const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: '.',
  testMatch: ['desktop/**/*.spec.mjs'],
  timeout: 120000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'desktop',
      testMatch: 'desktop/**/*.spec.mjs'
    }
  ]
})
