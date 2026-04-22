import { test, expect } from '@playwright/test'
import {
  createTempUserDataDir,
  createDesktopSeed,
  seedDesktopUserData,
  launchDesktopApp
} from './support/desktop-app.mjs'

test('desktop login signs in with cached offline credentials', async () => {
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

    await expect(page.getByTestId('sidebar-sync-panel')).toBeVisible({ timeout: 30000 })
    await expect(page.getByText(seed.user.name)).toBeVisible()
  } finally {
    await app.close()
  }
})
