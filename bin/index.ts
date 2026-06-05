#!/usr/bin/env node
import { parseArgs } from "node:util";
import { intro, text, outro, isCancel, cancel } from "@clack/prompts";
import { Library } from "../src/index.js";

const argv = process.argv.slice(2);
const { values: args } = parseArgs({
  args: argv[0] === "--" ? argv.slice(1) : argv,
  options: {
    key: { type: "string", short: "k" },
    jobs: { type: "string", short: "j" },
    output: { type: "string", short: "o" },
    "dry-run": { type: "boolean" },
    "omit-publisher": { type: "boolean" },
    compat: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
  strict: true,
});

if (args.help) {
  console.log(`Usage: drivethruwindow [options]

Options:
  -k, --key <key>        DriveThruRPG API key (prompts if omitted)
  -j, --jobs <n>         Concurrent downloads (default: 4)
  -o, --output <dir>     Output directory (default: downloads)
      --dry-run          Show what would be downloaded without downloading
      --omit-publisher   Skip publisher directory level
      --compat           Use DriveThruRPG client naming convention
  -h, --help             Show this help`);
  process.exit(0);
}

let apiKey = args.key ?? "";

if (!apiKey) {
  intro("drivethruwindow");

  const key = await text({ message: "DriveThruRPG API key:" });
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

const lib = new Library({
  apiKey,
  outputDir: args.output ?? "downloads",
  jobs,
  compat: args.compat ?? false,
  omitPublisher: args["omit-publisher"] ?? false,
  dryRun: args["dry-run"] ?? false,
});

await lib.authenticate();
await lib.loadProducts();
await lib.downloadLibrary();

outro("Done.");
