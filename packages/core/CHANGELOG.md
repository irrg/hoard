# @irrg/hoard-core

## 0.2.0

### Minor Changes

- 3d06cfa: Add FairScheduler and ProviderRuntime for fair global concurrency

  - `FairScheduler`: registered providers retain a progress slot while active, with round-robin FIFO queues and a global connection limit
  - `ProviderRuntime` interface with `network<T>` and `filesystem<T>` capabilities; `directRuntime` no-op default for standalone use
  - All four providers now accept `runtime?: ProviderRuntime` in their options; individual network calls (fetchWithRetry, streamToFile) and filesystem calls (md5sum) are gated through the runtime rather than at the per-game task level
  - `hoard sync` registers configured storefronts in fair network and checksum schedulers; downloads use the global `jobs` limit while checksums use one round-robin disk slot
  - Provider libraries retain bounded per-game backpressure while individual network and checksum operations are gated at the call site

- 295068a: Publish @irrg/hoard-core as a public package; providers depend on it at runtime

  Fixes a packaging defect in 0.3.0 where @irrg/hoard-core was marked private but
  referenced as a runtime dependency in the CLI and as an import in provider type
  declarations. Provider builds revert from tsup back to tsc; core is now a real
  published dependency rather than an inlined bundle.
