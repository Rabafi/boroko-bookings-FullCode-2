import { spawn } from 'child_process'

const deskKey = String(process.argv[2] || 'A').trim().toUpperCase()
const safeDeskKey = deskKey.replace(/[^A-Z0-9_-]/g, '') || 'A'
const deskName = `Boroko Bookings Local Desk ${safeDeskKey}`

const electronBin = process.platform === 'win32'
  ? 'node_modules\\.bin\\electron.cmd'
  : 'node_modules/.bin/electron'

console.log(`Starting ${deskName}...`)
console.log('Use another terminal with the other desk command to test local mesh peer discovery.')

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
