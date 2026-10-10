# Hjulben – Rotation Plan

A plan for rotating terrain blocks and props, in the trail format, the game and the editor.

---

> **Status: implemented.** Changes from the plan: `rotate.js` keeps its own capture/apply loop rather than splitting `moveItems` into a shared `transformItems`; `rotateSelection` lives in `rotate.js`; and the pose logic is in `propRotation`/`propPoint` plus the existing `propAlignmentSlope`/`propGroundOffset`, rather than a separate `propPose` helper.

## Approach in one paragraph

Blocks and props need different approaches. A **block** is already free geometry, so the editor rotates it by changing its node positions, the same way `scaleBlock` handles scaling. The format, physics, glass, hashing and replays don't change. A **prop** is an anchor plus a type, so it gets a new optional `rotation` field that the renderer uses when drawing it. In the editor, both use one rotate handle built on the existing scale frame, plus a keyboard shortcut and inspector controls.

---

## 1. Blocks: rotation baked into the geometry

**Format:** unchanged. A rotated block is just a block with different `x`/`y`/`in`/`out` values.

- [x] **`rotateBlock(block, px, py, angle)`** in `js/terrain-geometry.js`, next to `moveBlock` and `scaleBlock`:
  - Rotates every node of `outer` and each `inner` boundary about `(px, py)`. It also rotates the `in`/`out` handles, which is exact for cubic Béziers because rotation is affine, so curves keep their shape.
  - Keeps node, boundary and block ids, `mode`, `edge`, `material` and `layer`.
  - Rounds with the existing `round` (SNAP). The editor always rotates from the **original** block during a drag, so rounding doesn't build up.
  - Positive angles turn clockwise on screen, because the canvas y axis points down. Props use the same convention.
- [x] **Nothing else changes in the game.** Collision, glass strength (the doc already says it is "exact for a rectangle at any angle"), back walls, lighting and `trail-hash.js` all read the node positions. Rotating terrain changes the trail hash, the same way moving it does.

## 2. Props: a new `rotation` field

**Format:**

```json
{ "x": 640, "y": 300, "type": "crates", "layer": "front", "rotation": 20 }
```

- Degrees, clockwise, about the prop's anchor (its ground/contact origin). Omitted when 0, like `flip`.
- [x] **Normalization** (`normalizeTrail` in `js/trail-schema.js`): keep the value only if it is finite, wrap it to `(-180, 180]`, round it to 0.1°, and drop it when it is 0.
- [x] **`canRotate(type)`** in `js/drawing.js`, next to `canFlip`. Rotation is ignored for props that fit themselves to the world or move through it:
  - wall props (`vines`, `roots`, `moss`), `graffiti` (painted), ceiling props, `beams` and `minecart` (cave-fitted)
  - water props (`lily`, `duck`, `seaweed`, `reeds`, `fish`)
  - moving or startled animals and effects: `squirrel`, `tumbleweed`, `vulture`, `bird`, `bats`, `heat-haze`
  - Everything else can rotate, including `sign` (rotating doesn't mirror text). Like `flip`, an unsupported rotation stays in the JSON but is not drawn.
- [x] **How it interacts with ground alignment.** Today some props tilt automatically with the slope (`propAlignmentSlope` / `propDrawAngle`), and trunks and posts reach down to the ground through `groundOffset(localX)`. That callback works in unrotated local x, so a manual rotation can't safely combine with it. Decision: **a rotated prop is posed by hand.** Its draw angle is `rotation`, replacing the automatic slope, and `groundOffset` becomes `() => 0`. Add one helper, `propPose(trail, prop) → { angle, groundOffset }`, so every caller (game, editor, glows, lighting) gets the same answer.
- [x] **`drawProp` / `drawPropGlow`** (`js/drawing.js`): add a trailing `rotation = 0` parameter. The transform order is `translate(anchor) → rotate(angle) → scale(-1, 1) if flipped`, so a positive rotation always turns clockwise on screen, whether or not the prop is flipped. Animated parts (windmill blades, scarecrow head, bees, crane lights) rotate with the frame.
- [x] **`propBounds`**: generalize the corner rotation that `bush` already uses to every type whenever the angle isn't 0. This keeps `drawPropLayer` (the faded editor preview) cropping correctly.
- [x] **Culling** in `js/render.js` (`drawProps`, `drawPropGlows`): for a rotated prop, use a circle of radius `max(rise, hang, PROP_REACH)` around the anchor for `inView` and the x-ray `area` test, so a tilted tall prop doesn't pop out of view.
- [x] **Lights** (`js/lighting.js` `propLights`): rotate the `lamp` head position and its beam `angle`, and the `crane` warning lights, about the anchor. `mushrooms` only move their centre.
- [x] Pass `prop.rotation` at every call site: `js/render.js` (props and glows), `js/editor/render.js` (props, glows and the placement preview).

## 3. Editor

### Rotate handle (main interaction)

Decisions:
- A rotated prop replaces the automatic slope tilt.
- Rotating a selection moves everything selected around the pivot.
- Shift and `R` snap to 15°.

- [x] **New module `js/editor/rotate.js`**, modelled on `scale.js`: `rotateHandle()`, `rotateHandleAt(point)`, `startRotate(handle, point, before)`, `updateRotate(point, { shift })`, `endRotate()` and `rotating()`.
  - **What it acts on:** any selection except one made only of water. A single prop that can rotate turns about its anchor. Anything else turns about the centre of the selection's box:
    - **Blocks** and **selected block points** turn: their positions and curve handles rotate (`rotateBlock` for whole blocks, the same maths for loose points).
    - **Props** move around the pivot and, if `canRotate`, also turn by the same angle.
    - **Apples, spikes, start, finish and water** only move around the pivot. They keep their own shape and settings: the start keeps its `facing`, a spike keeps its `spin`, and water stays an axis-aligned rectangle (moved with `moveWaterTo`).
    - This reuses the loop in `moveItems` (`js/editor/selection.js`). Each item's position is read once at the start of the drag, and objects standing on the ground get an explicit `y`, just like when a group is dragged. Split that loop into a shared `transformItems(before, mapPoint)` helper, so moving and rotating share it.
  - **Handle:** a round knob on a short stalk above the top-centre of the frame (the scale frame for blocks, a small frame from `propBounds` for a prop). Cursor `grab`/`grabbing`.
  - **Drag:** the angle is `atan2(pointer − pivot) − atan2(start − pivot)`, applied to the originals on every move. **Shift** snaps to 15°. Show the live angle with the existing `snapGuide` label style.
  - **Undo:** one history step per drag. As in `scale.js`, return the `before` snapshot on the first change so `input.js` pushes it once.
- [x] **`js/editor/input.js`:** check `rotateHandleAt` before `scaleHandleAt` on pointerdown, route pointermove and pointerup, re-snap when Shift is pressed or released mid-drag (as scaling already does), and set the hover cursor.
- [x] **`js/editor/render.js`:** a new `drawRotateHandle()` call next to `drawScaleFrame()`, hidden while a shape is pending.

### Keyboard

- [x] **`R`** rotates 15° clockwise and **`Shift+R`** rotates 15° counter-clockwise (`KeyR` is free). This works on the selection and on the Prop tool's next prop, like `X` for flip. Each press is one undo step. Add a `rotateSelection(deg)` next to `toggleFlip` in `js/editor/selection.js`.
- [x] Add the shortcut to the shortcuts list in `editor.html` (next to "Flip prop", around line 839).

### Inspector and tool settings

- [x] **Props:** a **Rotation** number field (degrees, −180…180, step 1) with a ↺ reset button in `editor.html`, as `selection-rotation-row`. Show it only when `canRotate(type)`, and wire it in `js/editor/inspector.js` the same way `selection-flip` is wired.
- [x] **Blocks:** a **Rotate** row with `↺ 90°` and `↻ 90°` buttons. A block has no stored angle, so these apply a single rotation about the selection centre.
- [x] **Prop tool:** add `rotation: 0` to `DEFAULT_TOOL_SETTINGS.prop` in `js/editor/tools.js` and show it as a field. The placement preview draws it, and `blocks.js` applies it when placing if `canRotate`. That way a row of tilted crates can be placed quickly.
- [x] Changing a prop's type to one that can't rotate keeps the value but hides the field, which matches how `flip` behaves.

## 4. Docs

- [x] **`TRAIL_FORMAT.md`:**
  - Extend "Props: `flip` and wall props" with `rotation`: units, direction, pivot, which props ignore it, and that a rotated prop no longer follows the slope.
  - In "Visual editor", cover the rotate handle, `R`/`Shift+R`, and block rotation.
- [x] Run `npm run context` to regenerate `TRAIL_AUTHORING_CONTEXT.md` (`context:check` runs in `npm test`).

## 5. Tests

- [x] `scripts/test-terrain-geometry.mjs`, `rotateBlock`:
  - a 90° turn of a rectangle swaps its width and height
  - four 90° turns, or `+a` then `−a`, give back the original within SNAP
  - handles rotate, ids are kept, and the area is unchanged
- [x] `scripts/test-trail-schema.mjs`: rotation wrapping, rounding, 0 dropped, non-numbers dropped.
- [x] `scripts/test-terrain.mjs`:
  - `propPose`: a rotated prop ignores the slope and has a flat `groundOffset`
  - an unrotatable type ignores `rotation`
  - `propBounds` grows when the prop is rotated
- [x] `scripts/test-lighting.mjs`: a rotated lamp moves its head and beam.
- [x] `scripts/test-editor-gestures.mjs`:
  - dragging the rotate handle turns a block and a prop
  - Shift snaps to 15°
  - one drag is one undo step
  - a mixed selection moves apples, spikes, water and the start around the pivot, keeps the start's `facing`, and turns blocks and props
  - the handle is hidden when only water is selected
- [x] `scripts/test-editor-dom.mjs` / `test-editor-markup.mjs`: the new inspector rows, and when they are shown.
- [x] `npm test` passes, including `test-replays` (no shipped trail changes).

## 6. Suggested order

1. `rotateBlock` and its tests. Small, and blocks can be rotated from the console right away.
2. Prop `rotation`: schema, `canRotate`, `propPose`, drawing, bounds, culling, lights, and their tests.
3. Editor `R`/`Shift+R` and inspector fields. Quick to build, and they make the feature usable.
4. The rotate handle (`rotate.js`) and gesture tests.
5. Docs and context regeneration.
