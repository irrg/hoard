#!/usr/bin/env tsx
/**
 * One-time migration: moves .md5 sidecars, old/ dirs, errors.txt, and
 * manifest JSONs into {storefront}/.data/ so download folders are clean.
 *
 * Usage:
 *   tsx migrate.ts [--dry-run] [outputDir]
 *
 * outputDir defaults to the value in ~/.hoard/config.json, or "downloads".
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { homedir } from "node:os";

const STOREFRONTS = ["itchio", "drivethru", "humblebundle", "bundleofholding"];

const dryRun = process.argv.includes("--dry-run");
const argDir = process.argv.filter((a) => !a.startsWith("-")).at(2);

async function resolveOutputDir(): Promise<string> {
  if (argDir) return argDir;
  const configPath = join(homedir(), ".hoard", "config.json");
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(await readFile(configPath, "utf-8")) as {
        HOARD_OUTPUT_DIR?: string;
      };
      if (cfg.HOARD_OUTPUT_DIR) return cfg.HOARD_OUTPUT_DIR;
    } catch {}
  }
  return "downloads";
}

interface Action {
  from: string;
  to: string;
  kind: "sidecar" | "old-dir" | "errors" | "manifest";
}

async function collectActions(libDir: string): Promise<Action[]> {
  const actions: Action[] = [];
  const dataDir = join(libDir, ".data");

  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent<string>[];
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: "utf-8" });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const rel = relative(libDir, fullPath);

      if (rel === ".data" || rel.startsWith(".data/")) continue;

      if (entry.isDirectory()) {
        if (entry.name === "old") {
          const relParent = relative(libDir, dir);
          actions.push({ from: fullPath, to: join(dataDir, relParent, "old"), kind: "old-dir" });
        } else {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const relDir = relative(libDir, dir);

        if (entry.name.endsWith(".md5")) {
          actions.push({ from: fullPath, to: join(dataDir, relDir, entry.name), kind: "sidecar" });
        } else if (entry.name === "errors.txt" && dir === libDir) {
          actions.push({ from: fullPath, to: join(dataDir, "errors.txt"), kind: "errors" });
        } else if (entry.name.endsWith(".json")) {
          // Manifest: JSON alongside a same-named directory (itchio/drivethru pattern)
          const base = entry.name.slice(0, -5);
          const sibling = join(dir, base);
          if (existsSync(sibling)) {
            try {
              if ((await stat(sibling)).isDirectory()) {
                actions.push({
                  from: fullPath,
                  to: join(dataDir, relDir, entry.name),
                  kind: "manifest",
                });
              }
            } catch {}
          }
        }
      }
    }
  }

  if (existsSync(libDir)) await walk(libDir);
  return actions;
}

const outputDir = await resolveOutputDir();
console.log(`Output directory: ${outputDir}`);
if (dryRun) console.log("(dry run — nothing will be moved)\n");

let total = 0;

for (const sf of STOREFRONTS) {
  const libDir = join(outputDir, sf);
  const actions = await collectActions(libDir);
  if (actions.length === 0) continue;

  console.log(`\n${sf}  (${actions.length} items):`);

  for (const { from, to, kind } of actions) {
    const fromRel = relative(outputDir, from);
    const toRel = relative(outputDir, to);
    console.log(`  [${kind.padEnd(8)}] ${fromRel}`);
    console.log(`             → ${toRel}`);

    if (!dryRun) {
      if (existsSync(to)) {
        console.log(`             (skipped — target already exists)`);
        continue;
      }
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
    }

    total++;
  }
}

if (total === 0) {
  console.log("\nNothing to migrate.");
} else {
  console.log(
    dryRun
      ? `\n${total} item(s) would be moved. Re-run without --dry-run to apply.`
      : `\n${total} item(s) moved.`,
  );
}
