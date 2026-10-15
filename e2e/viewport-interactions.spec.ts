import { expect, test, type Page } from '@playwright/test'
import { findViewportPoint, plate, readDocument } from './helpers'

/**
 * Working on the part directly in the 3D view: pulling a face, picking a face
 * to sketch on, and measuring. Each drives the real pointer through picking.
 */

test.describe.configure({ timeout: 240_000 })

const viewport = (page: Page) => page.getByLabel('3D modeling viewport')

async function extrudeDistance(page: Page, extrudeId: string) {
  const feature = (await readDocument(page)).features.find((candidate) => candidate.id === extrudeId)
  return feature?.kind === 'extrude' ? feature.parameters.distance : null
}

test('pulls a face to change its extrude, as one undo step', async ({ page }) => {
  const extrudeId = await plate(page)
  // Finishing a sketch leaves the camera looking straight down the face
  // normal, along which a pull cannot be read from the pointer. Turn to the
  // home view, as a person would.
  await page.getByTitle('Home view (Isometric Z-up)').click()
  const at = await findViewportPoint(page, async () => await viewport(page).getAttribute('data-push-pull') === 'available')

  await page.mouse.down()
  await page.mouse.move(at.x, at.y - 60, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => extrudeDistance(page, extrudeId)).not.toBe(8)
  const pulled = await extrudeDistance(page, extrudeId)
  expect(Number.isInteger(pulled)).toBe(true)

  await page.keyboard.press('Control+z')
  await expect.poll(() => extrudeDistance(page, extrudeId)).toBe(8)
})

test('starts a sketch on a picked face of the part', async ({ page }) => {
  await plate(page)
  await page.getByRole('button', { name: 'Create sketch' }).click()
  await page.getByRole('button', { name: /Pick a model face/ }).click()
  const banner = page.locator('.face-pick-banner')
  const at = await findViewportPoint(page, async () => ((await banner.textContent()) ?? '').includes('Top face'))
  await expect(viewport(page)).toHaveAttribute('data-face-highlight', 'supported')
  await page.mouse.click(at.x, at.y)

  await expect(page.locator('svg.sketch-surface')).toBeVisible()
  const sketches = (await readDocument(page)).features.filter((feature) => feature.kind === 'sketch')
  const sketch = sketches.at(-1)!
  expect(sketch.kind === 'sketch' && sketch.plane).toBe('XY')
  expect(sketch.kind === 'sketch' && sketch.parameters.planeOffset).toBeCloseTo(8)
  expect(sketch.kind === 'sketch' && sketch.attachment?.faceLabel).toBe('Top face')
})

test('measures between two snapped points on the part', async ({ page }) => {
  await plate(page)
  await page.getByTitle('Measure points and features').first().click()
  const snapped = async () => Boolean(await viewport(page).getAttribute('data-measurement-snap'))

  const first = await findViewportPoint(page, snapped)
  await page.mouse.click(first.x, first.y)
  await expect(page.locator('.measurement-reference')).toHaveCount(1)

  const far = (point: { x: number; y: number }) => Math.hypot(point.x - first.x, point.y - first.y) > 30
  const second = await findViewportPoint(page, snapped, far)
  await page.mouse.click(second.x, second.y)
  await expect(page.locator('.measurement-result')).toBeVisible()
  await expect(page.locator('.measurement-total').first()).toContainText('Distance')
})

test('picks an edge of the part to fillet', async ({ page }) => {
  await plate(page)
  await page.getByTitle('Home view (Isometric Z-up)').click()
  await page.getByTitle('Fillet selected edges').first().click()
  const banner = page.locator('.fillet-pick-banner')

  // Walk down from the middle of the view, clicking, until a click lands
  // close enough to an edge to pick it. Misses only report themselves.
  const box = (await viewport(page).boundingBox())!
  let picked = false
  for (let dy = 0; dy < box.height / 2 && !picked; dy += 8) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + dy)
    picked = ((await banner.textContent()) ?? '').includes('1 edge selected')
  }
  expect(picked).toBe(true)
})

test('an orthographic view draws and picks the part, and is remembered', async ({ page }) => {
  const extrudeId = await plate(page)
  await page.getByTitle('Home view (Isometric Z-up)').click()
  await page.getByTitle('Orientation menu').click()
  await page.getByRole('button', { name: 'Orthographic' }).click()
  const canvas = viewport(page).locator('canvas').first()
  await expect(canvas).toHaveAttribute('data-projection', 'orthographic')
  await page.screenshot({ path: test.info().outputPath('orthographic.png') })

  // Picking goes through the camera that drew the frame, so a pull still lands.
  const at = await findViewportPoint(page, async () => await viewport(page).getAttribute('data-push-pull') === 'available')
  await page.mouse.down()
  await page.mouse.move(at.x, at.y - 60, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => extrudeDistance(page, extrudeId)).not.toBe(8)

  await page.reload()
  await expect(viewport(page).locator('canvas').first()).toHaveAttribute('data-projection', 'orthographic')
})
