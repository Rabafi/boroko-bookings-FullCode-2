import { test, expect } from '@playwright/test'
import { createTempUserDataDir, launchDesktopApp } from './support/desktop-app.mjs'

test('desktop app launch opens the login screen', async () => {
  const userDataDir = createTempUserDataDir()
  const { app, window: page } = await launchDesktopApp({ userDataDir })

  try {
    await page.getByRole('button', { name: 'Log In' }).click()
    await expect(page.getByTestId('login-email-input')).toBeVisible()
    await expect(page.getByTestId('login-password-input')).toBeVisible()
    await expect(page.getByTestId('login-submit-button')).toBeVisible()
  } finally {
    await app.close()
  }
})
