import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { linkLocalBarChooserDraft, readLocalBarChooserEntry } from '../src/main/bar-local/chooserEntry.js'
import { projectBarChooserProfiles } from '../src/shared/barLocalChooser.js'

const profileId = 'c699837b-3892-4d04-bca8-a12fe36c4dd0'
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8'),
  decryptString: (value) => Buffer.from(value).toString('utf8')
}

function setupFixture(t) {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-chooser-entry-'))
  t.after(() => rmSync(userDataPath, { recursive: true, force: true }))
  const barRoot = join(userDataPath, 'local-bar-workspace', 'bar-local')
  const setupPath = join(barRoot, 'server-setup', 'server-setup.bin')
  const authorityPath = join(barRoot, 'authority.bin')
  const linkPath = join(barRoot, 'chooser-link.bin')
  const writeSetup = (phase, businessName = 'Rabafi Pub') => {
    mkdirSync(join(barRoot, 'server-setup'), { recursive: true })
    writeFileSync(setupPath, safeStorage.encryptString(JSON.stringify({
      version: 1,
      phase,
      owner: { business_name: businessName, business_profile: {} }
    })))
  }
  const writeAuthority = (authorityMode = 'bar_local') => {
    mkdirSync(barRoot, { recursive: true })
    writeFileSync(authorityPath, safeStorage.encryptString(JSON.stringify({
      authority_mode: authorityMode,
      product: 'hospitality-pos',
      business_id: 'e513f287-3c0d-4a8a-9e30-3c498de85b99',
      outlet_ids: ['1fa934c2-981b-4d4e-8c02-1851cd96c4ea'],
      active_outlet_id: '1fa934c2-981b-4d4e-8c02-1851cd96c4ea',
      authority_id: 'a7cf64e8-bf07-4bb6-ac6e-7129c6b26fc7',
      authority_epoch: 1,
      commissioning_id: 'test',
      base_url: 'http://127.0.0.1:4317'
    })))
  }
  const writeLink = (profileIdToLink = profileId) => {
    mkdirSync(barRoot, { recursive: true })
    writeFileSync(linkPath, safeStorage.encryptString(JSON.stringify({ version: 1, profile_id: profileIdToLink })))
  }
  const read = () => readLocalBarChooserEntry({ userDataPath, safeStorage })
  return { userDataPath, barRoot, setupPath, authorityPath, linkPath, writeSetup, writeAuthority, writeLink, read }
}

test('no saved local Bar attempt produces no chooser entry', (t) => {
  const fixture = setupFixture(t)
  assert.deepEqual(fixture.read(), { status: 'none', label: null, origin_profile_id: null })
})

test('a real unfinished server setup appears as one resumable draft', (t) => {
  const fixture = setupFixture(t)
  fixture.writeSetup('failed')
  assert.deepEqual(fixture.read(), { status: 'draft', label: 'Rabafi Pub', origin_profile_id: null })
})

test('owner-complete state remains Ready after restart or service outage', (t) => {
  const fixture = setupFixture(t)
  fixture.writeSetup('complete')
  const entry = fixture.read()
  assert.equal(entry.status, 'ready')
  assert.equal(entry.label, 'Rabafi Pub')
  // The chooser reader does not probe service readiness; a transient outage
  // cannot change the durable owner-complete state back to a draft.
})

test('a committed authority reconciles a lost final response to Ready', (t) => {
  const fixture = setupFixture(t)
  fixture.writeSetup('owner_pending')
  fixture.writeAuthority()
  assert.equal(fixture.read().status, 'ready')
})

test('a completed Bar does not depend on a live service readiness response', (t) => {
  const fixture = setupFixture(t)
  fixture.writeSetup('complete')
  // The local service endpoint in the authority fixture is not running. The
  // chooser reads durable owner completion and does not downgrade Ready.
  fixture.writeAuthority()
  assert.equal(fixture.read().status, 'ready')
})

test('an unmatched saved attempt remains visible without matching by name', (t) => {
  const fixture = setupFixture(t)
  fixture.writeSetup('installed', 'New Business')
  const entry = fixture.read()
  assert.equal(entry.status, 'draft')
  assert.equal(entry.label, 'New Business')
  assert.equal(entry.origin_profile_id, null)
})

test('unreadable saved setup gets recovery instead of an unsafe new-setup state', (t) => {
  const fixture = setupFixture(t)
  mkdirSync(join(fixture.barRoot, 'server-setup'), { recursive: true })
  writeFileSync(fixture.setupPath, 'not encrypted setup data')
  assert.deepEqual(fixture.read(), { status: 'recovery', label: 'Saved Bar setup', origin_profile_id: null })
})

test('only the explicitly linked Bar draft is folded into the Bar card; other profiles survive', () => {
  const barDraft = { lodge_id: profileId, status: 'draft', label: 'New Business' }
  const anotherDraft = { lodge_id: 'a78cfa1f-9343-40ec-8e28-9fc10a63ec63', status: 'draft', label: 'New Business' }
  const restaurant = { lodge_id: '2bf3e0ef-bfa2-44f0-8c5d-6513bc2f9542', status: 'ready', label: 'Restaurant' }
  const profiles = [barDraft, anotherDraft, restaurant]
  const result = projectBarChooserProfiles(profiles, { status: 'ready', origin_profile_id: profileId })
  assert.deepEqual(result.profiles, [anotherDraft, restaurant])
  assert.equal(result.hiddenDraftId, profileId)
  assert.equal(result.profiles[1], restaurant)
})

test('the protected saved link returns only its exact originating profile ID', (t) => {
  const fixture = setupFixture(t)
  fixture.writeSetup('prepared')
  fixture.writeLink()
  assert.equal(fixture.read().origin_profile_id, profileId)
})

test('explicit draft reconciliation preserves the original profile registry', (t) => {
  const fixture = setupFixture(t)
  fixture.writeSetup('complete')
  const profile = { lodge_id: profileId, status: 'draft', label: 'New Business' }
  const registryBytes = JSON.stringify({ active_lodge_id: profileId, profiles: [profile] })
  writeFileSync(join(fixture.userDataPath, 'profiles.json'), registryBytes)
  const linked = linkLocalBarChooserDraft({ userDataPath: fixture.userDataPath, safeStorage, profileId })
  assert.equal(linked.origin_profile_id, profileId)
  assert.equal(readFileSync(join(fixture.userDataPath, 'profiles.json'), 'utf8'), registryBytes)
})

test('explicit reconciliation refuses a missing profile and preserves another existing link', (t) => {
  const fixture = setupFixture(t)
  fixture.writeSetup('complete')
  writeFileSync(join(fixture.userDataPath, 'profiles.json'), JSON.stringify({ profiles: [] }))
  assert.throws(() => linkLocalBarChooserDraft({ userDataPath: fixture.userDataPath, safeStorage, profileId }), /not found/)

  const otherProfileId = 'a78cfa1f-9343-40ec-8e28-9fc10a63ec63'
  writeFileSync(join(fixture.userDataPath, 'profiles.json'), JSON.stringify({ profiles: [{ lodge_id: profileId, status: 'draft' }, { lodge_id: otherProfileId, status: 'draft' }] }))
  fixture.writeLink(otherProfileId)
  assert.throws(() => linkLocalBarChooserDraft({ userDataPath: fixture.userDataPath, safeStorage, profileId }), /different saved draft/)
  assert.equal(fixture.read().origin_profile_id, otherProfileId)
})

test('multiple genuine drafts and Restaurant profiles remain unchanged without an explicit link', () => {
  const profiles = [
    { lodge_id: profileId, status: 'draft', label: 'New Business' },
    { lodge_id: 'a78cfa1f-9343-40ec-8e28-9fc10a63ec63', status: 'draft', label: 'New Business' },
    { lodge_id: '2bf3e0ef-bfa2-44f0-8c5d-6513bc2f9542', status: 'ready', label: 'Restaurant' }
  ]
  const result = projectBarChooserProfiles(profiles, { status: 'draft', origin_profile_id: null })
  assert.equal(result.profiles, profiles)
  assert.equal(result.hiddenDraftId, null)
  assert.deepEqual(result.profiles.map((profile) => profile.label), ['New Business', 'New Business', 'Restaurant'])
})

test('the chooser has one Bar entry and only explicit new-setup handoff links a draft', () => {
  const chooser = readFileSync('src/renderer/src/components/LodgeChooser.jsx', 'utf8')
  const setup = readFileSync('src/renderer/src/components/Setup.jsx', 'utf8')
  const handoff = readFileSync('src/renderer/src/components/hospitality-pos/BarLocalSetupHandoff.jsx', 'utf8')
  const runtime = readFileSync('src/main/bar-local/electronRuntime.js', 'utf8')
  assert.doesNotMatch(chooser, /Already started a local Bar setup/)
  assert.match(chooser, /getChooserEntry/)
  assert.match(chooser, /'Open Bar'/)
  assert.match(chooser, /'Continue setup'/)
  assert.match(chooser, /This is the same Bar/)
  assert.match(chooser, /saved draft data will be kept/)
  assert.match(setup, /originProfileId=\{activeProfile\?\.status === 'draft' \? activeProfile\.lodge_id : null\}/)
  assert.match(handoff, /origin_profile_id: originProfileId/)
  assert.match(runtime, /isLocalProfileId\(originProfileId\) && runtime\.localBarChooserEntry\(\)\.status === 'none'/)
  assert.match(runtime, /safeStorage\.encryptString\(JSON\.stringify\(\{ version: 1, profile_id: originProfileId \}\)\)/)
  assert.match(runtime, /barLocal:linkChooserDraft/)
})
