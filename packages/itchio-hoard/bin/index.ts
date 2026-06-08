#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { intro, text, password, outro, isCancel, cancel } from '@clack/prompts';
import cliProgress from 'cli-progress';

import { loginAPI, Library } from '../src/index.js';

const argv = process.argv.slice(2);
const { values: args } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: {
    key: { type: 'string', short: 'k' },
    user: { type: 'string', short: 'u' },
    password: { type: 'string', short: 'p' },
    platform: { type: 'string' },
    human: { type: 'boolean' },
    jobs: { type: 'string', short: 'j' },
    collections: { type: 'boolean' },
    collection: { type: 'string', short: 'c' },
    bundles: { type: 'boolean' },
    bundle: { type: 'string', short: 'b' },
    output: { type: 'string', short: 'o' },
    filter: { type: 'string', short: 'f', multiple: true },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (args.help) {
  console.log(`Usage: itchio-hoard [options]

Options:
  -k, --key <key>          API key (alternative to username/password)
  -u, --user <username>    itch.io username
  -p, --password <pass>    itch.io password
      --platform <name>    Filter by platform: windows, linux, osx, android
      --human              Use game titles for folder names instead of URL slugs
  -j, --jobs <n>           Concurrent downloads (default: 4, max: 8)
      --collections        List your itch.io collections and exit
  -c, --collection <id>    Download all games in a collection by ID
      --bundles            List your purchased bundles and exit
  -b, --bundle <id>        Download all games in a bundle by ID
  -o, --output <dir>       Output directory (default: downloads)
  -f, --filter <term>      Filter games by name (case-insensitive substring); repeat for multiple
      --dry-run            Show what would be downloaded without downloading
  -h, --help               Show this help`);
  process.exit(0);
}

let token = args.key ?? '';

if (!token) {
  try {
    const raw = await readFile(join(homedir(), '.hoard', 'config.json'), 'utf-8');
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    token = (cfg['HOARD_ITCHIO_API_KEY'] as string) ?? '';
  } catch {
    // no config
  }
}

if (!token) {
  if (args.user && args.password) {
    token = await loginAPI(args.user, args.password);
  } else {
    intro('itchio-hoard');

    let username = args.user ?? '';
    if (!username) {
      const val = await text({ message: 'Username:' });
      if (isCancel(val)) {
        cancel();
        process.exit(1);
      }
      username = val as string;
    }

    let pass = args.password ?? '';
    if (!pass) {
      const val = await password({ message: 'Password:' });
      if (isCancel(val)) {
        cancel();
        process.exit(1);
      }
      pass = val as string;
    }

    token = await loginAPI(username, pass);
  }
}

const jobs = args.jobs != null ? parseInt(args.jobs, 10) : 4;
if (isNaN(jobs) || jobs < 1) {
  console.error(`Invalid --jobs value: "${args.jobs}". Must be a positive integer.`);
  process.exit(1);
}

let bar: cliProgress.SingleBar | null = null;

const lib = new Library(
  token,
  jobs,
  args.human ?? false,
  args.output ?? 'downloads',
  args['dry-run'] ?? false,
  args.filter ?? [],
  () => {},
  (done, total, downloaded) => bar?.update(done, { downloaded }),
);

if (args.collections) {
  const profile = await lib.getProfile();
  if (profile) {
    console.log(`Profile: ${profile.display_name ?? profile.username}`);
  }
  const collections = await lib.loadCollections();
  if (collections.length === 0) {
    console.log('No collections found.');
  } else {
    for (const c of collections) {
      console.log(`  [${c.id}] ${c.title} (${c.games_count ?? '?'} games)`);
    }
  }
  process.exit(0);
}

if (args.collection != null) {
  const collectionId = parseInt(args.collection, 10);
  if (isNaN(collectionId) || collectionId < 1) {
    console.error(`Invalid --collection value: "${args.collection}". Must be a positive integer.`);
    process.exit(1);
  }
  process.stdout.write('Loading collection...\n');
  await lib.loadCollection(collectionId);
  bar = new cliProgress.SingleBar(barOptions(), cliProgress.Presets.shades_classic);
  bar.start(lib.games.length, 0, { downloaded: 0 });
  const result = await lib.downloadLibrary(args.platform);
  bar.stop();
  outro(`Downloaded ${result.downloaded} games, ${result.errors} errors`);
  process.exit(0);
}

if (args.bundles) {
  const profile = await lib.getProfile();
  if (profile) {
    console.log(`Profile: ${profile.display_name ?? profile.username}`);
  }
  const bundles = await lib.loadBundles();
  if (bundles.length === 0) {
    console.log('No bundles found.');
  } else {
    for (const bk of bundles) {
      console.log(`  [${bk.bundle.id}] ${bk.bundle.title} (${bk.bundle.games_count ?? '?'} games)`);
    }
  }
  process.exit(0);
}

if (args.bundle != null) {
  const bundleId = parseInt(args.bundle, 10);
  if (isNaN(bundleId) || bundleId < 1) {
    console.error(`Invalid --bundle value: "${args.bundle}". Must be a positive integer.`);
    process.exit(1);
  }
  process.stdout.write('Loading bundle...\n');
  await lib.loadBundle(bundleId);
  bar = new cliProgress.SingleBar(barOptions(), cliProgress.Presets.shades_classic);
  bar.start(lib.games.length, 0, { downloaded: 0 });
  const result = await lib.downloadLibrary(args.platform);
  bar.stop();
  outro(`Downloaded ${result.downloaded} games, ${result.errors} errors`);
  process.exit(0);
}

process.stdout.write('Loading library...\n');
await lib.loadOwnedGames();
bar = new cliProgress.SingleBar(barOptions(), cliProgress.Presets.shades_classic);
bar.start(lib.games.length, 0);
const result = await lib.downloadLibrary(args.platform);
bar.stop();
outro(`Downloaded ${result.downloaded} games, ${result.errors} errors`);

function barOptions(): cliProgress.Options {
  return {
    format: 'Downloading |{bar}| {value}/{total} ({downloaded} new)',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
  };
}
