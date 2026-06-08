# @irrg/drivethru-hoard

## 0.2.1

### Patch Changes

- 0a250d7: Fix infinite re-download loop caused by shared MD5 sidecars for products with multiple formats (e.g., `.epub` and `.pdf` sharing the same `.md5` file). Each file format now gets its own sidecar (`file.epub.md5`, `file.pdf.md5`).

  Also fixes the MD5 sidecar not being written after a download when the computed hash did not match the API hash, which caused the same file to be re-downloaded on every subsequent deep sync.

  Move `old/` backup directories from `.data/<path>/old/` to live alongside the product files. Directories containing only an `old/` folder are no longer considered "has files" for the shallow sync check.
