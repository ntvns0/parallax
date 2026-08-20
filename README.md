# Parallax

Parallax is a browser-first parametric mechanical modeler. Its long-term goal is to provide the precision and depth expected from professional desktop CAD while remaining fast, approachable, local-first, and available from a modern web browser.

> **Project status:** Early pre-alpha foundation. The core sketch-to-exact-solid workflow exists, but Parallax is not ready for production design work.

See [ROADMAP.md](./ROADMAP.md) for completed work, the active milestone, and the path ahead.

## What works today

- A polished Three.js modeling viewport with a Z-up coordinate system, perspective and orthographic views, picking, snapping, and transform controls
- Width-controlled model edges and ambient occlusion scaled to the part, so a pocket reads as a recess rather than as an outline printed on a face
- Push/pull: drag the end of a sweep to change the extrusion that made it, as a single undoable step, with the exact solid rebuilding from the new parameter
- An inspect-and-measure tool with vertex, edge, edge-midpoint, hole-center, planar-face-center, feature-center, and surface snapping plus detected hole diameters, distance, and signed X/Y/Z deltas
- A versioned parametric document and feature history
- Parametric box, cylinder, and sphere preview features
- XY, XZ, and YZ principal-plane sketches with line, rectangle, circle, centre-point arc, three-point arc, and endpoint-driven tangent arc tools
- Profiles that mix straight and curved edges — slots, D shapes, and rounded outlines — closed into exact regions and swept as true arcs by the B-rep kernel rather than as tessellated chords
- Sketch-on-face workflow for axis-aligned planar solid faces, with per-face hover highlighting, persistent face metadata, projected boundary references, center/edge/midpoint snapping, one-click face centering, and the existing body visible throughout editing
- Cursor-centered sketch zoom, middle-button or Space-drag panning, generous entity selection, connected-shape dragging, typed center positioning, one-click origin centering, fit/reset controls, and configurable line-angle snapping
- Horizontal, vertical, coincident, distance, angle, and radius constraints created automatically as geometry is drawn, plus parallel, perpendicular, tangent, equal, and concentric applied by hand to a selection
- A constraint list naming the geometry each constraint holds, with every dimension editable in place, individual removal, and conflicting, redundant, or inapplicable constraints highlighted on the geometry responsible, alongside degrees-of-freedom reporting
- FreeCAD PlaneGCS constraint solving in a Web Worker, with an explicit per-sketch solver anchor so a sketch solves the same way regardless of entity order
- Sketch edits that go through the solver: changing a dimension edits the driving constraint and re-solves rather than moving geometry directly
- Multi-region profile detection, including holes and nested islands by the even-odd rule
- Sketch-linked extrusion features with editable depth, symmetric extent, exact add/cut operations, and selectable-edge fillets
- Sketch-linked revolve features with an editable angle about the sketch X or Y axis and the same exact add/cut operations
- Exact extrusion and revolve evaluation using OpenCascade in a separate Web Worker, shown in the viewport as exact B-rep geometry rather than as a preview mesh
- A prefix cache of intermediate solids, so editing one feature resumes from the last operation that did not change instead of replaying the history from the start
- Exact STEP and binary STL export for supported extrusions and revolves
- Dimensioned drawing sheets: third-angle front, top, right, and isometric views projected from the exact B-rep, with hidden lines, centre marks, title block, notes, and a model parameter table, exported as vector PDF or SVG
- Full section views cut at any position through the part, hatched where the cut meets material, replacing the view they were cut in the direction of and marked with a cutting-plane line on the view that shows the plane edge-on
- Automatic dimensioning: overall size, diameter and radius callouts grouped with counts (`4× Ø6`, `2× R3`), and hole and shoulder positions measured from a single datum corner
- Undo, redo, keyboard shortcuts, command search, multi-project IndexedDB autosave, recovery snapshots, and project import/export
- Fillets that report their own limit: a radius too large for the geometry it sits on no longer fails the part, and the feature says how large a radius would actually work
- Persistent local diagnostics for application and exact-kernel failures, including structured feature context plus JSON export and clear controls
- Named parameters and formulas: a document-wide parameter table, and any feature or sketch dimension driven by an expression typed with a leading `=` — arithmetic, degree-based trigonometry, `min`/`max`/`round`, references to other parameters, and `mm`/`in` literals. Parameters are renamed across every formula that reads them in one undoable step, dependency cycles are reported by naming the cycle, and a formula that stops evaluating keeps its last good value and offers to clear itself rather than breaking the part
- Sketch trim: click a piece of any curve to cut it back to where its neighbours cross it, with the span that will be removed highlighted before the click, arcs and circles included, and the constraints that no longer describe the result dropped while direction and radius carry onto every surviving piece
- Sketch fillet: round the corner between two selected lines into an arc that is tangent to both, fully constrained by tangency, a radius dimension and coincidence at each end — so the radius stays editable from the constraint list, and a radius too large for the lines reports the largest one that fits rather than failing
- Millimeter display plus machinist inches to .001 and carpenter inches to 1/16, including decimal/fraction input and matching sketch snaps
- Human-readable, versioned Parallax project files

## Current limitations

- Quick primitives are still Three.js preview geometry rather than OpenCascade B-rep features.
- Sketch editing is intentionally small: arcs, trim, and line-to-line corner fillets are available, but fillets between curves, offset, projected geometry, and arbitrary datum planes are not. Sketches attach to principal planes and axis-aligned planar faces only.
- Constraint diagnosis names and highlights the responsible geometry; under-, fully-, and over-constrained sketches are also distinguished directly on the geometry. Plain-language repair guidance remains limited.
- Named parameters drive feature dimensions and sketch dimensions. They are not yet readable from a drawing dimension, and a parameter is a plain number rather than a typed quantity, so nothing stops a length formula being used for an angle.
- Exact extrusion and revolve support new-body, add, and cut operations in a linear single-body history; intersect and independent multi-body management are not implemented.
- Editing a parameter resumes evaluation from the last unchanged operation rather than replaying the whole history, so changing the end of a long part is roughly as fast as changing the end of a short one. Recomputation is not yet *dependency-aware*: changing an early feature still re-runs everything after it, and that does need stable references.
- Stable references are solved only for the cases that have them: fillet edges named by the sketch geometry that swept them, and face-attached sketches named by the sweep end they sit on. Faces referenced by anything else still depend on absolute coordinates.
- A face-attached sketch follows the feature it was drawn on when that feature's depth changes, but the rest of the captured face — its boundary, centre and area — is still the snapshot taken when the sketch was created.
- The command palette offers a small fixed set of commands rather than the full command surface.
- Drawings are generated from the current model on demand and are not stored in the project. Dimensions are inferred from projected geometry as a starting point: they are not associative, not individually editable, and carry no tolerances or GD&T. One full section per sheet is supported; offset, half, detail, auxiliary, and broken views are not.
- STEP import, assemblies, manufacturing tools, collaboration, and cloud storage are future work.

## Run locally

Requirements:

- Node.js 22 or newer
- npm 10 or newer
- A browser with WebAssembly and WebGL 2 support

```bash
npm install
npm run dev
```

Vite serves the application at `http://localhost:5173`.

## Useful commands

```bash
npm run dev       # Start the development server
npm run build     # Type-check and create a production build
npm run lint      # Run ESLint
npm test          # Run document, sketch, and persistence regression tests
npm run bench     # Benchmark a deterministic 250-step modeling history
npm run check:bundle # Enforce JavaScript and WebAssembly size budgets
npm run preview   # Preview the production build
```

## Architecture

Parallax separates design intent, exact geometry, and display geometry. Three.js is the presentation layer; it is not treated as the source of mechanical truth.

| Layer | Responsibility | Current technology |
| --- | --- | --- |
| Document | Versioned features, parameters, references, units, and serialization | TypeScript |
| Editor state | Selection, active tools, undo/redo, autosave, and UI state | Zustand |
| Constraints | Numerical solution of sketch geometry and constraints | FreeCAD PlaneGCS / WebAssembly |
| Exact geometry | B-rep construction, topology, tessellation, and STEP output | OpenCascade.js through Replicad |
| Preview | Immediate feedback while exact geometry is loading or recomputing | Three.js |
| Interface | Commands, feature tree, properties, sketcher, and application shell | React |
| Persistence | Local project storage and portable project files | IndexedDB; OPFS planned for large binary payloads |

PlaneGCS and OpenCascade run in separate Web Workers so expensive computation does not block the interface. Exact solids are tessellated for display in Three.js, while the underlying B-rep remains responsible for mechanical geometry and exchange formats.

## Project structure

```text
src/
├── core/       Parametric document, feature store, schema migration, IndexedDB
│               storage, sketch profiles and regions, preview geometry
├── kernel/     OpenCascade worker, exact evaluation client, extrusion extents,
│               and the operation chain that replays feature history
├── sketcher/   Sketch interface, PlaneGCS worker, solver-driven edits, and the
│               pan/zoom transform
├── ui/         Application shell, feature tree, properties, and icons
└── viewport/   Three.js scene, cameras, controls, picking, face classification,
                and exact mesh display
```

Geometry and coordinate logic is kept in pure modules separate from the React
and Three.js layers so it can be tested directly — `kernel/extrude-extent.ts`,
`kernel/operation-chain.ts`, `viewport/face-classification.ts`, and
`sketcher/sketch-view.ts` are the load-bearing examples.

## Project files and units

Parallax stores model geometry in millimeters using JavaScript double-precision numbers. Users can display and enter millimeters, machinist decimal inches to .001, or carpenter fractional inches to 1/16 without converting existing geometry. Project files are versioned JSON and use the `.parallax.json` suffix. Browser storage keeps projects in separate records and retains recent recovery snapshots before overwriting a saved version. Schema changes must provide an explicit migration path so old designs remain recoverable.

Projects are stored in IndexedDB. Projects saved by earlier builds are migrated out of Local Storage automatically on first load; the old records are removed only once every migrated write has committed, so an interrupted migration simply runs again next time.

STEP and STL files exported from supported extrusions are generated by the OpenCascade B-rep kernel, not reconstructed from the visible preview mesh. Binary STL files use millimeter coordinates at a 0.02 mm tessellation tolerance.

Cut operations push their cutting tool 0.05 mm back through the face it enters. This avoids the coplanar-face case that makes OpenCascade booleans fail, and it does not change the finished part: the tool is lengthened by the same amount, so the cut depth measured from the sketch plane is exactly what was asked for. `src/kernel/extrude-extent.ts` documents and tests this.

## Product principles

- **Precision is foundational.** Approximate preview geometry must never be presented as exact manufacturing geometry.
- **Design intent stays editable.** Features, sketches, constraints, and relationships are first-class document data.
- **The browser is the platform.** Heavy computation belongs in workers and WebAssembly, not on a required server.
- **Local-first by default.** A user should be able to model, save, reopen, and export without an account.
- **Power should remain discoverable.** Professional depth should not require an intimidating interface.
- **File ownership belongs to the user.** Projects need documented, versioned, and portable representations.

## Roadmap and progress

Development is organized around complete modeling workflows rather than isolated tools. The current priorities and acceptance criteria live in [ROADMAP.md](./ROADMAP.md).

## License

[MIT](LICENSE).
