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

Part of the hoard family — [itchio-hoard](https://github.com/irrg/itchio-hoard), [drivethru-hoard](https://github.com/irrg/drivethru-hoard).
