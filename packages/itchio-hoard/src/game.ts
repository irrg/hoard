import { existsSync, readdirSync } from 'fs';
import { writeFile, readFile, mkdir, rename, appendFile } from 'fs/promises';
import path from 'path';

import { cleanPath, download, fetchWithRetry, md5sum, NoDownloadError } from './utils.js';

export interface GameData {
  title: string;
  user?: { username: string; display_name?: string };
  url: string;
  id: number;
  [key: string]: unknown;
}

export interface OwnedKeyData {
  id?: number;
  game_id?: number;
  game: GameData;
  [key: string]: unknown;
}

export interface Upload {
  id: number;
  filename?: string;
  display_name?: string;
  traits?: string[];
  md5_hash?: string;
  [key: string]: unknown;
}

export class Game {
  data: GameData;
  name: string;
  publisher: string;
  link: string;
  id: number | false;
  gameId: number;
  gameSlug: string;
  publisherSlug: string;
  dir: string;
  outputDir: string;
  downloads: Upload[];
  dryRun: boolean;
  deep: boolean;
  private logger: (msg: string) => void;

  constructor(
    data: OwnedKeyData,
    humanFolders = false,
    outputDir = 'downloads',
    dryRun = false,
    logger: (msg: string) => void = () => {},
    deep = false,
  ) {
    this.data = data.game;
    this.name = this.data.title;
    this.link = this.data.url;

    const matches = this.link.match(/https:\/\/(.+)\.itch\.io\/(.+)/);
    if (!matches) throw new Error(`Cannot parse game URL: ${this.link}`);

    this.publisher = this.data.user?.username ?? matches[1];

    if ('game_id' in data && data.game_id != null) {
      this.id = data.id as number;
      this.gameId = data.game_id;
    } else {
      this.id = false;
      this.gameId = this.data.id;
    }

    if (humanFolders) {
      this.gameSlug = cleanPath(this.data.title);
      this.publisherSlug = cleanPath(
        this.data.user?.display_name ?? this.data.user?.username ?? matches[1],
      );
    } else {
      this.publisherSlug = matches[1];
      this.gameSlug = matches[2];
    }

    this.outputDir = outputDir;
    this.dir = path.join(outputDir, cleanPath(this.publisherSlug), cleanPath(this.gameSlug));
    this.downloads = [];
    this.dryRun = dryRun;
    this.deep = deep;
    this.logger = logger;
  }

  async loadDownloads(token: string): Promise<void> {
    this.downloads = [];

    const url = this.id
      ? `https://api.itch.io/games/${this.gameId}/uploads?download_key_id=${this.id}`
      : `https://api.itch.io/games/${this.gameId}/uploads`;

    const r = await fetchWithRetry(url, { headers: { Authorization: token } }, 3, this.logger);
    let j: { uploads: Upload[] };

    try {
      j = (await r.json()) as { uploads: Upload[] };
    } catch {
      this.logger(`Failed to load downloads for ${this.name} (HTTP ${r.status}), skipping`);
      return;
    }

    this.downloads = Array.isArray(j.uploads) ? j.uploads : [];
  }

  async download(token: string, platform?: string): Promise<boolean> {
    if (!this.deep && hasFiles(this.dir)) return false;
    this.logger(`Downloading ${this.name}`);

    await this.loadDownloads(token);

    const eligible = this.downloads.filter((d) => {
      if (platform != null && Array.isArray(d.traits)) {
        const platformTraits = d.traits.filter((t) => t.startsWith('p_'));
        if (platformTraits.length > 0 && !platformTraits.includes(`p_${platform}`)) {
          this.logger(
            `Skipping ${this.name} - ${d.filename ?? d.id} (${platformTraits.join(', ')})`,
          );
          return false;
        }
      }
      return true;
    });

    if (eligible.length === 0) return false;

    await mkdir(this.dir, { recursive: true });

    let wrote = 0;
    for (const d of eligible) {
      if (await this.doDownload(d, token)) wrote++;
    }

    if (wrote === 0) return false;

    const manifestPath = path.join(
      this.outputDir,
      '.data',
      path.relative(this.outputDir, this.dir) + '.json',
    );
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          name: this.name,
          publisher: this.publisher,
          link: this.link,
          itch_id: this.id,
          game_id: this.gameId,
          itch_data: this.data,
        },
        null,
        2,
      ),
    );
    return true;
  }

  async doDownload(d: Upload, token: string): Promise<boolean> {
    const rawFilename = d.filename ?? d.display_name ?? String(d.id);
    const filename = cleanPath(rawFilename);
    const outFile = path.join(this.dir, filename);
    const md5Hash = d.md5_hash?.toLowerCase();

    if (this.dryRun) {
      this.logger(`Dry run: ${this.name} - ${filename}`);
      return false;
    }

    this.logger(`Downloading ${filename}`);

    if (existsSync(outFile)) {
      this.logger(`File already exists: ${filename}`);

      if (!md5Hash) {
        this.logger(`Skipping ${this.name} - ${filename}`);
        return false;
      }

      const md5File = sidecarPath(this.outputDir, outFile);

      if (existsSync(md5File)) {
        const storedMd5 = (await readFile(md5File, 'utf8')).trim();
        if (storedMd5 === md5Hash) {
          this.logger(`Skipping ${this.name} - ${filename}`);
          return false;
        }
        this.logger(`Checksum mismatch: ${filename}`);
      } else {
        const computed = await md5sum(outFile);
        if (computed === md5Hash) {
          this.logger(`Skipping ${this.name} - ${filename}`);
          await mkdir(path.dirname(md5File), { recursive: true });
          await writeFile(md5File, md5Hash);
          return false;
        }
      }

      const oldDir = path.join(this.dir, 'old');
      await mkdir(oldDir, { recursive: true });

      this.logger(`Moving ${filename} to old/`);
      const timestamp = new Date().toISOString().split('T')[0];
      await rename(outFile, path.join(oldDir, `${timestamp}-${filename}`));
    }

    // Get download session UUID
    const sessionResp = await fetchWithRetry(
      `https://api.itch.io/games/${this.gameId}/download-sessions`,
      {
        method: 'POST',
        headers: { Authorization: token },
      },
      3,
      this.logger,
    );

    let sessionJson: { uuid?: string };
    try {
      sessionJson = (await sessionResp.json()) as { uuid?: string };
    } catch {
      this.logger(
        `Failed to start download session for ${this.name} (HTTP ${sessionResp.status}), skipping ${filename}`,
      );
      return false;
    }

    if (!sessionJson.uuid) {
      this.logger(
        `No session UUID for ${this.name} (HTTP ${sessionResp.status}), skipping ${filename}`,
      );
      return false;
    }

    const downloadUrl = this.id
      ? `https://api.itch.io/uploads/${d.id}/download?api_key=${token}&download_key_id=${this.id}&uuid=${sessionJson.uuid}`
      : `https://api.itch.io/uploads/${d.id}/download?api_key=${token}&uuid=${sessionJson.uuid}`;

    try {
      await download(downloadUrl, this.dir, this.name, filename, this.logger);
    } catch (e) {
      if (e instanceof NoDownloadError) {
        this.logger(`HTTP response is not a download, skipping`);
        await this._logError(
          outFile,
          filename,
          downloadUrl,
          'Missing content-disposition header — skipped, please download manually',
        );
        return false;
      }

      if (e instanceof Error) {
        this.logger(`Download failed: ${this.name} - ${filename}`);
        const code = (e as NodeJS.ErrnoException).code ?? 'unknown';
        await this._logError(
          outFile,
          filename,
          downloadUrl,
          `Code: ${code}, reason: ${e.message} — skipped, please download manually`,
        );
        return false;
      }

      throw e;
    }

    if (md5Hash) {
      const computed = await md5sum(outFile);
      const md5File = sidecarPath(this.outputDir, outFile);
      await mkdir(path.dirname(md5File), { recursive: true });
      await writeFile(md5File, md5Hash);
      if (computed !== md5Hash) {
        this.logger(`Failed to verify ${filename}`);
      }
    }

    return true;
  }

  private async _logError(
    outFile: string,
    filename: string,
    requestUrl: string,
    detail: string,
  ): Promise<void> {
    const safeUrl = requestUrl.replace(/api_key=[^&]+/, 'api_key=REDACTED');
    const errorsFile = path.join(this.outputDir, '.data', 'errors.txt');
    await mkdir(path.dirname(errorsFile), { recursive: true });
    await appendFile(
      errorsFile,
      [
        ` Cannot download game/asset: ${this.gameSlug}`,
        ` Publisher Name: ${this.publisherSlug}`,
        ` Path: ${outFile}`,
        ` File: ${filename}`,
        ` Request URL: ${safeUrl}`,
        ` ${detail}`,
        ` ---------------------------------------------------------\n`,
      ].join('\n'),
    );
  }
}

function hasFiles(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((e) => !String(e).startsWith('.') && e !== 'old');
  } catch {
    return false;
  }
}

function sidecarPath(outputDir: string, filePath: string): string {
  const rel = path.relative(outputDir, filePath);
  return path.join(outputDir, '.data', rel + '.md5');
}
