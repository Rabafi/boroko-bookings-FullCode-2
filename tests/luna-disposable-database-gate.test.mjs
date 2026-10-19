import test from 'node:test'
import assert from 'node:assert/strict'
import { DisposableDatabaseBlocked, readLunaDatabaseTarget } from './helpers/luna-disposable-database.mjs'

const goodEnv = {
  LUNA_REMEDIATION_TEST_DB_URL: 'postgresql://tester:secret@127.0.0.1:54322/postgres',
  LUNA_REMEDIATION_TARGET_MARKER: 'LUNA-REMEDIATION-DISPOSABLE-v1',
  LUNA_REMEDIATION_EXPECTED_DATABASE: 'postgres',
  LUNA_REMEDIATION_EXPECTED_PROJECT_REF: 'luna-disposable-20261006'
}

test('disposable database gate requires only the explicit remediation URL, never a generic linked URL', () => {
  assert.throws(() => readLunaDatabaseTarget({ DATABASE_URL: goodEnv.LUNA_REMEDIATION_TEST_DB_URL }), DisposableDatabaseBlocked)
})

test('disposable database gate requires explicit marker, database, and project identity', () => {
  assert.deepEqual(readLunaDatabaseTarget(goodEnv), {
    connectionString: goodEnv.LUNA_REMEDIATION_TEST_DB_URL,
    expectedDatabase: 'postgres',
    expectedProjectRef: 'luna-disposable-20261006'
  })
  for (const key of ['LUNA_REMEDIATION_TARGET_MARKER', 'LUNA_REMEDIATION_EXPECTED_DATABASE', 'LUNA_REMEDIATION_EXPECTED_PROJECT_REF']) {
    const env = { ...goodEnv }
    delete env[key]
    assert.throws(() => readLunaDatabaseTarget(env), DisposableDatabaseBlocked, key)
  }
})

test('disposable database gate rejects the linked production project even with an explicit marker', () => {
  assert.throws(() => readLunaDatabaseTarget({
    ...goodEnv,
    LUNA_REMEDIATION_EXPECTED_PROJECT_REF: 'oicgpknsmtvcsjacymum'
  }), /production project is explicitly denied/)
  assert.throws(() => readLunaDatabaseTarget({
    ...goodEnv,
    LUNA_REMEDIATION_TEST_DB_URL: 'postgresql://tester:secret@oicgpknsmtvcsjacymum.supabase.co:5432/postgres'
  }), /production project is explicitly denied/)
})

test('disposable database gate rejects non-PostgreSQL and malformed targets without exposing the URL', () => {
  assert.throws(() => readLunaDatabaseTarget({ ...goodEnv, LUNA_REMEDIATION_TEST_DB_URL: 'https://example.test' }), /PostgreSQL URL/)
  assert.throws(() => readLunaDatabaseTarget({ ...goodEnv, LUNA_REMEDIATION_TEST_DB_URL: 'not-a-url' }), /valid PostgreSQL URL/)
  assert.doesNotMatch(String(() => readLunaDatabaseTarget({ ...goodEnv, LUNA_REMEDIATION_TEST_DB_URL: 'not-a-url' })), /secret/)
})
test('disposable database gate rejects the historical project even with a valid disposable marker', () => {
  assert.throws(() => readLunaDatabaseTarget({
    ...goodEnv,
    LUNA_REMEDIATION_EXPECTED_PROJECT_REF: 'hwzkwdfmoeayophaktsq'
  }), /historical project is explicitly denied/)
  assert.throws(() => readLunaDatabaseTarget({
    ...goodEnv,
    LUNA_REMEDIATION_TEST_DB_URL: 'postgresql://tester:secret@hwzkwdfmoeayophaktsq.supabase.co:5432/postgres'
  }), /historical project is explicitly denied/)
})