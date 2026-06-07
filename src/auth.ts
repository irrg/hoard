import { cancel, confirm, intro, isCancel, outro, password, text } from "@clack/prompts";

import {
  CONFIG_PATH,
  type HoardConfig,
  type Storefront,
  readConfig,
  writeConfig,
} from "./config.js";

async function promptText(message: string, initialValue: string): Promise<string> {
  const val = await text({ message, initialValue });
  if (isCancel(val)) {
    cancel();
    process.exit(1);
  }
  return val as string;
}

async function promptPassword(message: string): Promise<string> {
  const val = await password({ message });
  if (isCancel(val)) {
    cancel();
    process.exit(1);
  }
  return val as string;
}

async function promptConfirm(message: string): Promise<boolean> {
  const val = await confirm({ message });
  if (isCancel(val)) {
    cancel();
    process.exit(1);
  }
  return val as boolean;
}

async function configureItchio(config: HoardConfig): Promise<void> {
  config.HOARD_ITCHIO_USERNAME = await promptText(
    "itch.io username:",
    config.HOARD_ITCHIO_USERNAME,
  );
  const pass = await promptPassword("itch.io password (press Enter to keep existing):");
  if (pass) config.HOARD_ITCHIO_PASSWORD = pass;
}

async function configureDrivethru(config: HoardConfig): Promise<void> {
  const key = await promptPassword("DriveThruRPG API key (press Enter to keep existing):");
  if (key) config.HOARD_DRIVETHRU_API_KEY = key;
}

async function configureHumblebundle(config: HoardConfig): Promise<void> {
  const sess = await promptPassword(
    "Humble Bundle _simpleauth_sess cookie (press Enter to keep existing):",
  );
  if (sess) config.HOARD_HUMBLEBUNDLE_SESSION = sess;
}

async function configureBundleofholding(config: HoardConfig): Promise<void> {
  config.HOARD_BUNDLEOFHOLDING_EMAIL = await promptText(
    "Bundle of Holding email:",
    config.HOARD_BUNDLEOFHOLDING_EMAIL,
  );
  const pass = await promptPassword("Bundle of Holding password (press Enter to keep existing):");
  if (pass) config.HOARD_BUNDLEOFHOLDING_PASSWORD = pass;
}

const CONFIGURERS: Record<Storefront, (config: HoardConfig) => Promise<void>> = {
  itchio: configureItchio,
  drivethru: configureDrivethru,
  humblebundle: configureHumblebundle,
  bundleofholding: configureBundleofholding,
};

export async function cmdAuth(storefronts: Storefront[]): Promise<void> {
  const config = await readConfig();

  if (storefronts.length > 0) {
    intro(`hoard auth ${storefronts.join(" ")}`);
    for (const sf of storefronts) {
      await CONFIGURERS[sf](config);
    }
  } else {
    intro("hoard auth");
    if (await promptConfirm("Configure itch.io?")) await configureItchio(config);
    if (await promptConfirm("Configure DriveThruRPG?")) await configureDrivethru(config);
    if (await promptConfirm("Configure Humble Bundle?")) await configureHumblebundle(config);
    if (await promptConfirm("Configure Bundle of Holding?")) await configureBundleofholding(config);

    config.HOARD_OUTPUT_DIR = await promptText("Output directory:", config.HOARD_OUTPUT_DIR);
    const jobsStr = await promptText("Concurrent downloads:", String(config.HOARD_JOBS));
    const jobs = parseInt(jobsStr, 10);
    config.HOARD_JOBS = isNaN(jobs) || jobs < 1 ? 4 : jobs;
  }

  await writeConfig(config);
  outro(`Config saved to ${CONFIG_PATH}`);
}
