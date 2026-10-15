import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

const systemChrome = '/usr/bin/google-chrome'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Software WebGL takes a second or more a frame, and actions wait for frames.
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    ...(existsSync(systemChrome) ? { launchOptions: { executablePath: systemChrome } } : {}),
  },
  webServer: {
    command: 'npm run serve:dist',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /performance\.spec\.ts/ },
    { name: 'performance', use: { ...devices['Desktop Chrome'] }, testMatch: /performance\.spec\.ts/ },
  ],
})
