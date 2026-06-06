# drivethru-hoard

Download your DriveThruRPG library.

## Setup

1. Go to [account settings](https://www.drivethrurpg.com/en/account/settings) → **Library App Keys** → generate a key.
2. Install deps: `pnpm install`

## Usage

```
pnpm drivethru-hoard --key <YOUR_API_KEY>
```

Omit `--key` to be prompted interactively.

## Options

```
-k, --key <key>        DriveThruRPG API key (prompts if omitted)
-j, --jobs <n>         Concurrent downloads (default: 4)
-o, --output <dir>     Output directory (default: downloads)
    --dry-run          Show what would be downloaded without downloading
    --omit-publisher   Skip publisher directory level
    --compat           Use DriveThruRPG client naming convention
-h, --help             Show this help
```

## Output structure

```
downloads/
  Publisher Name/
    Product Name/
      file.pdf
      file.md5
    Product Name.json
```

`--omit-publisher` removes the publisher level. `--compat` names files the way DriveThruRPG's own client does.

## See also

Part of the hoard family — [itchio-hoard](https://github.com/irrg/itchio-hoard), [humblebundle-hoard](https://github.com/irrg/humblebundle-hoard), [bundleofholding-hoard](https://github.com/irrg/bundleofholding-hoard).

## License

Copyright (c) 2026, Robb Irrgang

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
