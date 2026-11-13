import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const shell = readFileSync(new URL('../../src/renderer/src/components/hospitality-pos/LocalBarHposShell.jsx', import.meta.url), 'utf8')
const login = readFileSync(new URL('../../src/renderer/src/components/Login.jsx', import.meta.url), 'utf8')

test('a commissioned owner opens email sign-in without exposing the generated staff UUID', () => {
  assert.match(shell, /consumeLocalSetupNotice=\{postSetupNoticePending\}/)
  assert.match(shell, /onLocalSetupNoticeConsumed=\{\(\) => setPostSetupNoticePending\(false\)\}/)
  assert.match(login, /type="email"[\s\S]*data-testid="login-email-input"/)
  assert.doesNotMatch(login, /Staff ID|Staff PIN|staff_id: staffId|localLoginMethod/)
  assert.doesNotMatch(shell, /initialStaffId=\{status\.setup_owner_staff_id/)
})

test('the first-use notice remains pending until the owner has signed in', () => {
  assert.match(shell, /Your Bar is ready\. Sign in with the owner email and password you chose during setup\./)
  const localLogin = login.slice(login.indexOf('if (localBarAuthority) {'), login.indexOf('\n    let latestStatus = authStatus'))
  assert.ok(localLogin.indexOf('await window.api.barLocal.login') < localLogin.indexOf('await login(result)'))
  assert.ok(localLogin.indexOf('await login(result)') < localLogin.indexOf('consumePostSetupNotice'))
  assert.ok(localLogin.indexOf('consumePostSetupNotice') < localLogin.indexOf('onLocalSetupNoticeConsumed()'))
  assert.match(localLogin, /if \(consumeLocalSetupNotice\)/)
  const consumeNotice = localLogin.slice(localLogin.indexOf('if (consumeLocalSetupNotice)'), localLogin.indexOf("navigate('/hpos/pos'"))
  assert.doesNotMatch(consumeNotice, /setError/)
})
