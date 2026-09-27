# Unified Terrain Redesign Plan

## 1. Objective

Replace the separate ground, gap, platform, and thick-path systems with **one editable terrain block type**.

Each block has editable boundary points:

- **Outer boundaries** define its solid shape.
- **Inner boundaries** define empty spaces within it.

Both use identical point-editing and curvature controls. A cave is not a separate block, mask, or subtractive object. It is an inner boundary of the same terrain block.

The creator should be able to:

- Start with a rectangular block.
- Move, add, and remove boundary points.
- Make edges straight or curved.
- Create empty spaces inside the block.
- Reshape those spaces using their boundary points.
- Open an interior space to the outside.
- Create hills, islands, overhangs, tunnels, and loops using the same terrain type.

## 2. Core Editing Model

### One block, multiple boundaries

A terrain block owns its material and boundaries.

```text
Terrain block
├── Outer boundary
│   └── Editable points and curve handles
├── Inner boundary: empty space
│   └── Editable points and curve handles
└── Additional inner boundaries, if needed
    └── Editable points and curve handles
```

Selecting an inner boundary means selecting part of the block—not selecting another terrain object.

### Moving empty space

Select all points around an inner boundary and drag them:

- The empty space moves.
- Its previous location becomes solid.
- Its new location becomes empty.

Moving the whole block moves all its boundaries together.

### Openings and disconnected pieces

When an inner boundary reaches the outside, it must merge with the outer boundary to form an entrance.

A cut through a block may produce disconnected solid pieces. These can remain parts of one editable terrain object. They must not require a new terrain type.

## 3. Scope

### Included

- Unified terrain data format.
- Outer and inner boundary editing.
- Straight and curved edges.
- Operations for creating holes, entrances, and separations.
- Collision support for floors, walls, and ceilings.
- Existing pixel-art rendering and caching.
- Existing editor integration.
- Migration of older maps.
- Cave-aware object placement, shadows, and finish placement.
- Validation, hashing, and tests.

### Blocks inside empty spaces

- New terrain blocks can be created inside another block’s inner boundary.
- They use the same block type, point editing, curves, and materials.
- Each block remains independently selectable and movable.
- Being inside another block’s empty space does not automatically make it a child of that block. Moving the surrounding block does not move it unless both are selected.
- Each new block can also have its own inner boundaries.
-If blocks touch or overlap, the compiled collision geometry must remove buried edges while preserving the independently editable blocks.
- Example: a large rock block contains a cave; inside that cave, you place a separate grass-covered island. Both are normal terrain blocks, and either can be edited independently.

## 4. Current System and Reusable Infrastructure

Current terrain consists of:

| Data | Purpose |
|---|---|
| `level.points` | Main ground height curve |
| `level.gaps` | Missing horizontal ground ranges |
| `level.platforms` | Islands with top and bottom curves |
| `level.paths` | Thick open or closed lines |

A single ground height per x-coordinate cannot represent arbitrary cave roofs, vertical walls, or overhangs.

Preserve where practical:

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

- Stable identifier.
- Material.
- One or more solid regions.

Each region contains:

- One closed outer boundary.
- Zero or more closed inner boundaries.

Multiple regions allow one block to remain one editor object after being split into disconnected pieces.

### 5.2 Boundary nodes

Each boundary consists of ordered nodes containing:

- Stable node identifier.
- Position.
- Incoming and outgoing curve handles.
- Point mode: corner, smooth, or independent.
- Outgoing edge type: straight or cubic Bézier.

All boundaries use the same node format.

Do not sort boundary points by x-coordinate. Their order follows the boundary around the shape.

### 5.3 Geometry rules

- Outer and inner boundaries must not self-intersect.
- Inner boundaries must lie inside their owning outer boundary.
- Boundaries must not intersect or touch in an unresolved state.
- Empty spaces may contain solid islands represented as additional solid regions.
- Boundary direction and solid-side conventions must be normalized.
- Serialized geometry contains no separate cave objects or persistent cutter masks.

Exact field names should be finalized before coding.

## 6. Editor Workflow

### 6.1 Terrain tools

Replace Ground, Gap, Island, and Path/loop with:

- **Block:** creates a rectangular terrain block.
- **Cut:** edits the selected block’s boundaries by removing a drawn region.

The Cut outline is temporary input. Once committed, only the resulting block boundaries remain.

The existing Select tool handles:

- Block movement.
- Boundary-point movement.
- Curve-handle movement.
- Whole-boundary selection.
- Multiple-point selection.

### 6.2 Point editing

Support:

- Drag nodes and handles.
- Double-click an edge to insert a node.
- Delete selected nodes.
- Switch edges between straight and curved.
- Select all nodes of an inner boundary to move or scale that space.
- Delete an entire inner boundary to fill its space.
- Move the whole block, including all interior boundaries.

Inserting a node on a curved edge should split the Bézier without changing its shape.

Deleting an outer boundary must clearly distinguish deleting its solid region from deleting the entire block.

### 6.3 Curve controls

Inspector controls:

- Straight or curved edge.
- Corner point.
- Smooth point with aligned handles.
- Independent incoming and outgoing handles.
- Position and optional grid snapping.

The same controls apply inside and outside the block.

### 6.4 Creating holes and entrances

| Operation | Result |
|---|---|
| Cut entirely inside solid terrain | New inner boundary |
| Cut across the outside edge | Modified outer boundary |
| Extend an existing empty space to the outside | Inner and outer boundaries join into an entrance |
| Cut through the entire block | Multiple solid regions in the same block |
| Delete an inner boundary | Empty space fills in |
| Cut outside the selected block | No change; show feedback |

Dragging an inner boundary into another boundary requires an explicit topology commit, not silently saving intersecting outlines.

Preview the proposed result and allow confirmation or cancellation. If the operation cannot produce valid geometry, keep the last valid state.

### 6.5 Undo and selection stability

- One undo step per completed gesture or topology operation.
- Escape cancels unfinished operations.
- Undo restores original curves and boundary structure.
- Preserve identifiers for unchanged nodes.
- Clear or remap selection when an operation removes selected geometry.

## 7. Curves and Topology Operations

### 7.1 Ordinary edits

Moving points and handles updates the stored curves directly. No permanent polygon conversion is needed.

### 7.2 Cuts and boundary joins

Cuts may split curves, remove sections, create intersections, or change which boundaries are connected.

Use a tested geometry implementation rather than hand-written polygon subtraction.

The output must become the block’s new editable boundaries. It must not remain a separate subtractive object.

### 7.3 Preserving editable curves

Polygon Boolean operations alone do not preserve Bézier handles.

Before implementation, choose and test one of these approaches:

1. A curve-aware Boolean implementation.
2. A polygon-based implementation that preserves source-edge provenance, retains untouched curves, splits surviving curve sections, and reconstructs changed sections within a defined tolerance.

Requirements:

- Retain unaffected curves where possible.
- Avoid turning the whole block into hundreds of permanent nodes after a small cut.
- Bound any curve-fitting or simplification error.
- Revalidate reconstructed geometry.
- Permit short straight boundary sections where safe curve reconstruction is unavailable.

Prove this workflow in a small prototype before building the complete editor.

## 8. Shared Runtime Geometry

Compile editable boundaries into runtime geometry:

```text
Stored outer and inner boundary curves
                  ↓
Deterministic curve subdivision
                  ↓
Validated solid regions and holes
                  ↓
Resolve overlaps between blocks
                  ↓
Cached boundary edges and spatial index
                  ↓
Rendering, collision, and surface queries
```

### Subdivision

Use adaptive subdivision with:

- Fixed world-space error tolerance.
- Stable output ordering.
- A segment or recursion limit.
- No dependence on camera zoom or frame rate.

### Overlapping blocks

Collision uses the union of solids so buried edges do not become invisible barriers.

Blocks remain individually editable.

Define a deterministic material-priority rule shared by rendering and physics.

## 9. Physics and Surface Queries

Adapt the existing collision infrastructure to compiled boundary loops.

Requirements:

- Correct solid containment with holes.
- Normals pointing from solid into empty space.
- Contacts against floors, walls, ceilings, and cave interiors.
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

Return position, normal, tangent, material, and relevant geometry identity.

Inside a cave, a downward query must find the cave floor, not the outside surface above its ceiling.

Update callers of:

- `terrainAt()`
- `terrainSurfacesAt()`
- `seatedSurfaceAt()`
- `groundShadowSamples()`
- Direct reads of legacy ground and platform curves.

## 10. Rendering and Caching

Preserve:

- Two-world-unit art pixels.
- Palette quantization.
- Existing material appearance.
- World-space terrain chunks.

Render from the same compiled boundaries used by physics.

Support:

- Empty interiors.
- Cave floors, ceilings, and exterior walls.
- Material patterns clipped to solids.
- Vegetation restricted to suitable upward-facing surfaces.
- Consistent chunk boundaries.

### Invalidation

Track geometry revisions explicitly.

When a block changes, invalidate:

1. Its compiled geometry.
2. Affected overlap geometry and collision indexes.
3. Rendering chunks covering old and new bounds.
4. Dependent prop and shadow queries.

Begin with whole-level invalidation if needed for correctness, then optimize.

No Boolean operations or curve rebuilding should occur during ordinary gameplay frames.

## 11. Object and Finish Placement

### New levels

Use explicit positions or reference-height-based surface snapping.

The finish needs a height or surface attachment in addition to x-coordinate.

Props and shadows must follow the intended surface, including cave floors and islands.

If attachments are stored, define recovery when the referenced boundary is removed or split.

### Legacy levels

Resolve implicit positions before removing the old terrain representation:

- Apples with `y: null`.
- Props with `y: null`.
- Ground-relative starts.
- Automatically placed spikes.
- X-only finish flags.

Preserve their previous world positions rather than selecting a newly discovered overhead surface.

## 12. Migration

Convert existing maps into reviewed copies. Do not overwrite originals automatically.

### Conversion rules

- Ground and gaps become finite solid regions.
- Platforms become blocks with closed boundaries.
- Thick paths become filled outlines preserving thickness and rounded joins.
- Closed thick paths retain their empty interiors where appropriate.
- Materials, objects, and metadata remain.

Legacy cosine curves require approximation. Define a geometric tolerance and validate conversion against it.

Explicitly define finite terrain bounds, since parts of the old system extend ground beyond authored endpoints.

### Initial fixture

Use `hanging-gardens.json` to exercise:

- Ground and gaps.
- Multiple island materials.
- Thick open and winding paths.
- Negative vertical coordinates.
- Explicit and implicit object placement.

Add isolated fixtures for holes, entrances, and closed bands.

## 13. File Changes

| File | Planned responsibility |
|---|---|
| New geometry module | Boundary curves, topology operations, subdivision, compilation |
| New migration module | Legacy-format conversion |
| `terrain.js` | Collision and surface queries |
| `terrain-render.js` | Unified solid rendering and revision-based caching |
| `level-schema.js` | New format, normalization, validation, blank block |
| `editor.js` | Block tools, inner/outer point editing, topology previews |
| Editor HTML | Terrain controls, curve controls, finish height |
| `drawing.js` | Prop alignment through new surface queries |
| `levels.js` | Consistent normalization and migration entry points |
| `level-hash.js` | New gameplay geometry and version identity |
| Runtime consumers | Spawn, finish, shadows, effects, terrain references |

The remaining runtime files must be audited during implementation. Compatibility is not yet verified.

## 14. Dependencies and Versioning

Select a geometry library based on:

- License.
- Browser and Node compatibility.
- Precision and determinism.
- Multipolygon and hole support.
- Curve-preservation strategy.
- Degenerate-input handling.

Bundle or vendor it locally in a native-module-compatible form. Do not require a runtime CDN.

Version individual level data separately from the level catalog.

Include gameplay-relevant terrain geometry and an appropriate compiler/physics version in gameplay identity. Exclude temporary selections and caches.

Do not silently reuse old replays or leaderboard identities for changed collision geometry.

## 15. Implementation Milestones

### Milestone 1 — Format and topology prototype

- [ ] Define blocks, regions, and boundary nodes.
- [ ] Create an outer boundary with an editable inner boundary.
- [ ] Move the inner boundary as part of the same block.
- [ ] Prove curve-preserving cuts and entrance creation.
- [ ] Handle splits into disconnected solid regions.
- [ ] Validate malformed geometry.

### Milestone 2 — Physics

- [ ] Compile deterministic collision boundaries.
- [ ] Implement containment with holes.
- [ ] Verify floor, wall, and ceiling contacts.
- [ ] Verify swept collisions.
- [ ] Remove buried overlap edges.

### Milestone 3 — Rendering

- [ ] Render blocks with holes.
- [ ] Preserve pixel-art materials.
- [ ] Add revision-based cache invalidation.
- [ ] Verify vegetation and chunk seams.

### Milestone 4 — Editor

- [ ] Replace legacy terrain tools.
- [ ] Add outer and inner boundary editing.
- [ ] Add multi-point and whole-boundary selection.
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
- [ ] Retire old authoring tools.
- [ ] Retain legacy import as a migration path.

## 16. Acceptance Criteria

- [ ] Only one terrain block type is exposed.
- [ ] A block owns its outer and inner boundaries.
- [ ] No persistent cave blocks or cutter masks are required.
- [ ] Inner points use the same controls as outer points.
- [ ] Moving an inner boundary moves empty space and fills its old location.
- [ ] Moving a block moves all its boundaries.
- [ ] Deleting an inner boundary fills the hole.
- [ ] Opening a hole to the outside produces valid joined boundaries.
- [ ] Splitting a block produces valid disconnected regions.
- [ ] Curves remain editable after cutting and save/load.
- [ ] Cuts do not needlessly flatten unaffected curves.
- [ ] Wheels and ragdolls collide with cave floors and ceilings.
- [ ] Overlapping blocks produce no internal collision barriers.
- [ ] Rendering and collision agree within the specified tolerance.
- [ ] Props, shadows, and finishes use the correct surface.
- [ ] Undo/redo restores geometry and caches correctly.
- [ ] Migration preserves object positions within the agreed tolerance.
- [ ] Runtime geometry is deterministic and cached.

## 17. Delivery Strategy

Implement on a separate branch or backed-up copy.

First prove the core interaction:

> Create one block, add inner boundary points, reshape the empty space, and join it to the outside without introducing another terrain object.

Then integrate physics, rendering, and the existing editor.

Keep the current working game intact until the unified system passes the acceptance tests.