// The schema always contains an EMPTY test_guard table. Only a populated
// identity marker denotes a disposable test database. An unreadable marker
// throws: callers must not interpret a permissions/corruption error as empty.
export async function hasPopulatedTestGuard(client) {
  const marker = await client.query("SELECT to_regclass('bar_local.test_guard') AS marker")
  if (!marker.rows[0]?.marker) return false
  const result = await client.query('SELECT EXISTS (SELECT 1 FROM bar_local.test_guard) AS guarded')
  if (typeof result.rows[0]?.guarded !== 'boolean') throw new Error('Could not establish the test database identity.')
  return result.rows[0].guarded
}
