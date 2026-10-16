import { expect, test, type Page } from '@playwright/test'
import { commit, findViewportPoint, plate, readDocument, sketchPoint } from './helpers'

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

test('drills a hole at a point sketched on a face of the part, then patterns it', async ({ page }) => {
  await plate(page)
  await page.getByRole('button', { name: 'Create sketch' }).click()
  await page.getByRole('button', { name: /Pick a model face/ }).click()
  const banner = page.locator('.face-pick-banner')
  const at = await findViewportPoint(page, async () => ((await banner.textContent()) ?? '').includes('Top face'))
  await page.mouse.click(at.x, at.y)
  await expect(page.locator('svg.sketch-surface')).toBeVisible()

  await page.getByRole('button', { name: /^Point/ }).click()
  const spot = await sketchPoint(page, 10, 5)
  await page.mouse.click(spot.x, spot.y)
  await expect(page.locator('.sketch-lone-point')).toHaveCount(1)
  await page.getByRole('button', { name: 'Finish sketch' }).click()

  await page.getByTitle('Hole at sketch points').first().click()
  const hole = (await readDocument(page)).features.find((feature) => feature.kind === 'hole')
  expect(hole).toMatchObject({ name: 'Hole 1', parameters: { preset: 'M3 clearance', through: true } })
  await expect(page.locator('.properties-panel')).toContainText('1 point in')
  await expect(page.locator('.hole-callout')).toHaveText('Ø3.4 THRU')
  await expect(viewport(page)).toHaveAttribute('data-exact-features', new RegExp(hole!.id), { timeout: 60_000 })

  // A preset resizes it as one choice.
  await page.getByLabel('Hole preset').selectOption('M3 counterbore')
  await expect(page.locator('.hole-callout')).toHaveText('Ø3.4 THRU ⌴ Ø6.5 ↧ 3.3')

  // Then a row of three, stepping back across the plate.
  await page.getByTitle('Pattern or mirror selected feature').first().click()
  await commit(page, page.getByLabel('Count', { exact: true }), '3')
  await commit(page, page.getByLabel('Spacing', { exact: true }), '-10')
  await expect(page.locator('.pattern-summary')).toHaveText('3 × -10 mm along X')
  const pattern = (await readDocument(page)).features.find((feature) => feature.kind === 'pattern')
  expect(pattern).toMatchObject({ featureIds: [hole!.id], parameters: { count: 3, spacing: -10 } })
  await page.getByTitle('Home view (Isometric Z-up)').click()
  await expect(viewport(page)).toHaveAttribute('data-exact-features', new RegExp(pattern!.id), { timeout: 60_000 })
  await page.screenshot({ path: test.info().outputPath('patterned-holes.png') })
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

test('chamfers a picked edge of the part', async ({ page }) => {
  await plate(page)
  await page.getByTitle('Home view (Isometric Z-up)').click()
  await page.getByTitle('Chamfer selected edges').first().click()
  const banner = page.locator('.fillet-pick-banner')
  await expect(banner).toContainText('SELECT EDGES TO CHAMFER')

  const box = (await viewport(page).boundingBox())!
  let picked = false
  for (let dy = 0; dy < box.height / 2 && !picked; dy += 8) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + dy)
    picked = ((await banner.textContent()) ?? '').includes('1 edge selected')
  }
  expect(picked).toBe(true)

  await page.getByLabel('Chamfer distance').fill('1')
  await banner.getByRole('button', { name: 'Apply' }).click()
  await expect(banner).toBeHidden()
  await expect.poll(async () => (await readDocument(page)).features.find((feature) => feature.kind === 'fillet')).toMatchObject({
    name: 'Chamfer 1', parameters: { radius: 1, blend: 'chamfer' },
  })
  await expect(page.locator('.properties-panel .panel-header')).toContainText('CHAMFER')
})

test('shells the part open at a picked face', async ({ page }) => {
  await plate(page)
  await page.getByTitle('Home view (Isometric Z-up)').click()
  await page.getByTitle('Shell selected solid').first().click()
  const banner = page.locator('.fillet-pick-banner')
  await expect(banner).toContainText('SELECT FACES TO OPEN')

  const at = await findViewportPoint(page, async () => await viewport(page).getAttribute('data-face-highlight') === 'supported')
  await page.mouse.click(at.x, at.y)
  await expect(banner).toContainText('1 face open')
  await expect(viewport(page)).toHaveAttribute('data-picked-faces', '1')

  await page.getByLabel('Shell wall thickness').fill('2')
  await banner.getByRole('button', { name: 'Apply' }).click()
  await expect(banner).toBeHidden()
  await expect.poll(async () => (await readDocument(page)).features.find((feature) => feature.kind === 'shell')).toMatchObject({
    name: 'Shell 1', parameters: { thickness: 2 },
  })
  const shell = (await readDocument(page)).features.find((feature) => feature.kind === 'shell')!
  expect(shell.kind === 'shell' && shell.faces).toHaveLength(1)
  await expect(viewport(page)).toHaveAttribute('data-exact-features', new RegExp(shell.id), { timeout: 60_000 })
  await expect(page.locator('.properties-panel .panel-header')).toContainText('SHELL')
  await expect(page.locator('.shell-face-count')).toHaveText('1 face')
  await expect(page.locator('.properties-panel .dependency-warning')).toHaveCount(0)
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

test('a new sketch snaps to the part’s edges projected onto its plane', async ({ page }) => {
  await plate(page)
  await page.getByRole('button', { name: 'Create sketch' }).click()
  await page.getByRole('button', { name: /XY plane/ }).click()
  await page.keyboard.press('l')

  // The plate's corner at (25, 15), approached from slightly off it.
  const near = await sketchPoint(page, 24.4, 15.5)
  await page.mouse.move(near.x, near.y)
  await expect(page.locator('.snap-indicator.projected.corner')).toBeVisible()

  const away = await sketchPoint(page, 40, 15)
  await page.mouse.down()
  await page.mouse.move(away.x, away.y, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => {
    const sketches = (await readDocument(page)).features.filter((feature) => feature.kind === 'sketch')
    const latest = sketches.at(-1)
    const line = latest?.kind === 'sketch' ? latest.entities[0] : undefined
    return line?.type === 'line' ? line.start : null
  }).toEqual([25, 15])
})
