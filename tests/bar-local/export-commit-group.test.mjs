import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migrationUrl = new URL('../../services/bar-local/db/migrations/0045_export_complete_commit_groups.sql', import.meta.url)
const sourceMigrationUrl = new URL('../../services/bar-local/db/migrations/0023_reports_audit_export_support.sql', import.meta.url)
const apiTestUrl = new URL('../../services/bar-local/tests/api-advanced-commands.test.mjs', import.meta.url)

test('export paging selects complete commit sequences and locks the full group', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  assert.match(sql, /WITH page_groups AS \([\s\S]*GROUP BY o\.commit_sequence[\s\S]*LIMIT v_limit[\s\S]*\), picked AS/)
  assert.match(sql, /JOIN page_groups g USING \(commit_sequence\)/)
  assert.match(sql, /FOR UPDATE OF o/)
  assert.match(sql, /commit_sequence, event_index/)
  assert.doesNotMatch(sql, /ORDER BY o\.commit_sequence, o\.event_index\s+LIMIT v_limit/)
})

test('migration 0045 preserves the existing export transaction outside its selection CTE', async () => {
  const [source, migration] = await Promise.all([readFile(sourceMigrationUrl, 'utf8'), readFile(migrationUrl, 'utf8')])
  const extract = (text) => {
    const start = text.indexOf('CREATE OR REPLACE FUNCTION bar_local.cmd_export_bundle_create(')
    const end = text.indexOf('\n$$;', start) + 4
    assert.ok(start >= 0 && end > start)
    return text.slice(start, end).replace(/\r\n/g, '\n')
  }
  const oldFunction = extract(source)
  const newFunction = extract(migration)
  const oldCte = /    WITH picked AS \([\s\S]*?\), updated AS \(/
  const newCte = /    -- Select complete transaction groups\. The limit bounds commit groups, not event rows\.\n    WITH page_groups AS \([\s\S]*?\), updated AS \(/
  assert.match(oldFunction, oldCte)
  assert.match(newFunction, newCte)
  assert.equal(oldFunction.replace(oldCte, '    __EXPORT_SELECTION_CTE__'), newFunction.replace(newCte, '    __EXPORT_SELECTION_CTE__'))
})

test('database API regression creates a multi-event group and expects it intact at limit one', async () => {
  const source = await readFile(apiTestUrl, 'utf8')
  assert.match(source, /Model a multi-event transaction group/)
  assert.match(source, /export\.bundle\.create', \{ limit: 1 \}/)
  assert.match(source, /assert\.equal\(exported\.body\.result\.event_count, 2\)/)
})
