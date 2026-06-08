import { spinner } from '@clack/prompts';
import { loginWeb as bohLogin } from '@irrg/bundleofholding-hoard';
import { Library as DrivethruLibrary } from '@irrg/drivethru-hoard';
import { loginAPI as itchioLogin } from '@irrg/itchio-hoard';

import { type HoardConfig, STOREFRONTS, type Storefront } from './config.js';

type CheckResult = { ok: true } | { ok: false; reason: string };

async function checkItchio(config: HoardConfig): Promise<CheckResult> {
  if (!config.HOARD_ITCHIO_USERNAME || !config.HOARD_ITCHIO_PASSWORD) {
    return { ok: false, reason: 'not configured' };
  }
  try {
    await itchioLogin(config.HOARD_ITCHIO_USERNAME, config.HOARD_ITCHIO_PASSWORD);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

async function checkDrivethru(config: HoardConfig): Promise<CheckResult> {
  if (!config.HOARD_DRIVETHRU_API_KEY) {
    return { ok: false, reason: 'not configured' };
  }
  try {
    const lib = new DrivethruLibrary({
      apiKey: config.HOARD_DRIVETHRU_API_KEY,
      outputDir: '',
      jobs: 1,
      compat: false,
      omitPublisher: false,
      dryRun: true,
      filters: [],
      logger: () => {},
    });
    await lib.authenticate();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

async function checkHumblebundle(config: HoardConfig): Promise<CheckResult> {
  if (!config.HOARD_HUMBLEBUNDLE_SESSION) {
    return { ok: false, reason: 'not configured' };
  }
  try {
    const r = await fetch('https://www.humblebundle.com/api/v1/user/order', {
      headers: { Cookie: `_simpleauth_sess=${config.HOARD_HUMBLEBUNDLE_SESSION}` },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

async function checkBundleofholding(config: HoardConfig): Promise<CheckResult> {
  if (!config.HOARD_BUNDLEOFHOLDING_EMAIL || !config.HOARD_BUNDLEOFHOLDING_PASSWORD) {
    return { ok: false, reason: 'not configured' };
  }
  try {
    await bohLogin(config.HOARD_BUNDLEOFHOLDING_EMAIL, config.HOARD_BUNDLEOFHOLDING_PASSWORD);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

const CHECKERS: Record<Storefront, (config: HoardConfig) => Promise<CheckResult>> = {
  itchio: checkItchio,
  drivethru: checkDrivethru,
  humblebundle: checkHumblebundle,
  bundleofholding: checkBundleofholding,
};

export async function cmdCheck(
  config: HoardConfig,
  storefronts: Storefront[] = [...STOREFRONTS],
): Promise<void> {
  for (const sf of storefronts) {
    const s = spinner();
    s.start(sf);
    const result = await CHECKERS[sf](config);
    if (result.ok) {
      s.stop(`✓ ${sf}`);
    } else {
      s.stop(`✗ ${sf}: ${result.reason}`);
    }
  }
}
