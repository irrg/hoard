import { CONFIG_PATH, type Storefront, STOREFRONTS, readConfig } from './config.js';

export async function cmdStatus(storefronts: Storefront[] = [...STOREFRONTS]): Promise<void> {
  const config = await readConfig();

  const bohConfigured = config.HOARD_BUNDLEOFHOLDING_COOKIE
    ? config.HOARD_BUNDLEOFHOLDING_COOKIE
    : config.HOARD_BUNDLEOFHOLDING_EMAIL && config.HOARD_BUNDLEOFHOLDING_PASSWORD
      ? 'password'
      : '';

  const all: Record<Storefront, [string, boolean]> = {
    itchio: [config.HOARD_ITCHIO_USERNAME && config.HOARD_ITCHIO_PASSWORD ? 'password' : '', false],
    drivethru: [config.HOARD_DRIVETHRU_API_KEY, false],
    humblebundle: [config.HOARD_HUMBLEBUNDLE_SESSION, true],
    bundleofholding: [bohConfigured, config.HOARD_BUNDLEOFHOLDING_COOKIE !== ''],
  };

  console.log(`Config: ${CONFIG_PATH}`);
  console.log();

  for (const sf of storefronts) {
    const [cred, ephemeral] = all[sf];
    const label = sf.padEnd(20);
    if (!cred) {
      console.log(`  ✗ ${label} not configured`);
    } else if (ephemeral) {
      console.log(`  ~ ${label} configured (session cookie — may have expired)`);
    } else {
      console.log(`  ✓ ${label} configured`);
    }
  }

  console.log();
  console.log(`  Output dir: ${config.HOARD_OUTPUT_DIR}`);
  console.log(`  Jobs:       ${config.HOARD_JOBS}`);
}
