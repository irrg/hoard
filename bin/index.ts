#!/usr/bin/env node
import { parseArgs } from "node:util";
import { intro, text, password, outro, isCancel, cancel } from "@clack/prompts";
import { loginAPI, Library } from "../src/index.js";

const argv = process.argv.slice(2);
const { values: args } = parseArgs({
  args: argv[0] === "--" ? argv.slice(1) : argv,
  options: {
    key: { type: "string", short: "k" },
    platform: { type: "string", short: "p" },
    human: { type: "boolean" },
    jobs: { type: "string", short: "j" },
    collections: { type: "boolean" },
    collection: { type: "string", short: "c" },
    bundles: { type: "boolean" },
    bundle: { type: "string", short: "b" },
    output: { type: "string", short: "o" },
    help: { type: "boolean", short: "h" },
  },
  strict: true,
});

if (args.help) {
  console.log(`Usage: itchcraft-dl [options]

Options:
  -k, --key <key>          API key (prompts for credentials if omitted)
  -p, --platform <name>    Filter by platform: windows, linux, osx, android
      --human              Use game titles for folder names instead of URL slugs
  -j, --jobs <n>           Concurrent downloads (default: 4, max: 8)
      --collections        List your itch.io collections and exit
  -c, --collection <id>    Download all games in a collection by ID
      --bundles            List your purchased bundles and exit
  -b, --bundle <id>        Download all games in a bundle by ID
  -o, --output <dir>       Output directory (default: downloads)
  -h, --help               Show this help`);
  process.exit(0);
}

let token = args.key ?? "";

if (!token) {
  intro("itchcraft");

  const user = await text({ message: "Username:" });
  if (isCancel(user)) {
    cancel();
    process.exit(1);
  }

  const pass = await password({ message: "Password:" });
  if (isCancel(pass)) {
    cancel();
    process.exit(1);
  }

  token = await loginAPI(user as string, pass as string);
}

const jobs = args.jobs != null ? parseInt(args.jobs, 10) : 4;
if (isNaN(jobs) || jobs < 1) {
  console.error(`Invalid --jobs value: "${args.jobs}". Must be a positive integer.`);
  process.exit(1);
}
const lib = new Library(token, jobs, args.human ?? false, args.output ?? "downloads");

if (args.collections) {
  const profile = await lib.getProfile();
  if (profile) {
    console.log(`Profile: ${profile.display_name ?? profile.username}`);
  }
  const collections = await lib.loadCollections();
  if (collections.length === 0) {
    console.log("No collections found.");
  } else {
    for (const c of collections) {
      console.log(`  [${c.id}] ${c.title} (${c.games_count ?? "?"} games)`);
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
  await lib.loadCollection(collectionId);
  await lib.downloadLibrary(args.platform);
  outro("Done.");
  process.exit(0);
}

if (args.bundles) {
  const profile = await lib.getProfile();
  if (profile) {
    console.log(`Profile: ${profile.display_name ?? profile.username}`);
  }
  const bundles = await lib.loadBundles();
  if (bundles.length === 0) {
    console.log("No bundles found.");
  } else {
    for (const bk of bundles) {
      console.log(`  [${bk.bundle.id}] ${bk.bundle.title} (${bk.bundle.games_count ?? "?"} games)`);
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
  await lib.loadBundle(bundleId);
  await lib.downloadLibrary(args.platform);
  outro("Done.");
  process.exit(0);
}

await lib.loadOwnedGames();
await lib.downloadLibrary(args.platform);

outro("Done.");
