# Parallax Roadmap

Last updated: August 4, 2026 (revolve made exact in the viewport, golden-part regression corpus, and prefix caching)

This document tracks what Parallax can do, what the project is actively building, and the milestones required to become a professional browser-native parametric CAD system.

## Status legend

- ✅ Complete for the current stage
- 🚧 In progress or next in the active milestone
- ⬜ Planned
- 🔬 Research required before implementation

“Complete” means the capability is integrated and usable in the current pre-alpha. It does not imply final production quality.

## Where we are

Parallax has crossed its first architectural threshold: a user can draw a constrained planar profile, turn it into a linked parametric extrusion, have that extrusion evaluated as an exact OpenCascade B-rep, reload the project, export a STEP file, and print a dimensioned drawing of it.

Dimensions have since stopped being constants: a document-wide parameter table drives feature and sketch dimensions by formula, while every evaluator downstream still reads the plain numbers it always read.

The sketcher has since stopped being the limiting factor. Profiles can mix straight and curved edges, so slots, D shapes and rounded outlines are expressible and reach the kernel as true arcs; constraints are listed, added, edited and removed by hand rather than only inferred as geometry is drawn.

The project is still a pre-alpha. It proves the browser architecture and the primary sketch-to-solid loop, but it does not yet provide the breadth, reference stability, testing, or recovery guarantees required for serious production work.

### Current capability snapshot

| Area | Status | Notes |
| --- | --- | --- |
| Application shell | ✅ | Browser workspace, feature tree, properties, status, commands |
| 3D viewport | ✅ | Z-up grid, cameras, view cube, selection, transform gizmo, weighted edges and part-scaled ambient occlusion |
| Inspection and measurement | ✅ | Feature inspection and snapped point-to-point measurements with axis deltas |
| Direct manipulation | 🚧 | Push/pull on the end cap of a sweep edits the owning extrusion as one undo step; fillet handles and on-model dimensions remain |
| Parametric document | ✅ | Versioned schema (v8), editable feature parameters, named parameters and formulas, serialization |
| Undo/redo | ✅ | Snapshot history; command-level history is planned |
| Local persistence | ✅ | IndexedDB multi-project autosave, recovery snapshots, portable project JSON |
| Primitive features | 🚧 | Editable previews; not exact B-rep features yet |
| Sketching | 🚧 | Line, rectangle, circle, centre-point arc, trim, corner fillet, snapping, multi-region profiles with holes, and boundaries mixing straight and curved edges |
| Constraint solving | 🚧 | PlaneGCS worker with an explicit anchor; constraints are listed, added, edited, and removed by hand, and conflicts name the geometry |
| Exact solids | 🚧 | Exact new-body, additive, subtractive, and filleted extrusion and revolve are integrated, and both now reach the viewport as B-rep rather than preview geometry; an oversized fillet reports the radius that would fit instead of failing the part |
| STEP export | ✅ | Available for supported exact extrusions and revolves |
| Boolean modeling | 🚧 | Exact add and cut are integrated; intersect and multi-body management remain |
| Drawings | 🚧 | Third-angle sheets with a hatched full section and generated dimensions export to PDF and SVG; not associative, no GD&T |
| Named parameters | ✅ | Document parameter table, `=` formulas on feature and sketch dimensions, rename propagation, broken-formula degradation and repair |
| Assemblies | ⬜ | Not started |

## Next session — start here

Ordered by value, with the reasoning rather than just the task.

0. **Move sketching into the 3D viewport.** The sketcher is an SVG surface that
   replaces the scene, so the model disappears while you draw on it. That is the
   ceiling on how the application feels, and it is also what blocks projected
   geometry, arbitrary datum planes, and in-context modeling — each of which is
   listed elsewhere in this roadmap as if it were an independent task. The pure
   logic (`sketch-view`, `entity-snap`, `line-inference`, `tangent-arc`,
   `constraint-*`, `sketch-edits`) survives the move; what changes is the render
   surface and the model↔screen transform becoming a camera projection. Every
   sketch tool added before this migration is written twice, so it should happen
   *before* item 4, not after.
1. **Repair actions, not just repair advice.** ✅ An oversized fillet offers an "apply suggested radius" control backed by the kernel-verified value, and an unresolved fillet can replace its stale edge references in the viewport without recreating the feature.
2. **Consolidate the tolerance constants.** ✅ Reference anchors, face ownership, coplanarity, and fillet-edge matching now use one documented tolerance policy. Linear distances and squared-distance scores are named with their units, and tests preserve the intentional strictness ordering between modeling and presentation decisions.
3. **One broken-reference state.** ✅ Fillet edges, face anchors, and constraint failures now share the same feature-diagnostic vocabulary in `core/diagnostics.ts`: owner, subject, reason, severity, and typed repair actions. Missing face hosts no longer fail silently, and all three mechanisms feed the same feature-tree warning state.
4. **Finish the sketch tool set.** 🚧 Centre-point, three-point, and endpoint-driven tangent arcs now share the existing `ArcEntity`, solver, profile, and exact-kernel path. General trim ships: `sketcher/trim.ts` computes line/arc/circle crossings, decides which span a click asks to remove, and returns the surviving pieces, so sketch fillet (corner round) and offset are now "split at these parameters, then add geometry between the pieces" and no longer need new intersection maths. Line-to-line corner fillet follows from it and ships too. Construction geometry, offset, curve-to-curve fillets and the remaining entity-editing tools follow.
5. **Manufacturing-aware Hole feature.** Now unblocked — build the next major vertical slice: simple, counterbored, countersunk, and threaded holes placed from sketch points or face coordinates; through-all and blind extents; standard sizes and thread metadata; exact boolean geometry; editable parameters; and automatic drawing callouts. This must preserve manufacturing intent in the document rather than behaving like a renamed subtractive cylinder.
6. **Under-, fully-, and over-constrained visual states.** ✅ Sketch geometry is coloured by its live solver state, while selections and the specific geometry responsible for a constraint issue retain stronger highlight priority.
7. **Performance fixtures.** ✅ A deterministic 250-step linear part benchmark measures document signatures and full operation-chain/cache-key construction without mixing WebAssembly startup into the result. Kernel-level reuse is guarded separately by a replayed-operation count in `evaluate-chain.test.ts`, which is exact and machine-independent where a wall-clock budget would be flaky.
8. **Direct manipulation.** 🚧 Push/pull ships: dragging the end cap of a sweep
   edits the owning extrusion's distance, live, as one undo step. It stays
   parametric — the drag resolves to *which feature owns this face and what
   number on it the face is*, then changes that number, so the history rebuilds
   and the edit survives a reload. Draggable fillet-radius handles and on-model
   dimension editing remain, as does dragging a side wall, which means editing
   sketch geometry rather than a feature parameter.

## Milestone 0 — Browser CAD foundation

Status: ✅ Complete

- ✅ TypeScript, React, Vite, Three.js, and Zustand application foundation
- ✅ Responsive browser workspace and CAD-oriented visual system
- ✅ Z-up Three.js viewport with grid, camera navigation, and view controls
- ✅ Millimeter-native parametric document with millimeter, machinist-inch (.001), and carpenter-inch (1/16) display and entry modes
- ✅ Feature selection, property editing, and visibility
- ✅ Undo and redo
- ✅ Local autosave
- ✅ Project import and export
- ✅ Versioned project schema with initial migration support
- ✅ Git repository and production build pipeline

## Milestone 1 — Constrained sketch to exact solid

Status: ✅ Complete for the initial vertical slice

- ✅ XY-plane sketch mode
- ✅ Line, rectangle, and circle creation
- ✅ Coordinate display and 1 mm snapping
- ✅ Horizontal, vertical, coincident, and radius constraints
- ✅ PlaneGCS running outside the main thread
- ✅ Closed-profile recognition
- ✅ Sketch-linked extrusion feature
- ✅ Editable extrusion distance and symmetric extent
- ✅ Responsive preview followed by exact B-rep evaluation
- ✅ OpenCascade running outside the main thread
- ✅ Exact solid reevaluation after project reload
- ✅ STEP export

## Milestone 2 — Fully controllable sketches

Status: 🚧 Current priority

The goal is to make sketches predictable, inspectable, and genuinely parametric rather than merely constrained at creation time.

### Geometry and interaction

- ✅ Unified model-to-screen coordinates for geometry, previews, points, and pointer input
- ✅ Cursor-centered zoom, panning, fit, and reset controls in the sketch workspace
- ✅ Configurable 15°, 30°, and 45° line-angle snapping with persistent angle constraints
- ✅ Select and delete sketch entities
- ✅ Select entities and drag connected sketch geometry with a single undoable commit
- ✅ Position a connected profile or complete sketch by typed center coordinates, including centering at the origin
- ✅ Start sketches from axis-aligned planar solid faces and retain a ghosted in-context body while editing
- ✅ Highlight the individual supported or unsupported face under the pointer before creating a face-attached sketch
- ✅ Retain the parent solid during face sketching and expose the selected face boundary, center, dimensions, area, source, and snap targets
- ✅ Persist the face dependency: a face-attached sketch names the sweep end it sits on and re-derives its plane, so it follows the feature underneath when that feature's depth changes
- ✅ Every sketch edit runs through PlaneGCS and commits only solved geometry, as a single undoable step
- ✅ Explicit per-sketch solver anchor, so entity order no longer changes how a sketch solves
- 🚧 Select and drag individual sketch points while solving surrounding geometry
- 🚧 Drag geometry while PlaneGCS solves temporary constraints (currently solved on release, not during)
- 🚧 Trim splits a curve at its crossings and removes the picked span, previewing that span before the click; entity editing beyond dragging, and an explicit split-without-removing, remain
- ✅ Arc tools: centre-point, three-point, and tangent arcs are integrated end to end, from the sketcher through PlaneGCS to exact B-rep profiles that mix straight and curved edges
- ⬜ Construction geometry and centerlines
- ⬜ Project external edges into a sketch
- 🚧 Sketch fillet rounds a line-to-line corner: the arc is tangent to both lines, both are cut back to the tangent points, and the result carries tangency, a radius dimension and coincidence at each end, so it means "rounded corner" to the solver rather than "an arc near a gap". Fillets involving arcs or circles need a different tangent construction and are reported as unsupported instead of approximated. Offset remains, and the trim work above supplies the splitting maths it needs
- 🚧 Multi-selection: shift-click selects a second entity so a relationship can be applied to a pair; box selection remains

### Constraints and dimensions

- ✅ Driving horizontal, vertical, distance, angle and radius dimensions: every dimension in the constraint list can be retargeted and re-solves the sketch
- ✅ Add and remove constraints explicitly, from a constraint list that names the geometry each one holds
- 🚧 Parallel, perpendicular, tangent, equal and concentric are available on a selection; midpoint, symmetry, and point-on-object remain
- ✅ Degrees-of-freedom reporting
- ✅ Under-, fully-, and over-constrained visual states
- 🚧 Conflicting, redundant, and inapplicable constraints are reported by id and highlighted on the geometry they name; plain-language repair advice remains
- ⬜ Reference dimensions
- ✅ Named parameters and expressions: a document parameter table resolved in dependency order, formulas stored beside the numbers they drive so PlaneGCS, the exact kernel, the operation-chain cache and export keep reading plain numbers, `=` entry on every feature and sketch dimension, rename-with-reference-rewrite as one undo step, and a formula that stops evaluating degrading to its last good value with a repair action rather than failing the part

### Milestone acceptance criteria

- A user can create and fully constrain a mechanical profile without editing serialized data.
- Every driving dimension can be changed later and recomputes the sketch predictably.
- Dragging under-constrained geometry remains responsive and honors existing constraints.
- Conflicting or redundant constraints identify the responsible geometry.
- Undo/redo produces coherent modeling actions rather than solver-internal steps.

## Milestone 3 — Exact part modeling

Status: ⬜ Planned

### Exact feature system

- ⬜ Move boxes, cylinders, and spheres to exact OpenCascade features
- ✅ Additive and subtractive extrusion in a linear single-body history
- ⬜ Intersecting extrusion and independent multi-body management
- ✅ Multiple closed regions and profiles with internal holes
- ✅ Revolve about the sketch X or Y axis, with new-body, add, and cut operations
- ⬜ Manufacturing-aware Hole feature: simple, counterbored, and countersunk forms; through-all and blind extents; placement from sketch points or face coordinates; standard diameters and thread metadata; exact boolean geometry; editable design intent; and data for generated drawing callouts
- 🚧 Exact selectable-edge fillet is integrated, and an oversized radius is reported with the largest one that works instead of failing the part; chamfer remains
- 🔬 Mitered corner fillets: fix OpenCascade 2-edge sharp fillet intersections without falling back to spherical blends or edge-by-edge mutations
- ⬜ Shell and draft
- ⬜ Linear, circular, and mirror patterns
- ⬜ Sweep and loft
- ⬜ Multiple bodies and body folders
- ⬜ Feature suppression, rollback, and reorder

### References and datum geometry

- 🚧 Sketch on principal planes and axis-aligned planar faces; arbitrary datum planes remain
- ⬜ Datum planes, axes, points, and coordinate systems
- ⬜ Reference faces, edges, vertices, and feature outputs
- 🚧 Stable topological naming across recomputation: fillet edges and face-attached sketches carry provenance anchors re-derived from the document; faces referenced by other feature kinds, and a shared tolerance policy, remain
- 🚧 Broken-reference diagnostics and repair workflow: an unresolved fillet edge distinguishes moved from deleted, and an oversized fillet quotes a radius that fits, both surfaced on the feature; the diagnostics are still per-mechanism and none of them can be acted on without retyping the value by hand

### Milestone acceptance criteria

- A practical multi-feature mechanical part can be built without leaving Parallax.
- All solid-producing features use exact B-rep geometry.
- Additive and subtractive operations preserve parametric dependencies.
- Common parameter changes recompute without silently attaching features to the wrong topology.
- Supported parts export valid STEP and STL files.
- Hole intent survives parameter edits and produces correct geometry and drawing callouts without being inferred back from anonymous cylindrical cuts.

## Milestone 4 — Reliability, performance, and file interoperability

Status: ⬜ Planned

> **Dependency, corrected August 4, 2026.** This section previously blocked all
> caching on stable topological naming. That was wrong, and it cost the project
> a straightforward performance win.
>
> Naming is required for *dependency-aware* recomputation — skipping features in
> the middle of a history because nothing they depend on changed. It is **not**
> required for *prefix* recomputation. `buildOperationChain` is already a pure
> function of the document and already resolves references down to concrete
> geometry, so a given prefix of operations always denotes the same solid and
> can be cached and resumed from safely. That is now implemented in
> `kernel/evaluate-chain.ts`, and in a linear history it captures most of the
> win: editing the end of a 40-feature part is ~23x faster than replaying it.
>
> What still waits on naming is the middle of the history, not the end of it.

- ✅ Move project persistence to IndexedDB
- ⬜ Move large binary payloads to OPFS
- ⬜ Crash-safe incremental autosave and recovery
- ⬜ Background feature-graph evaluation with cancellation
- ✅ Geometry cache keyed by feature inputs — an LRU of intermediate solids keyed
  by every legal prefix of the operation chain, never splitting a fillet run
- 🚧 Incremental recomputation of affected features only — evaluation resumes
  from the last unchanged operation; skipping *unaffected* features in the
  middle of a history still needs stable naming
- ⬜ Progress and failure states for long kernel operations
- ✅ Persistent local application and kernel diagnostics with operation-chain context and JSON export
- ⬜ STEP import
- ⬜ STL, OBJ, and GLB import/export where appropriate
- ⬜ Native B-rep archival inside project packages
- 🚧 Project schema compatibility tests and migration fixtures (v1→v3 migration and the Local Storage import are covered)
- 🚧 Unit, integration, kernel, and browser interaction test suites (pure geometry, the kernel operation chain, face classification, sketch transforms, and persistence are covered; `kernel/golden-parts.test.ts` now takes whole documents through the real kernel and checks them against hand-computed volumes, which is the layer that previously had almost none; there is no browser interaction suite yet)
- 🚧 Large-model performance budgets and benchmarks (a reproducible 250-step modeling fixture and baseline benchmarks ship; enforced timing budgets and exact-kernel benchmarks remain)
- ⬜ Offline-capable PWA packaging

## Milestone 5 — Assemblies

Status: ⬜ Planned

- ⬜ Part and assembly documents
- ⬜ Component insertion and instances
- ⬜ Fixed, coincident, concentric, distance, angle, parallel, and tangent mates
- ⬜ Assembly constraint solver
- ⬜ Subassemblies
- ⬜ Configurations and component suppression
- ⬜ Interference and clearance checks
- ⬜ Exploded views
- ⬜ Bill of materials
- ⬜ Lightweight component loading for large assemblies
- ⬜ Shared part references with explicit version control

## Milestone 6 — Drawings and manufacturing communication

Status: 🚧 First vertical slice complete

A user can take a modelled part to a printable, dimensioned sheet without
leaving Parallax. The sheet is generated from the exact B-rep by hidden-line
removal, not from the display mesh, so what it measures is what the STEP file
contains.

The slice deliberately stops short of a drawing *document*: sheets are produced
on demand and are not stored, which means a drawing can never disagree with its
model, but also that nothing on it can be moved, overridden, or toleranced yet.
That is the next step, and it needs the same stable-reference work Milestone 3
is blocked on before an annotation can survive a recompute.

- 🚧 Drawing sheets, formats, and title blocks (Letter, Tabloid, A4, A3 with a filled title block and notes; multi-sheet and custom formats remain)
- 🚧 Projected, section, detail, auxiliary, and broken views (third-angle front, top, right and isometric are projected, and one full section can be cut in the direction of any of them; offset, half, detail, auxiliary and broken views remain)
- 🚧 Associative dimensions and annotations (overall size, diameter and radius callouts with counts, and hole and shoulder positions are generated from the projection; they are regenerated rather than associative, and cannot yet be placed or edited by hand)
- ✅ Preferred-scale selection, hidden-line removal, and hidden lines suppressed where visible geometry already covers them
- ✅ Section hatching clipped to the cut faces, with a cutting-plane line and direction-of-sight arrows on the reference view
- ✅ Center marks
- ⬜ Geometric dimensioning and tolerancing
- ⬜ Associative hole callouts generated from Hole feature intent, including quantity, diameter or thread, depth, counterbore, and countersink data; surface finish, weld, and datum symbols remain
- ⬜ Parts lists and balloons
- 🚧 PDF, SVG, DXF, and DWG-oriented exchange workflows (vector PDF and SVG ship; DXF and DWG remain)
- ⬜ Drawing update and broken-reference diagnostics

## Milestone 7 — Professional product platform

Status: ⬜ Planned

- ⬜ Optional accounts without weakening local-first use
- ⬜ Encrypted cloud storage and version history
- ⬜ Share links and permission controls
- ⬜ Multiplayer editing and presence
- ⬜ Branching, comparison, and merge workflows for CAD documents
- ⬜ Comments, review, approval, and release states
- ⬜ Extensible command, feature, importer, and exporter APIs
- ⬜ Desktop wrappers only where native integration adds value
- ⬜ Keyboard, mouse, pen, touch, and SpaceMouse input
- ⬜ Accessibility and localization
- ⬜ Administrable team and enterprise deployments

## Continuous workstreams

These do not wait for a single milestone.

### User experience

- Keep core operations discoverable without hiding professional controls.
- Keep measurement and inspection available without modifying the parametric model.
- Preserve spatial context when switching between sketching, part modeling, assemblies, and drawings.
- Design error states as repair workflows rather than generic failures: a refused operation should report the value that would be accepted.
- Maintain a consistent command search, shortcut, and context-menu model.
- Keep the viewport technical rather than photographic: weighted edges, matte
  surfaces, and occlusion tight enough to read as form. A part should look
  measured, not rendered.
- Never let presentation decide what can be picked. How geometry is drawn and
  where that geometry is have to stay separate, or changing a material silently
  changes what a user can snap to.

### Quality and correctness

- Add regression fixtures for every geometry bug.
- Distinguish preview failure, solver failure, and kernel failure in the interface.
- Never label mesh-only geometry as mechanically exact.
- Validate exported manufacturing files independently of the display mesh.

### Performance

- Keep pointer and camera interaction at 60 frames per second on representative hardware.
- Keep PlaneGCS and OpenCascade work off the main thread.
- Load large WebAssembly modules only when needed.
- Measure recomputation latency and memory use as the feature graph grows.

### Project durability

- Version every persisted structure.
- Preserve a migration path for user-created documents.
- Prefer deterministic feature evaluation.
- Keep the document representation independent of React and Three.js.

## Refactor notes — August 2, 2026

These are implementation-shaping notes from a code review, not committed feature work. Tackle them incrementally with behavior-preserving tests; the current performance fixes should remain measurable guardrails while these boundaries move.

### Highest-leverage boundaries

- ✅ Split `SceneViewport.tsx` into a Three.js runtime/controller, exact-mesh scene adapter, picking/selection service, and measurement/overlay components.
- ✅ Give the viewport a typed controller API (for camera commands, selection modes, and callbacks) instead of coupling `App`, `ViewCube`, and `SceneViewport` through `window` `CustomEvent`s and mutable callback refs.
- ✅ Replace the collection of mutually exclusive app interaction booleans with a discriminated interaction-mode state machine/reducer: idle, face selection, fillet edge selection, measurement, sketch entry, etc. Centralize cancel/Escape and cleanup so incompatible modes cannot overlap.
- ✅ Break `App.tsx` into app shell, command definitions, project dialogs, feature tree, toolbar, and per-feature property panels. Keep presentation components fed by typed commands/selectors rather than reaching into the Zustand singleton throughout the UI.

### Document and kernel seams

- ✅ Extract pure document commands/history transitions from `document-store.ts`; move hydration, autosave scheduling, recovery snapshots, and IndexedDB orchestration behind a project-session/persistence service. The store should mainly compose state, commands, and selectors.
- ✅ Replace whole-document JSON comparisons used by recovery snapshots with a deliberate revision/content-hash policy. Define which document changes deserve a recovery snapshot and avoid repeated deep serialization as projects grow.
- ✅ Wrap worker state, request IDs, in-flight deduplication, cache policy, diagnostics context, and stale-result handling in a `KernelClient`. Add request cancellation or supersession semantics so obsolete evaluations can be discarded before spending more work, not only ignored after completion.
- ✅ Separate geometric operation inputs from display-only feature identity where safe when forming kernel cache keys. Feature IDs and names currently participate in serialized operation chains; retain identity where reference resolution needs it, but avoid needless misses caused by presentation-only edits.
- ✅ Introduce an explicit document geometry revision/signature from the core model instead of rebuilding a JSON signature in the viewport. This will make invalidation rules visible, cheaper, and independently testable.

### Geometry, compatibility, and tests

- ✅ Build a normalized exact-edge index alongside each exact mesh and use it for hover, fillet picking, and measurement snapping. The viewport currently has several related edge/segment traversal paths; one reusable index will reduce duplicated transforms and give reference matching a single contract.
- ✅ Isolate third-party compatibility shims (including the OrbitControls private-field access and OpenCascade loader cast) in small adapters with version/contract tests. Application code should not depend directly on private library internals.
- ✅ Add browser-level interaction tests around mode entry/cancel, view commands, selection, fillet preflight/commit, and stale kernel responses. Pure core coverage is already useful; these seams need a small integration suite before the viewport and shell are split.
- ⬜ Add repeatable performance fixtures and budgets for long feature histories, mesh-cache memory, cold/warm fillet evaluation, and viewport rebuilds. Keep the recent “same fillet chain is evaluated once” and “render only necessary history stages” behavior protected by measurements.

### Roadmap/documentation cleanup

- ✅ Reconcile milestone wording with the current implementation before the next planning pass. Kept current since: the model schema is v7, and provenance anchors now cover fillet edges and face-attached sketches. Stable topological naming still blocks safe dependency-aware incremental recomputation, but it no longer blocks every cache or performance improvement.

## Kernel behaviour notes

Facts about OpenCascade through Replicad that cost real effort to establish. Recorded so they are not re-derived, and because each one falsified a plausible assumption.

- **A `Compound` result is normal, not a failure.** `shape.fillet()` returns a `Compound` even for a 1 mm fillet that is entirely valid. Treating the result type as a validity signal would report every fillet as broken.
- **A fillet that does not fit throws a bare numeric status code**, with no indication of what would fit. It does not return degenerate geometry — the failure is loud, just uninformative. `kernel/fillet-limit.ts` searches for an accepted radius instead of interpreting the code.
- **A fillet's limit depends on how many edges are rounded together.** One corner of a 20 × 20 plate accepts up to 19.9 mm, bounded by the adjacent faces; all four corners together stop at exactly 10 mm, where the blends collide. Any limit worked out from a single edge in isolation will be wrong for a group.
- **`measureVolume(shape)` is the volume accessor**, not a `.volume` property; the property exists on a different class and silently yields `NaN`.
- **PlaneGCS names a separate constraint per pair of entity kinds** — `arc_radius` against `circle_radius`, four tangency variants, four for equality. Applying the wrong one is not an error; it is a constraint that quietly fails to hold. `sketcher/constraint-primitives.ts` centralises the mapping for that reason.
- **Arc profiles reach the kernel through `threePointsArcTo`**, which carries no sweep or large-arc flag and so cannot disagree with the direction a boundary is being travelled. The endpoint-plus-flags forms can.
- **A boolean's operands stay valid, and were being leaked.** `previous.cut(tool)` returns a new solid and leaves both operands live; the worker never freed them, so a long history grew OpenCascade memory in proportion to its length. Freeing them is safe and now happens in `evaluate-chain.ts` — but only through `release`, because a shape the prefix cache owns must survive the evaluation that produced it.
- **One solid can legitimately back several cache entries.** A fillet whose edges have all gone is skipped, and `applyFilletGroup` passes the incoming solid straight through, so the prefixes either side of it are the same object. The prefix cache reference-counts shapes for exactly this case; a plain set double-freed them.
- **A cached prefix has to carry its diagnostics.** A skipped fillet leaves no trace in the geometry, so an evaluation resumed from a cached prefix that did not also cache `unresolved` silently stops reporting the broken feature. The part looks identical either way, which is what makes it easy to miss.
- **A bore built by boolean comes back split at the seam; a revolved cylinder does not.** A Ø12 hole through a plate yields two half-cylindrical faces (8 faces total), while a full revolve keeps its cylinders whole (4 faces for a tube). Both are stable, and `golden-parts.test.ts` pins them — but neither is derivable from the geometry, so do not predict face counts.
- **`Bnd_Box` is inflated by the shape tolerance.** A plate that genuinely starts at -30 reports -30.0000001. Assert extents to the millimetre; an exact comparison tests OCCT's tolerance constant rather than the part.
- **A planar cap is tessellated entirely from vertices on its own boundary**, and ray-casting containment is undefined exactly on a boundary. `core/face-ownership.ts` therefore attributes such a cap to *nothing*: `attributeFaces` returns the owner for a face sampled at interior points and for a side wall, but null for a cap sampled at its corners. For feature highlighting that is the documented cosmetic miss; for push/pull, which acts on caps and nothing else, it is fatal — which is why `core/push-pull.ts` resolves owners by depth match and a bounding-box overlap instead of going through `attributeFaces`. Worth fixing at the source eventually, since highlighting a solid's end faces is also wrong today.
- **`LineSegments2` is a `Mesh`, not a `LineSegments`.** Its geometry stores endpoints as instanced attributes, so it has no `position` attribute either. Both facts silently break anything that finds edges with `instanceof THREE.LineSegments` or reads `geometry.getAttribute('position')` — which is what measurement snapping used to do. Where the model's edges *are* now lives in `viewport/model-edges.ts` as an `EdgeSource` on the solid, separate from how they are drawn.
- **`LineMaterial` needs the drawing-buffer size.** Width is computed in clip space, so a material that misses a resize keeps drawing at the previous viewport's width. `setEdgeResolution` in `model-edges.ts` is called from `ViewportController.resize` for that reason, and `disposeObject` has to unregister materials or the registry keeps disposed ones alive.
- **A composed render path bypasses tone mapping.** `EffectComposer` ignores `renderer.toneMapping` and `outputColorSpace`; without a closing `OutputPass` the entire viewport washes out. This looks like a lighting bug and is not one.
- **Kernel-level tests run under jsdom** (`kernel/arc-profile.test.ts`, `fillet-apply.test.ts`, `fillet-limit.test.ts`). Load the wasm with `readFileSync` and a path resolved from `process.cwd()`: `import.meta.url` is not a file URL in that environment, and the shared test setup assumes a DOM, so the `node` environment is not available.

## Major technical risks

### Topological naming

Faces and edges may change identity when an upstream feature recomputes. Solving this before deep downstream references accumulate is critical. The project needs a persistent reference strategy based on feature provenance, geometric signatures, and explicit repair—not transient OpenCascade indices.

**The approach is now established, and applied twice.** A reference names *what made the geometry* rather than where it was, and is re-derived from the document on every evaluation:

- `core/edge-anchor.ts` names a solid edge by the sketch entity that swept it and where along that entity it sits, scoped to the extrusion that produced it.
- `core/face-anchor.ts` names the face a sketch is attached to by the sweep end it lies on, so the sketch plane follows its host.

Both are pure functions of the document — no solid required — which is what lets migrations backfill saved parts instead of demanding a rebuild, and what makes them testable without WebAssembly. Geometric fingerprinting remains the authority downstream: an anchor is a *prediction*, matched against the real solid, so a wrong one fails to match rather than silently attaching to the wrong topology.

What remains is breadth, not method. Faces referenced by anything other than sketch attachment, edges produced by fillets rather than sweeps, and vertices have no anchors yet, and the seven reference mechanisms still carry six independent tolerance constants.

This is *part* of the critical path for performance, but less of it than previously recorded here. Prefix caching (Milestone 4) turned out not to need naming at all, and now covers editing the end of a history. What naming still blocks is recomputing only the features actually affected by a change in the *middle* of a history: without references that survive a recompute, everything after the edit has to be re-run.

### Constraint-system usability

A capable solver is not enough. Users need clear degrees of freedom, stable dragging, understandable conflicts, and dimensions that behave predictably. Milestone 2 treats this as a product system rather than a list of constraints.

### Browser memory and startup cost

CAD kernels are large. Workers, lazy loading, custom OpenCascade builds, transferable buffers, caching, and explicit WebAssembly memory cleanup will remain architectural requirements.

### Long-lived document compatibility

Parametric documents outlive individual application releases. Schema migration, feature-version migration, recovery fixtures, and compatibility testing must be established before outside users depend on the format.

### Exactness versus responsiveness

Immediate previews are valuable, but they must never become the authority for manufacturing output. Preview and B-rep results need clear lifecycle and failure semantics.

## Decision principles

When priorities compete:

1. Correct geometry beats a larger tool count.
2. Stable design intent beats convenient internal shortcuts.
3. A complete end-to-end workflow beats disconnected features.
4. Repairable failures beat silent fallback behavior.
5. Local ownership beats mandatory infrastructure.
6. Measured browser performance beats desktop-era assumptions.

## Updating this roadmap

Update this file whenever a milestone changes state or a significant capability lands:

1. Change the relevant status marker.
2. Update the capability snapshot.
3. Record new limitations or technical risks.
4. Move the active milestone only when its acceptance criteria are met.
5. Rewrite “Next session — start here” so it names what is now most valuable, with the reasoning and not just the task.
6. Add anything that falsified a plausible assumption about the kernel or the solver to “Kernel behaviour notes”. That section exists to stop the same wrong guess being made twice; a fact that cost an hour to establish belongs there even if it seems obvious afterwards.
7. Update the “Last updated” date.

Completed items should stay visible. The roadmap is both a plan and a record of how Parallax evolves.

Status markers describe what is *usable*, not what has been started. Prefer 🚧 with an explicit note about what remains over ✅ with a caveat buried elsewhere: a reader deciding what to work on is better served by an honest partial than by a claim they have to go and verify.
