# bundleofholding-hoard

Download your Bundle of Holding purchases.

## Setup

```bash
pnpm install
```

## CLI

```bash
# download everything (prompts for email/password)
pnpm bundleofholding-hoard

# with credentials
pnpm bundleofholding-hoard -- -e you@example.com -p 'yourpassword'

# with session cookie instead of credentials
pnpm bundleofholding-hoard -- -c 'yourcookievalue'

# specific bundle by key
pnpm bundleofholding-hoard -- -e you@example.com -p 'yourpassword' -k somebundlekey

# filter files by name (substring, case-insensitive)
pnpm bundleofholding-hoard -- -e you@example.com -p 'yourpassword' -f pdf

# list files without downloading
pnpm bundleofholding-hoard -- -e you@example.com -p 'yourpassword' --list

# dry run
pnpm bundleofholding-hoard -- -e you@example.com -p 'yourpassword' --dry-run
```

## Options

```
-e, --email <email>    Account email
-p, --password <pass>  Account password
-c, --cookie <value>   Session cookie (alternative to email/password)
-k, --key <key>        Limit to specific bundle key(s); repeat or comma-separate for multiple
-f, --filter <term>    Filter files by name (case-insensitive substring); repeat for multiple
-j, --jobs <n>         Concurrent downloads (default: 4)
-o, --output <dir>     Output directory (default: downloads)
    --dry-run          Show what would be downloaded without downloading
    --list             List files and exit without downloading
-h, --help             Show this help
```

## Output

```
downloads/
  Bundle Name/
    filename.pdf
    filename.pdf.md5
```

Files already downloaded are skipped. If the stored MD5 doesn't match the remote hash, the old file is moved to `old/` and re-downloaded. Failed downloads are logged to `errors.txt`.

## See also

Part of the hoard family — [itchio-hoard](https://github.com/irrg/itchio-hoard), [humblebundle-hoard](https://github.com/irrg/humblebundle-hoard), [drivethru-hoard](https://github.com/irrg/drivethru-hoard).

## License

Copyright (c) 2026, Robb Irrgang

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
