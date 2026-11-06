import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  createVerifiedDisposableClient,
  DisposableDatabaseBlocked,
  readLunaDatabaseTarget
} from './helpers/luna-disposable-database.mjs'

const goodEnv = {
  LUNA_REMEDIATION_TEST_DB_URL: 'postgresql://tester:secret@db.repsrmlomedqrmrdsbga.supabase.co:5432/postgres',
  LUNA_REMEDIATION_TARGET_MARKER: 'LUNA-REMEDIATION-DISPOSABLE-v1',
  LUNA_REMEDIATION_EXPECTED_DATABASE: 'postgres',
  LUNA_REMEDIATION_EXPECTED_PROJECT_REF: 'repsrmlomedqrmrdsbga'
}

test('disposable database gate requires only the explicit remediation URL, never a generic linked URL', () => {
  assert.throws(() => readLunaDatabaseTarget({ DATABASE_URL: goodEnv.LUNA_REMEDIATION_TEST_DB_URL }), DisposableDatabaseBlocked)
})

test('disposable database gate requires explicit marker, database, and project identity', () => {
  assert.deepEqual(readLunaDatabaseTarget(goodEnv), {
    connectionString: goodEnv.LUNA_REMEDIATION_TEST_DB_URL,
    expectedDatabase: 'postgres',
    expectedProjectRef: 'repsrmlomedqrmrdsbga'
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
  assert.throws(() => readLunaDatabaseTarget({
    ...goodEnv,
    LUNA_REMEDIATION_TEST_DB_URL: 'postgresql://tester:secret@other-project.supabase.co:5432/postgres'
  }), /host and account must identify the approved/)
  for (const query of [
    'sslmode=disable',
    'sslmode=no-verify',
    'host=127.0.0.1',
    'user=another-project',
    'port=6432',
    'ssl=true'
  ]) {
    assert.throws(() => readLunaDatabaseTarget({
      ...goodEnv,
      LUNA_REMEDIATION_TEST_DB_URL: `${goodEnv.LUNA_REMEDIATION_TEST_DB_URL}?${query}`
    }), DisposableDatabaseBlocked, query)
  }
  assert.doesNotMatch(String(() => readLunaDatabaseTarget({ ...goodEnv, LUNA_REMEDIATION_TEST_DB_URL: 'not-a-url' })), /secret/)
})

test('required property-transition database command exits blocked for a configured invalid URL', () => {
  const packageRoot = fileURLToPath(new URL('..', import.meta.url))
  const npmCommand = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm'
  const npmArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run test:property-transition-db']
    : ['run', 'test:property-transition-db']
  const result = spawnSync(npmCommand, npmArgs, {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...goodEnv,
      LUNA_REMEDIATION_TEST_DB_URL: 'not-a-postgresql-url'
    }
  })

  assert.equal(result.status, 2, `expected blocked exit 2; stdout=${result.stdout}; stderr=${result.stderr}`)
  assert.match(result.stderr, /BLOCKED property-transitions-disposable/)
  assert.doesNotMatch(result.stdout + result.stderr, /SKIP|all checks passed/)
  assert.doesNotMatch(result.stdout + result.stderr, /tester:secret/)
})

test('required campsite quotation database command cannot report a missing database as a skip', () => {
  const packageRoot = fileURLToPath(new URL('..', import.meta.url))
  const env = { ...process.env }
  for (const key of [
    'LUNA_REMEDIATION_TEST_DB_URL',
    'LUNA_REMEDIATION_TARGET_MARKER',
    'LUNA_REMEDIATION_EXPECTED_DATABASE',
    'LUNA_REMEDIATION_EXPECTED_PROJECT_REF'
  ]) delete env[key]
  const result = spawnSync(process.execPath, ['scripts/verify-campsite-quotation-disposable.mjs'], {
    cwd: packageRoot,
    encoding: 'utf8',
    env
  })

  assert.equal(result.status, 2, `expected blocked exit 2; stdout=${result.stdout}; stderr=${result.stderr}`)
  assert.match(result.stdout + result.stderr, /BLOCKED campsite-quotation-disposable/)
  assert.doesNotMatch(result.stdout + result.stderr, /# SKIP|no disposable database\)/)
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

test('disposable database gate is pinned to the approved LodgingOS project', () => {
  assert.throws(() => readLunaDatabaseTarget({
    ...goodEnv,
    LUNA_REMEDIATION_EXPECTED_PROJECT_REF: 'another-disposable-project'
  }), /approved LodgingOS remediation disposable project/)
})

test('approved Supabase pooler target must name the pinned project in its username', () => {
  const pooler = 'postgresql://postgres.repsrmlomedqrmrdsbga:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres'
  assert.equal(readLunaDatabaseTarget({ ...goodEnv, LUNA_REMEDIATION_TEST_DB_URL: pooler }).expectedProjectRef,
    'repsrmlomedqrmrdsbga')
  assert.throws(() => readLunaDatabaseTarget({
    ...goodEnv,
    LUNA_REMEDIATION_TEST_DB_URL: 'postgresql://postgres.wrongproject:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres'
  }), /host and account must identify the approved/)
})

test('pg receives only explicitly validated endpoint credentials and verified TLS options', () => {
  const { client } = createVerifiedDisposableClient(goodEnv)
  const { connectionParameters } = client
  assert.equal(connectionParameters.host, 'db.repsrmlomedqrmrdsbga.supabase.co')
  assert.equal(connectionParameters.port, 5432)
  assert.equal(connectionParameters.user, 'tester')
  assert.equal(connectionParameters.database, 'postgres')
  assert.equal(connectionParameters.ssl.rejectUnauthorized, true)
  assert.throws(() => createVerifiedDisposableClient({
    ...goodEnv,
    LUNA_REMEDIATION_TEST_DB_URL: `${goodEnv.LUNA_REMEDIATION_TEST_DB_URL}?host=127.0.0.1&sslmode=disable`
  }), DisposableDatabaseBlocked)
})

test('quotation SQL mismatch probe rolls back its expected database error to a savepoint', () => {
  const sqlTest = fs.readFileSync(new URL('./campsite-quotation-conversion-sql.test.mjs', import.meta.url), 'utf8')
  assert.match(sqlTest, /savepoint quoted_total_mismatch[\s\S]*?assert\.rejects\([\s\S]*?rollback to savepoint quoted_total_mismatch[\s\S]*?release savepoint quoted_total_mismatch/)
})
