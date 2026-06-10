# Hoard Devlog

## 2026-06-08 — 0.3 architecture: core package, tsup bundling, scheduler, atomic downloads, checksum-as-error

### packages/core (new, private)
- Added `packages/core` as a private package (`@irrg/hoard-core`, not published)
- `Scheduler` class: global concurrency limiter; `RunTask` type exported for providers
- Shared utilities consolidated from 4 provider copies: `fetchWithRetry`, `streamToFile`, `md5sum`, `runConcurrently`, `NoDownloadError`
- `HoardProvider` interface (compile-time contract only)
- Tests: scheduler concurrency/error/drain, utils coverage

### Build: tsc → tsup (all 4 providers)
- Each provider gains `tsup.config.ts` with `noExternal: ['@irrg/hoard-core']`
- Core is bundled inline into each provider's `dist/index.js` at build time
- Published packages have zero runtime dep on core
- `@irrg/hoard-core` is a devDependency (`workspace:*`) in each provider
- Provider package.json exports/main/types updated to `./dist/index.js`
- `"development": "./src/index.ts"` export condition allows vitest to import TS source directly

### Provider utils.ts migration
- `itchio-hoard/src/utils.ts`: re-exports from core + keeps local `download()` (now atomic) + `cleanPath()`
- `humblebundle-hoard/src/utils.ts`: re-exports from core + local `cleanPath()`
- `drivethru-hoard/src/utils.ts`: re-exports from core + local `normalizePathPart()` + `unescapeHtml()`
- `bundleofholding-hoard/src/utils.ts`: re-exports from core + local `cleanPath()`
- `cleanPath` kept local per provider (subtle differences prevent safe consolidation)

### Global Scheduler (apps/hoard)
- `@irrg/hoard-core` added as runtime dependency in `apps/hoard/package.json`
- `sync.ts`: creates one `Scheduler(jobs)` and passes `runTask = (t) => scheduler.run(t)` to all 4 providers
- Fixes concurrency bug: `--jobs 4` with 4 providers previously ran 16 simultaneous connections

### runTask added to all 4 LibraryOptions
- Optional `runTask?: RunTask`; when absent, falls back to `runConcurrently(tasks, this.jobs)` (no breaking change)

### Atomic downloads (all 4 providers)
- Stream to `outPath + '.partial'`, rename on success
- On `streamToFile` failure: `unlink(partialPath).catch(() => {})` then rethrow
- Prevents truncated files at final path surviving a crash/interrupt

### Checksum-as-error (all 4 providers)
- Post-download md5 mismatch: move bad file to `old/<date>-<filename>`, do NOT write sidecar, log to `errors.txt`, return error
- Pre-existing correct behavior (sidecar match → skip, computed match → write sidecar + skip) unchanged
- humblebundle cookie prefix moved to call site: `'_simpleauth_sess=' + cookie` (core's `streamToFile` takes raw Cookie value)

### Bug fixes
- `bundleofholding-hoard/src/library.ts` `sidecarPath`: was stripping file extension (e.g. `book.pdf.md5` → `book.md5`); now `rel + '.md5'` (keeps full extension)
- `humblebundle-hoard/src/library.ts` `hasFiles`: added missing `&& e !== 'old'` guard

### Tests
- All 355 tests pass across core + 4 providers + apps/hoard
- Updated tests for: new cookie prefix format, atomic rename mock, checksum-mismatch-as-error behavior (new log message, no sidecar write, rename to old/, errors.txt entry)
- `unlink` added to `fs/promises` mocks in BOH, drivethru, and itchio test suites
