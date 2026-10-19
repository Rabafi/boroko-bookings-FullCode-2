import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildAccountingDisposableDesktopEnvironment,
  buildDesktopLaunchEnvironment,
  createIsolatedAccountingUserDataDir,
  getRealBackendEnv
} from '../Playwright tests/desktop/support/desktop-app.mjs'

function anonKey() {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'anon', iss: 'supabase' })}.signature`
}

function temporaryProfile() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'electron-runner-guard-'))
}

test('offline Electron allowlist drops ambient private values and rejects forbidden extra names', () => {
  const userDataDir = temporaryProfile()
  try {
    const env = buildDesktopLaunchEnvironment({
      parentEnv: { PATH: 'safe-path', SUPABASE_SERVICE_ROLE_KEY: 'private-sentinel', LUNA_REMEDIATION_TEST_DB_URL: 'db-secret' },
      userDataDir
    })
    assert.equal(env.PATH, 'safe-path')
    assert.equal(env.SUPABASE_URL, 'http://127.0.0.1:65535')
    assert.equal(Object.hasOwn(env, 'SUPABASE_SERVICE_ROLE_KEY'), false)
    assert.equal(Object.hasOwn(env, 'LUNA_REMEDIATION_TEST_DB_URL'), false)
    assert.throws(() => buildDesktopLaunchEnvironment({ userDataDir, extraEnv: { SUPABASE_SERVICE_ROLE_KEY: 'private-sentinel' } }), /unapproved environment names/)
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('online Electron launch rejects production and invalid public-key targets', () => {
  const userDataDir = temporaryProfile()
  const parentEnv = { PATH: process.env.PATH || '' }
  try {
    assert.throws(() => buildDesktopLaunchEnvironment({ userDataDir, parentEnv, extraEnv: {
      BOROKO_TEST_FORCE_OFFLINE: 'false', SUPABASE_URL: 'https://oicgpknsmtvcsjacymum.supabase.co', SUPABASE_ANON_KEY: anonKey()
    } }), /only approved disposable project/)
    assert.throws(() => buildDesktopLaunchEnvironment({ userDataDir, parentEnv, extraEnv: {
      BOROKO_TEST_FORCE_OFFLINE: 'false', SUPABASE_URL: 'https://repsrmlomedqrmrdsbga.supabase.co', SUPABASE_ANON_KEY: 'service-role-secret'
    } }), /public anon\/client key/)
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('Accounting live launcher requires approved public config and an empty isolated profile', () => {
  const emptyProfile = createIsolatedAccountingUserDataDir()
  try {
    assert.throws(() => buildAccountingDisposableDesktopEnvironment({ userDataDir: emptyProfile, parentEnv: {} }), /VITE_SUPABASE_URL/)
    const validParent = { VITE_SUPABASE_URL: 'https://repsrmlomedqrmrdsbga.supabase.co', VITE_SUPABASE_KEY: anonKey(), SUPABASE_SERVICE_ROLE_KEY: 'must-not-forward' }
    const env = buildAccountingDisposableDesktopEnvironment({ userDataDir: emptyProfile, parentEnv: validParent })
    assert.equal(env.BOROKO_TEST_FORCE_OFFLINE, 'false')
    assert.equal(env.BOROKO_PRODUCT, 'hospitality-pos')
    assert.equal(env.SUPABASE_URL, validParent.VITE_SUPABASE_URL)
    assert.equal(Object.hasOwn(env, 'VITE_SUPABASE_KEY'), false)
    assert.equal(Object.hasOwn(env, 'SUPABASE_SERVICE_ROLE_KEY'), false)
  } finally {
    fs.rmSync(emptyProfile, { recursive: true, force: true })
  }
  const copiedProfile = createIsolatedAccountingUserDataDir()
  try {
    fs.writeFileSync(path.join(copiedProfile, 'auth-cache.json'), '{}')
    assert.throws(() => buildAccountingDisposableDesktopEnvironment({
      userDataDir: copiedProfile,
      parentEnv: { VITE_SUPABASE_URL: 'https://repsrmlomedqrmrdsbga.supabase.co', VITE_SUPABASE_KEY: anonKey() }
    }), /new empty isolated profile/)
  } finally {
    fs.rmSync(copiedProfile, { recursive: true, force: true })
  }
})

test('live backend helper never reads repository .env or returns a non-disposable target', () => {
  const prior = { url: process.env.VITE_SUPABASE_URL, key: process.env.VITE_SUPABASE_KEY, supabaseUrl: process.env.SUPABASE_URL, anon: process.env.SUPABASE_ANON_KEY }
  try {
    delete process.env.VITE_SUPABASE_URL
    delete process.env.VITE_SUPABASE_KEY
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_ANON_KEY
    assert.deepEqual(getRealBackendEnv(), { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' })
  } finally {
    for (const [name, value] of Object.entries({ VITE_SUPABASE_URL: prior.url, VITE_SUPABASE_KEY: prior.key, SUPABASE_URL: prior.supabaseUrl, SUPABASE_ANON_KEY: prior.anon })) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})
