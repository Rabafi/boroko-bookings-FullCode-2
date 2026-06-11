import { test, expect } from '@playwright/test'
import {
  createTempUserDataDir,
  createDesktopSeed,
  seedDesktopUserData,
  launchDesktopApp
} from './support/desktop-app.mjs'
import { restoreSeededDesktopSession } from './support/desktop-flows.mjs'

test('desktop sync status panel exposes counts and sync state', async () => {
  const userDataDir = createTempUserDataDir()
  const seed = createDesktopSeed()
  seedDesktopUserData(userDataDir, seed)

  const { app, window: page } = await launchDesktopApp({ userDataDir })

  try {
    await restoreSeededDesktopSession(page, seed)

    await expect(page.getByTestId('sidebar-sync-panel')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('sidebar-sync-state')).toHaveText('Failed')
    await expect(page.getByTestId('sidebar-sync-pending')).toHaveText('1')
    await expect(page.getByTestId('sidebar-sync-failed')).toHaveText('1')
    await expect(page.getByTestId('sidebar-sync-last-success')).toContainText('Last successful sync:')
  } finally {
    await app.close()
  }
})
