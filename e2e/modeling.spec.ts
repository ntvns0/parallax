import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

/**
 * The modelling loop, end to end, in a real browser with WebGL and both
 * WebAssembly workers.
 *
 * These act only through the interface. `__PARALLAX_TEST__` and the viewport's
 * `data-exact-features` attribute are read, never driven, so a pass means the
 * application works rather than that the test reached around it.
 *
 * Software WebGL renders a frame in a second or more, and every action waits
 * for one, so these are slow by design rather than by accident.
 */

test.describe.configure({ timeout: 240_000 })

/** The sketch view opens at 4 px per mm with the origin centred. */
const PX_PER_MM = 4

const readDocument = (page: Page) => page.evaluate(() => window.__PARALLAX_TEST__!.document())

async function sketchPoint(page: Page, x: number, y: number) {
  const box = (await page.locator('svg.sketch-surface').boundingBox())!
  return { x: box.x + box.width / 2 + x * PX_PER_MM, y: box.y + box.height / 2 - y * PX_PER_MM }
}

async function commit(page: Page, input: ReturnType<Page['getByLabel']>, value: string) {
  await input.fill(value)
  await input.press('Enter')
}

/** Sketch a rectangle on XY by dragging corner to corner, in millimetres. */
async function sketchRectangle(page: Page, from: [number, number], to: [number, number]) {
  await page.getByRole('button', { name: 'Create sketch' }).click()
  await page.getByRole('button', { name: /XY plane/ }).click()
  await page.getByRole('button', { name: /^Rectangle/ }).click()
  const start = await sketchPoint(page, ...from)
  const end = await sketchPoint(page, ...to)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 4 })
  await page.mouse.up()
  await expect(page.getByLabel('Distance value')).toHaveCount(2)
}

async function sketchDimensions(page: Page) {
  const sketch = (await readDocument(page)).features.find((feature) => feature.kind === 'sketch')
  return sketch?.kind === 'sketch' ? sketch.constraints.filter((c) => c.type === 'distance').map((c) => c.value) : []
}

/** The sketch's extent along X, read from its solved geometry. */
async function sketchWidth(page: Page) {
  const sketch = (await readDocument(page)).features.find((feature) => feature.kind === 'sketch')
  if (sketch?.kind !== 'sketch') return null
  const xs = sketch.entities.flatMap((entity) => entity.type === 'line' ? [entity.start[0], entity.end[0]] : [])
  return Math.round((Math.max(...xs) - Math.min(...xs)) * 1000) / 1000
}

async function extrudeSelectedSketch(page: Page, distance: string) {
  await page.getByRole('button', { name: 'Extrude', exact: true }).click()
  await commit(page, page.getByLabel('Distance', { exact: true }), distance)
  const extrude = (await readDocument(page)).features.find((feature) => feature.kind === 'extrude')
  return extrude!.id
}

async function expectExactSolid(page: Page, featureId: string) {
  await expect(page.getByLabel('3D modeling viewport'))
    .toHaveAttribute('data-exact-features', new RegExp(featureId), { timeout: 60_000 })
}

test('sketches, extrudes, exports, and reloads a plate', async ({ page }) => {
  await page.goto('/?test=1')
  await expect(page.getByRole('button', { name: 'PARALLAX' })).toBeVisible()

  await sketchRectangle(page, [-20, -15], [20, 15])
  await commit(page, page.getByLabel('Distance value').nth(0), '50')
  await commit(page, page.getByLabel('Distance value').nth(1), '30')
  await expect.poll(() => sketchDimensions(page)).toEqual([50, 30])
  await expect.poll(() => sketchWidth(page)).toBe(50)
  await page.getByRole('button', { name: 'Finish sketch' }).click()

  const extrudeId = await extrudeSelectedSketch(page, '8')
  await expect.poll(async () => {
    const feature = (await readDocument(page)).features.find((candidate) => candidate.id === extrudeId)
    return feature?.kind === 'extrude' ? feature.parameters.distance : null
  }).toBe(8)
  await expectExactSolid(page, extrudeId)

  await page.getByRole('button', { name: 'Settings' }).click()
  const [step] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export STEP (.step)' }).click(),
  ])
  const stepText = await readFile((await step.path())!, 'utf8')
  expect(stepText.startsWith('ISO-10303-21')).toBe(true)
  expect(stepText).toContain('MANIFOLD_SOLID_BREP')

  const [stl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export STL (.stl)' }).click(),
  ])
  const stlBytes = await readFile((await stl.path())!)
  // Binary STL: an 80-byte header, a triangle count, then 50 bytes a triangle.
  const triangles = stlBytes.readUInt32LE(80)
  expect(triangles).toBeGreaterThanOrEqual(12)
  expect(stlBytes.length).toBe(84 + 50 * triangles)
  await page.keyboard.press('Escape')

  // Reload: the part comes back from IndexedDB and is evaluated again.
  await expect(page.getByText('Saved locally')).toBeVisible()
  await page.reload()
  await expect.poll(async () => (await readDocument(page)).features.map((feature) => feature.kind)).toEqual(['sketch', 'extrude'])
  await expectExactSolid(page, extrudeId)
})

test('a named parameter drives sketch geometry, not only the dimension', async ({ page }) => {
  await page.goto('/?test=1')
  await expect(page.getByRole('button', { name: 'PARALLAX' })).toBeVisible()

  await page.getByRole('button', { name: 'PARAMETERS' }).click()
  await page.getByRole('button', { name: 'Add parameter' }).click()
  await commit(page, page.getByLabel('Parameter parameter1 name'), 'width')
  await commit(page, page.getByLabel('Parameter width formula'), '40')

  await sketchRectangle(page, [-20, -15], [20, 15])
  await commit(page, page.getByLabel('Distance value').nth(0), '=width')
  await expect.poll(() => sketchWidth(page)).toBe(40)
  await page.getByRole('button', { name: 'Finish sketch' }).click()

  await commit(page, page.getByLabel('Parameter width formula'), '60')
  await expect.poll(() => sketchDimensions(page)).toEqual([60, 30])
  await expect.poll(() => sketchWidth(page)).toBe(60)
})
