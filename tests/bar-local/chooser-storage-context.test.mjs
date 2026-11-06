import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BarLocalElectronRuntime } from '../../src/main/bar-local/electronRuntime.js'

// Model the actual profile-key boundary with authenticated, different keys.
// These tests do not claim to exercise Windows DPAPI/Electron safeStorage.
function profileStorage() {
  const key = randomBytes(32)
  return { isEncryptionAvailable: () => true,
    encryptString(value) {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([nonce, cipher.getAuthTag(), data])
    }, decryptString(value) {
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      cipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8')
    } }
}
const config = { authority_mode: 'bar_local', product: 'hospitality-pos',
  business_id: 'e513f287-3c0d-4a8a-9e30-3c498de85b99',
  outlet_ids: ['1fa934c2-981b-4d4e-8c02-1851cd96c4ea'], active_outlet_id: '1fa934c2-981b-4d4e-8c02-1851cd96c4ea',
  authority_id: 'a7cf64e8-bf07-4bb6-ac6e-7129c6b26fc7', authority_epoch: 1, contract_version: 1, base_url: 'http://127.0.0.1:4317' }

test('parent can select existing child encrypted with a distinct key; child validates its own authority without a session', (t) => {
  const parentPath = mkdtempSync(join(tmpdir(), 'bar-key-context-'))
  const childPath = join(parentPath, 'local-bar-workspace')
  mkdirSync(join(childPath, 'bar-local'), { recursive: true })
  const parentStorage = profileStorage()
  const childStorage = profileStorage()
  const file = join(childPath, 'bar-local', 'authority.bin')
  const encrypted = childStorage.encryptString(JSON.stringify(config))
  writeFileSync(file, encrypted)
  const parent = new BarLocalElectronRuntime({ userDataPath: parentPath, safeStorage: parentStorage, buildProductId: 'hospitality-pos' })
  t.after(() => parent.close())
  assert.equal(parent.localBarChooserEntry().status, 'recovery', 'parent cannot assert child readiness')
  assert.deepEqual(parent.selectLocalBarWorkspace(), { restart_required: true, workspace: 'local_bar' })
  assert.deepEqual(readFileSync(file), encrypted, 'selection must not rewrite or re-encrypt protected child data')
  const child = new BarLocalElectronRuntime({ userDataPath: childPath, safeStorage: childStorage, buildProductId: 'hospitality-pos' })
  t.after(() => child.close())
  t.after(() => rmSync(parentPath, { recursive: true, force: true }))
  assert.equal(child.mode, 'bar_local')
  assert.equal(child.status().session_active, false, 'workspace selection is not authentication')
})

test('explicit recovery selection never makes a malformed child authority valid or enables cloud fallback', (t) => {
  const parentPath = mkdtempSync(join(tmpdir(), 'bar-bad-context-'))
  const childPath = join(parentPath, 'local-bar-workspace')
  mkdirSync(join(childPath, 'bar-local'), { recursive: true })
  const storage = profileStorage()
  writeFileSync(join(childPath, 'bar-local', 'authority.bin'), storage.encryptString('{"authority_mode":"bar_local"}'))
  const parent = new BarLocalElectronRuntime({ userDataPath: parentPath, safeStorage: profileStorage(), buildProductId: 'hospitality-pos' })
  t.after(() => parent.close())
  t.after(() => rmSync(parentPath, { recursive: true, force: true }))
  assert.equal(parent.selectLocalBarWorkspace().workspace, 'local_bar')
  assert.throws(() => new BarLocalElectronRuntime({ userDataPath: childPath, safeStorage: storage, buildProductId: 'hospitality-pos' }))
})
