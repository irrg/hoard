# @irrg/bundleofholding-hoard

## 0.4.0

### Minor Changes

- 92fde18: Fix data integrity and error propagation issues across all providers

  - Partial-before-verify: hash `.partial` file before renaming to final path; unlink partial on mismatch instead of quarantining (corrupt freshly-downloaded files never reach the output path)
  - Deep mode sidecar bypass: when `--deep` is set, always re-hash the local file rather than trusting the sidecar
  - Quarantine filename collision: timestamp now includes milliseconds and a 4-digit hex random suffix (`YYYY-MM-DDTHH-MM-SS-mmm-xxxx`) to make same-second overwrites in `old/` astronomically unlikely
  - Error propagation: drivethru and itch.io providers now return discriminated `'downloaded' | 'skipped' | 'error'` from `doDownload()` and `{ newFiles, errors }` from `download()`, so per-file checksum and network failures are counted and surfaced in `downloadLibrary()` results
  - itch.io: 403/404 from the uploads endpoint is treated as "no access" (silent skip) rather than an error; affects bundle games and access-restricted items that will never have a downloadable file
  - itch.io: games with no downloadable file (browser-based tools, online character sheets) return `'skipped'` instead of `'error'` when the response carries no content-disposition header

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

- 295068a: Publish @irrg/hoard-core as a public package; providers depend on it at runtime

  Fixes a packaging defect in 0.3.0 where @irrg/hoard-core was marked private but
  referenced as a runtime dependency in the CLI and as an import in provider type
  declarations. Provider builds revert from tsup back to tsc; core is now a real
  published dependency rather than an inlined bundle.

- Updated dependencies [3d06cfa]
- Updated dependencies [295068a]
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
