---
'@irrg/itchio-hoard': patch
'@irrg/humblebundle-hoard': patch
'@irrg/drivethru-hoard': patch
'@irrg/bundleofholding-hoard': patch
---

Fix infinite re-download loop when a storefront has two files for the same product with filenames that differ only in case (e.g. "file.pdf" vs "File.pdf"). On macOS's case-insensitive filesystem these resolve to the same path, causing a ping-pong overwrite loop. Filenames that collide after lowercasing now have a stable disambiguator appended before the extension.
