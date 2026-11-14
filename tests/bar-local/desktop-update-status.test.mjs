import test from 'node:test'
import assert from 'node:assert/strict'
import { registerLocalDesktopUpdateStatus } from '../../src/main/bar-local/desktopUpdateStatus.js'

function dispatchFixture(getVersion = () => '1.2.3') {
  const handlers = new Map()
  const updater = { checks: 0, downloads: 0, installs: 0 }
  registerLocalDesktopUpdateStatus({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, getVersion })
  return { handlers, updater }
}

test('actual local update IPC handlers report unsupported without invoking updater or implying latest', async () => {
  const { handlers, updater } = dispatchFixture()
  const check = await handlers.get('update:check')()
  const download = await handlers.get('update:download')()
  const install = await handlers.get('update:install')()
  const state = handlers.get('update:getState')()
  assert.equal(check.success, false)
  assert.equal(check.unsupported, true)
  assert.equal(check.state.availability, 'unsupported')
  assert.equal(check.state.currentVersion, '1.2.3')
  assert.equal(check.state.version, null)
  assert.match(check.error, /Ask your administrator for approved release instructions/)
  assert.equal(download.unsupported, true)
  assert.equal(install.unsupported, true)
  assert.equal(state.phase, 'idle')
  assert.equal(state.error, '')
  assert.equal(updater.checks + updater.downloads + updater.installs, 0)
})

test('local update status surfaces runtime version-provider failures instead of claiming a successful check', () => {
  const { handlers } = dispatchFixture(() => { throw new Error('Version unavailable') })
  assert.throws(() => handlers.get('update:getState')(), /Version unavailable/)
  assert.throws(() => handlers.get('update:check')(), /Version unavailable/)
})
