#!/usr/bin/env node
import { parseArgs } from "node:util";
import { intro, text, password as passwordPrompt, outro, isCancel, cancel } from "@clack/prompts";
import { loginWeb } from "../src/index.js";
const argv = process.argv.slice(2);
const { values: args } = parseArgs({
    args: argv[0] === "--" ? argv.slice(1) : argv,
    options: {
        key: { type: "string", short: "k", multiple: true },
        email: { type: "string", short: "e" },
        password: { type: "string", short: "p" },
        jobs: { type: "string", short: "j" },
        output: { type: "string", short: "o" },
        "dry-run": { type: "boolean" },
        list: { type: "boolean" },
        help: { type: "boolean", short: "h" },
    },
    strict: true,
});
if (args.help) {
    console.log(`Usage: bundleofholding-hoard [options]

Options:
  -k, --key <key>        Download page key(s); repeat or comma-separate for multiple
  -e, --email <email>    Account email (prompts if omitted and no key given)
  -p, --password <pass>  Account password (prompts if omitted and no key given)
  -j, --jobs <n>         Concurrent downloads (default: 4)
  -o, --output <dir>     Output directory (default: downloads)
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
// Expand comma-separated keys
const keys = (args.key ?? []).flatMap((k) => k.split(",").map((s) => s.trim())).filter(Boolean);
let cookie;
if (keys.length === 0) {
    // Need account login
    intro("bundleofholding-hoard");
    let email = args.email ?? "";
    let pass = args.password ?? "";
    if (!email) {
        const val = await text({ message: "Bundle of Holding email:" });
        if (isCancel(val)) {
            cancel();
            process.exit(1);
        }
        email = val;
    }
    if (!pass) {
        const val = await passwordPrompt({ message: "Password:" });
        if (isCancel(val)) {
            cancel();
            process.exit(1);
        }
        pass = val;
    }
    console.log("Logging in...");
    cookie = await loginWeb(email, pass);
    console.log("Logged in.");
    // TODO: fetch Wizard's Cabinet to enumerate keys
    console.log("(Wizard's Cabinet enumeration not yet implemented)");
    outro("Done.");
    process.exit(0);
}
// TODO: fetch and download each key
console.log(`Keys: ${keys.join(", ")}`);
console.log("(Download not yet implemented — awaiting HTML sample)");
outro("Done.");
