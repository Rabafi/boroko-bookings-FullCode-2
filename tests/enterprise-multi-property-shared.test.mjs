import test from 'node:test'
import assert from 'node:assert/strict'

async function readSQL() {
  const fs = await import('fs')
  return fs.readFileSync(
    new URL('../supabase/migrations/20260705205000_multi_property_shared_profiles.sql', import.meta.url),
    'utf8'
  )
}

async function readDomain() {
  const fs = await import('fs')
  return fs.readFileSync(
    new URL('../src/main/domains/multiProperty.js', import.meta.url),
    'utf8'
  )
}

async function readMain() {
  const fs = await import('fs')
  return fs.readFileSync(
    new URL('../src/main/index.js', import.meta.url),
    'utf8'
  )
}

async function readPreload() {
  const fs = await import('fs')
  return fs.readFileSync(
    new URL('../src/preload/index.js', import.meta.url),
    'utf8'
  )
}

test('shared profiles migration file exists', async () => {
  const sql = await readSQL()
  assert.ok(sql.length > 0, 'migration file has content')
})

test('creates shared_guest_profiles table', async () => {
  const sql = await readSQL()
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS shared_guest_profiles'), 'shared_guest_profiles table')
  assert.ok(sql.includes('UNIQUE(group_id, guest_id)'), 'unique constraint on group_id, guest_id')
})

test('creates shared_blacklist table', async () => {
  const sql = await readSQL()
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS shared_blacklist'), 'shared_blacklist table')
  assert.ok(sql.includes('CONSTRAINT at_least_one_identifier'), 'check constraint for identifiers')
})

test('creates shared_corporate_accounts table', async () => {
  const sql = await readSQL()
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS shared_corporate_accounts'), 'shared_corporate_accounts table')
  assert.ok(sql.includes('UNIQUE(group_id, corporate_account_id)'), 'unique constraint')
  assert.ok(sql.includes("CHECK (share_level IN ('read', 'write', 'full'))"), 'share_level check constraint')
})

test('has all 10+ RPCs', async () => {
  const sql = await readSQL()
  const expectedRPCs = [
    'get_shared_guest_profiles',
    'share_guest_profile',
    'unshare_guest_profile',
    'get_shared_blacklist',
    'add_blacklist_entry',
    'remove_blacklist_entry',
    'get_shared_corporate_accounts',
    'share_corporate_account',
    'unshare_corporate_account',
    'get_group_member_lodges'
  ]
  for (const rpc of expectedRPCs) {
    assert.ok(sql.includes(`CREATE OR REPLACE FUNCTION ${rpc}`), `RPC ${rpc} exists`)
  }
})

test('RPCs use app_require_lodge_role', async () => {
  const sql = await readSQL()
  assert.ok(sql.includes('app_require_lodge_role'), 'uses app_require_lodge_role')
  const rpcCount = (sql.match(/CREATE OR REPLACE FUNCTION /g) || []).length
  const lodgeRoleCount = (sql.match(/app_require_lodge_role/g) || []).length
  assert.equal(lodgeRoleCount, rpcCount, 'every RPC has app_require_lodge_role')
})

test('enables RLS on all tables', async () => {
  const sql = await readSQL()
  assert.ok(sql.includes('shared_guest_profiles ENABLE ROW LEVEL SECURITY'), 'RLS on shared_guest_profiles')
  assert.ok(sql.includes('shared_blacklist ENABLE ROW LEVEL SECURITY'), 'RLS on shared_blacklist')
  assert.ok(sql.includes('shared_corporate_accounts ENABLE ROW LEVEL SECURITY'), 'RLS on shared_corporate_accounts')
})

test('grants execute to authenticated', async () => {
  const sql = await readSQL()
  const authGrants = (sql.match(/GRANT EXECUTE ON FUNCTION .+ TO authenticated/g) || []).length
  const svcGrants = (sql.match(/GRANT EXECUTE ON FUNCTION .+ TO service_role/g) || []).length
  assert.ok(authGrants >= 10, 'authenticated grants for all RPCs')
  assert.ok(svcGrants >= 10, 'service_role grants for all RPCs')
})

test('domain file exports new functions', async () => {
  const src = await readDomain()
  const expectedExports = [
    'getSharedGuestProfiles',
    'shareGuestProfile',
    'unshareGuestProfile',
    'getSharedBlacklist',
    'addBlacklistEntry',
    'removeBlacklistEntry',
    'getSharedCorporateAccounts',
    'shareCorporateAccount',
    'unshareCorporateAccount',
    'getGroupMemberLodges'
  ]
  for (const fn of expectedExports) {
    assert.ok(
      src.includes(`export async function ${fn}`) || src.includes(`export const ${fn}`),
      `exports ${fn}`
    )
  }
  assert.ok(src.includes('dedupePromise'), 'uses dedupePromise')
})

test('IPC handlers exist for new methods', async () => {
  const src = await readMain()
  const expectedHandlers = [
    'multiProperty:getSharedGuestProfiles',
    'multiProperty:shareGuestProfile',
    'multiProperty:unshareGuestProfile',
    'multiProperty:getSharedBlacklist',
    'multiProperty:addBlacklistEntry',
    'multiProperty:removeBlacklistEntry',
    'multiProperty:getSharedCorporateAccounts',
    'multiProperty:shareCorporateAccount',
    'multiProperty:unshareCorporateAccount',
    'multiProperty:getGroupMemberLodges'
  ]
  for (const h of expectedHandlers) {
    assert.ok(src.includes(`'${h}'`), `handler ${h} exists`)
  }

  assert.ok(src.includes("requireCapabilityOrDevEnterprisePreview('multi_property.view')"), 'view handlers use preview')
  assert.ok(src.includes("requireCapability('multi_property.manage')"), 'manage handlers use requireCapability')
})

test('preload has new methods in multiProperty section', async () => {
  const src = await readPreload()
  const expectedMethods = [
    'getSharedGuestProfiles',
    'shareGuestProfile',
    'unshareGuestProfile',
    'getSharedBlacklist',
    'addBlacklistEntry',
    'removeBlacklistEntry',
    'getSharedCorporateAccounts',
    'shareCorporateAccount',
    'unshareCorporateAccount',
    'getGroupMemberLodges'
  ]
  for (const m of expectedMethods) {
    assert.ok(src.includes(m), `preload method ${m} exists`)
  }
})
