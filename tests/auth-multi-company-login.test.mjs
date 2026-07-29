/**
 * Multi-company hospitality-pos login contract.
 * Proves company selection is a definitive online result (not offline fallback)
 * and that a cached local profile cannot silently select a company.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const authLogin = fs.readFileSync(path.join(root, 'src/main/domains/authLogin.js'), 'utf8')

test('login requires an explicit company selection when selectedLodgeId is omitted', () => {
  assert.match(authLogin, /effectiveLodgeId/)
  assert.match(
    authLogin,
    /const effectiveLodgeId = normalizeLodgeId\(selectedLodgeId\);/
  )
  assert.doesNotMatch(authLogin, /normalizeLodgeId\(selectedLodgeId\) \|\| normalizeLodgeId\(state\.lodgeId\)/)
})

test('company_selection_required is never hidden behind offline-session fallback', () => {
  assert.match(authLogin, /definitiveOnlineCodes/)
  assert.match(authLogin, /'company_selection_required'/)
  assert.match(authLogin, /'invalid_company_selection'/)
  assert.match(authLogin, /'multi_company_login_unavailable'/)

  // The old narrow hard-fail list must not be the only gate before offline fallback.
  const offlineBlock = authLogin.slice(
    authLogin.indexOf('definitiveOnlineCodes'),
    authLogin.indexOf('offline fallback decision')
  )
  assert.match(offlineBlock, /company_selection_required/)
  assert.match(offlineBlock, /definitiveOnlineCodes\.has\(online\.code\)/)
})

test('supabase membership resolution requires a picker choice instead of using the active profile', () => {
  assert.match(
    authLogin,
    /const requestedLodgeId = normalizeLodgeId\(selectedLodgeId\);/
  )
  assert.doesNotMatch(authLogin, /activeLodgeId && memberships\.some/)
  assert.match(
    authLogin,
    /This email belongs to more than one restaurant\/bar company/
  )
})

test('Login UI still handles company_selection_required membership picker', () => {
  const login = fs.readFileSync(path.join(root, 'src/renderer/src/components/Login.jsx'), 'utf8')
  assert.match(login, /company_selection_required/)
  assert.match(login, /setCompanyChoices/)
  assert.match(login, /handleSelectCompany/)
  assert.match(login, /lodge_display_name/)
})
