// Reuse only an owned synthetic encrypted backup; each drill still creates a
// fresh nonce database. The stopped source cluster is never started or edited.
import assert from 'node:assert/strict'
import { readFile, realpath, access, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SERVICE_ROOT } from '../dist/config.js'
import { runPointInTimeDrill } from '../dist/operations/recovery.js'

const fixture = path.resolve(process.argv[2] ?? '')
const root = path.resolve(SERVICE_ROOT, '../../.tmp')
if (!/^pr-[a-f0-9]{8}$/.test(path.basename(fixture)) || path.dirname(fixture) !== root || await realpath(fixture) !== fixture) throw new Error('Only a nonce-owned recovery test fixture inside this checkout is accepted.')
const owner = JSON.parse(await readFile(path.join(fixture, 'fixture-owner.json'), 'utf8'))
if (!/^bar_local_test_[a-f0-9]{16}$/.test(owner.database) || !path.resolve(owner.source_data).startsWith(path.join(root, 'bar-isolated-tests') + path.sep)) throw new Error('Synthetic source identity is invalid.')
await access(path.join(owner.source_data, 'postmaster.pid')).then(() => { throw new Error('The source test cluster must be stopped.') }, error => { if (error.code !== 'ENOENT') throw error })
const id = process.argv[3]
const target = process.argv[4]
const config = { service: { root: SERVICE_ROOT }, db: { host: '127.0.0.1', port: 55499, database: owner.database, user: 'bar_local_runtime', password: 'isolated-trust-fixture' }, backup: { dir: fixture, keyFile: path.join(fixture, 'backup.key'), migrationsDir: path.join(SERVICE_ROOT, 'db/migrations') }, replication: { pgBin: path.join(SERVICE_ROOT, '.local/pg17runtime/pgsql/bin') }, recovery: { walDir: path.join(fixture, 'wal'), walKeyFile: path.join(fixture, 'wal.key') } }
const report = await runPointInTimeDrill(config, id, target, async client => {
  assert.deepEqual((await client.query('SELECT id FROM public.recovery_probe ORDER BY id')).rows.map(row => row.id), [1, 2])
})
await writeFile(path.join(fixture, 'retained-fixture-verification.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
