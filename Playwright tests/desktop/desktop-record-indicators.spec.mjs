import { test, expect } from '@playwright/test'
import {
  createTempUserDataDir,
  createDesktopSeed,
  seedDesktopUserData,
  launchDesktopApp
} from './support/desktop-app.mjs'

test('desktop records show pending, failed, and needs-attention indicators', async () => {
  const userDataDir = createTempUserDataDir()
  const seed = createDesktopSeed()
  seedDesktopUserData(userDataDir, seed)

  const { app, window: page } = await launchDesktopApp({ userDataDir })

  try {
    await expect(page.getByRole('button', { name: 'Use Lodge' })).toBeVisible({ timeout: 30000 })
    await page.getByRole('button', { name: 'Use Lodge' }).click()
    await page.evaluate(() => { window.location.hash = '#/login' })
    await page.getByTestId('login-email-input').fill(seed.user.email)
    await page.getByTestId('login-password-input').fill(seed.password)
    await page.getByTestId('login-submit-button').click()

    await page.getByRole('link', { name: 'Bookings' }).click()
    await expect(page.getByRole('heading', { name: 'Bookings' })).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId(`booking-row-booking-pending`)).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId(`booking-pending-sync-booking-pending`)).toBeVisible()
    await expect(page.getByTestId(`booking-sync-failed-booking-failed`)).toBeVisible()
    await expect(page.getByTestId(`booking-needs-attention-booking-attention`)).toBeVisible()

    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByTestId('settings-tab-system').click()
    await expect(page.getByTestId('system-health-failed-queue')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('system-health-failed-item')).toBeVisible()
    await expect(page.getByTestId('system-health-validation-alerts')).toBeVisible()
    await expect(page.getByTestId('system-health-validation-alert')).toBeVisible()
  } finally {
    await app.close()
  }
})
