# humblebundle-hoard

Download your Humble Bundle library.

## Setup

1. Log in to [humblebundle.com](https://www.humblebundle.com) in your browser.
2. Open DevTools → **Application** tab → **Cookies** → `https://www.humblebundle.com`.
3. Copy the value of the `_simpleauth_sess` cookie.
4. Install deps: `pnpm install`

## Usage

```
pnpm humblebundle-hoard --key <SESSION_COOKIE>
```

Omit `--key` to be prompted interactively.

## Options

```
-k, --key <cookie>       Humble Bundle session cookie (prompts if omitted)
-j, --jobs <n>           Concurrent downloads (default: 4)
-o, --output <dir>       Output directory (default: downloads)
-p, --platform <name>    Filter by platform (ebook, video, linux, etc.)
    --ext-include <exts> Only download these extensions, comma-separated (e.g. pdf,epub)
    --ext-exclude <exts> Skip these extensions, comma-separated
    --bundles            List your Humble Bundle orders and exit
-b, --bundle <key>       Download a specific order by key
    --dry-run            Show what would be downloaded without downloading
-h, --help               Show this help
```

## Output structure

```
downloads/
  Bundle Title/
    Product Name/
      file.epub
      file.md5
```

Files already downloaded are skipped. If the API reports a different MD5, the old file is moved to `old/` and re-downloaded. Failed downloads are logged to `errors.txt`.

## See also

Part of the hoard family — [itchio-hoard](https://github.com/irrg/itchio-hoard), [drivethru-hoard](https://github.com/irrg/drivethru-hoard), [bundleofholding-hoard](https://github.com/irrg/bundleofholding-hoard).

## License

Copyright (c) 2026, Robb Irrgang

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
