import { test, expect } from '@playwright/test'

test('manager login page opens', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173')
  await expect(page).toHaveTitle(/Boroko|Vite|Bookings/i)
})
