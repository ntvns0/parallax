import { expect, test } from '@playwright/test'

test('serves the production shell and immutable application assets', async ({ page, request }) => {
  await page.goto('/?test=1')
  await expect(page.getByRole('button', { name: 'PARALLAX' })).toBeVisible()
  await expect(page.getByLabel('3D modeling viewport').locator('canvas')).toBeVisible()

  const scriptPath = await page.locator('script[type="module"]').getAttribute('src')
  expect(scriptPath).toMatch(/^\/assets\/.*\.js$/)
  const response = await request.get(scriptPath!)
  expect(response.headers()['cache-control']).toContain('immutable')
})

test('reloads the application shell while offline after installation', async ({ page, context }) => {
  await page.goto('/?test=1')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'PARALLAX' })).toBeVisible()
})
