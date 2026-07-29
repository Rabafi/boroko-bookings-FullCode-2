import { spawn } from 'child_process'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const deskKey = String(process.argv[2] || 'A').trim().toUpperCase()
const safeDeskKey = deskKey.replace(/[^A-Z0-9_-]/g, '') || 'A'
const deskName = `Tsa Bonno LodgingOS Local Desk ${safeDeskKey}`

const electronBin = process.platform === 'win32'
  ? 'node_modules\\.bin\\electron.cmd'
  : 'node_modules/.bin/electron'

console.log(`Starting ${deskName}...`)
console.log('Use another terminal with the other desk command to test local mesh peer discovery.')

const deskUserDataDir = join(homedir(), 'AppData', 'Roaming', deskName)
for (const cacheName of ['Cache', 'Code Cache', 'GPUCache', 'DawnCache']) {
  const cachePath = join(deskUserDataDir, cacheName)
  try {
    if (existsSync(cachePath)) rmSync(cachePath, { recursive: true, force: true })
  } catch {
    // Cache cleanup is best-effort. Never block starting a local test desk.
  }
}

const child = process.platform === 'win32'
  ? spawn('cmd.exe', ['/d', '/s', '/c', electronBin, '.'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        BOROKO_DEV_DESK_NAME: deskName
      }
    })
  : spawn(electronBin, ['.'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    BOROKO_DEV_DESK_NAME: deskName
  }
  })

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
