@echo off
cd /D "C:\Users\Botswapelo Studios\Documents\Work\Boroko Bookings\Playwright tests"
npx.cmd playwright test --config "playwright.config.cjs" --reporter=list
