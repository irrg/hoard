#!/usr/bin/env node
/**
 * Migrates old-format .md5 sidecars (base.md5) to new format (base.ext.md5).
 *
 * Old format stripped the file extension, causing collisions when a product
 * ships both .epub and .pdf with the same base name. New format keeps the full
 * filename so each format gets its own sidecar.
 *
 * Safe to run multiple times. Deletes old sidecars only after successful rename/write.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { createReadStream } from 'node:fs';

const DOWNLOAD_DIRS = [
  'downloads/humblebundle',
  'downloads/drivethru',
  'downloads/itchio',
  'downloads/bundleofholding',
];

const ROOT = new URL('..', import.meta.url).pathname;

async function md5File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    const stream = createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function oldSidecarPath(outputDir: string, filePath: string): string {
  const rel = relative(outputDir, filePath);
  const ext = extname(rel);
  const base = ext ? rel.slice(0, -ext.length) : rel;
  return join(outputDir, '.data', base + '.md5');
}

function newSidecarPath(outputDir: string, filePath: string): string {
  const rel = relative(outputDir, filePath);
  return join(outputDir, '.data', rel + '.md5');
}

function walkFiles(dir: string, dataDir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === dataDir) continue;
      results.push(...walkFiles(full, dataDir));
    } else if (entry.isFile() && !entry.name.startsWith('.')) {
      results.push(full);
    }
  }
  return results;
}

async function migrateStorefront(outputDir: string): Promise<void> {
  const dataDir = join(outputDir, '.data');
  const files = walkFiles(outputDir, dataDir);

  let migrated = 0;
  let written = 0;
  let skipped = 0;
  let collisions = 0;

  // Group files by their old sidecar path to detect collisions
  const byOldSidecar = new Map<string, string[]>();
  for (const f of files) {
    const old = oldSidecarPath(outputDir, f);
    const group = byOldSidecar.get(old) ?? [];
    group.push(f);
    byOldSidecar.set(old, group);
  }

  for (const [oldSidecar, group] of byOldSidecar) {
    if (!existsSync(oldSidecar)) {
      // No old sidecar — write new ones for files that lack them
      for (const f of group) {
        const newSidecar = newSidecarPath(outputDir, f);
        if (!existsSync(newSidecar)) {
          try {
            const hash = await md5File(f);
            await writeFile(newSidecar, hash);
            written++;
          } catch {
            // skip unreadable files
          }
        } else {
          skipped++;
        }
      }
      continue;
    }

    const storedHash = (await readFile(oldSidecar, 'utf8')).trim();

    if (group.length === 1) {
      // No collision — rename old sidecar to new path
      const newSidecar = newSidecarPath(outputDir, group[0]);
      if (!existsSync(newSidecar)) {
        await rename(oldSidecar, newSidecar);
        migrated++;
      } else {
        await unlink(oldSidecar);
        skipped++;
      }
    } else {
      // Collision — figure out which file the old sidecar belongs to
      collisions++;
      let matched = false;
      for (const f of group) {
        const newSidecar = newSidecarPath(outputDir, f);
        if (existsSync(newSidecar)) continue;
        try {
          const hash = await md5File(f);
          if (hash === storedHash) {
            await rename(oldSidecar, newSidecar);
            matched = true;
            migrated++;
            break;
          }
        } catch {
          // skip
        }
      }
      if (!matched && existsSync(oldSidecar)) {
        // Couldn't match — delete old sidecar, files will re-verify on next deep sync
        await unlink(oldSidecar);
      }
      // Write new sidecars for remaining files in the group
      for (const f of group) {
        const newSidecar = newSidecarPath(outputDir, f);
        if (!existsSync(newSidecar)) {
          try {
            const hash = await md5File(f);
            await writeFile(newSidecar, hash);
            written++;
          } catch {
            // skip
          }
        }
      }
    }
  }

  const rel = relative(ROOT, outputDir);
  console.log(`${rel}: ${migrated} migrated, ${written} written, ${skipped} skipped, ${collisions} collision groups resolved`);
}

for (const dir of DOWNLOAD_DIRS) {
  await migrateStorefront(join(ROOT, dir));
}
