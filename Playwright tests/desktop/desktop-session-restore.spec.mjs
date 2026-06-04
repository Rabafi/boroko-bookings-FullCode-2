import { test, expect } from '@playwright/test'
import {
  createTempUserDataDir,
  createDesktopSeed,
  seedDesktopUserData,
  launchDesktopApp
} from './support/desktop-app.mjs'

test('desktop session restores from the saved nonce on restart', async () => {
  const userDataDir = createTempUserDataDir()
  const seed = createDesktopSeed()
  seedDesktopUserData(userDataDir, seed)

  const { app, window: page } = await launchDesktopApp({ userDataDir })

  try {
    await expect(page.getByRole('button', { name: 'Use Lodge' })).toBeVisible({ timeout: 30000 })
    await page.getByRole('button', { name: 'Use Lodge' }).click()
    await page.evaluate(({ user, scope }) => {
      localStorage.setItem('bb_user', JSON.stringify(user))
      localStorage.setItem('bb_user_scope', scope)
    }, {
      user: seed.localStorageUser,
      scope: seed.lodgeId
    })

    await page.reload()

    await expect(page.getByTestId('sidebar-sync-panel')).toBeVisible({ timeout: 30000 })
    await expect(page.getByText(seed.user.name)).toBeVisible()
  } finally {
    await app.close()
  }
})
