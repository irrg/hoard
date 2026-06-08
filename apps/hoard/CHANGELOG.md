# @irrg/hoard

## 0.2.0

### Minor Changes

- 0a250d7: Add `--verbose` / `-v` flag to `sync`: prints per-file log lines from all storefronts and skips progress bars.

  Also fixes `sync` and `check` exit codes (non-zero on failure), surfaces fetch error causes in failure messages, and writes config files with secure permissions (0o600).

### Patch Changes

- Updated dependencies [0a250d7]
  - @irrg/bundleofholding-hoard@0.2.1
  - @irrg/drivethru-hoard@0.2.1
  - @irrg/humblebundle-hoard@0.2.2
  - @irrg/itchio-hoard@0.2.1
