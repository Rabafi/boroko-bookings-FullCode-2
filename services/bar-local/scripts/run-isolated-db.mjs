// A new cluster per run: never discovers, resets, or reuses an application DB.
// Deliberately not named test-*.mjs: Node's default discovery would execute
// this orchestration script recursively as a test and create another cluster.
import { randomBytes } from 'node:crypto'
import { mkdir, stat, statfs, readFile, writeFile, appendFile, realpath, rm } from 'node:fs/promises'
import { openSync, closeSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

if (process.env.NODE_TEST_CONTEXT) throw new Error('The isolated database runner must be invoked directly, outside node --test discovery.')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const pgIndex = process.argv.indexOf('--pg-bin')
const testFiles=[]
for(let i=2;i<process.argv.length;i++){
 if(process.argv[i]!=='--test-file')continue
 const file=process.argv[++i]
 if(!file||!/^[a-z0-9-]+\.test\.mjs$/i.test(file)||testFiles.includes(file)){
  throw new Error('Each --test-file must name a distinct file inside services/bar-local/tests without directory or shell syntax.')
 }
 testFiles.push(file)
}
const pgBin = path.resolve(pgIndex >= 0 ? process.argv[pgIndex + 1] ?? '' : process.env.BAR_LOCAL_PG_BIN ?? path.join(root, 'services/bar-local/.local/pg17runtime/pgsql/bin'))
const suffix = process.platform === 'win32' ? '.exe' : ''
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`
const work = path.join(root, '.tmp', 'bar-isolated-tests', runId)
const data = path.join(work, 'pg-data')
await mkdir(work, { recursive: true })
// Repeated schema resets and physical backup fixtures need temporary headroom.
// Never start a destructive test cluster when its volume is already constrained.
const volume = await statfs(work, { bigint: true })
const freeBytes = volume.bavail * volume.bsize
// The measured full synthetic cluster is under 0.5 GiB; reserve 4 GiB for
// schema-reset WAL, restore copies and temporary dumps. This is test headroom,
// never a commissioning capacity estimate for a real bar.
const requiredBytes = 4n * 1024n * 1024n * 1024n
if (freeBytes < requiredBytes) {
  throw new Error(`Isolated database tests require at least 4 GiB free; available ${(Number(freeBytes) / 1024 ** 3).toFixed(2)} GiB. No cluster was initialized. Free space outside active application databases before retrying.`)
}
await writeFile(path.join(work, 'disk-preflight.json'), JSON.stringify({available_bytes:freeBytes.toString(),required_bytes:requiredBytes.toString()},null,2))
const port = await new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close(() => resolve(address.port))
  })
})
const database = `bar_local_test_${randomBytes(8).toString('hex')}`
const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (/^(BAR_LOCAL_|PG|DATABASE_URL$|SUPABASE_)/.test(key)) delete env[key]
}
Object.assign(env, {
  // Several config-level service tests intentionally use the guarded
  // bar_local_test_* database name without connecting to PostgreSQL. Keep the
  // explicit disposable-target opt-in confined to this isolated runner.
  BAR_LOCAL_TEST_DB: '1', BAR_LOCAL_ALLOW_TEST_DB: '1', BAR_LOCAL_DB_HOST: '127.0.0.1', BAR_LOCAL_DB_PORT: String(port),
  BAR_LOCAL_DB_NAME: database, BAR_LOCAL_TEST_CLUSTER_DATA: data,
  BAR_LOCAL_MIGRATOR_USER: 'bar_local_migrator', BAR_LOCAL_RUNTIME_USER: 'bar_local_runtime',
  BAR_LOCAL_BOOTSTRAP_USER: 'postgres', BAR_LOCAL_SETUP_SECRET: randomBytes(32).toString('hex'),
  BAR_LOCAL_PG_BIN: pgBin, PATH: pgBin + path.delimiter + process.env.PATH
})
const results = []
async function run(name, command, args, timeoutMs = 1_800_000) {
  const log = path.join(work, `${name}.log`)
  const fd = openSync(log, 'wx')
  const start = Date.now()
  let result
  try {
    result = await new Promise((resolve) => {
      const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', fd, fd] })
      let error
      const timer = setTimeout(() => { error = 'Command timeout'; child.kill() }, timeoutMs)
      child.once('error', (cause) => { error = cause.message })
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, error }) })
    })
  } finally { closeSync(fd) }
  results.push({ name, ...result, seconds: (Date.now() - start) / 1000, log })
  await writeFile(path.join(work, 'results.json'), JSON.stringify(results, null, 2))
  console.log(`${name}: ${result.code === 0 ? 'PASS' : 'FAIL'} (${log})`)
  if (result.code !== 0) throw new Error(`${name} failed: ${result.error ?? result.code}; see ${log}`)
}
let started = false
let testsPassed = false
let dataRetired = false
async function assertIdentity() {
  const client = new pg.Client({ host: '127.0.0.1', port, database: 'postgres', user: 'postgres', connectionTimeoutMillis: 5000 })
  await client.connect()
  try {
    const row = (await client.query("SELECT current_setting('data_directory') AS data, current_setting('port') AS port, version() AS version")).rows[0]
    if (path.resolve(row.data).toLowerCase() !== data.toLowerCase() || Number(row.port) !== port) throw new Error('Refusing operation: disposable cluster identity mismatch')
    await writeFile(path.join(work, 'identity.json'), JSON.stringify(row, null, 2))
  } finally { await client.end() }
}
try {
  for (const binary of ['initdb', 'pg_ctl', 'pg_dump', 'pg_restore']) await stat(path.join(pgBin, binary + suffix))
  await writeFile(path.join(work, 'target.json'), JSON.stringify({ data, port, database, pgBin }, null, 2))
  await run('initdb', path.join(pgBin, 'initdb' + suffix), ['-D', data, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--no-locale'])
  await appendFile(path.join(data, 'postgresql.conf'), `\nlisten_addresses='127.0.0.1'\nport=${port}\nfsync=on\nfull_page_writes=on\nsynchronous_commit=on\n`)
  try {
    await run('start', path.join(pgBin, 'pg_ctl' + suffix), ['-D', data, '-l', path.join(work, 'postgres.log'), '-w', 'start'], 60_000)
  } catch (cause) {
    // Some managed Windows tokens cannot be restricted again by pg_ctl. Start
    // only this nonce-named test cluster directly, then prove its identity
    // before bootstrap. All disk, loopback, target and shutdown guards remain.
    const startLog = await readFile(path.join(work, 'start.log'), 'utf8')
    if (process.platform !== 'win32' || !/could not create restricted token: error code 87/.test(startLog)) throw cause
    await stat(path.join(pgBin, 'postgres' + suffix))
    const log = path.join(work, 'start-direct.log')
    const fd = openSync(log, 'wx')
    let child
    let startupError
    try {
      child = spawn(path.join(pgBin, 'postgres' + suffix), ['-D', data], { cwd: root, env, windowsHide: true, stdio: ['ignore', fd, fd] })
      child.once('error', (error) => { startupError = error })
    } finally { closeSync(fd) }
    const begin = Date.now()
    let verified = false
    while (Date.now() - begin < 60_000) {
      if (startupError || child.exitCode !== null) break
      try { await assertIdentity(); verified = true; break } catch (error) {
        if (/identity mismatch/i.test(error.message)) { startupError = error; break }
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (!verified) {
      // This reference belongs to the exact child spawned above; never find
      // or stop another PostgreSQL process on this computer.
      child.kill()
      throw startupError ?? new Error(`Direct isolated PostgreSQL startup did not verify; see ${log}`)
    }
    started = true
    results.push({ name: 'start-direct', code: 0, seconds: (Date.now() - begin) / 1000, log, reason: 'pg_ctl restricted-token error 87; direct child identity verified' })
    await writeFile(path.join(work, 'results.json'), JSON.stringify(results, null, 2))
    console.log(`start-direct: PASS (${log}; exact disposable identity verified)`)
  }
  started = true
  await assertIdentity()
  await run('bootstrap', process.execPath, ['services/bar-local/scripts/bootstrap-local.mjs'])
  if (testFiles.length>0) {
    for(const testFile of testFiles)await stat(path.join(root, 'services/bar-local/tests', testFile))
    await run('service-build', process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run bar-local:build'] : ['run', 'bar-local:build'])
    await run('service-tests', process.execPath, ['--test', '--test-force-exit', '--test-concurrency=1', ...testFiles.map(file=>path.join(root,'services/bar-local/tests',file))], 3_600_000)
  } else {
    await run('service-tests', process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run bar-local:test'] : ['run', 'bar-local:test'], 3_600_000)
  }
  testsPassed = true
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (started) {
    try {
      await assertIdentity()
      await run('stop', path.join(pgBin, 'pg_ctl' + suffix), ['-D', data, '-m', 'fast', '-w', 'stop'], 60_000)
      if(testsPassed && !process.argv.includes('--retain-data')){
        // Only this nonce-named, identity-verified, positively stopped cluster.
        // Keep logs and target identity; never accumulate successful DB copies.
        if(path.resolve(await realpath(data))!==path.resolve(data)
          ||!data.startsWith(work+path.sep)||existsSync(path.join(data,'postmaster.pid'))){
          throw new Error('Refusing fixture retirement: stopped data-directory identity is uncertain')
        }
        await rm(data,{recursive:true})
        await writeFile(path.join(work,'retired-data.json'),JSON.stringify({data,database,retired_at:new Date().toISOString(),reason:'Successful disposable run; logs retained'},null,2))
        dataRetired=true
      }
    } catch (error) { console.error(`Disposable cluster cleanup requires attention: ${error.message}`); process.exitCode = 1 }
  }
  console.log(`${dataRetired?'Evidence retained; successful disposable data retired':'Evidence and disposable data retained'} at ${work}`)
}
