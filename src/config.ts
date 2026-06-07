import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_DIR = join(homedir(), ".hoard");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export const STOREFRONTS = ["itchio", "drivethru", "humblebundle", "bundleofholding"] as const;
export type Storefront = (typeof STOREFRONTS)[number];

export function isStorefront(s: string): s is Storefront {
  return (STOREFRONTS as readonly string[]).includes(s);
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
  HOARD_ITCHIO_USERNAME: "",
  HOARD_ITCHIO_PASSWORD: "",
  HOARD_HUMBLEBUNDLE_SESSION: "",
  HOARD_DRIVETHRU_API_KEY: "",
  HOARD_BUNDLEOFHOLDING_EMAIL: "",
  HOARD_BUNDLEOFHOLDING_PASSWORD: "",
  HOARD_BUNDLEOFHOLDING_COOKIE: "",
  HOARD_OUTPUT_DIR: "downloads",
  HOARD_JOBS: 4,
};

export async function readConfig(): Promise<HoardConfig> {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULTS };
  }
  const raw = await readFile(CONFIG_PATH, "utf-8");
  return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<HoardConfig>) };
}

export async function writeConfig(config: HoardConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
