import { expect, test, type Page } from '@playwright/test'

/**
 * The viewport draws only when something changes. Drawing every frame kept a
 * GPU busy — ambient occlusion included — while the part sat still.
 */

const framesDrawn = async (page: Page) =>
  Number(await page.getByLabel('3D modeling viewport').locator('canvas').getAttribute('data-rendered-frames') ?? 0)

test('draws nothing while idle, and draws again on input', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/?test=1')
  const canvas = page.getByLabel('3D modeling viewport').locator('canvas')
  await expect(canvas).toHaveAttribute('data-rendered-frames', /\d+/)

  // Let start-up settle: hydration and the first layout each ask for a frame.
  await expect.poll(async () => {
    const before = await framesDrawn(page)
    await page.waitForTimeout(1500)
    return (await framesDrawn(page)) - before
  }, { timeout: 60_000 }).toBe(0)

  const idle = await framesDrawn(page)
  await page.waitForTimeout(2000)
  expect(await framesDrawn(page)).toBe(idle)

  // Orbiting has to keep working: a drag moves the camera and draws. Off
  // centre, clear of the empty-project hint in the middle of the viewport.
  const box = (await canvas.boundingBox())!
  const from = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.75 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 80, from.y - 20, { steps: 4 })
  await page.mouse.up()
  await expect.poll(() => framesDrawn(page)).toBeGreaterThan(idle)
})
