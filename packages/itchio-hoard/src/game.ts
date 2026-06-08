import { existsSync } from 'fs';
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

  constructor(data: OwnedKeyData, humanFolders = false, outputDir = 'downloads', dryRun = false) {
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
  }

  async loadDownloads(token: string): Promise<void> {
    this.downloads = [];

    const url = this.id
      ? `https://api.itch.io/games/${this.gameId}/uploads?download_key_id=${this.id}`
      : `https://api.itch.io/games/${this.gameId}/uploads`;

    const r = await fetchWithRetry(url, { headers: { Authorization: token } });
    let j: { uploads: Upload[] };

    try {
      j = (await r.json()) as { uploads: Upload[] };
    } catch {
      console.log(`Failed to load downloads for ${this.name} (HTTP ${r.status}), skipping`);
      return;
    }

    this.downloads = Array.isArray(j.uploads) ? j.uploads : [];
  }

  async download(token: string, platform?: string): Promise<void> {
    console.log('Downloading', this.name);

    await this.loadDownloads(token);

    const eligible = this.downloads.filter((d) => {
      if (platform != null && Array.isArray(d.traits)) {
        const platformTraits = d.traits.filter((t) => t.startsWith('p_'));
        if (platformTraits.length > 0 && !platformTraits.includes(`p_${platform}`)) {
          console.log(
            `Skipping ${this.name} - ${d.filename ?? d.id} (${platformTraits.join(', ')})`,
          );
          return false;
        }
      }
      return true;
    });

    if (eligible.length === 0) return;

    await mkdir(this.dir, { recursive: true });

    let wrote = 0;
    for (const d of eligible) {
      if (await this.doDownload(d, token)) wrote++;
    }

    if (wrote === 0) return;

    const manifestPath = this.dir + '.json';
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
  }

  async doDownload(d: Upload, token: string): Promise<boolean> {
    const rawFilename = d.filename ?? d.display_name ?? String(d.id);
    const filename = cleanPath(rawFilename);
    const outFile = path.join(this.dir, filename);
    const md5Hash = d.md5_hash;

    if (this.dryRun) {
      console.log(`Dry run: ${this.name} - ${filename}`);
      return false;
    }

    console.log(`Downloading ${filename}`);

    if (existsSync(outFile)) {
      console.log(`File already exists: ${filename}`);

      if (!md5Hash) {
        console.log(`Skipping ${this.name} - ${filename}`);
        return true;
      }

      const md5File = withSuffix(outFile, '.md5');

      if (existsSync(md5File)) {
        const storedMd5 = (await readFile(md5File, 'utf8')).trim();
        if (storedMd5 === md5Hash) {
          console.log(`Skipping ${this.name} - ${filename}`);
          return true;
        }
        console.log(`Checksum mismatch: ${filename}`);
      } else {
        const computed = await md5sum(outFile);
        if (computed === md5Hash) {
          console.log(`Skipping ${this.name} - ${filename}`);
          await writeFile(md5File, md5Hash);
          return true;
        }
      }

      const oldDir = path.join(this.dir, 'old');
      await mkdir(oldDir, { recursive: true });

      console.log(`Moving ${filename} to old/`);
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
    );

    let sessionJson: { uuid?: string };
    try {
      sessionJson = (await sessionResp.json()) as { uuid?: string };
    } catch {
      console.log(
        `Failed to start download session for ${this.name} (HTTP ${sessionResp.status}), skipping ${filename}`,
      );
      return false;
    }

    if (!sessionJson.uuid) {
      console.log(
        `No session UUID for ${this.name} (HTTP ${sessionResp.status}), skipping ${filename}`,
      );
      return false;
    }

    const downloadUrl = this.id
      ? `https://api.itch.io/uploads/${d.id}/download?api_key=${token}&download_key_id=${this.id}&uuid=${sessionJson.uuid}`
      : `https://api.itch.io/uploads/${d.id}/download?api_key=${token}&uuid=${sessionJson.uuid}`;

    try {
      await download(downloadUrl, this.dir, this.name, filename);
    } catch (e) {
      if (e instanceof NoDownloadError) {
        console.log(`HTTP response is not a download, skipping`);
        await this._logError(
          outFile,
          filename,
          downloadUrl,
          'Missing content-disposition header — skipped, please download manually',
        );
        return false;
      }

      if (e instanceof Error) {
        console.log(`Download failed: ${this.name} - ${filename}`);
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
      await writeFile(withSuffix(outFile, '.md5'), computed);
      if (computed !== md5Hash) {
        console.log(`Failed to verify ${filename}`);
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
    await appendFile(
      path.join(this.outputDir, 'errors.txt'),
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

function withSuffix(filePath: string, newExt: string): string {
  const ext = path.extname(filePath);
  return ext ? filePath.slice(0, -ext.length) + newExt : filePath + newExt;
}
