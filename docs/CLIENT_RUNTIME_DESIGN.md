# Client runtime design

## Problem

Parallax already evaluates CAD geometry, renders, exports, and stores projects in
the visiting browser. The deployment host should only deliver versioned static
files. The missing piece is one place that owns client capability policy,
performance evidence, storage health, and exact-kernel scheduling without leaking
browser probes or worker mechanics into modeling code.

OpenCascade imposes the main constraint. One worker owns its native solid cache,
and a synchronous evaluation cannot be interrupted safely. Viewport refreshes may
become obsolete, but fillet preflight, drawing projection, and export are durable
user work and must never be discarded.

## Usage

Startup captures browser facts, derives conservative policy, registers the
production service worker, and begins local performance recording:

```ts
const runtime = await startClientRuntime()
const controller = new ViewportController(host, { policy: runtime.policy.render })
```

The viewport asks for replaceable work and treats supersession as ordinary control
flow:

```ts
const result = await evaluateViewportMesh(feature, sketch, features)
if (result.status === 'ready') install(result.mesh)
```

Durable callers use methods that cannot be marked disposable:

```ts
await evaluateExactExtrude(feature, sketch, features) // fillet preflight
await projectExactDocument(features, projection)
await exportExactDocument(features, 'step')
```

Settings can inspect storage, request persistence from a user gesture, and export a
bounded performance report. Reports remain on the device unless the user downloads
one.

## Shape

```text
src/runtime/client-runtime.ts       startup and derived client policy
src/runtime/performance.ts          bounded, privacy-filtered event recorder
src/runtime/storage-status.ts       quota and persistence adapter
src/kernel/kernel-client.ts         intent-specific scheduling and mesh cache
src/kernel/exact-kernel.worker.ts   exact-solid owner and transferable mesh producer
src/viewport/viewport-controller.ts render policy and WebGL lifecycle
src/ui/ProjectDialogs.tsx           storage status and local report controls
src/service-worker.ts               generated production precache and offline shell
scripts/serve-dist.mjs              production-like local artifact server
deploy/Caddyfile                    Mac mini static-file configuration
e2e/                                production artifact and offline verification
```

`KernelClient` exposes separate viewport and durable mesh methods. Its private
scheduler posts at most one request to the worker. It retains semantic jobs in FIFO
order and at most one waiting viewport job. A newer viewport job settles the older
waiting one as `superseded`. An active obsolete viewport job finishes because
terminating it would discard the initialized kernel and exact-solid cache. Its mesh
may enter the bounded cache but never replaces the current display.

The worker normalizes display data to `Float32Array` vertices, normals, and edge
lines plus `Uint32Array` triangle indices. It validates integer index range before
conversion and transfers those buffers. Exact solids remain worker-owned; display
meshes become main-thread-owned. Three.js consumes the typed arrays without another
numeric conversion.

The runtime probes browser facts once and derives policy in a pure function. Policy,
not raw `navigator` values, reaches the viewport and mesh cache. The initial policy
changes only render pixel ratio, AO samples, and cache size. It does not change CAD
tolerance or exact results.

Performance events use an allowlisted set of numeric and categorical fields. Worker
durations and main-thread queue or round-trip durations are recorded separately
because worker and window clocks do not share a trustworthy origin. Reports contain
no document names, feature geometry, operation chains, or free-form diagnostic
context.

## Synthesis decision

The base design used a single runtime composition point and separate
`preview/evaluate/project/export` intent methods. Two other candidates converged on
main-thread admission control and transferable meshes. The synthesis also adopts
their strict mesh validation, telemetry allowlist, production-like local static
server, and a read-only browser-test bridge.

Rejected designs include a generic priority queue, cancellation tokens that cannot
interrupt OpenCascade, multiple kernel workers sized from logical CPU count,
worker-side coalescing after payload transfer, and immediate cross-origin isolation.
Those designs expose more machinery, consume more memory, or add deployment cost
without helping the current single-threaded kernel.

## Tradeoffs

- One obsolete active viewport evaluation may finish so the initialized kernel and
  prefix cache survive.
- Display geometry uses Float32 while exact B-rep operations and exports keep the
  kernel's native precision.
- Capability policy starts conservatively because browser memory hints are missing
  on some supported clients.
- Service-worker updates wait for a reload so a live editor never mixes application,
  worker, and WebAssembly revisions.
- CI checks functional behavior and report shape, while Fedora performance runs
  record timings without brittle shared-runner speed thresholds.

## Implementation order

1. Scheduler contract tests and intent-specific kernel methods.
2. Typed mesh transport and direct Three.js buffers.
3. Runtime policy, storage health, and performance recording.
4. Production static serving and CI artifact checks.
5. Generated PWA precache and offline browser verification.
6. Fedora performance baselines, followed by a threaded OpenCascade experiment only
   if exact evaluation remains dominant.
