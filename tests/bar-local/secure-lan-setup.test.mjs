import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { createServer } from 'node:https'
import path from 'node:path'
import { BarLocalElectronRuntime } from '../../src/main/bar-local/electronRuntime.js'
import { createHttpTransport } from '../../src/main/bar-local/client.js'
import { buildInstallerArguments } from '../../src/main/bar-local/serverSetup.js'
import { lanEndpoints } from '../../services/bar-local/dist/network.js'

test('automatic LAN plan exposes pinned HTTPS and keeps PostgreSQL off the LAN', () => {
  const args = buildInstallerArguments({ data_dir: 'C:\\Bar\\data', tls_cert_file: 'C:\\Bar\\tls\\api.crt', tls_key_file: 'C:\\Bar\\tls\\api.key', http_port: 8787 })
  assert.equal(new Map(args).get('HttpHost'), '0.0.0.0')
  assert.equal(new Map(args).get('TlsCertFile'), 'C:\\Bar\\tls\\api.crt')
  assert.ok(args.some(([name]) => name === 'LoopbackDatabase'))
  assert.ok(!args.some(([name]) => name === 'SkipFirewall'))
  const interfaces = { lan: [{ family: 'IPv4', address: '192.168.20.4', internal: false }], public: [{ family: 'IPv4', address: '8.8.8.8', internal: false }] }
  assert.deepEqual(lanEndpoints('0.0.0.0', 8787, true, interfaces), ['https://192.168.20.4:8787'])
  assert.deepEqual(lanEndpoints('0.0.0.0', 8787, false, interfaces), [])
  assert.deepEqual(lanEndpoints('127.0.0.1', 8787, true, interfaces), [])
})

test('native certificate identity survives retry and real HTTPS commissioning rejects a wrong pin', { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
  const parent = path.resolve('.tmp'); mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(path.join(parent, 'bar-lan-proof-'))
  const certificate = path.join(root, 'tls')
  const generate = () => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('services/bar-local/packaging/windows/create-api-certificate.ps1'), '-NodePath', process.execPath, '-OutputDir', certificate], { windowsHide: true, encoding: 'utf8', timeout: 30000 }))
  const identity = generate()
  assert.equal(generate().fingerprint, identity.fingerprint, 'installer retry must not rotate the saved identity')
  let calls = 0
  const server = createServer({ cert: readFileSync(path.join(certificate, 'api.crt')), key: readFileSync(path.join(certificate, 'api.key')) }, async (req, res) => {
    calls++
    let body = ''; for await (const chunk of req) body += chunk
    const payload = JSON.parse(body)
    assert.equal(payload.certificate_fingerprint, undefined, 'the transport pin is not an owner setup field')
    assert.equal(payload.owner_email, 'owner@example.test')
    res.writeHead(201, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, authority_id: '11111111-1111-4111-8111-111111111111', authority_epoch: 1, business_id: '22222222-2222-4222-8222-222222222222', outlet_id: '33333333-3333-4333-8333-333333333333', device_id: '44444444-4444-4444-8444-444444444444', owner_staff_id: '55555555-5555-4555-8555-555555555555' }))
  })
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve))
  const port = server.address().port
  const lan = Object.values(networkInterfaces()).flat().find(row => row?.family === 'IPv4' && !row.internal && /^(10\.|192\.168\.|172\.)/.test(row.address))?.address ?? '127.0.0.1'
  const wrong = createHttpTransport({ base_url: `https://${lan}:${port}`, certificate_fingerprint: '0'.repeat(64) })
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('protected:' + value), decryptString: value => value.toString().slice(10) }
  const runtime = new BarLocalElectronRuntime({ userDataPath: path.join(root, 'profile'), safeStorage, buildProductId: 'hospitality-pos' })
  try {
    await assert.rejects(wrong.get('/v1/health/live'), { code: 'TLS_FINGERPRINT_MISMATCH' })
    assert.equal(calls, 0, 'no HTTP credentials are released to an unverified peer')
    const result = await runtime.setupOwner({ base_url: `https://127.0.0.1:${port}`, certificate_fingerprint: identity.fingerprint, setup_secret: 'a local test setup secret', business_name: 'LAN fixture', outlet_name: 'Main', owner_name: 'Owner', owner_email: 'owner@example.test', owner_password: 'native local owner password', pin: '1234', device_name: 'Main PC' })
    assert.equal(result.authority_mode, 'bar_local')
    assert.equal(calls, 1)
  } finally { wrong.close(); runtime.close(); await new Promise(resolve => server.close(resolve)) }
})
