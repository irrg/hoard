---
"@irrg/hoard": patch
---

Fix exit status, job validation, and parallel sync scheduling

- Humble partial inventory: failed order fetches now count toward the error total and produce a non-zero exit code instead of reporting success with a verbose warning only
- `--jobs` flag now rejects non-integer values such as `4x` and `4.5`; previously `parseInt` silently accepted trailing garbage
- Each storefront now gets its own `Scheduler(jobs)` instead of sharing a single global pool; previously a slow storefront (e.g. humblebundle md5-checking large files) would occupy all slots and stall the others for the duration of a run
