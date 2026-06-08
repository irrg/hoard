---
"@irrg/hoard": minor
---

Add `--verbose` / `-v` flag to `sync`: prints per-file log lines from all storefronts and skips progress bars.

Also fixes `sync` and `check` exit codes (non-zero on failure), surfaces fetch error causes in failure messages, and writes config files with secure permissions (0o600).
