---
"@irrg/itchio-hoard": minor
"@irrg/humblebundle-hoard": minor
"@irrg/drivethrurpg-hoard": minor
"@irrg/bundleofholding-hoard": minor
"@irrg/hoard": minor
---

Add --keep-old flag; fix checksum handling for watermarked files

- `--keep-old`: new CLI flag that moves replaced files to `old/` with a timestamped name; default behavior is now to delete the old file rather than accumulate versions
- Watermark/stale-checksum fix: when a downloaded file's MD5 differs from the API-reported checksum, the file is kept and the actual MD5 is stored in the sidecar; subsequent shallow runs skip the file correctly instead of looping forever
- Sidecar integrity check: on shallow runs, if the stored sidecar MD5 differs from the API checksum, the actual file MD5 is compared to the sidecar before deciding to re-download; this correctly handles both watermarked files and genuine file corruption
- `errors.txt` is now truncated at the start of each sync run so it reflects only the current run
- Fix misleading "Downloading" log line in itchio and drivethru that fired before the existence check
