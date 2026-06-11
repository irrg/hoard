---
"@irrg/hoard": patch
---

Fix exit status, job validation, and scheduler coverage in hoard sync

- Humble partial inventory: failed order fetches now count toward the error total and produce a non-zero exit code instead of reporting success with a verbose warning only
- `--jobs` flag now rejects non-integer values such as `4x` and `4.5`; previously `parseInt` silently accepted trailing garbage
- Global scheduler now covers inventory HTTP requests (Humble bundle fetches, Bundle of Holding page loads) in addition to downloads, so aggregate concurrency no longer exceeds `--jobs` when all storefronts run together
