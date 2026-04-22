import { test, expect } from '@playwright/test'
import {
  createTempUserDataDir,
  createDesktopSeed,
  seedDesktopUserData,
  launchDesktopApp
} from './support/desktop-app.mjs'
import { signInDesktop } from './support/desktop-flows.mjs'

test('desktop keeps the signed-in session across a normal restart after a real login', async () => {
  const userDataDir = createTempUserDataDir()
  const seed = createDesktopSeed()
  seedDesktopUserData(userDataDir, seed)

  const firstLaunch = await launchDesktopApp({ userDataDir })

  try {
    await signInDesktop(firstLaunch.window, seed)
  } finally {
    await firstLaunch.app.close().catch(() => {})
  }

  const secondLaunch = await launchDesktopApp({ userDataDir })

  try {
    const { window: page } = secondLaunch
    const useLodgeButton = page.getByRole('button', { name: 'Use Lodge' })
    const welcomeVisible = await useLodgeButton.isVisible({ timeout: 8000 }).catch(() => false)
    if (welcomeVisible) {
      await useLodgeButton.click()
    }

    await expect(page.getByTestId('sidebar-sync-panel')).toBeVisible({ timeout: 30000 })
    await expect(page.getByText(seed.user.name)).toBeVisible()
    await expect(page.getByTestId('login-email-input')).toBeHidden()
  } finally {
    await secondLaunch.app.close().catch(() => {})
  }
})
