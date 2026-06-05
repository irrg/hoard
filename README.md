# itchcraft

TypeScript port of [irrg/itchio](https://github.com/irrg/itchio). Downloads your itch.io library.

## Install

```bash
pnpm install
```

## CLI

```bash
# download full library
pnpm itchcraft-dl -- -k YOUR_API_KEY

# with concurrency (max 8)
pnpm itchcraft-dl -- -k YOUR_API_KEY -j 4

# platform filter: windows, linux, osx, android
pnpm itchcraft-dl -- -k YOUR_API_KEY -p osx

# use display names for folder structure instead of URL slugs
pnpm itchcraft-dl -- -k YOUR_API_KEY --human-folders
```

Get an API key at https://itch.io/user/settings/api-keys.

Failed downloads are logged to `errors.txt` in the working directory.

## Library

```typescript
import { Library } from './src/index.js';

const lib = new Library(apiKey, 4);
await lib.loadOwnedGames();       // lib.games: Game[]

// download everything
await lib.downloadLibrary('osx'); // platform optional

// or one game at a time
const game = lib.games[0];
await game.loadDownloads(apiKey); // game.downloads: Upload[]
await game.doDownload(game.downloads[0], apiKey);
```
