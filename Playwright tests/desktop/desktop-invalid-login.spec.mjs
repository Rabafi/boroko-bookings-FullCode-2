import { test, expect } from '@playwright/test'
import {
  createTempUserDataDir,
  createDesktopSeed,
  seedDesktopUserData,
  launchDesktopApp
} from './support/desktop-app.mjs'
import { selectFirstLodge } from './support/desktop-flows.mjs'

test('desktop rejects invalid login cleanly without partial access', async () => {
  const userDataDir = createTempUserDataDir()
  const seed = createDesktopSeed()
  seedDesktopUserData(userDataDir, seed)

  const { app, window: page } = await launchDesktopApp({ userDataDir })

  try {
    await selectFirstLodge(page, seed.lodgeName)
    await page.evaluate(() => { window.location.hash = '#/login' })

    await page.getByTestId('login-email-input').fill(seed.user.email)
    await page.getByTestId('login-password-input').fill(`${seed.password}-wrong`)
    await page.getByTestId('login-submit-button').click()

    await expect(page.getByText(/incorrect|sign-in failed/i)).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('sidebar-sync-panel')).toBeHidden()
    await expect(page.getByTestId('login-email-input')).toBeVisible()
    await expect(page.getByTestId('login-password-input')).toBeVisible()
  } finally {
    await app.close().catch(() => {})
  }
})
