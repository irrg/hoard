import { Game, GameData, OwnedKeyData } from './game.js';
import { NoDownloadError, fetchWithRetry, runConcurrently } from './utils.js';

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

export class Library {
  token: string;
  games: Game[];
  jobs: number;
  humanFolders: boolean;
  outputDir: string;
  dryRun: boolean;
  filters: string[];
  private logger: (msg: string) => void;
  private onProgress?: (done: number, total: number, downloaded: number) => void;

  constructor(
    token: string,
    jobs = 4,
    humanFolders = false,
    outputDir = 'downloads',
    dryRun = false,
    filters: string[] = [],
    logger: (msg: string) => void = () => {},
    onProgress?: (done: number, total: number, downloaded: number) => void,
  ) {
    this.token = token;
    this.games = [];
    this.jobs = Math.min(jobs, MAX_JOBS);
    this.humanFolders = humanFolders;
    this.outputDir = outputDir;
    this.dryRun = dryRun;
    this.filters = filters.map((f) => f.toLowerCase());
    this.logger = logger;
    this.onProgress = onProgress;
  }

  async loadGamePage(page: number): Promise<number> {
    this.logger(`Loading page ${page}`);
    const r = await fetchWithRetry(`https://api.itch.io/profile/owned-keys?page=${page}`, {
      headers: { Authorization: this.token },
    });

    let j: { owned_keys?: OwnedKeyData[] };
    try {
      j = (await r.json()) as { owned_keys?: OwnedKeyData[] };
    } catch {
      this.logger(`Failed to load page ${page} (HTTP ${r.status}), stopping pagination`);
      return 0;
    }

    if (!Array.isArray(j.owned_keys) || j.owned_keys.length === 0) return 0;

    for (const s of j.owned_keys) {
      this.games.push(new Game(s, this.humanFolders, this.outputDir, this.dryRun, this.logger));
    }

    return j.owned_keys.length;
  }

  async loadOwnedGames(): Promise<void> {
    let page = 1;
    while (true) {
      const n = await this.loadGamePage(page);
      if (n === 0) break;
      page++;
    }
  }

  async getProfile(): Promise<UserProfile | null> {
    const r = await fetchWithRetry('https://api.itch.io/profile', {
      headers: { Authorization: this.token },
    });
    try {
      const j = (await r.json()) as { user?: UserProfile };
      return j.user ?? null;
    } catch {
      this.logger(`Failed to load profile (HTTP ${r.status})`);
      return null;
    }
  }

  async loadCollections(): Promise<Collection[]> {
    const r = await fetchWithRetry('https://api.itch.io/profile/collections', {
      headers: { Authorization: this.token },
    });
    try {
      const j = (await r.json()) as { collections?: Collection[] };
      return Array.isArray(j.collections) ? j.collections : [];
    } catch {
      this.logger(`Failed to load collections (HTTP ${r.status})`);
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
      let j: { collection_games?: Array<{ game: GameData }> };
      try {
        j = (await r.json()) as { collection_games?: Array<{ game: GameData }> };
      } catch {
        this.logger(`Failed to load collection ${id} page ${page} (HTTP ${r.status}), stopping`);
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
    try {
      const j = (await r.json()) as { bundle_keys?: BundleKey[] };
      return Array.isArray(j.bundle_keys) ? j.bundle_keys : [];
    } catch {
      this.logger(`Failed to load bundles (HTTP ${r.status})`);
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
      let j: { bundle_games?: Array<{ game: GameData }> };
      try {
        j = (await r.json()) as { bundle_games?: Array<{ game: GameData }> };
      } catch {
        this.logger(`Failed to load bundle ${id} page ${page} (HTTP ${r.status}), stopping`);
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
        const hadNewFiles = await g.download(this.token, platform);
        if (hadNewFiles) {
          downloaded++;
          this.logger(`Downloaded ${g.name} (${downloaded} of ${total})`);
        }
      } catch (e) {
        if (e instanceof NoDownloadError) {
          this.logger(String(e));
          errors++;
        } else {
          throw e;
        }
      }
      this.onProgress?.(++done, total, downloaded);
    });

    await runConcurrently(tasks, this.jobs);
    return { downloaded, errors };
  }
}
