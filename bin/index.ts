#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { intro, text, password, outro, isCancel, cancel } from '@clack/prompts';

import { Library } from '../src/index.js';

const argv = process.argv.slice(2);
const { values: args } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: {
    key: { type: 'string', short: 'k' },
    jobs: { type: 'string', short: 'j' },
    output: { type: 'string', short: 'o' },
    platform: { type: 'string', short: 'p' },
    'ext-include': { type: 'string' },
    'ext-exclude': { type: 'string' },
    bundles: { type: 'boolean' },
    bundle: { type: 'string', short: 'b' },
    filter: { type: 'string', short: 'f', multiple: true },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (args.help) {
  console.log(`Usage: humblebundle-hoard [options]

Options:
  -k, --key <cookie>       Humble Bundle session cookie (prompts if omitted)
  -j, --jobs <n>           Concurrent downloads (default: 4)
  -o, --output <dir>       Output directory (default: downloads)
  -p, --platform <name>    Filter by platform (ebook, video, linux, etc.)
      --ext-include <exts> Only download these extensions, comma-separated (e.g. pdf,epub)
      --ext-exclude <exts> Skip these extensions, comma-separated
      --bundles            List your Humble Bundle orders and exit
  -b, --bundle <key>       Download a specific order by key
  -f, --filter <term>      Filter items by name (case-insensitive substring); repeat for multiple
      --dry-run            Show what would be downloaded without downloading
  -h, --help               Show this help`);
  process.exit(0);
}

if (args['ext-include'] && args['ext-exclude']) {
  console.error('Cannot use --ext-include and --ext-exclude together.');
  process.exit(1);
}

let cookie = args.key ?? '';

if (!cookie) {
  intro('humblebundle-hoard');

  const val = await password({ message: 'Humble Bundle session cookie (_simpleauth_sess):' });
  if (isCancel(val)) {
    cancel();
    process.exit(1);
  }
  cookie = val as string;
}

const jobs = args.jobs != null ? parseInt(args.jobs, 10) : 4;
if (isNaN(jobs) || jobs < 1) {
  console.error(`Invalid --jobs value: "${args.jobs}". Must be a positive integer.`);
  process.exit(1);
}

function parseExtList(val?: string): string[] {
  if (!val) return [];
  return val
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

const lib = new Library({
  cookie,
  outputDir: args.output ?? 'downloads',
  jobs,
  platform: args.platform,
  extInclude: parseExtList(args['ext-include']),
  extExclude: parseExtList(args['ext-exclude']),
  dryRun: args['dry-run'] ?? false,
  filters: args.filter ?? [],
});

if (args.bundles) {
  await lib.loadOrders();
  if (lib.bundles.length === 0) {
    console.log('No orders found.');
  } else {
    for (const b of lib.bundles) {
      console.log(`  [${b.key}] ${b.title}`);
    }
  }
  process.exit(0);
}

if (args.bundle != null) {
  await lib.loadOrder(args.bundle);
  await lib.downloadLibrary();
  outro('Done.');
  process.exit(0);
}

await lib.loadOrders();
await lib.downloadLibrary();

outro('Done.');
