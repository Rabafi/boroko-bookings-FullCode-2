import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { verifyServerPayload } from './serverSetup.js'

type SecureStorage = { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string }
type State = { version: 1; id: string; dbPort: number; httpPort: number; password: string; runtimePassword: string; setupSecret: string; backupKey: string }
type Runner = (binary: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, signal?: AbortSignal) => Promise<void>
type Runtime = { setupOwner(request: Record<string, unknown>): Promise<unknown>; status(): { configured: boolean }; assertTrainingEndpoint(url: string): void }

export function trainingWorkspace(base: string): string {
  return path.join(path.resolve(base), 'bar-training', 'workspace')
}

/** Never inherit live DB, provider, cloud-upload, test-target or renderer URL settings. */
export function trainingEnvironment(inherited: NodeJS.ProcessEnv, root: string, state: State, pgBin: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  const operatingSystemKeys = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|COMSPEC|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS|ALLUSERSPROFILE|PROGRAMFILES(?:\(X86\))?|COMMONPROGRAMFILES(?:\(X86\))?|LANG|LC_ALL|TZ)$/i
  for (const [key, value] of Object.entries(inherited)) if (operatingSystemKeys.test(key)) env[key] = value
  Object.assign(env, {
    BAR_LOCAL_TRAINING: '1', BAR_LOCAL_TRAINING_ID: state.id,
    BAR_LOCAL_HTTP_HOST: '127.0.0.1', BAR_LOCAL_HTTP_PORT: String(state.httpPort),
    BAR_LOCAL_DB_HOST: '127.0.0.1', BAR_LOCAL_DB_PORT: String(state.dbPort), BAR_LOCAL_DB_NAME: 'bar_local_training',
    BAR_LOCAL_PG_DATA_DIR: path.join(root, 'pg-data'), BAR_LOCAL_PG_BIN: pgBin,
    BAR_LOCAL_PROVISION: '1', BAR_LOCAL_PROVISION_UPGRADE: '1', BAR_LOCAL_MIGRATOR_USER: 'bar_local_migrator',
    BAR_LOCAL_MIGRATOR_PASSWORD: state.password, BAR_LOCAL_RUNTIME_USER: 'bar_local_runtime',
    BAR_LOCAL_RUNTIME_PASSWORD: state.runtimePassword, BAR_LOCAL_DB_USER: 'bar_local_runtime',
    BAR_LOCAL_DB_PASSWORD: state.runtimePassword, BAR_LOCAL_BOOTSTRAP_USER: 'postgres',
    BAR_LOCAL_BOOTSTRAP_PASSWORD: state.password, BAR_LOCAL_SETUP_SECRET: state.setupSecret,
    BAR_LOCAL_SETUP_SECRET_FILE: path.join(root, 'setup-secret.txt'),
    BAR_LOCAL_BACKUP_DIR: path.join(root, 'backups'), BAR_LOCAL_BACKUP_KEY: state.backupKey,
    BAR_LOCAL_UPDATE_STAGING_DIR: path.join(root, 'updates'), BAR_LOCAL_UPDATE_INBOX_DIR: path.join(root, 'inbox'),
    BAR_LOCAL_FAILOVER_MODE: 'disabled', BAR_LOCAL_CLOUD_SYNC_TRANSPORT: 'disabled', BAR_LOCAL_UPDATE_APPLY_ENABLED: 'false'
  })
  return env
}

async function port(): Promise<number> {
  const server = createServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') { server.close(); reject(new Error('No loopback port available.')); return }
      server.close(() => resolve(address.port))
    })
  })
}

const run: Runner = (binary, args, env, cwd, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new Error('Practice setup was cancelled.')); return }
  const log = path.join(path.dirname(env.BAR_LOCAL_PG_DATA_DIR ?? path.join(cwd, 'pg-data')), 'practice-preparation.log')
  const descriptor = openSync(log, 'a', 0o600)
  const child = spawn(binary, args, { env, cwd, windowsHide: true, stdio: ['ignore', descriptor, descriptor] })
  let settled = false
  const finish = (error?: Error) => {
    if (settled) return
    settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); closeSync(descriptor)
    error ? reject(error) : resolve()
  }
  let timedOut = false
  const cancel = () => { child.kill() }
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => { timedOut = true; child.kill() }, 180_000)
  child.once('error', () => finish(new Error('Could not start the packaged practice runtime.')))
  child.once('exit', code => {
    if (signal?.aborted || timedOut) { finish(new Error('Practice preparation stopped. Resume setup in the practice window.')); return }
    if (code === 0) { finish(); return }
    const detail = readFileSync(log, 'utf8').slice(-1800).replace(/[a-f0-9]{32,}/gi, '[redacted]')
    finish(new Error(`Practice preparation failed in ${path.basename(binary)} (exit ${code}). ${detail}`))
  })
})

/** A completely separate cluster, credentials, service and client profile; no live clone. */
export class TrainingSupervisor {
  private readonly options: { userDataPath: string; payloadDir: string; safeStorage: SecureStorage; run?: Runner; availableBytes?: () => bigint }
  readonly root: string
  readonly data: string
  private state: State | null = null
  private service: ReturnType<typeof spawn> | null = null
  private busy = false
  private started = false
  private pgBin = ''
  private env: NodeJS.ProcessEnv = {}
  private cancellation: AbortController | null = null
  private preparation: Promise<unknown> | null = null
  constructor(options: {
    userDataPath: string; payloadDir: string; safeStorage: SecureStorage;
    run?: Runner; availableBytes?: () => bigint
  }) {
    this.options = options
    if (path.basename(options.userDataPath) !== 'workspace' || path.basename(path.dirname(options.userDataPath)) !== 'bar-training') {
      throw new Error('Practice supervisor requires the separate bar-training/workspace profile. A live profile cannot be used.')
    }
    this.root = path.join(options.userDataPath, 'practice-server')
    this.data = path.join(this.root, 'pg-data')
  }
  status() { return { training: true, running: this.started, preparing: this.busy, saved: existsSync(path.join(this.root, 'identity.bin')) } }
  private read(): State | null {
    const file = path.join(this.root, 'identity.bin')
    if (!existsSync(file)) return null
    if (!this.options.safeStorage.isEncryptionAvailable()) throw new Error('OS secure storage is required for practice mode.')
    const state = JSON.parse(this.options.safeStorage.decryptString(readFileSync(file))) as State
    if (state.version !== 1 || !/^[0-9a-f-]{36}$/.test(state.id) || !Number.isInteger(state.dbPort) || !Number.isInteger(state.httpPort) || state.dbPort < 1024 || state.httpPort < 1024 || state.dbPort > 65535 || state.httpPort > 65535 || state.dbPort === state.httpPort || ![state.password, state.runtimePassword, state.setupSecret, state.backupKey].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) throw new Error('Practice identity is invalid. Do not reuse or edit a live database to repair it.')
    return state
  }
  private save(state: State) {
    if (!this.options.safeStorage.isEncryptionAvailable()) throw new Error('OS secure storage is required for practice mode.')
    mkdirSync(this.root, { recursive: true })
    const file = path.join(this.root, 'identity.bin')
    const temporary = `${file}.${randomUUID()}.tmp`
    const fd = openSync(temporary, 'wx', 0o600)
    try { writeFileSync(fd, this.options.safeStorage.encryptString(JSON.stringify(state))); fsyncSync(fd) }
    finally { closeSync(fd) }
    renameSync(temporary, file)
  }
  private assertOwnedCluster() {
    if (!this.state || !existsSync(path.join(this.data, 'postmaster.pid'))) throw new Error('Practice cluster identity cannot be verified.')
    const pid = readFileSync(path.join(this.data, 'postmaster.pid'), 'utf8').trim().split(/\r?\n/)
    if (path.resolve(pid[1] ?? '').toLowerCase() !== path.resolve(this.data).toLowerCase() || Number(pid[3]) !== this.state.dbPort || realpathSync(this.data).toLowerCase() !== path.resolve(this.data).toLowerCase()) throw new Error('Practice cluster identity mismatch. No database was stopped or changed.')
  }
  async start(runtime: Runtime, pin?: string) {
    if (this.preparation) throw new Error('Practice setup is already running.')
    this.cancellation = new AbortController()
    this.preparation = this.prepare(runtime, pin)
    try { return await this.preparation }
    finally { this.preparation = null }
  }
  private async prepare(runtime: Runtime, pin?: string) {
    if (this.busy) throw new Error('Practice setup is already running.')
    this.busy = true
    try {
      await verifyServerPayload({ payloadDir: this.options.payloadDir })
      this.state = this.read()
      if (!this.state) {
        if (!pin || !/^\d{4,12}$/.test(pin)) throw new Error('Enter a separate 4–12 digit practice owner PIN.')
        mkdirSync(this.root, { recursive: true })
        const free = this.options.availableBytes?.() ?? (() => { const volume = statfsSync(this.root, { bigint: true }); return volume.bavail * volume.bsize })()
        if (free < 4n * 1024n ** 3n) throw new Error('Practice mode needs at least 4 GiB free for its separate database. Live data was not changed.')
        this.state = { version: 1, id: randomUUID(), dbPort: await port(), httpPort: await port(), password: randomBytes(32).toString('hex'), runtimePassword: randomBytes(32).toString('hex'), setupSecret: randomBytes(32).toString('hex'), backupKey: randomBytes(32).toString('hex') }
        if (this.state.dbPort === this.state.httpPort) throw new Error('Practice ports collided. Retry setup.')
        this.save(this.state)
      }
      const state = this.state
      const url = `http://127.0.0.1:${state.httpPort}`
      if (runtime.status().configured) runtime.assertTrainingEndpoint(url)
      const serviceRoot = path.join(this.options.payloadDir, 'server')
      this.pgBin = path.join(this.options.payloadDir, 'postgres', 'bin')
      this.env = trainingEnvironment(process.env, this.root, state, this.pgBin)
      const exec: Runner = async (binary, args, env, cwd) => {
        if (this.cancellation?.signal.aborted) throw new Error('Practice setup was cancelled.')
        // pg_ctl starts a detached PostgreSQL child. Let that bounded startup
        // finish before shutdown, so cancellation cannot orphan the cluster.
        const startingDatabase = /pg_ctl(?:\.exe)?$/i.test(binary) && args.includes('start')
        await (this.options.run ?? run)(binary, args, env, cwd, startingDatabase ? undefined : this.cancellation?.signal)
        if (this.cancellation?.signal.aborted) throw new Error('Practice setup was cancelled.')
      }
      const binary = (name: string) => path.join(this.pgBin, `${name}${process.platform === 'win32' ? '.exe' : ''}`)
      const node = path.join(this.options.payloadDir, 'node', 'node.exe')
      if (!existsSync(path.join(this.data, 'PG_VERSION'))) {
        if (existsSync(this.data)) throw new Error('Incomplete practice database exists. Use the explicit practice reset; live data is never overwritten.')
        const passwordFile = path.join(this.root, 'init-password.txt')
        writeFileSync(passwordFile, state.password, { flag: 'wx', mode: 0o600 })
        try {
          await exec(binary('initdb'), ['-D', this.data, '-U', 'postgres', '--auth=scram-sha-256', `--pwfile=${passwordFile}`, '--encoding=UTF8', '--no-locale'], this.env, this.root)
          const conf = path.join(this.data, 'postgresql.conf')
          writeFileSync(conf, `\nlisten_addresses='127.0.0.1'\nport=${state.dbPort}\nfsync=on\nfull_page_writes=on\nsynchronous_commit=on\n`, { flag: 'a' })
        } finally { rmSync(passwordFile, { force: true }) }
      }
      if (existsSync(path.join(this.data, 'postmaster.pid'))) this.assertOwnedCluster()
      else await exec(binary('pg_ctl'), ['-D', this.data, '-l', path.join(this.root, 'postgres.log'), '-w', 'start'], this.env, this.root)
      this.assertOwnedCluster()
      await exec(node, [path.join(serviceRoot, 'scripts', 'provision-local.mjs')], this.env, serviceRoot)
      const healthy = async () => {
        try {
          const response = await fetch(`${url}/v1/health/live`, { signal: AbortSignal.timeout(1500) })
          const body = await response.json() as { training_instance_id?: string }
          return response.ok && body.training_instance_id === state.id
        } catch { return false }
      }
      if (!await healthy()) {
        if (this.cancellation?.signal.aborted) throw new Error('Practice setup was cancelled.')
        this.service = spawn(node, [path.join(serviceRoot, 'dist', 'server.js')], { cwd: serviceRoot, env: this.env, stdio: 'ignore', windowsHide: true })
        let startError = false
        this.service.once('error', () => { startError = true })
        let ready = false
        for (let attempt = 0; attempt < 40; attempt++) {
          if (this.cancellation?.signal.aborted) throw new Error('Practice setup was cancelled.')
          if (startError || this.service.exitCode !== null) break
          if (await healthy()) { ready = true; break }
          await new Promise(resolve => setTimeout(resolve, 250))
        }
        if (!ready) throw new Error('The isolated practice service did not become ready. Live trading is unaffected.')
      }
      this.started = true
      if (!runtime.status().configured) {
        if (!pin || !/^\d{4,12}$/.test(pin)) throw new Error('Enter the same practice PIN to resume owner creation.')
        await runtime.setupOwner({ base_url: url, setup_secret: state.setupSecret, business_name: 'TRAINING — Practice Bar', outlet_name: 'Practice counter', owner_name: 'Practice owner', device_name: 'Practice till', currency: 'BWP', timezone: 'Africa/Gaborone', pin })
      }
      return this.status()
    } finally { this.busy = false }
  }
  async seed(runtime: { command(request: Record<string, unknown>): Promise<unknown> }) {
    if (!this.started || !this.state) throw new Error('Practice authority has not been verified.')
    if (existsSync(path.join(this.root, 'sample-menu.ready'))) return
    for (const [sku, name, price] of [['PRACTICE-WATER', 'Practice water', '10.00'], ['PRACTICE-JUICE', 'Practice juice', '15.00']]) {
      const hex = createHash('sha256').update(`${this.state.id}:${sku}`).digest('hex')
      const operationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
      const result = await runtime.command({ command: 'catalogue.upsert', operation_id: operationId, payload: { sku, name, price, tax_rate: '0', track_stock: false } }) as { outcome?: string }
      if (result.outcome !== 'committed_local') throw new Error('The sample menu is not confirmed yet. Sign in again to retry the same practice operations.')
    }
    writeFileSync(path.join(this.root, 'sample-menu.ready'), 'Practice catalogue confirmed\n', { mode: 0o600 })
  }
  async stop() {
    this.cancellation?.abort()
    await this.preparation?.catch(() => {})
    if (this.service !== null) {
      const child = this.service
      if (child.exitCode === null && child.pid) await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill() })
      this.service = null
    }
    if (this.state && existsSync(path.join(this.data, 'postmaster.pid'))) {
      this.assertOwnedCluster()
      await (this.options.run ?? run)(path.join(this.pgBin, `pg_ctl${process.platform === 'win32' ? '.exe' : ''}`), ['-D', this.data, '-m', 'fast', '-w', 'stop'], this.env, this.root)
    }
    this.started = false
  }
  async reset(confirm: string, closeRuntime: () => void) {
    if (confirm !== 'RESET_TRAINING' || this.busy) throw new Error('Type RESET_TRAINING and finish any practice setup before resetting.')
    await this.stop()
    closeRuntime()
    // Retain evidence instead of recursively deleting database or credential files.
    const archive = path.join(path.dirname(this.root), `practice-retired-${randomUUID()}`)
    if (existsSync(this.root)) renameSync(this.root, archive)
    const profile = path.join(this.options.userDataPath, 'bar-local')
    if (existsSync(profile)) renameSync(profile, `${profile}-retired-${randomUUID()}`)
    this.state = null
    return { reset: true, live_data_changed: false }
  }
}
