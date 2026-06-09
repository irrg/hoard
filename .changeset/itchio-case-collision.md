---
'@irrg/itchio-hoard': patch
---

Fix infinite re-download loop when two itch.io uploads for the same game have filenames that differ only in case (e.g. "file.pdf" vs "File.pdf"). On macOS's case-insensitive filesystem these resolve to the same path, causing a ping-pong overwrite loop. Filenames that would collide after lowercasing now have the upload ID appended as a disambiguator (e.g. "file_123.pdf").
