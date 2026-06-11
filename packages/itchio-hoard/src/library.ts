import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

import type { RunTask } from '@irrg/hoard-core';

import { Game, GameData, OwnedKeyData } from './game.js';
import { fetchWithRetry, runConcurrently } from './utils.js';

export interface UserProfile {
  id: number;
  username: string;
  display_name?: string;
  url?: string;
  [key: string]: unknown;
}

export interface Collection {
  id: number;
  title: string;
  games_count?: number;
  [key: string]: unknown;
}

export interface BundleKey {
  id: number;
  bundle_id: number;
  purchase_id?: number;
  created_at?: string;
  bundle: {
    id: number;
    title: string;
    url?: string;
    games_count?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const MAX_JOBS = 8;

export interface LibraryOptions {
  jobs?: number;
  humanFolders?: boolean;
  outputDir?: string;
  dryRun?: boolean;
  filters?: string[];
  logger?: (msg: string) => void;
  onProgress?: (done: number, total: number, downloaded: number) => void;
  deep?: boolean;
  runTask?: RunTask;
}

export class Library {
  token: string;
  games: Game[];
  jobs: number;
  humanFolders: boolean;
  outputDir: string;
  dryRun: boolean;
  deep: boolean;
  filters: string[];
  private logger: (msg: string) => void;
  private onProgress?: (done: number, total: number, downloaded: number) => void;
  private runTask?: RunTask;

  constructor(
    token: string,
    jobs = 4,
    humanFolders = false,
    outputDir = 'downloads',
    dryRun = false,
    filters: string[] = [],
    logger: (msg: string) => void = () => {},
    onProgress?: (done: number, total: number, downloaded: number) => void,
    deep = false,
    runTask?: RunTask,
  ) {
    this.token = token;
    this.games = [];
    this.jobs = Math.min(jobs, MAX_JOBS);
    this.humanFolders = humanFolders;
    this.outputDir = outputDir;
    this.dryRun = dryRun;
    this.deep = deep;
    this.filters = filters.map((f) => f.toLowerCase());
    this.logger = logger;
    this.onProgress = onProgress;
    this.runTask = runTask;
  }

  async loadGamePage(page: number): Promise<number> {
    this.logger(`Loading page ${page}`);
    const keys = await this._fetchKeyPage(page);
    for (const s of keys) {
      this.games.push(
        new Game(
          s,
          this.humanFolders,
          this.outputDir,
          this.dryRun,
          this.logger,
          this.deep ?? false,
        ),
      );
    }
    return keys.length;
  }

  private async _fetchKeyPage(page: number): Promise<OwnedKeyData[]> {
    const r = await fetchWithRetry(`https://api.itch.io/profile/owned-keys?page=${page}`, {
      headers: { Authorization: this.token },
    });
    if (!r.ok) {
      throw new Error(`Failed to load owned keys page ${page}: HTTP ${r.status}`);
    }
    try {
      const j = (await r.json()) as { owned_keys?: OwnedKeyData[] };
      return Array.isArray(j.owned_keys) ? j.owned_keys : [];
    } catch {
      throw new Error(`Failed to parse page ${page} response`);
    }
  }

  private _makeGame(s: OwnedKeyData): Game {
    return new Game(
      s,
      this.humanFolders,
      this.outputDir,
      this.dryRun,
      this.logger,
      this.deep ?? false,
    );
  }

  async loadOwnedGames(): Promise<void> {
    const cacheFile = join(this.outputDir, '.data', 'owned-keys.json');

    const page1 = await this._fetchKeyPage(1);
    if (page1.length === 0) return;

    if (!this.deep && existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(await readFile(cacheFile, 'utf-8')) as OwnedKeyData[];
        const sentinelIds = page1.map((k) => k.id).join(',');
        const cachedHeadIds = cached
          .slice(0, page1.length)
          .map((k) => k.id)
          .join(',');
        if (sentinelIds === cachedHeadIds) {
          for (const s of cached) this.games.push(this._makeGame(s));
          return;
        }
      } catch {}
    }

    const allKeys = [...page1];
    let page = 2;
    while (true) {
      const keys = await this._fetchKeyPage(page);
      if (keys.length === 0) break;
      allKeys.push(...keys);
      page++;
    }

    for (const s of allKeys) this.games.push(this._makeGame(s));

    if (!this.dryRun) {
      try {
        await mkdir(dirname(cacheFile), { recursive: true });
        await writeFile(cacheFile, JSON.stringify(allKeys, null, 2));
      } catch {}
    }
  }

  async getProfile(): Promise<UserProfile | null> {
    const r = await fetchWithRetry('https://api.itch.io/profile', {
      headers: { Authorization: this.token },
    });
    if (!r.ok) {
      this.logger(`Failed to load profile (HTTP ${r.status})`);
      return null;
    }
    try {
      const j = (await r.json()) as { user?: UserProfile };
      return j.user ?? null;
    } catch {
      this.logger(`Failed to parse profile response`);
      return null;
    }
  }

  async loadCollections(): Promise<Collection[]> {
    const r = await fetchWithRetry('https://api.itch.io/profile/collections', {
      headers: { Authorization: this.token },
    });
    if (!r.ok) {
      this.logger(`Failed to load collections (HTTP ${r.status})`);
      return [];
    }
    try {
      const j = (await r.json()) as { collections?: Collection[] };
      return Array.isArray(j.collections) ? j.collections : [];
    } catch {
      this.logger(`Failed to parse collections response`);
      return [];
    }
  }

  async loadCollection(id: number): Promise<void> {
    let page = 1;
    while (true) {
      const r = await fetchWithRetry(
        `https://api.itch.io/collections/${id}/collection-games?page=${page}`,
        { headers: { Authorization: this.token } },
      );
      if (!r.ok) {
        this.logger(`Failed to load collection ${id} page ${page} (HTTP ${r.status}), stopping`);
        break;
      }
      let j: { collection_games?: Array<{ game: GameData }> };
      try {
        j = (await r.json()) as { collection_games?: Array<{ game: GameData }> };
      } catch {
        this.logger(`Failed to parse collection ${id} page ${page}, stopping`);
        break;
      }
      if (!Array.isArray(j.collection_games) || j.collection_games.length === 0) break;
      for (const item of j.collection_games) {
        this.games.push(
          new Game(
            { game: item.game } as OwnedKeyData,
            this.humanFolders,
            this.outputDir,
            this.dryRun,
            this.logger,
            this.deep ?? false,
          ),
        );
      }
      page++;
    }
  }

  async loadBundles(): Promise<BundleKey[]> {
    const r = await fetchWithRetry('https://api.itch.io/profile/owned-bundles', {
      headers: { Authorization: this.token },
    });
    if (!r.ok) {
      this.logger(`Failed to load bundles (HTTP ${r.status})`);
      return [];
    }
    try {
      const j = (await r.json()) as { bundle_keys?: BundleKey[] };
      return Array.isArray(j.bundle_keys) ? j.bundle_keys : [];
    } catch {
      this.logger(`Failed to parse bundles response`);
      return [];
    }
  }

  async loadBundle(id: number): Promise<void> {
    let page = 1;
    while (true) {
      const r = await fetchWithRetry(
        `https://api.itch.io/bundles/${id}/bundle-games?page=${page}`,
        { headers: { Authorization: this.token } },
      );
      if (!r.ok) {
        this.logger(`Failed to load bundle ${id} page ${page} (HTTP ${r.status}), stopping`);
        break;
      }
      let j: { bundle_games?: Array<{ game: GameData }> };
      try {
        j = (await r.json()) as { bundle_games?: Array<{ game: GameData }> };
      } catch {
        this.logger(`Failed to parse bundle ${id} page ${page}, stopping`);
        break;
      }
      if (!Array.isArray(j.bundle_games) || j.bundle_games.length === 0) break;
      for (const item of j.bundle_games) {
        this.games.push(
          new Game(
            { game: item.game } as OwnedKeyData,
            this.humanFolders,
            this.outputDir,
            this.dryRun,
            this.logger,
            this.deep ?? false,
          ),
        );
      }
      page++;
    }
  }

  async downloadLibrary(platform?: string): Promise<{ downloaded: number; errors: number }> {
    const games = this.filters.length
      ? this.games.filter((g) => this.filters.some((f) => g.name.toLowerCase().includes(f)))
      : this.games;
    const total = games.length;
    let downloaded = 0;
    let errors = 0;

    let done = 0;

    const tasks = games.map((g) => async () => {
      try {
        const result = await g.download(this.token, platform);
        if (result.newFiles > 0) {
          downloaded++;
          this.logger(`Downloaded ${g.name} (${downloaded} of ${total})`);
        }
        errors += result.errors;
      } catch (e) {
        this.logger(`Error downloading ${g.name}: ${e instanceof Error ? e.message : String(e)}`);
        errors++;
      }
      this.onProgress?.(++done, total, downloaded);
    });

    if (this.runTask) {
      await Promise.all(tasks.map((task) => this.runTask!(task)));
    } else {
      await runConcurrently(tasks, this.jobs);
    }
    return { downloaded, errors };
  }
}
