# @irrg/drivethru-hoard

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
