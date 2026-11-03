import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../../src/renderer/src/App.jsx', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('../../src/renderer/src/components/hospitality-pos/BarLocalWorkspace.jsx', import.meta.url), 'utf8')

test('a commissioned owner opens email sign-in without exposing the generated staff UUID', () => {
  assert.match(workspace, /status\.post_setup_notice_pending === true \|\| Boolean\(status\.setup_owner_staff_id\) \? 'owner' : 'staff'/)
  assert.match(app, /initialStaffId=\{currentAuthority\?\.training \? currentAuthority\.setup_owner_staff_id : ''\}/)
})

test('the first-use notice remains pending until the owner has signed in', () => {
  const login = workspace.slice(workspace.indexOf('const login = async'), workspace.indexOf('const recoverOwnerPassword ='))
  assert.ok(login.indexOf("loginMode === 'owner' && status.post_setup_notice_pending === true") >= 0)
  assert.ok(login.indexOf('window.api.barLocal.login') < login.indexOf('consumePostSetupNotice'))
  const mountEffect = workspace.slice(workspace.indexOf('if (status.post_setup_notice_pending !== true) return'), workspace.indexOf('}, [status.post_setup_notice_pending])'))
  assert.doesNotMatch(mountEffect, /consumePostSetupNotice/)
})
