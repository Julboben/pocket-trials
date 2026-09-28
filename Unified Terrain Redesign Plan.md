# Unified Terrain Redesign Plan

## 1. Objective

Replace the separate ground, gap, platform, and thick-path systems with **one editable terrain block type**.

Each block has editable boundary points:

- **Outer boundaries** define its solid shape.
- **Inner boundaries** define empty spaces within it.

Outer and inner boundaries use the same point-editing and curve controls. A cave is not a separate block, mask, or subtractive object. It is an inner boundary of the same terrain block.

The level creator should be able to:

- Start with a rectangular block.
- Move, add, and remove boundary points.
- Make edges straight or curved.
- Create empty spaces inside the block.
- Reshape those spaces using their boundary points.
- Open an interior space to the outside.
- Place other ordinary blocks inside empty spaces, such as an island inside a cave.
- Create hills, islands, overhangs, tunnels, and loops with the same terrain type.

## 2. Core Editing Model

### 2.1 One block, multiple boundaries

A terrain block owns its material and boundaries.

```text
Terrain block
├── Solid region
│   ├── Outer boundary
│   │   └── Editable points and curve handles
│   └── Inner boundaries (empty spaces)
│       └── Editable points and curve handles
└── Additional solid regions, if the block was split
```

Selecting an inner boundary means selecting part of the block, not another terrain object.

### 2.2 Moving empty space

Select all points around an inner boundary and drag them:

- The empty space moves.
- Its old location becomes solid.
- Its new location becomes empty.

Moving the whole block moves all its boundaries together.

### 2.3 Openings and disconnected pieces

When an inner boundary reaches the outside, it must merge with the outer boundary to form an entrance.

A cut through a block may produce disconnected solid pieces. These remain **regions of the same block**. They keep its material and move with it.

### 2.4 Blocks inside empty spaces

Ordinary terrain blocks can be created inside another block's inner boundary, for example a floating island inside a cave.

- They use the same block type, point editing, curves, and materials.
- They are independent. There is no parent/child relationship. Moving the surrounding block does not move them unless both are selected.
- Nesting depth is unlimited. A nested block may have its own inner boundaries, which may contain further blocks.
- A block's inner boundaries remove solid only from that block, never from other blocks. Where solids overlap, solid wins over empty.
- The Block tool always creates a new, separate block, even inside another block's empty space.
- A cut that splits a block creates regions of that same block, not new blocks.

**Deliberate trade-off:** moving a block with a cave does not carry blocks inside that cave. They stay in place and may end up buried in rock. This is the simpler, more predictable model. A later "Move contents with block" option could be added without changing the file format.

## 3. Scope

### Included

- Unified terrain data format.
- Outer and inner boundary editing.
- Straight and curved edges.
- Operations to create holes, entrances, and separations.
- Independent blocks inside other blocks' empty spaces.
- Collision support for floors, walls, and ceilings.
- Existing pixel-art rendering and caching.
- Existing editor integration.
- Migration of older maps.
- Cave-aware object placement, shadows, and finish placement.
- Validation, hashing, and tests.

### Not included initially

- Destructible terrain during gameplay.
- Moving terrain.
- Liquids.
- Automatic cave lighting.
- Automatically moving nested blocks with their surrounding block.
- A replacement editor application.
- Changes to rider graphics, bike handling, or the flip animation.

## 4. Current System and Reusable Infrastructure

Current terrain data:

| Data | Purpose |
|---|---|
| `level.points` | Main ground height curve |
| `level.gaps` | Missing horizontal ground ranges |
| `level.platforms` | Islands with top and bottom curves |
| `level.paths` | Thick open or closed lines |

A single ground height per x-coordinate cannot represent cave roofs, vertical walls, or overhangs.

Keep where practical:

- Editor layout, navigation, and playtesting.
- Selection and undo/redo infrastructure.
- Browser storage and export workflows.
- Materials and pixel-art palette.
- Terrain chunk caching.
- Collision edge indexing and swept-circle primitives.

## 5. Data Model

### 5.1 Authoritative editable geometry

Introduce a versioned level format containing a collection such as `terrainBlocks`.

Each block contains:

- A stable identifier.
- A material.
- One or more solid regions.

Each region contains:

- One closed outer boundary.
- Zero or more closed inner boundaries.

Multiple regions let a block stay one editor object after being split.

Blocks are stored as a flat list. Nesting is purely geometric: a block inside another block's cave is just another entry in the list, with no stored parent reference.

### 5.2 Boundary nodes

Each boundary consists of ordered nodes containing:

- A stable node identifier.
- Position.
- Incoming and outgoing curve handles.
- Point mode: corner, smooth, or independent.
- Outgoing edge type: straight or cubic Bézier.

All boundaries use the same node format.

Boundary points are not sorted by x-coordinate. Their order follows the boundary around the shape.

### 5.3 Geometry rules

Within one block:

- Outer and inner boundaries must not self-intersect.
- Inner boundaries must lie inside their region's outer boundary.
- Boundaries must not intersect or touch in an unresolved state.
- Boundary direction and solid-side conventions are normalized.

Islands inside empty space are represented in one of two ways:

| Origin | Representation |
|---|---|
| A cut split the block | Additional region of the same block |
| Created with the Block tool | Separate block |

Between blocks:

- Blocks may touch, overlap, or sit inside each other's empty spaces.
- One block's inner boundaries never affect another block's solid.

Serialized geometry contains no separate cave objects or persistent cutter masks.

Finalize exact field names before coding.

## 6. Editor Workflow

### 6.1 Terrain tools

Replace Ground, Gap, Island, and Path/loop with:

- **Block:** creates a new rectangular terrain block anywhere, including inside another block's empty space.
- **Cut:** edits the selected block's boundaries by removing a drawn region. It affects the selected block only.

The Cut outline is temporary input. Once committed, only the resulting block boundaries remain. Cutting through a cave does not affect blocks inside that cave.

The existing Select tool handles:

- Block movement.
- Boundary-point movement.
- Curve-handle movement.
- Whole-boundary selection.
- Multiple-point selection.
- Multiple-block selection, so a cave and the island inside it can move together.

### 6.2 Point editing

Support:

- Dragging nodes and handles.
- Double-clicking an edge to insert a node.
- Deleting selected nodes.
- Switching edges between straight and curved.
- Selecting all nodes of an inner boundary to move or scale that space.
- Deleting an entire inner boundary to fill its space.
- Moving the whole block, including all its interior boundaries.

Inserting a node on a curved edge splits the Bézier without changing its shape.

Deleting an outer boundary must clearly distinguish deleting that solid region from deleting the whole block.

### 6.3 Hit-testing

Selection priority:

1. Points and curve handles.
2. Boundary edges.
3. The topmost solid block under the cursor.

Clicking empty cave space does not select the surrounding block's body. Clicking a nested island selects the island, not the block around it.

### 6.4 Curve controls

Inspector controls:

- Straight or curved edge.
- Corner point.
- Smooth point with aligned handles.
- Independent incoming and outgoing handles.
- Position and optional grid snapping.

The same controls apply to inner and outer boundaries.

### 6.5 Creating holes and entrances

| Operation | Result |
|---|---|
| Cut entirely inside solid terrain | New inner boundary |
| Cut across the outside edge | Modified outer boundary |
| Extend an empty space to the outside | Inner and outer boundaries join into an entrance |
| Cut through the entire block | Multiple solid regions in the same block |
| Delete an inner boundary | Empty space fills in |
| Cut outside the selected block | No change; show feedback |
| Block tool inside an empty space | New, independent block |

Dragging an inner boundary into another boundary of the same block requires an explicit topology commit. Intersecting outlines must never be saved silently.

Preview the proposed result and allow confirmation or cancellation. If an operation cannot produce valid geometry, keep the last valid state.

### 6.6 Undo and selection stability

- One undo step per completed gesture or topology operation.
- Escape cancels unfinished operations.
- Undo restores original curves and boundary structure.
- Unchanged nodes keep their identifiers.
- Selection is cleared or remapped when an operation removes selected geometry.

## 7. Curves and Topology Operations

### 7.1 Ordinary edits

Moving points and handles updates the stored curves directly. No permanent polygon conversion is needed.

### 7.2 Cuts and boundary joins

Cuts may split curves, remove sections, create intersections, or change which boundaries connect.

Use a tested geometry implementation rather than hand-written polygon subtraction.

Topology operations apply to one block at a time. The output becomes that block's new editable boundaries, not a separate subtractive object.

### 7.3 Preserving editable curves

Polygon Boolean operations alone do not preserve Bézier handles.

Before implementation, choose and test one approach:

1. A curve-aware Boolean implementation.
2. A polygon-based implementation that tracks which source edge each piece came from, retains untouched curves, splits surviving curve sections, and reconstructs changed sections within a defined tolerance.

Requirements:

- Keep unaffected curves where possible.
- Don't turn the whole block into hundreds of permanent nodes after a small cut.
- Bound any curve-fitting or simplification error.
- Revalidate reconstructed geometry.
- Allow short straight sections where safe curve reconstruction isn't available.

Prove this in a small prototype before building the full editor.

## 8. Shared Runtime Geometry

Compile editable boundaries into runtime geometry:

```text
Stored outer and inner boundary curves, per block
                  ↓
Deterministic curve subdivision
                  ↓
Validated solid regions with holes, per block
                  ↓
Union of all blocks' solids (solid wins over empty)
                  ↓
Cached boundary edges and spatial index
                  ↓
Rendering, collision, and surface queries
```

Each block's holes are applied to that block before the union. This is what makes a nested island stay solid inside another block's cave.

### Subdivision

Adaptive subdivision with:

- A fixed world-space error tolerance.
- Stable output ordering.
- A segment or recursion limit.
- No dependence on camera zoom or frame rate.

### Overlapping blocks

Collision uses the union of all solids, so buried edges never become invisible barriers.

Blocks remain individually editable.

A deterministic material-priority rule, shared by rendering and physics, decides which material shows where blocks overlap.

## 9. Physics and Surface Queries

Adapt the existing collision infrastructure to the compiled boundary loops.

Requirements:

- Correct solid containment with holes.
- Normals pointing from solid into empty space.
- Contacts against floors, walls, ceilings, cave interiors, and nested islands.
- Swept collisions for fast movement.
- No contacts with internal overlap edges.
- Stable contact ordering.

Do not treat each boundary loop as an independent filled polygon.

### Surface queries

Provide:

- Point-in-solid test.
- Nearest-boundary query.
- Downward raycast from a reference position.
- Surface near a prop anchor.
- Boundary intersections along a query line.

Results include position, normal, tangent, material, and relevant geometry identity.

Queries use the combined geometry, so:

- Inside a cave, a downward query finds the cave floor, not the surface above the ceiling.
- Above a nested island, a downward query finds the island's top.

Update callers of:

- `terrainAt()`
- `terrainSurfacesAt()`
- `seatedSurfaceAt()`
- `groundShadowSamples()`
- Direct reads of legacy ground and platform curves.

## 10. Validation

### Errors (block saving and playtesting)

- Non-finite coordinates.
- Coincident consecutive nodes.
- Zero-area outlines.
- Self-intersecting boundaries after curve evaluation.
- Inner boundaries outside their region's outer boundary.
- Unresolved intersections between boundaries of the same block.
- Invalid topology-operation results.

### Warnings

- A block completely buried inside other solid terrain. It has no visible or physical effect. This often happens after moving a surrounding block.
- A cut that didn't change the selected block.
- Very thin passages or terrain features.
- Excessive geometry complexity.

Validation does not guarantee a level is rideable.

## 11. Rendering and Caching

Preserve:

- Two-world-unit art pixels.
- Palette quantization.
- Existing material appearance.
- World-space terrain chunks.

Render from the same compiled geometry used by physics.

Support:

- Empty interiors.
- Cave floors, ceilings, and exterior walls.
- Nested islands inside caves.
- Material patterns clipped to solids.
- Vegetation only on suitable upward-facing surfaces.
- Consistent chunk boundaries.

### Invalidation

Track geometry revisions explicitly.

When a block changes, invalidate:

1. Its compiled geometry.
2. Affected union geometry and collision indexes, including overlapping or nested blocks.
3. Rendering chunks covering the old and new bounds.
4. Dependent prop and shadow queries.

Start with whole-level invalidation if needed for correctness, then optimize.

No Boolean operations or curve rebuilding during ordinary gameplay frames.

## 12. Object and Finish Placement

### New levels

Use explicit positions, or snap to a surface below a reference height.

The finish needs a height or surface attachment in addition to its x-coordinate.

Props, shadows, and the finish can sit on any surface: exterior ground, cave floors, or nested islands.

If attachments are stored, define what happens when the referenced boundary is removed, split, or buried by another block.

### Legacy levels

Resolve implicit positions before removing the old terrain representation:

- Apples with `y: null`.
- Props with `y: null`.
- Ground-relative starts.
- Automatically placed spikes.
- X-only finish flags.

Preserve their previous world positions. Don't let them jump to a newly discovered overhead surface.

## 13. Migration

Convert existing maps into reviewed copies. Never overwrite originals automatically.

### Conversion rules

- Ground and gaps become finite solid regions.
- Platforms become separate blocks with closed boundaries.
- Thick paths become filled outlines that keep their thickness and rounded joins.
- Closed thick paths keep their empty interiors where appropriate.
- Materials, objects, and metadata are preserved.

Legacy cosine curves require approximation. Define a geometric tolerance and validate conversion against it.

Define finite terrain bounds explicitly, since the old system extends ground beyond its authored endpoints.

### Initial fixture

Use `hanging-gardens.json` to test:

- Ground and gaps.
- Multiple island materials.
- Thick open and winding paths.
- Negative vertical coordinates.
- Explicit and implicit object placement.

Add isolated fixtures for:

- Holes and entrances.
- Closed bands.
- A block split into regions.
- A separate block nested inside another block's cave.

## 14. File Changes

| File | Planned responsibility |
|---|---|
| New geometry module | Boundary curves, topology operations, subdivision, union, compilation |
| New migration module | Legacy-format conversion |
| `terrain.js` | Collision and surface queries |
| `terrain-render.js` | Unified solid rendering and revision-based caching |
| `level-schema.js` | New format, normalization, validation, blank block |
| `editor.js` | Block and Cut tools, inner/outer point editing, hit-testing, topology previews |
| Editor HTML | Terrain controls, curve controls, finish height |
| `drawing.js` | Prop alignment through the new surface queries |
| `levels.js` | Consistent normalization and migration entry points |
| `level-hash.js` | New gameplay geometry and version identity |
| Runtime consumers | Spawn, finish, shadows, effects, terrain references |

The remaining runtime files must be audited during implementation. Their compatibility is not yet verified.

## 15. Dependencies and Versioning

Choose a geometry library based on:

- License.
- Browser and Node compatibility.
- Precision and determinism.
- Multipolygon, hole, and union support.
- Curve-preservation strategy.
- Handling of degenerate input.

Bundle or vendor it locally in a form that works with native modules. Don't require a runtime CDN.

Version individual level data separately from the level catalog.

Include gameplay-relevant terrain geometry and an appropriate compiler/physics version in the gameplay identity. Exclude temporary selections and caches.

Never silently reuse old replays or leaderboard identities for changed collision geometry.

## 16. Implementation Milestones

### Milestone 1 — Format and topology prototype

- [ ] Define blocks, regions, and boundary nodes.
- [ ] Create an outer boundary with an editable inner boundary.
- [ ] Move the inner boundary as part of the same block.
- [ ] Prove curve-preserving cuts and entrance creation.
- [ ] Handle splits into disconnected regions.
- [ ] Place a separate block inside a cave and compile the union correctly.
- [ ] Validate malformed geometry.

### Milestone 2 — Physics

- [ ] Compile deterministic collision boundaries.
- [ ] Implement containment with holes.
- [ ] Verify floor, wall, ceiling, and nested-island contacts.
- [ ] Verify swept collisions.
- [ ] Remove buried overlap edges.

### Milestone 3 — Rendering

- [ ] Render blocks with holes and nested islands.
- [ ] Preserve pixel-art materials.
- [ ] Add revision-based cache invalidation.
- [ ] Verify vegetation and chunk seams.

### Milestone 4 — Editor

- [ ] Replace the legacy terrain tools.
- [ ] Add outer and inner boundary editing.
- [ ] Add multi-point, whole-boundary, and multi-block selection.
- [ ] Implement hit-testing priority.
- [ ] Add curve handles and shape-preserving node insertion.
- [ ] Add topology previews and undo/redo.
- [ ] Add cave-aware finish placement.

### Milestone 5 — Migration and integration

- [ ] Convert The Hanging Gardens.
- [ ] Preserve legacy object positions.
- [ ] Audit runtime terrain callers.
- [ ] Update hashing and replay policy.
- [ ] Verify file saves, browser drafts, exports, and playtests.

### Milestone 6 — Rollout

- [ ] Run regression tests.
- [ ] Profile representative maps.
- [ ] Convert and review official maps.
- [ ] Retire the old authoring tools.
- [ ] Keep legacy import as a migration path.

## 17. Acceptance Criteria

### Terrain model

- [ ] Only one terrain block type is exposed.
- [ ] A block owns its outer and inner boundaries.
- [ ] No persistent cave blocks or cutter masks are needed.
- [ ] Inner points use the same controls as outer points.

### Editing

- [ ] Moving an inner boundary moves empty space and fills its old location.
- [ ] Moving a block moves all its boundaries.
- [ ] Deleting an inner boundary fills the hole.
- [ ] Opening a hole to the outside produces valid joined boundaries.
- [ ] Splitting a block produces valid regions of the same block.
- [ ] Curves remain editable after cutting and after save/load.
- [ ] Cuts don't needlessly flatten unaffected curves.
- [ ] Undo/redo restores geometry and caches correctly.

### Nested blocks

- [ ] A separate block can be created and edited inside another block's cave.
- [ ] Moving the surrounding block leaves the nested block unchanged.
- [ ] Cutting the surrounding block doesn't affect the nested block.
- [ ] Clicking empty cave space doesn't select the surrounding block.
- [ ] A nested block overlapping a cave wall fills that part of the cave, with no internal collision edges.
- [ ] Validation warns when a block is fully buried.

### Runtime

- [ ] Wheels and ragdolls collide with cave floors, ceilings, and nested islands.
- [ ] Overlapping blocks produce no internal collision barriers.
- [ ] Rendering and collision agree within the specified tolerance.
- [ ] Props, shadows, and finishes use the correct surface.
- [ ] Migration preserves object positions within the agreed tolerance.
- [ ] Runtime geometry is deterministic and cached.

## 18. Delivery Strategy

Implement on a separate branch or a backed-up copy.

First prove the core interaction:

> Create one block, add inner boundary points, reshape the empty space, join it to the outside, and place a separate block inside it, without introducing another terrain object type.

Then connect physics, rendering, and the existing editor.

Keep the current working game intact until the unified system passes the acceptance criteria.