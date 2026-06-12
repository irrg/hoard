# @irrg/hoard

## 0.4.0

### Minor Changes

- 3d06cfa: Add FairScheduler and ProviderRuntime for fair global concurrency

  - `FairScheduler`: registered providers retain a progress slot while active, with round-robin FIFO queues and a global connection limit
  - `ProviderRuntime` interface with `network<T>` and `filesystem<T>` capabilities; `directRuntime` no-op default for standalone use
  - All four providers now accept `runtime?: ProviderRuntime` in their options; individual network calls (fetchWithRetry, streamToFile) and filesystem calls (md5sum) are gated through the runtime rather than at the per-game task level
  - `hoard sync` registers configured storefronts in fair network and checksum schedulers; downloads use the global `jobs` limit while checksums use one round-robin disk slot
  - Provider libraries retain bounded per-game backpressure while individual network and checksum operations are gated at the call site

- 3d06cfa: Add --keep-old flag; fix checksum handling for watermarked files

  - `--keep-old`: new CLI flag that moves replaced files to `old/` with a timestamped name; default behavior is now to delete the old file rather than accumulate versions
  - Watermark/stale-checksum fix: when a downloaded file's MD5 differs from the API-reported checksum, the file is kept and the actual MD5 is stored in the sidecar; subsequent shallow runs skip the file correctly instead of looping forever
  - Sidecar integrity check: on shallow runs, if the stored sidecar MD5 differs from the API checksum, the actual file MD5 is compared to the sidecar before deciding to re-download; this correctly handles both watermarked files and genuine file corruption
  - `errors.txt` is now truncated at the start of each sync run so it reflects only the current run
  - Fix misleading "Downloading" log line in itchio and drivethru that fired before the existence check

### Patch Changes

- 92fde18: Fix exit status, job validation, and parallel sync scheduling

  - Humble partial inventory: failed order fetches now count toward the error total and produce a non-zero exit code instead of reporting success with a verbose warning only
  - `--jobs` flag now rejects non-integer values such as `4x` and `4.5`; previously `parseInt` silently accepted trailing garbage
  - Each storefront now gets its own `Scheduler(jobs)` instead of sharing a single global pool; previously a slow storefront (e.g. humblebundle md5-checking large files) would occupy all slots and stall the others for the duration of a run

- Updated dependencies [92fde18]
- Updated dependencies [3d06cfa]
- Updated dependencies [295068a]
- Updated dependencies [3d06cfa]
  - @irrg/itchio-hoard@0.4.0
  - @irrg/humblebundle-hoard@0.4.0
  - @irrg/drivethrurpg-hoard@0.4.0
  - @irrg/bundleofholding-hoard@0.4.0
  - @irrg/hoard-core@0.2.0

## 0.3.0

### Minor Changes

- a27ce2e: 0.3: global scheduler, atomic downloads, checksum-as-error

  - Private `@irrg/hoard-core` package bundled inline via tsup; providers have zero new runtime deps
  - Global `Scheduler` in apps/hoard — `--jobs N` now limits total concurrency across all providers, not per-provider
  - Atomic downloads: stream to `.partial`, rename on success, cleanup on failure — no truncated files survive interrupts
  - Post-download checksum mismatch is now an error: bad file moved to `old/`, sidecar not written, errors.txt entry added
  - Optional `runTask` in all provider `LibraryOptions` for external scheduler injection
  - Fix: bundleofholding sidecar path was stripping file extension
  - Fix: humblebundle `hasFiles` now correctly excludes the `old/` subdirectory

### Patch Changes

- Updated dependencies [a27ce2e]
  - @irrg/itchio-hoard@0.3.0
  - @irrg/humblebundle-hoard@0.3.0
  - @irrg/drivethru-hoard@0.3.0
  - @irrg/bundleofholding-hoard@0.3.0
