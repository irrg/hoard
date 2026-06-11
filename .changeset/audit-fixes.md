---
"@irrg/itchio-hoard": minor
"@irrg/humblebundle-hoard": minor
"@irrg/drivethru-hoard": minor
"@irrg/bundleofholding-hoard": minor
---

Fix data integrity and error propagation issues across all providers

- Partial-before-verify: hash `.partial` file before renaming to final path; unlink partial on mismatch instead of quarantining (corrupt freshly-downloaded files never reach the output path)
- Deep mode sidecar bypass: when `--deep` is set, always re-hash the local file rather than trusting the sidecar
- Quarantine filename collision: timestamp now includes milliseconds and a 4-digit hex random suffix (`YYYY-MM-DDTHH-MM-SS-mmm-xxxx`) to make same-second overwrites in `old/` astronomically unlikely
- Error propagation: drivethru and itch.io providers now return discriminated `'downloaded' | 'skipped' | 'error'` from `doDownload()` and `{ newFiles, errors }` from `download()`, so per-file checksum and network failures are counted and surfaced in `downloadLibrary()` results
