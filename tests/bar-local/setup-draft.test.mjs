import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BAR_LOCAL_SETUP_DRAFT_KEY,
  clearBarLocalSetupDraft,
  loadBarLocalSetupDraft,
  saveBarLocalSetupDraft
} from '../../src/shared/barLocalSetupDraft.js'

function storageFixture() {
  const values = new Map()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  }
}

test('setup draft restores safe business fields but never stores owner identity or credentials', () => {
  const storage = storageFixture()
  const saved = saveBarLocalSetupDraft(storage, {
    business_name: 'Rabafi Test Bar', outlet_name: 'Main Bar', currency: 'BWP',
    timezone: 'Africa/Gaborone', owner_name: 'Owner', owner_email: 'owner@example.test',
    pin: '123456', owner_password: 'not-to-store', address: '1 Main Road'
  })
  const raw = storage.values.get(BAR_LOCAL_SETUP_DRAFT_KEY)
  assert.equal(saved.business_name, 'Rabafi Test Bar')
  assert.equal(saved.outlet_name, 'Main Bar')
  assert.match(raw, /Rabafi Test Bar/)
  assert.doesNotMatch(raw, /owner@example|Owner|123456|not-to-store/)
  const restored = loadBarLocalSetupDraft(storage, { pin: '', owner_name: '', owner_email: '' })
  assert.equal(restored.business_name, 'Rabafi Test Bar')
  assert.equal(restored.pin, '')
  assert.equal(restored.owner_name, '')
  assert.equal(restored.owner_email, '')
})

test('tampered saved credentials are discarded and the draft can be cleared', () => {
  const storage = storageFixture()
  storage.setItem(BAR_LOCAL_SETUP_DRAFT_KEY, JSON.stringify({ business_name: 'Test', pin: '999999', password: 'leaked' }))
  const restored = loadBarLocalSetupDraft(storage, { pin: '' })
  assert.equal(restored.business_name, 'Test')
  assert.equal(restored.pin, '')
  clearBarLocalSetupDraft(storage)
  assert.equal(storage.getItem(BAR_LOCAL_SETUP_DRAFT_KEY), null)
})
