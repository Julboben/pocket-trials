# Hjulben

A 2D motorcycle trials game in the browser, inspired by Elasto Mania: plain JavaScript modules and Canvas, no build step and no runtime dependencies. `README.md` describes the game, `CONTRIBUTING.md` the code.

## Commands

- `npm run dev`: dev server; it also watches `trails/` and rebuilds the trail catalogs.
- `npm test`: every check. It fails while a generated file is stale: run `npm run sw` after changing files the game loads, and `npm run context` after changing `TRAIL_FORMAT.md`, `js/trail-schema.js`, `js/materials.js` or the example trails.
- `npm run check` (syntax) and `npm run typecheck` for a quick check.

## Making trails

Read `TRAIL_AUTHORING_CONTEXT.md` first: the format, the validation rules, the materials and example trails in one file. `TRAILS_GUIDE.md` has the design rules the official career follows, and `PROPS_GUIDE.md` and the prop modules in `js/*-props.js` show what can dress a trail.

- **New trails go in `trails/custom/`** (git-ignored), so the user can ride them first. Never add or change files in `trails/official/` or `trails/bonus/` unless asked.
- **Playtest while you build.** `node scripts/playtest.mjs <trail file>` solves the trail with the replay bot and reports each stretch: jumps, turns, hangs, crashes, the tight spots and the bot's time. `--probe` measures one jump or section, and `--without` proves an apple needs the skill it is meant to test. See "Playtesting from the command line" in `TRAIL_FORMAT.md`. Design near what the bike can do, measured, rather than conservatively by guesswork, and don't hand over a trail the bot can't finish without saying so and where it fails.
- Run `npm run trails` (or keep `npm run dev` running) so a new file shows up under **CUSTOM TRAILS** in the game.
- Coordinates are Canvas ones: `y` grows downward, so higher terrain has a smaller `y`.

## Conventions

- The simulation must stay deterministic: use `js/det-math.js`, never `Math.sin`, `Math.atan2`, `Math.exp` and the like, in simulation code. Replays depend on it.
- Support current browsers only; no fallbacks for old ones.
- Ask before changing the size of touch targets or the visual design.
- Don't write counts that change (the number of trails, props and so on) into the README or other docs.
- Comments explain why, in full sentences, and match the density of the code around them.
