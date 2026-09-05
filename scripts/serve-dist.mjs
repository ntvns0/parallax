import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
const port = Number(process.env.PARALLAX_PORT ?? 4173)
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'], ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'], ['.wasm', 'application/wasm'], ['.webmanifest', 'application/manifest+json'],
])

function resolvedPath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  return join(root, clean === '/' ? 'index.html' : clean)
}

createServer(async (request, response) => {
  let file = resolvedPath(request.url ?? '/')
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file')
  } catch {
    file = join(root, 'index.html')
  }
  response.setHeader('Content-Type', contentTypes.get(extname(file)) ?? 'application/octet-stream')
  response.setHeader('Cache-Control', file.includes('/assets/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache')
  createReadStream(file).pipe(response)
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`Parallax dist server listening at http://127.0.0.1:${port}\n`)
})
