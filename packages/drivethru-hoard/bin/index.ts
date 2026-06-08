#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { intro, text, outro, isCancel, cancel } from '@clack/prompts';
import * as cliProgress from 'cli-progress';

import { Library } from '../src/index.js';

const argv = process.argv.slice(2);
const { values: args } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: {
    key: { type: 'string', short: 'k' },
    jobs: { type: 'string', short: 'j' },
    output: { type: 'string', short: 'o' },
    filter: { type: 'string', short: 'f', multiple: true },
    'dry-run': { type: 'boolean' },
    'omit-publisher': { type: 'boolean' },
    compat: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (args.help) {
  console.log(`Usage: drivethru-hoard [options]

Options:
  -k, --key <key>        DriveThruRPG API key (prompts if omitted)
  -j, --jobs <n>         Concurrent downloads (default: 4)
  -o, --output <dir>     Output directory (default: downloads)
  -f, --filter <term>    Filter products by name (case-insensitive substring); repeat for multiple
      --dry-run          Show what would be downloaded without downloading
      --omit-publisher   Skip publisher directory level
      --compat           Use DriveThruRPG client naming convention
  -h, --help             Show this help`);
  process.exit(0);
}

let apiKey = args.key ?? '';

if (!apiKey) {
  try {
    const raw = await readFile(join(homedir(), '.hoard', 'config.json'), 'utf-8');
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    apiKey = (cfg['HOARD_DRIVETHRU_API_KEY'] as string) ?? '';
  } catch {
    // no config
  }
}

if (!apiKey) {
  intro('drivethru-hoard');

  const key = await text({ message: 'DriveThruRPG API key:' });
  if (isCancel(key)) {
    cancel();
    process.exit(1);
  }
  apiKey = key as string;
}

const jobs = args.jobs != null ? parseInt(args.jobs, 10) : 4;
if (isNaN(jobs) || jobs < 1) {
  console.error(`Invalid --jobs value: "${args.jobs}". Must be a positive integer.`);
  process.exit(1);
}

const barOptions = (): cliProgress.Options => ({
  format: 'Downloading |{bar}| {value}/{total} ({downloaded} new)',
});

let bar: cliProgress.SingleBar | null = null;

const lib = new Library({
  apiKey,
  outputDir: args.output ?? 'downloads',
  jobs,
  compat: args.compat ?? false,
  omitPublisher: args['omit-publisher'] ?? false,
  dryRun: args['dry-run'] ?? false,
  filters: args.filter ?? [],
  logger: () => {},
  onProgress: (done, total, downloaded) => bar?.update(done, { downloaded }),
});

process.stdout.write('Authenticating...\n');
await lib.authenticate();
process.stdout.write('Loading product list...\n');
await lib.loadProducts();

bar = new cliProgress.SingleBar(barOptions(), cliProgress.Presets.shades_classic);
bar.start(lib.products.length, 0, { downloaded: 0 });
const result = await lib.downloadLibrary();
bar.stop();

outro(`Downloaded ${result.downloaded} new files, ${result.errors} errors.`);
