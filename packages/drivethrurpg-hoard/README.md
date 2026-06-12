# @irrg/drivethru-hoard

Downloads your DriveThruRPG library. Part of the [@irrg/hoard](https://github.com/irrg/hoard) monorepo.

Use the [`@irrg/hoard`](https://github.com/irrg/hoard/tree/main/apps/hoard) CLI for the full multi-storefront experience.

## Library

```typescript
import { Library } from '@irrg/drivethru-hoard';

const lib = new Library({
  apiKey: 'your-api-key',
  outputDir: 'downloads',
  jobs: 4,
  compat: false,         // use DriveThruRPG client naming convention
  omitPublisher: false,  // skip the publisher directory level
  dryRun: false,
  filters: [],           // substring filters on product names
});

await lib.authenticate();
await lib.loadProducts();
const { downloaded, errors } = await lib.downloadLibrary();
```

Get an API key at DriveThruRPG account settings → Library App Keys.

## Output structure

```
downloads/
  Publisher Name/
    Product Name/
      file.pdf
      file.pdf.md5
```

`omitPublisher: true` removes the publisher level. `compat: true` names files the way DriveThruRPG's own client does. Failed downloads are logged to `.data/errors.txt`.

## License

BSD-3-Clause — see LICENSE.
