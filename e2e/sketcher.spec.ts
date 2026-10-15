import { expect, test, type Page } from '@playwright/test'
import { sketchRectangle } from './helpers'

/**
 * The sketch tools through the interface: drawing, selecting, typing
 * coordinates, dragging. Read-only document access checks what each gesture
 * actually stored, not what the surface happened to draw.
 */

test.describe.configure({ timeout: 120_000 })

/** The sketch view opens at 4 px per mm with the origin centred. */
const PX_PER_MM = 4

const sketchEntities = async (page: Page) => {
  const document = await page.evaluate(() => window.__PARALLAX_TEST__!.document())
  const sketch = document.features.find((feature) => feature.kind === 'sketch')
  return sketch?.kind === 'sketch' ? sketch : null
}

const round = (value: number) => Math.round(value * 1000) / 1000 + 0

async function at(page: Page, x: number, y: number) {
  const box = (await page.locator('svg.sketch-surface').boundingBox())!
  return { x: box.x + box.width / 2 + x * PX_PER_MM, y: box.y + box.height / 2 - y * PX_PER_MM }
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const start = await at(page, ...from)
  const end = await at(page, ...to)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 4 })
  await page.mouse.up()
}

async function click(page: Page, x: number, y: number) {
  const point = await at(page, x, y)
  await page.mouse.click(point.x, point.y)
}

async function commit(page: Page, label: string, value: string) {
  const input = page.getByLabel(label)
  await input.fill(value)
  await input.press('Enter')
}

const firstLine = async (page: Page) => {
  const line = (await sketchEntities(page))?.entities.find((entity) => entity.type === 'line')
  return line?.type === 'line' ? [line.start, line.end].map((point) => point.map(round)) : null
}

test('draws, selects, retypes, and drags sketch geometry', async ({ page }) => {
  await page.goto('/?test=1')
  await page.getByRole('button', { name: 'Create sketch' }).click()
  await page.getByRole('button', { name: /XY plane/ }).click()

  // A line drawn a little off level is inferred horizontal and held there.
  await page.keyboard.press('l')
  await drag(page, [0, 0], [30, 0.6])
  await expect.poll(() => firstLine(page)).toEqual([[0, 0], [30, 0]])
  const constraints = (await sketchEntities(page))!.constraints.map((constraint) => constraint.type)
  expect(constraints).toContain('horizontal')

  // Select it and type a new end point.
  await page.keyboard.press('v')
  await click(page, 15, 0)
  await commit(page, 'Line end X', '40')
  await expect.poll(() => firstLine(page)).toEqual([[0, 0], [40, 0]])

  // Centre the selection on the origin.
  await commit(page, 'Selection center X', '0')
  await expect.poll(() => firstLine(page)).toEqual([[-20, 0], [20, 0]])

  // Drag it by its body; the move lands on whole millimetres.
  await drag(page, [5, 0], [5, 10.2])
  await expect.poll(() => firstLine(page)).toEqual([[-20, 10], [20, 10]])

  // A centre-point arc is three clicks: centre, start, sweep.
  await page.keyboard.press('a')
  await click(page, 0, -20)
  await click(page, 10, -20)
  await click(page, 0, -10)
  await expect.poll(async () => {
    const arc = (await sketchEntities(page))?.entities.find((entity) => entity.type === 'arc')
    return arc?.type === 'arc' ? { center: arc.center.map(round), radius: round(arc.radius) } : null
  }).toEqual({ center: [0, -20], radius: 10 })

  // Escape steps back one thing at a time: the selection, then the sketch.
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Line end X')).toHaveCount(0)
  await expect(page.locator('svg.sketch-surface')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('svg.sketch-surface')).toHaveCount(0)
})

test('a construction centreline becomes the axis a revolve turns about', async ({ page }) => {
  await page.goto('/?test=1')
  await sketchRectangle(page, [10, 0], [15, 12])

  // A line beside the section, made construction with Q.
  await page.keyboard.press('l')
  await drag(page, [5, -5], [5, 20])
  await page.keyboard.press('v')
  await click(page, 5, 18)
  await page.keyboard.press('q')
  await expect.poll(async () => (await sketchEntities(page))?.entities.filter((entity) => entity.construction).length).toBe(1)
  await expect(page.locator('g.construction')).toHaveCount(1)
  await page.getByRole('button', { name: 'Finish sketch' }).click()

  await page.getByRole('button', { name: 'Revolve', exact: true }).click()
  await page.getByLabel('Revolve axis').selectOption({ label: 'Centreline 1' })
  const document = await page.evaluate(() => window.__PARALLAX_TEST__!.document())
  const revolve = document.features.find((feature) => feature.kind === 'revolve')!
  const centreline = (await sketchEntities(page))!.entities.find((entity) => entity.construction)!
  expect(revolve.kind === 'revolve' && revolve.axisEntityId).toBe(centreline.id)
  await expect(page.getByLabel('3D modeling viewport')).toHaveAttribute('data-exact-features', new RegExp(revolve.id), { timeout: 60_000 })
})
