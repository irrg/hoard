#!/usr/bin/env node
import { parseArgs } from "node:util";

import { type Storefront, STOREFRONTS, isStorefront, readConfig } from "../src/config.js";
import { cmdAuth } from "../src/auth.js";
import { cmdCheck } from "../src/check.js";
import { cmdStatus } from "../src/status.js";
import { cmdSync } from "../src/sync.js";

const argv = process.argv.slice(2);
const { values: args, positionals } = parseArgs({
  args: argv[0] === "--" ? argv.slice(1) : argv,
  options: {
    jobs: { type: "string", short: "j" },
    output: { type: "string", short: "o" },
    deep: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
  strict: true,
});

const HELP = `Usage: hoard <command> [options]

Commands:
  auth [storefront...]        Configure credentials (all storefronts if none given)
  check [storefront...]       Verify credentials (all storefronts if none given)
  status [storefront...]      Show configuration and credential state
  sync [storefront...]        Sync all configured storefronts, or specific ones

Storefronts: ${STOREFRONTS.join(", ")}

Options:
  -j, --jobs <n>      Concurrent downloads (overrides config)
  -o, --output <dir>  Output directory (overrides config)
      --deep          Per-file md5 verification (default: skip if folder exists)
  -h, --help          Show this help`;

if (args.help && positionals.length === 0) {
  console.log(HELP);
  process.exit(0);
}

const [command, ...rest] = positionals;

if (!command) {
  console.log(HELP);
  process.exit(0);
}

function parseStorefronts(names: string[]): Storefront[] {
  for (const sf of names) {
    if (!isStorefront(sf)) {
      console.error(`Unknown storefront: "${sf}"\nValid storefronts: ${STOREFRONTS.join(", ")}`);
      process.exit(1);
    }
  }
  return names as Storefront[];
}

switch (command) {
  case "auth": {
    await cmdAuth(parseStorefronts(rest));
    break;
  }

  case "check": {
    const config = await readConfig();
    await cmdCheck(config, parseStorefronts(rest));
    break;
  }

  case "status": {
    await cmdStatus(parseStorefronts(rest));
    break;
  }

  case "sync": {
    const config = await readConfig();

    const jobs = args.jobs != null ? parseInt(args.jobs, 10) : config.HOARD_JOBS;
    if (isNaN(jobs) || jobs < 1) {
      console.error(`Invalid --jobs value: "${args.jobs}". Must be a positive integer.`);
      process.exit(1);
    }

    const outputDir = args.output ?? config.HOARD_OUTPUT_DIR;
    await cmdSync(
      parseStorefronts(rest.length > 0 ? rest : [...STOREFRONTS]),
      config,
      outputDir,
      jobs,
      args.deep ?? false,
    );
    break;
  }

  default: {
    console.error(`Unknown command: "${command}"\n`);
    console.log(HELP);
    process.exit(1);
  }
}
