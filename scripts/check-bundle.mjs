import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const assetsDirectory = new URL('../dist/assets/', import.meta.url)
const budgets = [
  // Raised from 900 kB when centre-point arcs landed, and from 1.05 MB when the
  // ambient-occlusion render path did: EffectComposer, GTAOPass and OutputPass
  // together cost about 42 kB. The budget exists to catch a sudden jump, not to
  // freeze the feature set, so it is set a little above the current size rather
  // than exactly at it.
  { pattern: /^index-.*\.js$/, limit: 1_150_000, label: 'Main application JavaScript' },
  { pattern: /replicad.*\.wasm$/, limit: 12_000_000, label: 'OpenCascade WebAssembly' },
  { pattern: /planegcs.*\.wasm$/, limit: 650_000, label: 'PlaneGCS WebAssembly' },
]

const files = await readdir(assetsDirectory)
let failed = false
for (const budget of budgets) {
  const file = files.find((candidate) => budget.pattern.test(candidate))
  if (!file) {
    console.error(`Bundle budget could not find: ${budget.label}`)
    failed = true
    continue
  }
  const bytes = (await stat(join(assetsDirectory.pathname, file))).size
  const result = bytes <= budget.limit ? 'PASS' : 'FAIL'
  console.log(`${result} ${budget.label}: ${(bytes / 1_000_000).toFixed(2)} MB / ${(budget.limit / 1_000_000).toFixed(2)} MB`)
  if (bytes > budget.limit) failed = true
}

if (failed) process.exitCode = 1
