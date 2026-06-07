import { join } from "node:path";

import { fetchCabinet, Library as BoHLibrary, loginWeb } from "@irrg/bundleofholding-hoard";
import { Library as DrivethruLibrary } from "@irrg/drivethru-hoard";
import { Library as HumbleLibrary } from "@irrg/humblebundle-hoard";
import { Library as ItchioLibrary, loginAPI as itchioLogin } from "@irrg/itchio-hoard";
import cliProgress from "cli-progress";

import { type HoardConfig, type Storefront } from "./config.js";

type SyncResult = { ok: true; downloaded: number; errors: number } | { ok: false; reason: string };

const BAR_NAME_WIDTH = 16;

function barName(sf: string): string {
  return sf.padEnd(BAR_NAME_WIDTH);
}

async function syncItchio(
  config: HoardConfig,
  outputDir: string,
  jobs: number,
  deep: boolean,
  multiBar: cliProgress.MultiBar,
): Promise<SyncResult> {
  if (!config.HOARD_ITCHIO_USERNAME || !config.HOARD_ITCHIO_PASSWORD) {
    return { ok: false, reason: "not configured" };
  }
  try {
    const token = await itchioLogin(config.HOARD_ITCHIO_USERNAME, config.HOARD_ITCHIO_PASSWORD);
    let bar: cliProgress.SingleBar | null = null;
    const lib = new ItchioLibrary(
      token,
      jobs,
      false,
      join(outputDir, "itchio"),
      false,
      [],
      () => {},
      (done, _total, downloaded) => bar?.update(done, { downloaded }),
      deep,
    );
    await lib.loadOwnedGames();
    if (lib.games.length > 0)
      bar = multiBar.create(lib.games.length, 0, { name: barName("itchio"), downloaded: 0 });
    const { downloaded, errors } = await lib.downloadLibrary();
    return { ok: true, downloaded, errors };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

async function syncDrivethru(
  config: HoardConfig,
  outputDir: string,
  jobs: number,
  deep: boolean,
  multiBar: cliProgress.MultiBar,
): Promise<SyncResult> {
  if (!config.HOARD_DRIVETHRU_API_KEY) return { ok: false, reason: "not configured" };
  try {
    let bar: cliProgress.SingleBar | null = null;
    const lib = new DrivethruLibrary({
      apiKey: config.HOARD_DRIVETHRU_API_KEY,
      outputDir: join(outputDir, "drivethru"),
      jobs,
      compat: false,
      omitPublisher: false,
      dryRun: false,
      deep,
      filters: [],
      logger: () => {},
      onProgress: (done, _total, downloaded) => bar?.update(done, { downloaded }),
    });
    await lib.authenticate();
    await lib.loadProducts();
    if (lib.products.length > 0)
      bar = multiBar.create(lib.products.length, 0, { name: barName("drivethru"), downloaded: 0 });
    const { downloaded, errors } = await lib.downloadLibrary();
    return { ok: true, downloaded, errors };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

async function syncHumblebundle(
  config: HoardConfig,
  outputDir: string,
  jobs: number,
  deep: boolean,
  multiBar: cliProgress.MultiBar,
): Promise<SyncResult> {
  if (!config.HOARD_HUMBLEBUNDLE_SESSION) return { ok: false, reason: "not configured" };
  try {
    let bar: cliProgress.SingleBar | null = null;
    const lib = new HumbleLibrary({
      cookie: config.HOARD_HUMBLEBUNDLE_SESSION,
      outputDir: join(outputDir, "humblebundle"),
      jobs,
      extInclude: [],
      extExclude: [],
      dryRun: false,
      deep,
      filters: [],
      logger: () => {},
      onProgress: (done, _total, downloaded) => bar?.update(done, { downloaded }),
    });
    await lib.loadOrders();
    const hbTotal = lib.bundles.reduce((sum, b) => sum + b.totalFiles(), 0);
    if (hbTotal > 0)
      bar = multiBar.create(hbTotal, 0, {
        name: barName("humblebundle"),
        downloaded: 0,
      });
    const { downloaded, errors } = await lib.downloadLibrary();
    return { ok: true, downloaded, errors };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

async function syncBundleofholding(
  config: HoardConfig,
  outputDir: string,
  jobs: number,
  deep: boolean,
  multiBar: cliProgress.MultiBar,
): Promise<SyncResult> {
  const hasCookie = !!config.HOARD_BUNDLEOFHOLDING_COOKIE;
  const hasCredentials =
    !!config.HOARD_BUNDLEOFHOLDING_EMAIL && !!config.HOARD_BUNDLEOFHOLDING_PASSWORD;
  if (!hasCookie && !hasCredentials) return { ok: false, reason: "not configured" };
  try {
    let cookie = config.HOARD_BUNDLEOFHOLDING_COOKIE;
    if (!cookie) {
      cookie = await loginWeb(
        config.HOARD_BUNDLEOFHOLDING_EMAIL,
        config.HOARD_BUNDLEOFHOLDING_PASSWORD,
      );
    }
    const bundles = await fetchCabinet(cookie);
    let bar: cliProgress.SingleBar | null = null;
    const lib = new BoHLibrary({
      outputDir: join(outputDir, "bundleofholding"),
      jobs,
      dryRun: false,
      deep,
      cookie,
      filters: [],
      logger: () => {},
      onProgress: (done, _total, downloaded) => bar?.update(done, { downloaded }),
    });
    if (bundles.length > 0)
      bar = multiBar.create(bundles.length, 0, { name: barName("bundleofholding"), downloaded: 0 });
    const { downloaded, errors } = await lib.downloadBundles(bundles);
    return { ok: true, downloaded, errors };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function cmdSync(
  storefronts: Storefront[],
  config: HoardConfig,
  outputDir: string,
  jobs: number,
  deep = false,
): Promise<void> {
  const multiBar = new cliProgress.MultiBar(
    {
      format: "{name} |{bar}| {value}/{total} ({downloaded} new)",
      barCompleteChar: "█",
      barIncompleteChar: "░",
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: false,
    },
    cliProgress.Presets.shades_classic,
  );

  const resultPairs = await Promise.all(
    storefronts.map(async (sf) => {
      let result: SyncResult;
      switch (sf) {
        case "itchio":
          result = await syncItchio(config, outputDir, jobs, deep, multiBar);
          break;
        case "drivethru":
          result = await syncDrivethru(config, outputDir, jobs, deep, multiBar);
          break;
        case "humblebundle":
          result = await syncHumblebundle(config, outputDir, jobs, deep, multiBar);
          break;
        case "bundleofholding":
          result = await syncBundleofholding(config, outputDir, jobs, deep, multiBar);
          break;
      }
      return { storefront: sf, result };
    }),
  );

  multiBar.stop();

  console.log();
  for (const { storefront, result } of resultPairs) {
    const label = storefront.padEnd(20);
    if (result.ok) {
      console.log(`✓ ${label} — ${result.downloaded} new, ${result.errors} errors`);
    } else {
      console.log(`✗ ${label} — ${result.reason}`);
    }
  }
}
