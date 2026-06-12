---
"@irrg/hoard-core": minor
"@irrg/itchio-hoard": minor
"@irrg/humblebundle-hoard": minor
"@irrg/drivethrurpg-hoard": minor
"@irrg/bundleofholding-hoard": minor
"@irrg/hoard": minor
---

Add FairScheduler and ProviderRuntime for fair global concurrency

- `FairScheduler`: registered providers retain a progress slot while active, with round-robin FIFO queues and a global connection limit
- `ProviderRuntime` interface with `network<T>` and `filesystem<T>` capabilities; `directRuntime` no-op default for standalone use
- All four providers now accept `runtime?: ProviderRuntime` in their options; individual network calls (fetchWithRetry, streamToFile) and filesystem calls (md5sum) are gated through the runtime rather than at the per-game task level
- `hoard sync` registers configured storefronts in fair network and checksum schedulers; downloads use the global `jobs` limit while checksums use one round-robin disk slot
- Provider libraries retain bounded per-game backpressure while individual network and checksum operations are gated at the call site
