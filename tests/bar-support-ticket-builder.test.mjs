import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const admin = fs.readFileSync(path.join(root, 'src/main/domains/admin.js'), 'utf8')

test('support ticket message inserts never chain .catch on the query builder', () => {
  // PostgREST builders are thenable via await but implement no .catch, so
  // `builder.catch()` throws AFTER the ticket row already exists — the
  // operator sees a scary error for a request that actually filed.
  assert.doesNotMatch(
    admin,
    /\.insert\(\{[\s\S]{0,500}\}\)\.catch\(/,
    'Fire-and-forget message inserts must not call .catch on the builder itself'
  )
  const guarded = admin.match(/try \{\s*await (?:state\.adminDb|requireAdmin\(\))\.from\('support_ticket_messages'\)\.insert\(/g) || []
  assert.equal(guarded.length, 2, 'Both support message inserts (lodge create + CC update) must await inside try/catch')
})

test('builder semantics prove the rule: await resolves, bare .catch throws', async () => {
  // Faithful postgrest-js shape: a thenable with no .catch method.
  const builder = {
    then(resolve) {
      resolve({ data: { id: 'ticket-1' }, error: null })
    }
  }
  assert.equal(typeof builder.catch, 'undefined')
  const { data, error } = await builder
  assert.equal(data?.id, 'ticket-1')
  assert.equal(error, null)
  assert.throws(() => builder.catch(() => {}), TypeError)
})

test('ticket creation still confirms its id and fails closed offline', () => {
  assert.match(admin, /if \(!state\.isOnline\) throw new Error\('Requires internet connection'\)/, 'Creation must refuse while offline')
  assert.match(admin, /rpc\('create_support_ticket'/, 'The anon-path creation RPC must stay wired')
  assert.match(admin, /return \{ success: true, id: data\?\.id \|\| null \}/, 'Creation must return the confirmed ticket id')
})
