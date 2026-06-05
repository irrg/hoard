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
