# Custom Levels

Drop your own trail files into this folder to play them locally.

## Adding a level

1. Build a trail in the **Level Editor** and click **Export JSON**.
2. Save the exported file here, e.g. `levels/custom/my-trail.json`.
3. With `npm run dev` running, the catalog regenerates automatically and the trail shows up under **CUSTOM TRAILS** in the level menu. Without the dev server, run `npm run levels` once to rebuild `levels/catalog.json`.

## Rules

- Only `.json` files are picked up. Files load in natural filename order, so a numeric prefix like `01-` controls ordering.
- Each file needs a string `name`; everything else follows the same schema as the official trails. See [`LEVEL_FORMAT.md`](../../LEVEL_FORMAT.md).
- The level ID is `custom:<filename>`, so renaming a file makes it a different level.
- Custom trails are labeled as custom and never affect career progression or official best times. A level can't mark itself as official; the folder decides.

## Git

The contents of this folder are git-ignored (except this README), so your trails stay local to your machine.
