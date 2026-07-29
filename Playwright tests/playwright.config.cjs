const path = require('path')
const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: '.',
  testMatch: [
    'desktop/**/*.spec.mjs',
    'pwa/**/*.spec.mjs',
    'booking-site/**/*.spec.mjs',
    'booking-site.spec.mjs'
  ],
  timeout: 60000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'npm --prefix ../manager-pwa run dev -- --host 127.0.0.1 --port 5173',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120000
    },
    {
      command: 'npm --prefix ../booking-site run dev -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120000
    }
  ],
  projects: [
    {
      name: 'desktop',
      testMatch: 'desktop/**/*.spec.mjs'
    },
    {
      name: 'pwa',
      testMatch: 'pwa/**/*.spec.mjs'
    },
    {
      name: 'booking-site',
      testMatch: ['booking-site.spec.mjs', 'booking-site/**/*.spec.mjs']
    }
  ]
})
