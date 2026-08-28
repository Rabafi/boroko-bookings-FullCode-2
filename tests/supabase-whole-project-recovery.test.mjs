import assert from 'node:assert/strict'
import { gunzipSync } from 'node:zlib'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  decryptBackupFile,
  generateBackupKeyPair
} from '../scripts/backup-crypto.mjs'
import { verifyPlainArchiveBytes } from '../scripts/verify-supabase-backup.mjs'
import {
  buildDumpCommandPlan,
  buildFunctionSourceInventory,
  buildSupabaseWholeProjectRecoveryBundle,
  createTarGzip,
  getRequiredFiles,
  getRestoreOrder,
  parseConfigKeys
} from '../scripts/supabase-whole-project-recovery.mjs'

function tarNames(bytes) {
  const names = []
  let offset = 0
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim()
    const size = parseInt(sizeText || '0', 8)
    names.push(name)
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return names
}

test('CLI plan explicitly captures managed Auth, Storage, and migration schemas', () => {
  const plan = buildDumpCommandPlan({
    dbUrl: 'postgresql://user:password@example.test/postgres',
    outputDirectory: '/tmp/recovery'
  })
  const byKind = Object.fromEntries(plan.map((step) => [step.kind, step]))

  assert.deepEqual(byKind['auth-schema'].flags, ['--schema', 'auth'])
  assert.deepEqual(byKind['auth-data'].flags, ['--schema', 'auth', '--data-only', '--use-copy'])
  assert.deepEqual(byKind['auth-storage-schema'].flags, ['--schema', 'storage'])
  assert.deepEqual(byKind['migration-history'].flags, ['--schema', 'supabase_migrations', '--data-only', '--use-copy'])
  assert.deepEqual(byKind.roles.flags, ['--role-only'])
  for (const step of plan) {
    assert.equal(step.args[0], '--yes')
    assert.match(step.args[1], /^supabase@2\.96\.0$/)
    assert.ok(step.args.includes('--db-url'))
    assert.ok(step.args.includes('--file'))
  }
})

test('required files and restore order are explicit and do not include secrets', () => {
  const files = getRequiredFiles()
  const order = getRestoreOrder()
  assert.deepEqual(files, [
    'roles.sql',
    'schema.sql',
    'auth-schema.sql',
    'auth-data.sql',
    'auth-storage-schema.sql',
    'data.sql',
    'migration-history.sql',
    'project-function-inventory.json',
    'metadata.json',
    'SHA256SUMS'
  ])
  assert.deepEqual(order, [
    'roles.sql',
    'auth-schema.sql',
    'auth-storage-schema.sql',
    'schema.sql',
    'auth-data.sql',
    'data.sql',
    'migration-history.sql'
  ])
  assert.equal(new Set(order).size, order.length)
  assert.ok(order.indexOf('auth-data.sql') < order.indexOf('data.sql'))
  assert.ok(order.indexOf('auth-storage-schema.sql') < order.indexOf('data.sql'))
  assert.ok(!files.some((file) => /secret|token|api[-_]?key|passphrase/i.test(file)))
})

test('config inventory records keys and hashes, never configuration values', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tsa-whole-project-inventory-'))
  context.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, 'supabase', 'functions', 'example'), { recursive: true })
  const secret = 'do-not-copy-this-value'
  await fs.writeFile(path.join(root, 'supabase', 'config.toml'), `project_id = "example-ref"\n[auth]\nsite_url = "https://example.test"\nsecret = "${secret}"\n`)
  await fs.writeFile(path.join(root, 'supabase', 'functions', 'example', 'index.ts'), `const secret = '${secret}'\n`)

  const keys = parseConfigKeys(await fs.readFile(path.join(root, 'supabase', 'config.toml'), 'utf8'))
  assert.ok(keys.includes('project_id'))
  assert.ok(keys.includes('auth.site_url'))
  assert.ok(keys.includes('auth.secret'))

  const inventory = await buildFunctionSourceInventory({ repositoryRoot: root })
  const serialized = JSON.stringify(inventory)
  assert.equal(inventory.project_ref, 'example-ref')
  assert.deepEqual(inventory.functions.map((entry) => entry.name), ['example'])
  assert.equal(inventory.functions[0].files[0].path, 'supabase/functions/example/index.ts')
  assert.ok(inventory.functions[0].files[0].sha256)
  assert.equal(serialized.includes(secret), false)
  assert.equal(serialized.includes('https://example.test'), false)
  assert.equal(inventory.remote_deployment.status, 'not-queried')
})

test('bundle contains required files, checksums, and metadata restore order while excluding secrets', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tsa-whole-project-bundle-'))
  context.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, 'supabase', 'functions', 'example'), { recursive: true })
  await fs.writeFile(path.join(root, 'supabase', 'config.toml'), 'project_id = "example-ref"\n[auth]\nsite_url = "https://example.test"\n')
  await fs.writeFile(path.join(root, 'supabase', 'functions', 'example', 'index.ts'), 'export default () => new Response("ok")\n')

  const passphrase = 'whole project recovery test passphrase'
  const pair = generateBackupKeyPair(passphrase)
  const databaseUrl = 'postgresql://backup-user:backup-password@example.test/postgres'
  const publicKeyB64 = Buffer.from(pair.publicKey).toString('base64')
  const dumpContent = {
    roles: '-- roles\n',
    schema: '-- public schema\n',
    'auth-schema': '-- auth schema\n',
    'auth-data': '-- auth data\n',
    'auth-storage-schema': '-- storage schema\n',
    data: '-- public data\n',
    'migration-history': '-- migration history\n'
  }
  const seenEnvironments = []
  const commandRunner = async ({ args, spec, env }) => {
    assert.equal(args.includes(databaseUrl), true)
    seenEnvironments.push(env)
    const target = args[args.indexOf('--file') + 1]
    await fs.writeFile(target, dumpContent[spec.kind])
  }

  const result = await buildSupabaseWholeProjectRecoveryBundle({
    dbUrl: databaseUrl,
    publicKeyB64,
    repositoryRoot: root,
    outputDirectory: 'recovery-output',
    repository: 'example/repository',
    commit: 'abcdef123456',
    runId: '42',
    commandRunner
  })
  assert.ok(result.encryptedBytes > 0)
  assert.equal(seenEnvironments.length, 7)
  for (const env of seenEnvironments) {
    assert.equal(Object.hasOwn(env, 'SUPABASE_ACCESS_TOKEN'), false)
    assert.equal(Object.hasOwn(env, 'SUPABASE_BACKUP_DB_URL'), false)
    assert.equal(Object.hasOwn(env, 'BACKUP_ENCRYPTION_PUBLIC_KEY_B64'), false)
    assert.equal(Object.hasOwn(env, 'CLOUDFLARE_R2_SECRET_ACCESS_KEY'), false)
  }
  assert.deepEqual(result.requiredFiles, getRequiredFiles())
  assert.deepEqual(result.restoreOrder, getRestoreOrder())
  assert.equal((await fs.readdir(path.join(root, 'recovery-output'))).length, 1)

  const decrypted = path.join(root, 'decrypted.tar.gz')
  await decryptBackupFile({
    inputPath: result.encryptedPath,
    outputPath: decrypted,
    privateKeyPem: pair.privateKey,
    passphrase
  })
  const archive = gunzipSync(await fs.readFile(decrypted))
  const names = tarNames(archive)
  assert.deepEqual(names, [...getRequiredFiles()].sort((left, right) => left < right ? -1 : left > right ? 1 : 0))
  const verification = verifyPlainArchiveBytes(await fs.readFile(decrypted))
  assert.equal(verification.checksums_verified, true)
  assert.deepEqual(verification.metadata.contents, getRequiredFiles().filter((file) => file !== 'SHA256SUMS'))
  const archiveText = archive.toString('utf8')
  assert.equal(archiveText.includes(databaseUrl), false)
  assert.equal(archiveText.includes(pair.privateKey), false)
  assert.equal(archiveText.includes(passphrase), false)
  assert.match(archiveText, /"restore_order": \[/)
  assert.match(archiveText, /SHA256SUMS/)
})

test('tar builder rejects duplicate or unsafe entries', () => {
  assert.throws(() => createTarGzip([{ name: 'same.sql', content: 'one' }, { name: 'same.sql', content: 'two' }]), /duplicate entry/i)
  assert.throws(() => createTarGzip([{ name: '../secret.sql', content: 'secret' }]), /invalid|unsafe/i)
})
