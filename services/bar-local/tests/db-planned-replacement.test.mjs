import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, access } from 'node:fs/promises'
import pg from 'pg'
import { createHarness } from './harness.mjs'
import { SERVICE_ROOT } from '../dist/config.js'
import { enrollStandby, switchover } from '../dist/operations/replication.js'
import { hashPin } from '../dist/pin.js'
import { loadConfig } from '../dist/config.js'
import { startServer } from '../dist/server.js'
import { verifyBarReplacement } from '../../../src/shared/barLocalReplacement.js'

const exec = promisify(execFile)
test('physical replacement preserves acknowledged sale and fences every old runtime login', { timeout: 900000 }, async t => {
  const h = await createHarness(t)
  const verifier = hashPin('1234', 100000)
  await h.migrator.query('UPDATE bar_local.staff SET pin_hash=$2,pin_salt=$3,pin_iterations=$4 WHERE id=$1', [h.ownerStaffId, verifier.pin_hash, verifier.pin_salt, verifier.pin_iterations])
  const shift = await h.openShift('100.00')
  const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', { sku: 'REPLACEMENT', name: 'Replacement fixture', price: '10.00', tax_rate: '0', track_stock: false }))
  const sale = await h.call('cmd_sale_commit', h.envelope('sale.commit', { shift_id: shift, items: [{ product_id: product.result.product_id, quantity: '1' }], tenders: [{ method: 'cash', amount: '10.00' }] }))
  assert.equal(sale.ok, true)
  const target = h.target
  await h.runtime.end(); await h.migrator.end()
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
  const data = path.resolve(SERVICE_ROOT, '../../.tmp', `sr-${randomUUID().slice(0, 8)}`)
  const primary = new URL(`postgresql://postgres@127.0.0.1:${target.port}/${target.database}`)
  const standby = new URL(primary); standby.port = String(port)
  const pgBin = process.env.BAR_LOCAL_PG_BIN
  const pgCtl = path.join(pgBin, process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl')
  t.after(async () => {
    const pid = await readFile(path.join(data, 'postmaster.pid'), 'utf8').catch(() => null)
    if (pid) {
      const lines = pid.split(/\r?\n/)
      assert.equal(path.resolve(lines[1]).toLowerCase(), data.toLowerCase()); assert.equal(Number(lines[3]), port)
      await exec(pgCtl, ['-D', data, '-m', 'fast', '-w', 'stop'], { windowsHide: true, timeout: 90000 })
    }
    // Retain the replica and receipt evidence; never remove a failed fixture.
  })
  const enrolled = await enrollStandby({ standbyDataDir: data, primaryHost: '127.0.0.1', primaryPort: target.port, replicationUser: 'postgres', standbyDatabaseUrl: standby.href, confirm: true, timeoutMs: 180000 }, { pgBin })
  assert.equal(enrolled.streaming_verified, true)
  await writeFile(path.join(data, 'fixture-owner.json'), JSON.stringify({ database: target.database, source_data: target.clusterData, acknowledged_sale: sale.result }))
  const report = await switchover({ role: 'single_host', coordinator: 'manual', adminDatabaseUrl: primary.href, standbyAdminDatabaseUrl: standby.href, pgDataDir: target.clusterData, pgBin, pgDump: 'pg_dump', pgRestore: 'pg_restore' }, { catchupTimeoutMs: 120000, promoteTimeoutSeconds: 60, fenceTimeoutMs: 30000 })
  assert.equal(report.ok, true, JSON.stringify(report))
  const old = new pg.Client({ host: '127.0.0.1', port: target.port, database: target.database, user: 'bar_local_runtime', connectionTimeoutMillis: 10000 })
  await assert.rejects(old.connect(), error => error.code === '28000')
  await old.end().catch(() => {})
  const current = new pg.Client({ connectionString: standby.href, connectionTimeoutMillis: 10000 })
  await current.connect()
  try {
    assert.equal((await current.query('SELECT authority_epoch::text AS epoch FROM bar_local.authority WHERE singleton')).rows[0].epoch, '2')
    assert.equal((await current.query('SELECT count(*)::int AS count FROM bar_local.sales')).rows[0].count, 1)
    assert.equal((await current.query('SELECT total::text AS total FROM bar_local.sales')).rows[0].total, '10.00')
    assert.equal((await current.query('SELECT bar_local.authority_fenced() AS fenced')).rows[0].fenced, false)
    assert.equal((await current.query("SELECT rolcanlogin FROM pg_roles WHERE rolname='bar_local_runtime'")).rows[0].rolcanlogin, true)
  } finally { await current.end() }
  const running = await startServer({ config: loadConfig({ ...process.env, BAR_LOCAL_ALLOW_TEST_DB: '1', BAR_LOCAL_DB_PORT: String(port), BAR_LOCAL_PG_DATA_DIR: data, BAR_LOCAL_BACKUP_DIR: `${data}-backups` }), port: 0, logger: { info() {}, error() {} } })
  try {
    const serviceUrl = `http://127.0.0.1:${running.server.address().port}`
    const exchange = async (method, route, options) => {
      const response = await fetch(serviceUrl + route, { method, headers: { 'content-type': 'application/json', ...(options.deviceToken ? { 'x-bar-device-token': options.deviceToken } : {}), ...(options.sessionToken ? { authorization: `Bearer ${options.sessionToken}` } : {}), ...(options.deviceId ? { 'x-bar-device-id': options.deviceId } : {}) }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) })
      return { status: response.status, body: await response.json() }
    }
    const original = { authority_id: h.authorityId, authority_epoch: 1, business_id: h.businessId, outlet_id: h.outletId }
    const credential = { device_id: h.deviceId, device_token: `device-${h.deviceId}` }
    const request = { staff_id: h.ownerStaffId, pin: '1234', confirm: 'RECONNECT_SERVER' }
    const endpoint = { base_url: serviceUrl, fingerprint: null }
    await assert.rejects(verifyBarReplacement({ ...original, authority_id: randomUUID() }, credential, request, exchange, endpoint))
    assert.equal((await verifyBarReplacement(original, credential, request, exchange, endpoint)).authority_epoch, 2)
  } finally { await running.close() }
})
