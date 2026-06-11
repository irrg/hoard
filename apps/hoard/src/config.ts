import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_DIR = join(homedir(), '.hoard');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export const STOREFRONTS = ['itchio', 'drivethru', 'humblebundle', 'bundleofholding'] as const;
export type Storefront = (typeof STOREFRONTS)[number];

export function isStorefront(s: string): s is Storefront {
  return (STOREFRONTS as readonly string[]).includes(s);
}

export function parseJobsArg(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback;
  return /^\d+$/.test(raw) ? Number(raw) : NaN;
}

export interface HoardConfig {
  HOARD_ITCHIO_USERNAME: string;
  HOARD_ITCHIO_PASSWORD: string;
  HOARD_HUMBLEBUNDLE_SESSION: string;
  HOARD_DRIVETHRU_API_KEY: string;
  HOARD_BUNDLEOFHOLDING_EMAIL: string;
  HOARD_BUNDLEOFHOLDING_PASSWORD: string;
  HOARD_BUNDLEOFHOLDING_COOKIE: string;
  HOARD_OUTPUT_DIR: string;
  HOARD_JOBS: number;
}

const DEFAULTS: HoardConfig = {
  HOARD_ITCHIO_USERNAME: '',
  HOARD_ITCHIO_PASSWORD: '',
  HOARD_HUMBLEBUNDLE_SESSION: '',
  HOARD_DRIVETHRU_API_KEY: '',
  HOARD_BUNDLEOFHOLDING_EMAIL: '',
  HOARD_BUNDLEOFHOLDING_PASSWORD: '',
  HOARD_BUNDLEOFHOLDING_COOKIE: '',
  HOARD_OUTPUT_DIR: 'downloads',
  HOARD_JOBS: 4,
};

export async function readConfig(): Promise<HoardConfig> {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULTS };
  }
  await chmod(CONFIG_PATH, 0o600).catch(() => {});
  const raw = await readFile(CONFIG_PATH, 'utf-8');
  return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<HoardConfig>) };
}

export async function writeConfig(config: HoardConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await chmod(CONFIG_DIR, 0o700).catch(() => {});
  const tmp = `${CONFIG_PATH}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', {
      encoding: 'utf-8',
      mode: 0o600,
    });
    await rename(tmp, CONFIG_PATH);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
