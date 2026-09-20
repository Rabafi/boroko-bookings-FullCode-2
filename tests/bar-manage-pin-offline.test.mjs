import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('Manage unlock falls back to the trusted offline PIN check on any transport failure', () => {
  const posDomain = read('src/main/domains/pos.js')

  assert.match(posDomain, /function isPosPinTransportFailure/, 'Must classify transport failures separately from authoritative server answers')
  assert.match(posDomain, /fetch failed/, 'Transport classifier must recognise unplugged-network fetch failures')
  assert.match(posDomain, /network_read_timeout/, 'Transport classifier must keep the existing timeout signal')

  const manageBlock = posDomain.slice(posDomain.indexOf('export async function verifyManagerPinForManage'))
  assert.match(manageBlock, /isPosPinTransportFailure\(transportError\)/, 'Manage unlock must catch thrown transport errors into the offline verifier')
  assert.match(manageBlock, /isPosPinTransportFailure\(error\)/, 'Manage unlock must treat transport-flavoured RPC error objects as offline, not as failures')
  assert.match(manageBlock, /resolveOfflineManageUnlock\(staff, pin\)/, 'Manage transport fallback must reuse the same offline unlock contract')
  assert.match(manageBlock, /if \(error\) throw/, 'Non-transport server errors must still fail closed, never fall back')
  assert.match(manageBlock, /manager_manage_unlocked_offline/, 'Offline unlocks must stay audit-logged')
})

test('Till unlock keeps the same transport fallback so one dead cable cannot trap either gate', () => {
  const posDomain = read('src/main/domains/pos.js')
  const tillBlock = posDomain.slice(
    posDomain.indexOf('export async function selectPosStaffWithPin'),
    posDomain.indexOf('export async function verifyManagerPinForManage'),
  )
  assert.match(tillBlock, /isPosPinTransportFailure\(transportError\)/, 'Till unlock must catch thrown transport errors into the cached verifier')
  assert.match(tillBlock, /isPosPinTransportFailure\(error\)/, 'Till unlock must treat transport-flavoured RPC error objects as offline')
})

test('Manage gate tells operators offline unlock works', () => {
  const layout = read('src/renderer/src/components/hospitality-pos/HposLayout.jsx')
  assert.match(layout, /Works offline/, 'Locked Manage placeholder must state offline unlock works')
})
