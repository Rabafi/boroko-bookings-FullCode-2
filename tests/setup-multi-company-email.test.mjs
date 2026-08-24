import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()

test('setup treats a reused email as a shared sign-in identity, not a duplicate company user', () => {
  const setup = fs.readFileSync(path.join(root, 'src/renderer/src/components/Setup.jsx'), 'utf8')
  const authUsers = fs.readFileSync(path.join(root, 'src/main/domains/authUsers.js'), 'utf8')

  assert.match(setup, /You may reuse an email already linked to another Tsa Bonno company\./)
  assert.match(setup, /Use the same password for that email; you will choose the company after sign-in\./)
  assert.doesNotMatch(setup, /IS_HOTEL_PRODUCT && \(\s*<p className="text-xs text-gray-400 mt-1">\s*You can reuse an email/)

  // There is no artificial Auth-user page cap: an existing identity must be
  // found and linked regardless of when it was created.
  assert.match(authUsers, /for \(let page = 1; ; page \+= 1\)/)
  assert.match(authUsers, /if \(users\.length < SUPABASE_AUTH_USER_PAGE_SIZE\) return null;/)

  // A create-vs-lookup race for a shared email is reconciled by re-reading
  // the Auth user, updating it, and linking this company-scoped staff row.
  assert.match(authUsers, /function isSupabaseAuthEmailAlreadyRegisteredError/)
  assert.match(authUsers, /else if \(isSupabaseAuthEmailAlreadyRegisteredError\(error\)\)/)
  assert.match(authUsers, /const existingAuthUser = await findSupabaseAuthUserByEmail\(adminClient, emailLower\);/)
  assert.match(authUsers, /authUserId = await updateSupabaseAuthStaffUser\(adminClient, existingAuthUser\.id, password, metadata\);/)
})
