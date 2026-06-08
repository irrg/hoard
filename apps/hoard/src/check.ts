import { spinner } from '@clack/prompts';
import { loginWeb as bohLogin } from '@irrg/bundleofholding-hoard';
import { Library as DrivethruLibrary } from '@irrg/drivethru-hoard';
import { loginAPI as itchioLogin } from '@irrg/itchio-hoard';

import { type HoardConfig, STOREFRONTS, type Storefront } from './config.js';

type CheckResult = { ok: true } | { ok: 'skip' } | { ok: false; reason: string };

function fmtError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as Error & { cause?: unknown }).cause;
  if (cause == null) return e.message;
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    const detail = cause.message || code || cause.name;
    return `${e.message}: ${detail}`;
  }
  return `${e.message}: ${String(cause)}`;
}

async function checkItchio(config: HoardConfig): Promise<CheckResult> {
  if (!config.HOARD_ITCHIO_USERNAME || !config.HOARD_ITCHIO_PASSWORD) {
    return { ok: 'skip' };
  }
  try {
    await itchioLogin(config.HOARD_ITCHIO_USERNAME, config.HOARD_ITCHIO_PASSWORD);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: fmtError(e) };
  }
}

async function checkDrivethru(config: HoardConfig): Promise<CheckResult> {
  if (!config.HOARD_DRIVETHRU_API_KEY) {
    return { ok: 'skip' };
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
    return { ok: false, reason: fmtError(e) };
  }
}

async function checkHumblebundle(config: HoardConfig): Promise<CheckResult> {
  if (!config.HOARD_HUMBLEBUNDLE_SESSION) {
    return { ok: 'skip' };
  }
  try {
    const r = await fetch('https://www.humblebundle.com/api/v1/user/order', {
      headers: { Cookie: `_simpleauth_sess=${config.HOARD_HUMBLEBUNDLE_SESSION}` },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: fmtError(e) };
  }
}

async function checkBundleofholding(config: HoardConfig): Promise<CheckResult> {
  if (!config.HOARD_BUNDLEOFHOLDING_EMAIL || !config.HOARD_BUNDLEOFHOLDING_PASSWORD) {
    return { ok: 'skip' };
  }
  try {
    await bohLogin(config.HOARD_BUNDLEOFHOLDING_EMAIL, config.HOARD_BUNDLEOFHOLDING_PASSWORD);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: fmtError(e) };
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
): Promise<boolean> {
  let anyFailed = false;
  for (const sf of storefronts) {
    const s = spinner();
    s.start(sf);
    const result = await CHECKERS[sf](config);
    if (result.ok === true) {
      s.stop(`✓ ${sf}`);
    } else if (result.ok === 'skip') {
      s.stop(`- ${sf}: not configured`);
    } else {
      s.stop(`✗ ${sf}: ${result.reason}`);
      anyFailed = true;
    }
  }
  return !anyFailed;
}
