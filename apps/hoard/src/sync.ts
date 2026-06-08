import { join } from 'node:path';

import { fetchCabinet, Library as BoHLibrary, loginWeb } from '@irrg/bundleofholding-hoard';
import { Library as DrivethruLibrary } from '@irrg/drivethru-hoard';
import { Library as HumbleLibrary } from '@irrg/humblebundle-hoard';
import { Library as ItchioLibrary, loginAPI as itchioLogin } from '@irrg/itchio-hoard';
import cliProgress from 'cli-progress';

import { type HoardConfig, type Storefront } from './config.js';

type SyncResult =
  | { ok: true; total: number; downloaded: number; errors: number }
  | { ok: 'skip' }
  | { ok: false; reason: string };

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

const BAR_NAME_WIDTH = 16;

function barName(sf: string): string {
  return sf.padEnd(BAR_NAME_WIDTH);
}

function barStatus(done: number, total: number, downloaded: number): string {
  const parts = [`${total} total`, `${downloaded} new`];
  const remaining = total - done;
  if (remaining > 0) parts.push(`${remaining} comparing`);
  return parts.join(', ');
}

async function syncItchio(
  config: HoardConfig,
  outputDir: string,
  jobs: number,
  deep: boolean,
  bar: cliProgress.SingleBar,
): Promise<SyncResult> {
  if (!config.HOARD_ITCHIO_USERNAME || !config.HOARD_ITCHIO_PASSWORD) {
    return { ok: 'skip' };
  }
  try {
    const token = await itchioLogin(config.HOARD_ITCHIO_USERNAME, config.HOARD_ITCHIO_PASSWORD);
    let lastTotal = 0;
    const lib = new ItchioLibrary(
      token,
      jobs,
      false,
      join(outputDir, 'itchio'),
      false,
      [],
      () => {},
      (done, total, downloaded) => {
        lastTotal = total;
        bar.update(done, { status: barStatus(done, total, downloaded) });
      },
      deep,
    );
    await lib.loadOwnedGames();
    lastTotal = lib.games.length;
    bar.setTotal(lib.games.length);
    bar.update(0, { status: barStatus(0, lib.games.length, 0) });
    const { downloaded, errors } = await lib.downloadLibrary();
    return { ok: true, total: lastTotal, downloaded, errors };
  } catch (e) {
    return { ok: false, reason: fmtError(e) };
  }
}

async function syncDrivethru(
  config: HoardConfig,
  outputDir: string,
  jobs: number,
  deep: boolean,
  bar: cliProgress.SingleBar,
): Promise<SyncResult> {
  if (!config.HOARD_DRIVETHRU_API_KEY) return { ok: 'skip' };
  try {
    let lastTotal = 0;
    const lib = new DrivethruLibrary({
      apiKey: config.HOARD_DRIVETHRU_API_KEY,
      outputDir: join(outputDir, 'drivethru'),
      jobs,
      compat: false,
      omitPublisher: false,
      dryRun: false,
      deep,
      filters: [],
      logger: () => {},
      onProgress: (done, total, downloaded) => {
        lastTotal = total;
        bar.update(done, { status: barStatus(done, total, downloaded) });
      },
    });
    await lib.authenticate();
    await lib.loadProducts();
    lastTotal = lib.products.length;
    bar.setTotal(lib.products.length);
    bar.update(0, { status: barStatus(0, lib.products.length, 0) });
    const { downloaded, errors } = await lib.downloadLibrary();
    return { ok: true, total: lastTotal, downloaded, errors };
  } catch (e) {
    return { ok: false, reason: fmtError(e) };
  }
}

async function syncHumblebundle(
  config: HoardConfig,
  outputDir: string,
  jobs: number,
  deep: boolean,
  bar: cliProgress.SingleBar,
): Promise<SyncResult> {
  if (!config.HOARD_HUMBLEBUNDLE_SESSION) return { ok: 'skip' };
  try {
    let lastTotal = 0;
    const lib = new HumbleLibrary({
      cookie: config.HOARD_HUMBLEBUNDLE_SESSION,
      outputDir: join(outputDir, 'humblebundle'),
      jobs,
      extInclude: [],
      extExclude: [],
      dryRun: false,
      deep,
      filters: [],
      logger: () => {},
      onProgress: (done, total, downloaded) => {
        lastTotal = total;
        bar.update(done, { status: barStatus(done, total, downloaded) });
      },
    });
    await lib.loadOrders();
    lastTotal = lib.bundles.reduce((sum, b) => sum + b.totalFiles(), 0);
    bar.setTotal(lastTotal);
    bar.update(0, { status: barStatus(0, lastTotal, 0) });
    const { downloaded, errors } = await lib.downloadLibrary();
    return { ok: true, total: lastTotal, downloaded, errors };
  } catch (e) {
    return { ok: false, reason: fmtError(e) };
  }
}

async function syncBundleofholding(
  config: HoardConfig,
  outputDir: string,
  jobs: number,
  deep: boolean,
  bar: cliProgress.SingleBar,
): Promise<SyncResult> {
  const hasCookie = !!config.HOARD_BUNDLEOFHOLDING_COOKIE;
  const hasCredentials =
    !!config.HOARD_BUNDLEOFHOLDING_EMAIL && !!config.HOARD_BUNDLEOFHOLDING_PASSWORD;
  if (!hasCookie && !hasCredentials) return { ok: 'skip' };
  try {
    let cookie = config.HOARD_BUNDLEOFHOLDING_COOKIE;
    if (!cookie) {
      cookie = await loginWeb(
        config.HOARD_BUNDLEOFHOLDING_EMAIL,
        config.HOARD_BUNDLEOFHOLDING_PASSWORD,
      );
    }
    const bundles = await fetchCabinet(cookie);
    let lastTotal = 0;
    const lib = new BoHLibrary({
      outputDir: join(outputDir, 'bundleofholding'),
      jobs,
      dryRun: false,
      deep,
      cookie,
      filters: [],
      logger: () => {},
      onLoadPage: (loaded, total, filesFound) => {
        bar.update(0, { status: `loading ${loaded}/${total}, ${filesFound} files` });
      },
      onProgress: (done, total, downloaded) => {
        lastTotal = total;
        if (done === 0) {
          bar.setTotal(total);
          bar.update(0, { status: barStatus(0, total, 0) });
        } else {
          bar.update(done, { status: barStatus(done, total, downloaded) });
        }
      },
    });
    const { downloaded, errors } = await lib.downloadBundles(bundles);
    return { ok: true, total: lastTotal, downloaded, errors };
  } catch (e) {
    return { ok: false, reason: fmtError(e) };
  }
}

export async function cmdSync(
  storefronts: Storefront[],
  config: HoardConfig,
  outputDir: string,
  jobs: number,
  deep = false,
): Promise<boolean> {
  const multiBar = new cliProgress.MultiBar(
    {
      format: '{name} |{bar}| {status}',
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: false,
    },
    cliProgress.Presets.shades_classic,
  );

  const bars = new Map(
    storefronts.map((sf) => [sf, multiBar.create(1, 0, { name: barName(sf), status: '...' })]),
  );

  const results = await Promise.all(
    storefronts.map(async (sf) => {
      const bar = bars.get(sf)!;
      let result: SyncResult;
      switch (sf) {
        case 'itchio':
          result = await syncItchio(config, outputDir, jobs, deep, bar);
          break;
        case 'drivethru':
          result = await syncDrivethru(config, outputDir, jobs, deep, bar);
          break;
        case 'humblebundle':
          result = await syncHumblebundle(config, outputDir, jobs, deep, bar);
          break;
        case 'bundleofholding':
          result = await syncBundleofholding(config, outputDir, jobs, deep, bar);
          break;
      }
      bar.setTotal(1);
      bar.update(1, {
        status:
          result.ok === true
            ? [
                `✓ ${result.total} total`,
                `${result.downloaded} new`,
                result.errors > 0 ? `${result.errors} errors` : '',
              ]
                .filter(Boolean)
                .join(', ')
            : result.ok === 'skip'
              ? '- not configured'
              : `✗ ${result.reason}`,
      });
      return result;
    }),
  );

  multiBar.stop();

  const totalItems = results.reduce((s, r) => s + (r.ok === true ? r.total : 0), 0);
  const totalNew = results.reduce((s, r) => s + (r.ok === true ? r.downloaded : 0), 0);
  const totalErrors = results.reduce((s, r) => s + (r.ok === true ? r.errors : 0), 0);
  const anyFailed = results.some((r) => r.ok === false);
  const summary = [`${totalItems} total`, `${totalNew} new`];
  if (totalErrors > 0) summary.push(`${totalErrors} errors`);
  console.log(`\n${summary.join(', ')}`);
  return !anyFailed && totalErrors === 0;
}
