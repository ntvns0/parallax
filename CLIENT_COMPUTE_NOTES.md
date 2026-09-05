# Client compute and deployment notes

> Implementation update, September 2026: production static serving, client
> capability policy, kernel queue coalescing, transferable mesh buffers, local
> performance reports, storage persistence controls, PWA caching, Playwright
> production tests, and CI artifact checks described below are now implemented.
> Threaded OpenCascade, WebGPU, and OffscreenCanvas remain measurement-led research.

## Short version

Parallax already runs its expensive work on the client. The Mac mini serves HTML,
JavaScript, and WebAssembly files. Each browser then creates its own OpenCascade
worker, PlaneGCS worker, Three.js renderer, IndexedDB database, and in-memory
geometry cache. A Fedora client does not send modeling work back to the Mac.

This is the right architecture for the current local-first product. The next step
is not a compute server. It is to make the static delivery path boring and fast,
then measure and improve how each browser uses its own CPU, GPU, memory, and disk.

## What runs where today

| Work | Location | Evidence |
| --- | --- | --- |
| React interface and document logic | Client main thread | `src/main.tsx`, `src/ui/App.tsx` |
| Three.js rendering, picking, and AO | Client main thread and GPU | `src/viewport/SceneViewport.tsx` |
| Exact B-rep evaluation and export | One client Web Worker | `src/kernel/kernel-client.ts` |
| OpenCascade WebAssembly | Inside that client worker | `src/kernel/exact-kernel.worker.ts` |
| Constraint solving | A second client Web Worker | `src/sketcher/constraint-solver.ts` |
| Project and recovery storage | Client IndexedDB | `src/core/project-storage.ts` |
| Vite dev transforms and asset delivery | Mac mini | `vite.config.ts` |

The browser workers protect interface responsiveness, but they do not by
themselves use all CPU cores. Exact-kernel requests are serialized in one worker.
PlaneGCS has its own worker and can overlap with it, but one OpenCascade evaluation
uses one worker unless the shipped WebAssembly library has explicit threading.

## Highest-value improvements

### 1. Stop using the development server as the normal deployment

Build once and serve `dist/` as immutable static files. Use Caddy or nginx on the
Mac, ideally behind Tailscale HTTPS if this is private. Vite's development server
does transforms, watches the source tree, retains development machinery, and sends
assets with development-oriented caching. None of that helps a remote modeling
session.

The static server should provide:

- Brotli or gzip for JavaScript, CSS, SVG, and JSON
- long-lived immutable caching for hashed files under `dist/assets/`
- no-cache or short revalidation for `index.html`
- byte-range support and a correct `application/wasm` content type
- HTTPS, especially if service workers or shared WebAssembly memory are added
- access logs with response bytes and timing, but no project data

Do not add server-side rendering. This application cannot model until its client
JavaScript and WebAssembly arrive, and server rendering would spend Mac CPU without
reducing kernel startup.

### 2. Add a small runtime-capabilities module

Create one deep module that reports the facts needed for performance decisions:

- logical CPU count from `navigator.hardwareConcurrency`
- approximate memory from `navigator.deviceMemory`, when available
- WebGL renderer limits and context-loss events
- WebAssembly, SIMD, threads, `SharedArrayBuffer`, OPFS, and storage availability
- persistent-storage status and quota from `navigator.storage`
- reduced-motion and coarse-pointer input capabilities where they affect rendering

Keep raw browser probes behind a small typed interface. Callers should ask for a
policy such as `interactive`, `balanced`, or `large-model`, not scatter user-agent
checks and hardware thresholds across the viewport and kernel.

Use this first for conservative defaults. Examples include AO quality, pixel ratio,
mesh tolerance, cache size, and whether nonessential work may run concurrently.
Always expose user overrides. Browser hardware estimates are incomplete and laptops
change performance as they heat up or enter battery-saving modes.

### 3. Instrument the actual client workload

The existing deterministic benchmark covers TypeScript operation-chain work, not
OpenCascade startup, tessellation, GPU rendering, worker transfer cost, IndexedDB,
or a remote page load. Add a browser performance runner that records at least:

- page navigation to usable viewport
- OpenCascade and PlaneGCS download and initialization time
- feature evaluation and tessellation time by operation count
- time spent waiting in the kernel queue
- worker-to-main-thread transfer time and payload bytes
- frame time while orbiting a representative large part
- peak cache size, storage quota, and WebGL context loss

Playwright is the obvious missing test tool here. It can run repeatable scenarios
on Fedora against the production build and collect browser performance entries.
Keep a few named fixtures such as small, medium, fillet-heavy, and drawing-heavy.
Numbers from the actual client matter more than a benchmark run on the Mac.

### 4. Cancel and coalesce obsolete work

`KernelClient` deduplicates identical mesh requests, but every distinct request is
queued and the worker processes them one at a time. During rapid parameter edits,
the worker can spend time finishing shapes the interface will never display.

Add request generations and cancellation semantics at the kernel interface. At a
minimum, drop queued mesh jobs superseded by a newer document generation. True
mid-operation cancellation may require terminating and recreating the worker because
OpenCascade calls are synchronous. Measure worker restart cost before using that
option. Exports and drawings must not be discarded as if they were viewport previews.

This will usually improve perceived speed more than trying to run multiple exact
evaluations at once. Parallel OpenCascade histories compete for memory and often
compute obsolete states faster.

### 5. Reduce copies between the kernel worker and viewport

Mesh results appear to cross the worker seam as ordinary arrays. The worker uses a
transfer list for STEP and STL bytes, but not for vertices, normals, triangles, or
edge lines. Confirm the runtime types produced by Replicad. If possible, normalize
them to typed arrays inside the worker and transfer their buffers. This avoids a
large structured clone and lets Three.js consume the data with less conversion.

This change needs care because transferred buffers detach in the worker. The prefix
solid cache can stay in the worker, while a mesh cache should have one clear owner.
Today the main thread keeps up to 96 MB of meshes and the worker separately keeps
exact solids. Add combined memory accounting before increasing either cache based on
client RAM.

### 6. Make repeat visits cheap and offline-capable

Add a minimal PWA service worker after production serving and cache headers are in
place. Cache the versioned application shell and both WebAssembly files. A repeat
visit should not depend on the Mac beyond checking whether a new build exists.

Use an explicit upgrade flow. Do not let a new interface bundle run against an old
worker or WebAssembly asset. Hashed Vite assets help, but the service-worker update
policy still needs testing. The existing project schema migrations are separate from
application-cache upgrades and should remain so.

For projects and native B-rep payloads, continue with the planned OPFS work. Ask for
persistent browser storage and show quota or eviction risk in diagnostics. IndexedDB
and OPFS remain device-local, so opening the site on Fedora will not automatically
show projects created on another machine.

## Using more client hardware

### CPU

Keep one interactive exact-kernel worker as the default. Add parallelism only for
independent, user-requested work such as multiple drawing views, imports, exports, or
separate bodies, and only after profiling memory use. A worker pool sized directly
from logical CPU count would be reckless for OpenCascade because each worker may
instantiate another large runtime and heap.

WebAssembly threads are worth a focused experiment, not an assumption. They require
a threaded OpenCascade build, `SharedArrayBuffer`, HTTPS, and cross-origin isolation
headers (`Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`). Cross-origin
isolation can also break third-party assets that lack compatible resource headers.
Prototype it against one representative model and compare wall time, memory, startup,
and browser compatibility before changing the production build.

### GPU

Three.js already uses the client's GPU through WebGL 2. WebGPU will not accelerate
OpenCascade B-rep operations. A WebGPU renderer might help very large display meshes
later, but it adds compatibility and rendering-validation work. First profile draw
calls, triangle counts, AO passes, pixel ratio, and buffer uploads. Adaptive AO and
resolution are cheaper improvements if orbiting is the bottleneck.

OffscreenCanvas could move some viewport work away from the main thread, but it also
makes React interaction, picking, text overlays, and debugging harder. Consider it
only after traces show the main thread, rather than the GPU or exact kernel, limits
interaction.

### Memory and disk

Treat memory as the main limit on capable clients. CAD kernels, exact-solid prefix
caches, display meshes, undo snapshots, and recovery data all retain copies of model
state. Add pressure-aware cache eviction and visible diagnostics before scaling work
to more cores. Parallel work that causes tab eviction is a regression.

## Missing tools and checks

In priority order:

1. A production deployment command and checked-in Caddy or nginx configuration
2. Playwright browser tests and client-side performance scenarios
3. A runtime-capabilities and performance-policy module
4. Performance marks plus an exportable local performance report
5. Kernel request cancellation and queue instrumentation
6. Typed-array transfer tests for large meshes
7. PWA manifest, service worker, and offline/update tests
8. Storage persistence, quota, OPFS, and eviction tests
9. A WebAssembly threads experiment with cross-origin-isolation deployment headers
10. WebGL context-loss recovery and representative large-scene rendering tests

The current environment is also missing installed npm dependencies, so `npm run
build` cannot find `tsc`. Run `npm ci` before using the existing build, test, lint,
benchmark, or bundle-budget commands on a fresh checkout. CI should run all of those
commands against the lockfile and publish the static `dist/` artifact.

## Suggested sequence

1. Add reproducible production serving and CI artifacts.
2. Measure page load and representative modeling on Fedora.
3. Add kernel queue timing, generations, and obsolete-job cancellation.
4. Transfer typed mesh buffers if measurement confirms copying is material.
5. Add capability-based render and cache policies with user overrides.
6. Add offline caching and persistent-storage diagnostics.
7. Prototype threaded OpenCascade only if exact evaluation still dominates.

That sequence keeps the Mac's job limited to serving cached static bytes while the
newer client does all modeling, rendering, storage, and export work it already owns.
