#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { intro, text, password as passwordPrompt, outro, isCancel, cancel } from '@clack/prompts';
import cliProgress from 'cli-progress';

import { loginWeb, fetchCabinet, Library } from '../src/index.js';

const argv = process.argv.slice(2);
const { values: args } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: {
    key: { type: 'string', short: 'k', multiple: true },
    email: { type: 'string', short: 'e' },
    password: { type: 'string', short: 'p' },
    cookie: { type: 'string', short: 'c' },
    jobs: { type: 'string', short: 'j' },
    output: { type: 'string', short: 'o' },
    filter: { type: 'string', short: 'f', multiple: true },
    'dry-run': { type: 'boolean' },
    list: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (args.help) {
  console.log(`Usage: bundleofholding-hoard [options]

Options:
  -k, --key <key>        Limit to specific bundle key(s); repeat or comma-separate for multiple
                         (omit to download all bundles from your Wizard's Cabinet)
  -e, --email <email>    Account email
  -p, --password <pass>  Account password
  -c, --cookie <value>   Session cookie (alternative to email/password)
  -j, --jobs <n>         Concurrent downloads (default: 4)
  -o, --output <dir>     Output directory (default: downloads)
  -f, --filter <term>    Filter files by name (case-insensitive substring); repeat for multiple
      --dry-run          Show what would be downloaded without downloading
      --list             List files and exit without downloading
  -h, --help             Show this help`);
  process.exit(0);
}

const jobs = args.jobs != null ? parseInt(args.jobs, 10) : 4;
if (isNaN(jobs) || jobs < 1) {
  console.error(`Invalid --jobs value: "${args.jobs}". Must be a positive integer.`);
  process.exit(1);
}

const keys = (args.key ?? []).flatMap((k) => k.split(',').map((s) => s.trim())).filter(Boolean);

let cookie = '';
let bundles: { name: string; key: string }[];

if (args.cookie) {
  cookie = args.cookie;
} else {
  try {
    const raw = await readFile(join(homedir(), '.hoard', 'config.json'), 'utf-8');
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    const savedCookie = (cfg['HOARD_BUNDLEOFHOLDING_COOKIE'] as string) ?? '';
    const savedEmail = (cfg['HOARD_BUNDLEOFHOLDING_EMAIL'] as string) ?? '';
    const savedPassword = (cfg['HOARD_BUNDLEOFHOLDING_PASSWORD'] as string) ?? '';
    if (savedCookie) {
      cookie = savedCookie;
    } else if (savedEmail && savedPassword) {
      cookie = await loginWeb(savedEmail, savedPassword);
    }
  } catch {
    // no config
  }
}

if (!cookie) {
  intro('bundleofholding-hoard');

  let email = args.email ?? '';
  let pass = args.password ?? '';

  if (!email) {
    const val = await text({ message: 'Bundle of Holding email:' });
    if (isCancel(val)) {
      cancel();
      process.exit(1);
    }
    email = val as string;
  }

  if (!pass) {
    const val = await passwordPrompt({ message: 'Password:' });
    if (isCancel(val)) {
      cancel();
      process.exit(1);
    }
    pass = val as string;
  }

  cookie = await loginWeb(email, pass);
}

function barOptions(): cliProgress.Options {
  return {
    format: 'Downloading |{bar}| {value}/{total} ({downloaded} new)',
  };
}

let bar: cliProgress.SingleBar | null = null;

const lib = new Library({
  outputDir: args.output ?? 'downloads',
  jobs,
  dryRun: args['dry-run'] ?? false,
  cookie,
  filters: args.filter ?? [],
  logger: () => {},
  onProgress: (done, total, downloaded) => bar?.update(done, { downloaded }),
});

if (keys.length > 0) {
  bundles = keys.map((k) => ({ name: k, key: k }));
} else {
  process.stdout.write("Fetching Wizard's Cabinet...\n");
  bundles = await fetchCabinet(cookie);
  process.stdout.write(`Found ${bundles.length} bundle(s).\n`);
}

if (args.list) {
  await lib.listBundles(bundles);
} else {
  bar = new cliProgress.SingleBar(barOptions(), cliProgress.Presets.shades_classic);
  bar.start(bundles.length, 0, { downloaded: 0 });
  const result = await lib.downloadBundles(bundles);
  bar.stop();
  outro(`Downloaded ${result.downloaded} new files.`);
}
