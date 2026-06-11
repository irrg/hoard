# @irrg/hoard

CLI tool for downloading your purchased TTRPG digital content from DriveThruRPG, itch.io, Humble Bundle, and Bundle of Holding.

## Installation

```
npm install -g @irrg/hoard
```

## Usage

```
hoard sync [storefronts...]  # Download new purchases
hoard sync --deep            # Re-verify all files
hoard --help
```

Configuration is stored at `~/.hoard/config.json`. Run `hoard auth` to configure credentials.

## License

BSD-3-Clause — see LICENSE.
