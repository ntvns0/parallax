import { expect, type Page } from '@playwright/test'

/** Shared steps for the browser tests. Each acts only through the interface. */

/** The sketch view opens at 4 px per mm with the origin centred. */
export const PX_PER_MM = 4

export const readDocument = (page: Page) => page.evaluate(() => window.__PARALLAX_TEST__!.document())

export async function sketchPoint(page: Page, x: number, y: number) {
  const box = (await page.locator('svg.sketch-surface').boundingBox())!
  return { x: box.x + box.width / 2 + x * PX_PER_MM, y: box.y + box.height / 2 - y * PX_PER_MM }
}

export async function commit(page: Page, input: ReturnType<Page['getByLabel']>, value: string) {
  await input.fill(value)
  await input.press('Enter')
}

/** Sketch a rectangle on XY by dragging corner to corner, in millimetres. */
export async function sketchRectangle(page: Page, from: [number, number], to: [number, number]) {
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

export async function sketchDimensions(page: Page) {
  const sketch = (await readDocument(page)).features.find((feature) => feature.kind === 'sketch')
  return sketch?.kind === 'sketch' ? sketch.constraints.filter((c) => c.type === 'distance').map((c) => c.value) : []
}

/** The sketch's extent along X, read from its solved geometry. */
export async function sketchWidth(page: Page) {
  const sketch = (await readDocument(page)).features.find((feature) => feature.kind === 'sketch')
  if (sketch?.kind !== 'sketch') return null
  const xs = sketch.entities.flatMap((entity) => entity.type === 'line' ? [entity.start[0], entity.end[0]] : [])
  return Math.round((Math.max(...xs) - Math.min(...xs)) * 1000) / 1000
}

export async function extrudeSelectedSketch(page: Page, distance: string) {
  await page.getByRole('button', { name: 'Extrude', exact: true }).click()
  await commit(page, page.getByLabel('Distance', { exact: true }), distance)
  const extrude = (await readDocument(page)).features.find((feature) => feature.kind === 'extrude')
  return extrude!.id
}

export async function expectExactSolid(page: Page, featureId: string) {
  await expect(page.getByLabel('3D modeling viewport'))
    .toHaveAttribute('data-exact-features', new RegExp(featureId), { timeout: 60_000 })
}


/** A 50 × 30 plate, 8 thick, sketched on XY and extruded up. Returns the extrude's id once its exact solid is drawn. */
export async function plate(page: Page) {
  await page.goto('/?test=1')
  await expect(page.getByRole('button', { name: 'PARALLAX' })).toBeVisible()
  await sketchRectangle(page, [-25, -15], [25, 15])
  await page.getByRole('button', { name: 'Finish sketch' }).click()
  const extrudeId = await extrudeSelectedSketch(page, '8')
  await expectExactSolid(page, extrudeId)
  return extrudeId
}

/**
 * Hover points around the middle of the viewport until `accept` says one is
 * right, and leave the pointer there.
 *
 * The camera's exact framing is not part of the interface, so tests find what
 * they need by looking for it, as a person would.
 */
export async function findViewportPoint(
  page: Page,
  accept: () => Promise<boolean>,
  consider: (point: { x: number; y: number }) => boolean = () => true,
) {
  const box = (await page.getByLabel('3D modeling viewport').boundingBox())!
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  for (const dy of [0, -20, -40, -60, 20, 40, -80]) {
    for (const dx of [0, -40, 40, -80, 80]) {
      const point = { x: center.x + dx, y: center.y + dy }
      if (!consider(point)) continue
      await page.mouse.move(point.x, point.y)
      if (await accept()) return point
    }
  }
  throw new Error('No point in the viewport was accepted.')
}
