const { app, ipcMain, BrowserWindow, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const work = fs.realpathSync(process.argv[2])
const { registerBarLocalIpc } = require(path.join(work, 'runtime.cjs'))
const marker = path.join(work, 'requested.json')
const result = path.join(work, 'result.json')
const userData = path.join(work, 'synthetic-user-data')
fs.mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.disableHardwareAcceleration()
const watchdog = setTimeout(() => app.exit(2), 45000)
function fail(error) {
  fs.writeFileSync(path.join(work, 'error.json'), JSON.stringify({ message: error.message, stack: error.stack }))
  clearTimeout(watchdog)
  app.exit(1)
}
app.whenReady().then(async () => {
  const runtime = registerBarLocalIpc({ ipcMain, app, safeStorage, buildProductId: 'hospitality-pos' })
  if (fs.existsSync(marker)) {
    const first = JSON.parse(fs.readFileSync(marker, 'utf8'))
    assert.notEqual(process.pid, first.pid)
    assert.equal(runtime.status().workspace_choice_required, false)
    assert.equal(runtime.mode, 'cloud')
    assert.equal(runtime.adapter, null)
    assert.equal(fs.existsSync(path.join(userData, 'bar-local', 'intents.sqlite')), false)
    fs.writeFileSync(result, JSON.stringify({ passed: true, first_pid: first.pid, restarted_pid: process.pid,
      electron: process.versions.electron, node: process.versions.node,
      evidence: 'Real hidden renderer -> fixed production IPC -> durable workspace choice -> Electron relaunch -> fresh runtime. No cloud database, local service or installed customer lifecycle started.' }, null, 2))
    clearTimeout(watchdog)
    runtime.close()
    app.exit(0)
    return
  }
  assert.equal(runtime.status().workspace_choice_required, true)
  assert.equal(runtime.mode, 'cloud')
  // No application profile, session, network or financial operation exists.
  fs.writeFileSync(marker, JSON.stringify({ pid: process.pid }))
  const window = new BrowserWindow({ show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: false,
    preload: path.join(work, 'preload.cjs')
  } })
  await window.loadURL('data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src %27none%27"><title>Synthetic startup IPC probe</title>')
}).catch(fail)
