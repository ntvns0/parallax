# Parallax — agent instructions

Read `ROADMAP.md` before starting work. Its "The plan — start here" section names
the next item, and the "Kernel behaviour notes" record OpenCascade and PlaneGCS
facts that cost real effort to learn.

## Done means

Before calling work finished, run each of these and see it pass:

- `npm run lint`
- `npm test`
- `npm run build`
- `npm run test:e2e -- --project=chromium` when the change touches the UI, the
  viewport, workers, persistence, or export. It needs a production build first.

The work is done when these pass and `ROADMAP.md` records the change in the
same commit: the item's status marker, what proves it, and anything the change
made untrue elsewhere in the file. The rules at the end of `ROADMAP.md` say how.

## Where code goes

- Geometry, coordinate, and document logic goes in plain TypeScript modules
  with a test beside them (`foo.ts` and `foo.test.ts`). React components and
  Three.js code call those modules and stay thin.
- Fixing a geometry bug starts with a test that fails on it. A whole-part bug
  gets a case in `kernel/golden-parts.test.ts` with a hand-computed volume.
- Saved documents outlive builds. Any change to the shape of `CadDocument`
  follows `src/core/fixtures/README.md`: bump the schema, extend the migratable
  list, and add a fixture.
- A new sketch tool puts what it adds in `sketcher/sketch-geometry-builders.ts`
  and what it previews in `sketcher/sketch-drawing-preview.ts`, both tested.
  Snapping goes in `sketcher/sketch-point-resolution.ts`. `SketchEditor.tsx`
  only sequences clicks, and the SVG layers only draw.

## Surprises

When OpenCascade, Replicad, PlaneGCS, or Three.js behaves differently from what
a reasonable reading of its API suggests, add the fact to "Kernel behaviour
notes" in `ROADMAP.md`.

## Running the app

`npm run dev` already listens on all interfaces. Report the LAN address
(`hostname -I`) and the Tailscale address (`tailscale ip -4`) alongside
localhost.
