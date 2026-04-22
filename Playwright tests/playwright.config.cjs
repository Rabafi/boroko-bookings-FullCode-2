const path = require('path')
const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './desktop',
  timeout: 60000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure'
  }
})
