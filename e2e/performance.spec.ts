import { expect, test } from '@playwright/test'

test('exports a local client performance report', async ({ page }, testInfo) => {
  await page.goto('/?test=1')
  await expect(page.getByLabel('3D modeling viewport').locator('canvas')).toBeVisible()
  const report = await page.evaluate(() => window.__PARALLAX_TEST__?.performanceReport())
  expect(report?.schemaVersion).toBe(1)
  expect(report?.runtime.policy.profile).toMatch(/conservative|balanced|capable/)
  await testInfo.attach('parallax-performance.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  })
})
