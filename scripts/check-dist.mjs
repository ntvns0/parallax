import { readdir, readFile, stat } from 'node:fs/promises'

const dist = new URL('../dist/', import.meta.url)
const required = ['index.html', 'manifest.webmanifest', 'service-worker.js', 'parallax-icon.svg']
for (const name of required) await stat(new URL(name, dist))

const assets = await readdir(new URL('assets/', dist))
const wasm = assets.filter((name) => name.endsWith('.wasm'))
if (wasm.length !== 2) throw new Error(`Expected two WebAssembly assets, found ${wasm.length}.`)

const worker = await readFile(new URL('service-worker.js', dist), 'utf8')
for (const name of wasm) {
  if (!worker.includes(name)) throw new Error(`Offline cache is missing ${name}.`)
}

const html = await readFile(new URL('index.html', dist), 'utf8')
if (!html.includes('manifest.webmanifest')) throw new Error('Production HTML does not link the application manifest.')
process.stdout.write(`PASS production artifact: ${assets.length} assets, ${wasm.length} WebAssembly modules precached\n`)
