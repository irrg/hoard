import { existsSync, readdirSync } from 'fs';
import { writeFile, readFile, mkdir, rename, unlink, appendFile } from 'fs/promises';
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

    if (!r.ok) {
      this.logger(`Failed to load downloads for ${this.name} (HTTP ${r.status}), skipping`);
      return;
    }

    let j: { uploads: Upload[] };
    try {
      j = (await r.json()) as { uploads: Upload[] };
    } catch {
      throw new Error(`Failed to parse downloads for ${this.name}`);
    }

    this.downloads = Array.isArray(j.uploads) ? j.uploads : [];
  }

  async download(token: string, platform?: string): Promise<{ newFiles: number; errors: number }> {
    if (!this.deep && hasFiles(this.dir)) return { newFiles: 0, errors: 0 };
    this.logger(`Downloading ${this.name}`);

    try {
      await this.loadDownloads(token);
    } catch (e) {
      this.logger(
        `Failed to load downloads for ${this.name}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { newFiles: 0, errors: 1 };
    }

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

    if (eligible.length === 0) return { newFiles: 0, errors: 0 };

    await mkdir(this.dir, { recursive: true });

    const filenameGroups = new Map<string, Upload[]>();
    for (const d of eligible) {
      const base = cleanPath(d.filename ?? d.display_name ?? String(d.id));
      const key = base.toLowerCase();
      const arr = filenameGroups.get(key) ?? [];
      arr.push(d);
      filenameGroups.set(key, arr);
    }

    let wrote = 0;
    let errors = 0;
    for (const d of eligible) {
      const base = cleanPath(d.filename ?? d.display_name ?? String(d.id));
      const key = base.toLowerCase();
      const group = filenameGroups.get(key)!;
      const filename = group.length > 1 ? disambiguateFilename(base, d.id) : base;
      const result = await this.doDownload(d, token, filename);
      if (result === 'downloaded') wrote++;
      else if (result === 'error') errors++;
    }

    if (wrote === 0) return { newFiles: 0, errors };

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
    return { newFiles: wrote, errors };
  }

  async doDownload(
    d: Upload,
    token: string,
    filename: string,
  ): Promise<'downloaded' | 'skipped' | 'error'> {
    const outFile = path.join(this.dir, filename);
    const md5Hash = d.md5_hash?.toLowerCase();

    if (this.dryRun) {
      this.logger(`Dry run: ${this.name} - ${filename}`);
      return 'skipped';
    }

    this.logger(`Downloading ${filename}`);

    if (existsSync(outFile)) {
      this.logger(`File already exists: ${filename}`);

      if (!md5Hash) {
        this.logger(`Skipping ${this.name} - ${filename}`);
        return 'skipped';
      }

      const md5File = sidecarPath(this.outputDir, outFile);

      if (existsSync(md5File) && !this.deep) {
        const storedMd5 = (await readFile(md5File, 'utf8')).trim();
        if (storedMd5 === md5Hash) {
          this.logger(`Skipping ${this.name} - ${filename}`);
          return 'skipped';
        }
        this.logger(`Checksum mismatch: ${filename}`);
      } else {
        const computed = await md5sum(outFile);
        if (computed === md5Hash) {
          this.logger(`Skipping ${this.name} - ${filename}`);
          await mkdir(path.dirname(md5File), { recursive: true });
          await writeFile(md5File, md5Hash);
          return 'skipped';
        }
      }

      const oldDir = path.join(this.dir, 'old');
      await mkdir(oldDir, { recursive: true });

      this.logger(`Moving ${filename} to old/`);
      const timestamp = `${new Date().toISOString().slice(0, 23).replace(/[:.]/g, '-')}-${Math.floor(
        Math.random() * 0x10000,
      )
        .toString(16)
        .padStart(4, '0')}`;
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
      return 'error';
    }

    if (!sessionJson.uuid) {
      this.logger(
        `No session UUID for ${this.name} (HTTP ${sessionResp.status}), skipping ${filename}`,
      );
      return 'error';
    }

    const downloadUrl = this.id
      ? `https://api.itch.io/uploads/${d.id}/download?api_key=${token}&download_key_id=${this.id}&uuid=${sessionJson.uuid}`
      : `https://api.itch.io/uploads/${d.id}/download?api_key=${token}&uuid=${sessionJson.uuid}`;

    const partialFilename = filename + '.partial';
    const partialPath = path.join(this.dir, partialFilename);
    try {
      await download(downloadUrl, this.dir, this.name, partialFilename, this.logger);
    } catch (e) {
      await unlink(partialPath).catch(() => {});
      if (e instanceof NoDownloadError) {
        this.logger(`${this.name} - ${filename}: no downloadable file (web-only), skipping`);
        return 'skipped';
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
        return 'error';
      }

      throw e;
    }

    if (md5Hash) {
      const computed = await md5sum(partialPath);
      if (computed !== md5Hash) {
        await unlink(partialPath).catch(() => {});
        this.logger(`Checksum mismatch after download: ${filename}`);
        await this._logError(outFile, filename, '', 'checksum mismatch after download');
        return 'error';
      }
    }

    await rename(partialPath, outFile);

    if (md5Hash) {
      const md5File = sidecarPath(this.outputDir, outFile);
      await mkdir(path.dirname(md5File), { recursive: true });
      await writeFile(md5File, md5Hash);
    }

    return 'downloaded';
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

function disambiguateFilename(filename: string, id: number): string {
  const ext = path.extname(filename);
  const base = ext ? filename.slice(0, -ext.length) : filename;
  return `${base}_${id}${ext}`;
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
