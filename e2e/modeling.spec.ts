import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import {
  commit,
  expectExactSolid,
  extrudeSelectedSketch,
  plate,
  readDocument,
  sketchDimensions,
  sketchRectangle,
  sketchWidth,
} from './helpers'

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

test('keeps a second body, and cuts the first one after it was started', async ({ page }) => {
  const plateId = await plate(page)
  const extrudes = async () => (await readDocument(page)).features.filter((feature) => feature.kind === 'extrude')

  // A sketch off to the side, extruded, is a body of its own.
  await sketchRectangle(page, [35, -10], [55, 10])
  await page.getByRole('button', { name: 'Finish sketch' }).click()
  await page.getByRole('button', { name: 'Extrude', exact: true }).click()
  await expect.poll(async () => (await extrudes()).length).toBe(2)
  const lid = (await extrudes())[1]
  expect(lid.kind === 'extrude' && lid.operation).toBe('newBody')
  await expect(page.getByLabel('Bodies')).toContainText('Body 2')
  await expectExactSolid(page, lid.id)

  // A pocket, made a cut, changes the latest body until told otherwise.
  await sketchRectangle(page, [-5, -5], [5, 5])
  await page.getByRole('button', { name: 'Finish sketch' }).click()
  await page.getByRole('button', { name: 'Extrude', exact: true }).click()
  await expect.poll(async () => (await extrudes()).length).toBe(3)
  await page.locator('.properties-panel select').filter({ has: page.locator('option[value="cut"]') }).selectOption('cut')
  const body = page.getByLabel('Body to change')
  await expect(body).toHaveValue(lid.id)
  await body.selectOption(plateId)

  const pocket = (await extrudes())[2]
  expect(pocket.kind === 'extrude' && pocket.bodyId).toBe(plateId)
  // Both bodies are drawn finished: the plate with its pocket, and the lid.
  await expectExactSolid(page, pocket.id)
  await expectExactSolid(page, lid.id)
  await expect(page.getByLabel('Bodies')).toContainText('2 features')
})

