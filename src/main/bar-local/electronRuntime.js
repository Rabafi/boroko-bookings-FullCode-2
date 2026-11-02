// @ts-check

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createModernBarLocalAdapter, openIntentJournal } from './index.js'
import { createHttpTransport } from './client.js'
import { AUTHORITY_MODES, BarLocalAdapterError, normalizeFingerprint, requireUuid, validateAuthorityConfig } from './authority.js'
import { journalProtection } from '../../shared/barLocalJournalProtection.js'
import { openSqliteIntentJournal } from './sqliteIntents.js'
import { ServerSetupOrchestrator } from './serverSetup.js'
import { importUpdatePackageDirectory } from './updates.js'
import { TrainingSupervisor } from './training.ts'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { verifyBarReplacement } from '../../shared/barLocalReplacement.js'
import {
  LEGACY_LOCAL_BAR_SETUP_REQUEST_VERSION,
  LOCAL_BAR_SETUP_REQUEST_FILE,
  LOCAL_BAR_SETUP_REQUEST_VERSION,
  isDedicatedLocalBarWorkspaceArgv
} from '../../shared/barLocalWorkspace.js'
import {
  buildWorkspaceLaunchArguments,
  buildWorkspacePrefill,
  dedicatedWorkspacePrefillPath,
  normalizeLocalBarSetupRequest,
  sanitizeWorkspaceEnvironment
} from './localBarWorkspace.ts'

/** @typedef {ReturnType<ReturnType<typeof createModernBarLocalAdapter>['requireClient']>} BarLocalClient */
/** @typedef {import('./authority.js').AuthorityConfig} AuthorityConfig */
/** @typedef {import('./authority.js').NormalizedAuthorityConfig} NormalizedAuthorityConfig */
/** @typedef {{device_id: string, device_token: string, label?: unknown}} BarLocalDeviceCredentialReadExpectedView */
/** @typedef {Record<string, unknown> & {authority_mode: 'cloud'|'bar_local', product: string}} BarLocalAuthorityPersistExpectedData */
/**
 * These records are written only by this module into the protected provisioning
 * file. The read path keeps its existing shallow corruption check; this view
 * describes the locally produced encrypted record and does not validate JSON.
 * @typedef {{kind:'owner',request:{base_url:string,certificate_fingerprint?:string,setup_secret:string,business_name?:string,outlet_name?:string,owner_name?:string,pin?:string,device_platform?:string,business_profile?:Record<string,string>,provisioning_id:string,device_token:string}}|{kind:'pairing',request:{base_url:string,certificate_fingerprint?:string|undefined,pairing_code:string,device_name:string,provisioning_id:string,device_token:string}}} PendingProvisioning
 */

const CONFIG_NAME = 'authority.bin'
const CREDENTIAL_NAME = 'device-credential.bin'
const PROVISIONING_NAME = 'provisioning.bin'
const JOURNAL_NAME = 'intents.sqlite'

/** Persist a complete replacement before publishing its filename. */
/**
 * @param {string} file
 * @param {string | Buffer} data
 */
function writeDurableAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  const staging = `${file}.tmp-${process.pid}-${randomUUID()}`
  let fd
  try {
    fd = openSync(staging, 'wx', 0o600)
    writeFileSync(fd, data)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(staging, file)
    // Directory fsync is supported on POSIX. Windows does not expose a
    // portable directory handle through Node, while the file itself is synced.
    if (process.platform !== 'win32') {
      const dirFd = openSync(dirname(file), 'r')
      try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
    }
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(staging) } catch {}
    throw error
  }
}

/**
 * Main-process owner for the Bar local client. Authority configuration and
 * credentials are never accepted from renderer state except during the
 * dedicated loopback owner-commissioning call. The renderer cannot switch an
 * existing authority or supply a new endpoint to a transaction.
 */
export class BarLocalElectronRuntime {
  /**
   * @param {{ userDataPath: string, safeStorage: { isEncryptionAvailable(): boolean, encryptString(value: string): Buffer, decryptString(value: Buffer): string }, buildProductId: string, logger?: Console }} options
   */
  constructor(options) {
    this.userDataPath = options.userDataPath
    this.safeStorage = options.safeStorage
    this.buildProductId = options.buildProductId
    this.logger = options.logger ?? console
    this.root = join(this.userDataPath, 'bar-local')
    this.configPath = join(this.root, CONFIG_NAME)
    this.credentialPath = join(this.root, CREDENTIAL_NAME)
    this.provisioningPath = join(this.root, PROVISIONING_NAME)
    this.journalPath = join(this.root, JOURNAL_NAME)
    this.legacyJournalPath = join(this.root, 'intents.jsonl')
    /** @type {ReturnType<typeof createModernBarLocalAdapter> | null} */
    this.adapter = null
    /** @type {typeof AUTHORITY_MODES[keyof typeof AUTHORITY_MODES]} */
    this.committedMode = AUTHORITY_MODES.CLOUD
    this.session = null
    this.lastReadiness = null
    this.provisioning = false
    // This process may have already started cloud workers. Only a fresh
    // local-authority process may open a local session or execute commands.
    this.restartRequired = false
    this.setupOwnerStaffId = null
    this.training = process.argv.includes('--bar-training')
    // A dedicated local Bar workspace is the separate profile/process an owner
    // with an existing cloud business uses to create a new local Bar. It owns a
    // different userData root, so it can never share credentials, journals,
    // caches or a single-instance lock with the cloud workspace.
    this.dedicatedLocalWorkspace = isDedicatedLocalBarWorkspaceArgv(process.argv)
    /** @type {TrainingSupervisor|null} */
    this.trainingSupervisor = null
    this.#loadAdapter()
    // A new shared Restaurant/Bar installation must make its workspace
    // decision before any cloud database, replay queue or timer is started.
    this.cloudStartupDeferred = this.buildProductId === 'hospitality-pos'
      && this.mode === AUTHORITY_MODES.CLOUD && !this.#hasCloudWorkspaceChoice()
  }

  #hasCloudWorkspaceChoice() {
    try {
      const choice = JSON.parse(readFileSync(join(this.root, 'workspace-choice.json'), 'utf8'))
      return choice?.version === 1 && choice.workspace === 'cloud'
    } catch { return false }
  }

  selectCloudWorkspace() {
    if (this.dedicatedLocalWorkspace) {
      throw new BarLocalAdapterError(
        'DEDICATED_LOCAL_WORKSPACE',
        'This is the local Bar window. Continue Bar setup here; it will not open another workspace.'
      )
    }
    if (this.mode !== AUTHORITY_MODES.CLOUD || this.provisioning || this.restartRequired) {
      throw new BarLocalAdapterError('WRONG_AUTHORITY', 'A local Bar cannot switch to cloud. Keep its saved operations and contact the owner for recovery.')
    }
    writeDurableAtomic(join(this.root, 'workspace-choice.json'), JSON.stringify({ version: 1, workspace: 'cloud' }))
    // The running process stays deferred. Cloud services start only on restart.
    return { restart_required: this.cloudStartupDeferred }
  }

  /**
   * Prefill the local Bar commissioning form from the cloud-workspace handoff.
   * Only Bar-specific name/contact details and currency are carried over. No
   * other workspace identity, credential or customer data crosses over.
   */
  #readSetupPrefill() {
    try {
      /** @type {Record<string, unknown>} */
      const prefill = JSON.parse(readFileSync(join(this.userDataPath, LOCAL_BAR_SETUP_REQUEST_FILE), 'utf8'))
      if (!prefill || ![LEGACY_LOCAL_BAR_SETUP_REQUEST_VERSION, LOCAL_BAR_SETUP_REQUEST_VERSION].includes(prefill.version)) return null
      const businessName = typeof prefill.business_name === 'string' ? prefill.business_name.trim().slice(0, 200) : ''
      const currency = typeof prefill.currency === 'string' && /^[A-Za-z]{2,4}$/.test(prefill.currency.trim())
        ? prefill.currency.trim().toUpperCase()
        : null
      const rawProfile = prefill.business_profile && typeof prefill.business_profile === 'object' && !Array.isArray(prefill.business_profile)
        ? /** @type {Record<string, unknown>} */ (prefill.business_profile)
        : {}
      const business_profile = {}
      for (const [key, max] of Object.entries({ company_name: 200, address: 240, city: 120, country: 120, phone: 80, email: 254, website: 240, vat_number: 80 })) {
        const value = rawProfile[key]
        if (typeof value === 'string' && value.trim()) business_profile[key] = value.trim().slice(0, max)
      }
      if (!businessName && !currency && !Object.keys(business_profile).length) return null
      return { business_name: businessName || null, currency, business_profile, entry_mode: prefill.entry_mode === 'join' ? 'join' : 'commission' }
    } catch { return null }
  }

  hasSavedCloudBusiness() {
    try { this.assertNoSavedCloudBusiness(); return false }
    catch { return true }
  }

  // Opening the dedicated local Bar workspace is a commissioning entry point.
  // Practice mode, an already-local window and a committed local authority must
  // not create a second Bar.
  assertCanOpenLocalBarWorkspace() {
    if (this.training) {
      throw new BarLocalAdapterError('WRONG_AUTHORITY', 'Practice mode cannot open a live local Bar workspace.')
    }
    if (this.dedicatedLocalWorkspace) {
      throw new BarLocalAdapterError('WORKSPACE_ALREADY_LOCAL', 'This window is already the dedicated local Bar workspace. Continue setup here.')
    }
    if (this.mode === AUTHORITY_MODES.BAR_LOCAL) {
      throw new BarLocalAdapterError('ALREADY_COMMISSIONED', 'This installation already owns a local Bar. Use its setup, recovery or administration screens instead of creating another.')
    }
  }

  #readConfig() {
    try {
      const encrypted = readFileSync(this.configPath)
      if (!this.safeStorage.isEncryptionAvailable()) {
        throw new BarLocalAdapterError('SECURE_STORAGE_UNAVAILABLE', 'OS secure storage is unavailable; the committed local authority profile cannot be opened.')
      }
      const raw = JSON.parse(this.safeStorage.decryptString(encrypted))
      this.setupOwnerStaffId = raw?.setup_owner_staff_id == null ? null : requireUuid(raw.setup_owner_staff_id, 'setup_owner_staff_id')
      if(raw?.authority_mode===AUTHORITY_MODES.BAR_LOCAL&&raw.journal_storage!==undefined){
        if(raw.journal_storage!=='local_sqlite_v1')throw new BarLocalAdapterError('INTENT_JOURNAL_CORRUPT','This authority profile requires an unsupported saved-operation storage version. Preserve this till for recovery.')
        if(!existsSync(this.journalPath))throw new BarLocalAdapterError('INTENT_JOURNAL_CORRUPT','The initialized SQLite operation journal is missing. Preserve the authority profile and recover the original SQLite storage; an older JSONL file must not be used as fallback.')
      }
      const config = validateAuthorityConfig(raw)
      if (config.product !== 'hospitality-pos' || this.buildProductId !== 'hospitality-pos') {
        throw new BarLocalAdapterError('WRONG_AUTHORITY', 'Local Bar authority is only supported by the hospitality-pos application.')
      }
      return config
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        if (existsSync(this.credentialPath)) {
          throw new BarLocalAdapterError('AUTHORITY_PROFILE_MISSING', 'A protected Bar device credential exists without its committed authority profile. Repair or re-pair this till before trading; cloud fallback is disabled.')
        }
        if(existsSync(this.legacyJournalPath)&&readFileSync(this.legacyJournalPath).length>0){
          throw new BarLocalAdapterError('AUTHORITY_PROFILE_MISSING','Saved Bar operations exist without their committed authority profile. Preserve the original journal and repair this till; cloud fallback is disabled.')
        }
        if(existsSync(this.journalPath)||existsSync(this.journalPath+'.initialized')){
          const probe=this.#openJournal()
          try{if(probe.size>0)throw new BarLocalAdapterError('AUTHORITY_PROFILE_MISSING','Saved Bar operations exist without their committed authority profile. Preserve the original SQLite journal and repair this till; cloud fallback is disabled.')}
          finally{probe.close()}
        }
        const legacyPath = join(this.root, 'authority.json')
        if (!existsSync(legacyPath)) return null
        try {
          const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'))
          if (legacy?.authority_mode === AUTHORITY_MODES.BAR_LOCAL) {
            throw new BarLocalAdapterError('AUTHORITY_PROFILE_UPGRADE_REQUIRED', 'A previous local authority profile is not protected by OS secure storage. Repair or re-pair this till before trading; cloud fallback is disabled.')
          }
          return null
        } catch (legacyError) {
          if (legacyError instanceof BarLocalAdapterError) throw legacyError
          throw new BarLocalAdapterError('AUTHORITY_CONFIG_INVALID', 'A previous authority profile exists but cannot be safely read. Repair is required before continuing.', { cause: legacyError })
        }
      }
      if (error instanceof BarLocalAdapterError && ['SECURE_STORAGE_UNAVAILABLE','INTENT_JOURNAL_CORRUPT'].includes(error.code)) throw error
      throw new BarLocalAdapterError('AUTHORITY_CONFIG_INVALID', 'The saved Bar authority profile is invalid. Repair is required before continuing.', { cause: error })
    }
  }

  #credentialStore() {
    const storage = this.safeStorage
    const file = this.credentialPath
    return {
      load() {
        try {
          if (!storage.isEncryptionAvailable()) throw new Error('OS secure storage is unavailable.')
          const encrypted = readFileSync(file)
          // Expected-data view of the record written by this protected store;
          // the guard below remains the runtime validation actually performed.
          const parsed = JSON.parse(storage.decryptString(encrypted))
          if (!parsed || typeof parsed !== 'object') {
            throw new Error('Saved device credential is malformed.')
          }
          // The existing guard below is the validation performed here. This
          // view only lets TypeScript read the fields after the object check.
          const record = /** @type {Record<string, unknown>} */ (parsed)
          const deviceId = record.device_id
          const deviceToken = record.device_token
          if (typeof deviceId !== 'string' || typeof deviceToken !== 'string') {
            throw new Error('Saved device credential is malformed.')
          }
          // Return the parsed object itself so absent fields stay absent.
          return /** @type {BarLocalDeviceCredentialReadExpectedView} */ (parsed)
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
          throw new BarLocalAdapterError('DEVICE_CREDENTIAL_UNAVAILABLE', 'The protected Bar device credential cannot be opened. Use the approved repair or re-pair workflow.', { cause: error })
        }
      },
      /** @param {{device_id:string,device_token:string,label?:string|null}|null} value */
      save(value) {
        if (value === null) {
          try {
            unlinkSync(file)
          } catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
          }
          return
        }
        if (!storage.isEncryptionAvailable()) throw new BarLocalAdapterError('SECURE_STORAGE_UNAVAILABLE', 'OS secure storage is unavailable; device credentials were not saved.')
        const encrypted = storage.encryptString(JSON.stringify(value))
        writeDurableAtomic(file, encrypted)
      },
      clear() { this.save(null) }
    }
  }

  #readProvisioning() {
    try {
      if (!this.safeStorage.isEncryptionAvailable()) throw new BarLocalAdapterError('SECURE_STORAGE_UNAVAILABLE', 'OS secure storage is required to resume local setup.')
      /** @type {PendingProvisioning} This is an expected-data view of this module's encrypted record, not validation of parsed JSON. */
      const pending = JSON.parse(this.safeStorage.decryptString(readFileSync(this.provisioningPath)))
      if (!pending || !['owner', 'pairing'].includes(pending.kind) || !pending.request || typeof pending.request !== 'object') {
        throw new BarLocalAdapterError('PROVISIONING_STATE_CORRUPT', 'The protected setup recovery record is invalid. Preserve this till for recovery.')
      }
      return pending
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }
  }

  /** @param {PendingProvisioning} pending */
  #saveProvisioning(pending) {
    if (!this.safeStorage.isEncryptionAvailable()) throw new BarLocalAdapterError('SECURE_STORAGE_UNAVAILABLE', 'OS secure storage is required before local setup can begin.')
    mkdirSync(this.root, { recursive: true })
    writeDurableAtomic(this.provisioningPath, this.safeStorage.encryptString(JSON.stringify(pending)))
  }

  #clearProvisioning() {
    try { unlinkSync(this.provisioningPath) }
    catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error }
  }

  /** @param {AuthorityConfig|NormalizedAuthorityConfig|BarLocalAuthorityPersistExpectedData} config */
  #persistConfig(config) {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new BarLocalAdapterError('SECURE_STORAGE_UNAVAILABLE', 'OS secure storage is unavailable; the local authority profile was not saved.')
    }
    const protectedConfig=config.authority_mode===AUTHORITY_MODES.BAR_LOCAL?{...config,journal_storage:'local_sqlite_v1',setup_owner_staff_id:this.setupOwnerStaffId}:config
    const encrypted = this.safeStorage.encryptString(`${JSON.stringify(protectedConfig, null, 2)}\n`)
    writeDurableAtomic(this.configPath, encrypted)
  }

  #openJournal(){
    return openSqliteIntentJournal({filePath:this.journalPath,legacyFilePath:this.legacyJournalPath,protection:journalProtection(this.safeStorage)})
  }

  /** @param {AuthorityConfig} config */
  #createAdapter(config) {
    return createModernBarLocalAdapter({
      authority_config: config,
      journal: config.authority_mode===AUTHORITY_MODES.BAR_LOCAL?this.#openJournal():openIntentJournal(),
      device_store: this.#credentialStore(),
      logger: {
        info: (record) => this.logger.info?.('[BarLocal]', record),
        warn: (record) => this.logger.warn?.('[BarLocal]', record),
        error: (record) => this.logger.error?.('[BarLocal]', record)
      }
    })
  }

  #loadAdapter() {
    const config = this.#readConfig()
    if (config === null) {
      this.committedMode = AUTHORITY_MODES.CLOUD
      this.adapter = null
      return
    }
    this.committedMode = config.authority_mode
    // If the protected profile and device credential were committed but the
    // final staging-file unlink was interrupted, remove only that matching
    // recovery record. A different staged credential is left untouched for
    // explicit recovery; it is never used to replace this authority.
    try {
      const pending = this.#readProvisioning()
      const credential = pending ? this.#credentialStore().load() : null
      if (pending && credential?.device_token === pending.request.device_token) {
        this.#clearProvisioning()
      }
    } catch (error) {
      this.logger.warn?.('[BarLocal] Could not reconcile a completed provisioning recovery record.', error)
    }
    const adapter=this.#createAdapter(config)
    try{
      // Publish the backend pin before any migrated till can dispatch work.
      if(config.authority_mode===AUTHORITY_MODES.BAR_LOCAL)this.#persistConfig(config)
      this.adapter=adapter
    }catch(error){adapter.close();throw error}
  }

  get mode() {
    return this.adapter?.authority_mode ?? this.committedMode
  }

  #provisioningRecoveryStatus() {
    if (this.adapter !== null) return null
    try {
      const pending = this.#readProvisioning()
      return pending ? { pending: true, kind: pending.kind, recoverable: true } : null
    } catch (error) {
      return {
        pending: true,
        kind: null,
        recoverable: false,
        error_code: typeof (/** @type {{code?: unknown}|null|undefined} */ (error))?.code === 'string' ? (/** @type {{code: string}|null|undefined} */ (error))?.code : 'PROVISIONING_STATE_CORRUPT'
      }
    }
  }

  status() {
    return Object.freeze({
      authority_mode: this.mode,
      training: this.training,
      configured: this.adapter !== null,
      workspace_choice_required: this.cloudStartupDeferred,
      workspace_isolation: this.dedicatedLocalWorkspace ? 'dedicated_bar' : 'standard',
      setup_prefill: this.dedicatedLocalWorkspace ? this.#readSetupPrefill() : null,
      has_saved_cloud_business: this.hasSavedCloudBusiness(),
      restart_required: this.restartRequired,
      provisioning_recovery: this.#provisioningRecoveryStatus(),
      setup_owner_staff_id: this.setupOwnerStaffId,
      session_active: this.session !== null,
      session: this.session === null ? null : {
        staff: this.session.staff,
        outlet_id: this.session.outlet_id,
        expires_at: this.session.expires_at
      },
      readiness: this.lastReadiness,
      adapter: this.adapter?.describe() ?? null,
      cloud_status: this.mode === AUTHORITY_MODES.BAR_LOCAL ? 'integration_disabled' : 'cloud'
    })
  }

  /** Bind the practice client's protected authority to its own verified service. */
  assertTrainingEndpoint(baseUrl) {
    if (!this.training) throw new Error('This is not a practice workspace.')
    const profile = JSON.parse(this.safeStorage.decryptString(readFileSync(this.configPath)))
    const configured = validateAuthorityConfig(profile)
    if (configured.authority_mode !== 'bar_local' || configured.local_service.base_url !== new URL(baseUrl).origin) throw new Error('The practice profile does not belong to this practice database. Live authority access is blocked.')
  }

  // The cloud profile reader intentionally tolerates malformed files. Setup
  // must not interpret that tolerance as proof that this is a new business.
  // A saved cloud profile requires a separately qualified transition, never
  // commissioning a disconnected local authority on top of it.
  assertNoSavedCloudBusiness() {
    for (const name of ['profiles.json', 'lodge-id.json']) {
      let data
      try { data = JSON.parse(readFileSync(join(this.userDataPath, name), 'utf8')) }
      catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue
        throw new BarLocalAdapterError('CLOUD_PROFILE_UNVERIFIED', 'The saved workspace state cannot be verified. Preserve this computer and contact support before local Bar setup.', { cause: error })
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new BarLocalAdapterError('CLOUD_PROFILE_UNVERIFIED', 'The saved workspace state is invalid. Contact support before local Bar setup.')
      }
      if (name === 'profiles.json') {
        if (!Array.isArray(data.profiles)) throw new BarLocalAdapterError('CLOUD_PROFILE_UNVERIFIED', 'The saved workspace list is invalid. Contact support before local Bar setup.')
        if (data.profiles.length || data.active_lodge_id) throw new BarLocalAdapterError('CLOUD_TRANSITION_REQUIRED', 'A saved workspace is already on this computer. Local Bar setup cannot safely use it yet; use a separate, unused computer or contact support.')
      } else if (data.lodge_id) {
        throw new BarLocalAdapterError('CLOUD_TRANSITION_REQUIRED', 'A saved workspace is already on this computer. Local Bar setup cannot safely use it yet; use a separate, unused computer or contact support.')
      }
    }
  }

  // A process that has already opened the cloud workspace has started the
  // cloud database, replay queue and timers. Local commissioning in that same
  // process would leave two authorities alive at once, so it is refused even
  // when called directly over IPC rather than through the visible UI.
  #assertCloudWorkspaceAvailable() {
    if (!this.cloudStartupDeferred) {
      throw new BarLocalAdapterError(
        'CLOUD_WORKSPACE_ACTIVE',
        'This workspace has already started. Open Bar setup from the application chooser on a fresh launch; a local Bar cannot start inside another workspace.'
      )
    }
  }

  /** @param {{base_url:string,certificate_fingerprint?:string,setup_secret:string,business_name?:string,outlet_name?:string,owner_name?:string,owner_email?:string,owner_password?:string,pin?:string,device_platform?:string,business_profile?:Record<string,string>}} request */
  async setupOwner({ base_url, certificate_fingerprint, setup_secret, ...request }) {
    if (this.buildProductId !== 'hospitality-pos') throw new BarLocalAdapterError('WRONG_AUTHORITY', 'Owner setup is only available in Restaurant & Bar POS.')
    if (this.adapter !== null) throw new BarLocalAdapterError('SETUP_ALREADY_COMMISSIONED', 'This installation already has a committed authority profile.')
    if (this.provisioning) throw new BarLocalAdapterError('SETUP_IN_PROGRESS', 'Another local authority provisioning operation is already running.')
    this.assertNoSavedCloudBusiness()
    this.#assertCloudWorkspaceAvailable()
    if (!this.safeStorage.isEncryptionAvailable()) throw new BarLocalAdapterError('SECURE_STORAGE_UNAVAILABLE', 'OS secure storage is required before commissioning this till.')
    let pending = this.#readProvisioning()
    if (pending && pending.kind !== 'owner') throw new BarLocalAdapterError('PROVISIONING_IN_PROGRESS', 'A saved pairing must be resumed before owner setup can begin.')
    if (pending) {
      const ownerPassword = request.owner_password
      base_url = pending.request.base_url
      certificate_fingerprint = pending.request.certificate_fingerprint
      request = { ...pending.request, ...(typeof ownerPassword === 'string' ? { owner_password: ownerPassword } : {}) }
      setup_secret = pending.request.setup_secret
    } else {
      const tokenBytes = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')
      const { owner_password: _transientPassword, ...protectedRequest } = request
      pending = { kind: 'owner', request: { ...protectedRequest, base_url, certificate_fingerprint, setup_secret, provisioning_id: randomUUID(), device_token: `bld_${tokenBytes}` } }
      this.#saveProvisioning(pending)
    }
    const transport = createHttpTransport({ base_url, certificate_fingerprint, request_timeout_ms: 15000, connect_timeout_ms: 5000 })
    this.provisioning = true
    let bootstrap
    try {
      bootstrap = createModernBarLocalAdapter({
        authority: { authority_mode: 'cloud', product: 'hospitality-pos' },
        transport,
        device_store: this.#credentialStore(),
        journal: this.#openJournal(),
        logger: null
      })
      if (typeof request.owner_password !== 'string') throw new BarLocalAdapterError('OWNER_PASSWORD_REQUIRED', 'Enter the owner password again to safely resume this setup attempt.')
      const { base_url: _baseUrl, certificate_fingerprint: _serverPin, setup_secret: stagedSetupSecret, ...stagedPayload } = pending.request
      const result = await bootstrap.requireClient().setupOwner({ setup_secret: stagedSetupSecret, ...stagedPayload, owner_password: request.owner_password })
      /** @type {BarLocalAuthorityPersistExpectedData} */
      const authority = {
        authority_mode: 'bar_local',
        product: 'hospitality-pos',
        business_id: result.business_id,
        outlet_ids: [result.outlet_id],
        active_outlet_id: result.outlet_id,
        authority_id: result.authority_id,
        authority_epoch: result.authority_epoch,
        commissioning_id: result.commissioning_id ?? null,
        contract_version: 1,
        base_url,
        certificate_fingerprint
      }
      const validated = validateAuthorityConfig(authority)
      this.setupOwnerStaffId = result.owner_staff_id == null ? null : requireUuid(result.owner_staff_id, 'owner_staff_id')
      mkdirSync(this.root, { recursive: true })
      this.#persistConfig(authority)
      this.#clearProvisioning()
      this.restartRequired = true
      bootstrap.close()
      this.#loadAdapter()
      this.lastReadiness = null
      return { ...result, device_token: undefined, authority_mode: validated.authority_mode }
    } catch (error) {
      bootstrap?.close()
      throw error
    } finally {
      this.provisioning = false
    }
  }

  /** @param {{base_url:string,certificate_fingerprint?:string,pairing_code:string,device_name:string}} request */
  async pairDevice({ base_url, certificate_fingerprint, pairing_code, device_name }) {
    if (this.buildProductId !== 'hospitality-pos') throw new BarLocalAdapterError('WRONG_AUTHORITY', 'Local device pairing is only supported by Restaurant & Bar POS.')
    if (this.adapter !== null) throw new BarLocalAdapterError('SETUP_ALREADY_COMMISSIONED', 'This till already has a committed authority profile.')
    if (this.provisioning) throw new BarLocalAdapterError('SETUP_IN_PROGRESS', 'Another local authority provisioning operation is already running.')
    this.assertNoSavedCloudBusiness()
    this.#assertCloudWorkspaceAvailable()
    if (!this.safeStorage.isEncryptionAvailable()) throw new BarLocalAdapterError('SECURE_STORAGE_UNAVAILABLE', 'OS secure storage is required before pairing this till.')
    let pending = this.#readProvisioning()
    if (pending && pending.kind !== 'pairing') throw new BarLocalAdapterError('PROVISIONING_IN_PROGRESS', 'A saved owner setup must be resumed before pairing another device.')
    if (pending) ({ base_url, certificate_fingerprint, pairing_code, device_name } = pending.request)
    else {
      const tokenBytes = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')
      const staged = /** @type {PendingProvisioning} */ ({ kind: 'pairing', request: {
        base_url, certificate_fingerprint, pairing_code, device_name,
        provisioning_id: randomUUID(), device_token: `bld_${tokenBytes}`
      } })
      pending = staged
      this.#saveProvisioning(staged)
    }
    if (typeof pairing_code !== 'string' || !/^\d{6,12}$/.test(pairing_code)) throw new BarLocalAdapterError('VALIDATION_FAILED', 'The pairing code must contain 6–12 digits.')
    if (typeof device_name !== 'string' || device_name.trim().length < 1 || device_name.trim().length > 120) throw new BarLocalAdapterError('VALIDATION_FAILED', 'The device name must contain 1–120 characters.')
    const transport = createHttpTransport({
      base_url,
      certificate_fingerprint,
      request_timeout_ms: 15000,
      connect_timeout_ms: 5000
    })
    this.provisioning = true
    try {
      // Validate and durably initialise the journal before consuming the
      // single-use pairing code. A corrupt/full journal must stop at setup.
      const journalProbe = this.#openJournal()
      journalProbe.close()
      const response = await transport.post('/v1/pairing/complete', {
        pairing_code,
        name: device_name.trim(),
        platform: 'modern',
        provisioning_id: pending.request.provisioning_id,
        device_token: pending.request.device_token,
        certificate_fingerprint: transport.fingerprint
      }, { correlationId: randomUUID() })
      const result = response.body
      const resultFields = result && typeof result === 'object'
        ? /** @type {Record<string, unknown>} */ (result)
        : null
      // The non-2xx server response uses string code/message fields; this is
      // an expected-data view only. The body remains unvalidated at runtime.
      const errorFields = resultFields
        ? /** @type {Record<string, unknown> & {code?: string, message?: string}} */ (resultFields)
        : null
      const error = errorFields
        ? new BarLocalAdapterError(errorFields.code || 'PAIRING_FAILED', errorFields.message || 'The local Bar authority refused device pairing.', { status: response.status })
        : null
      if (response.status < 200 || response.status >= 300) {
        throw error || new BarLocalAdapterError('PAIRING_FAILED', 'The local Bar authority refused device pairing.', { status: response.status })
      }
      if (!result || !resultFields || resultFields.ok !== true || resultFields.outcome !== 'device_paired') {
        throw new BarLocalAdapterError('PAIRING_RESPONSE_INVALID', 'The local Bar authority returned an invalid pairing response.')
      }
      if (transport.fingerprint && resultFields.server_certificate_fingerprint) {
        if (normalizeFingerprint(resultFields.server_certificate_fingerprint) !== transport.fingerprint) {
          throw new BarLocalAdapterError('TLS_FINGERPRINT_MISMATCH', 'The pairing response certificate does not match the entered fingerprint.')
        }
      }
      /** @type {BarLocalAuthorityPersistExpectedData} */
      const authority = {
        authority_mode: 'bar_local',
        product: 'hospitality-pos',
        business_id: resultFields.business_id,
        outlet_ids: [resultFields.outlet_id],
        active_outlet_id: resultFields.outlet_id,
        authority_id: resultFields.authority_id,
        authority_epoch: resultFields.authority_epoch,
        contract_version: 1,
        local_service: { base_url, certificate_fingerprint: transport.fingerprint }
      }
      const validated = validateAuthorityConfig(authority)
      if (typeof resultFields.device_id !== 'string') {
        throw new BarLocalAdapterError('PAIRING_RESPONSE_INVALID', 'The pairing response did not include a valid device credential.')
      }
      mkdirSync(this.root, { recursive: true })
      this.#credentialStore().save({ device_id: resultFields.device_id, device_token: pending.request.device_token })
      try {
        this.#persistConfig(authority)
      } catch (error) {
        this.#credentialStore().clear()
        throw error
      }
      this.#clearProvisioning()
      this.restartRequired = true
      this.#loadAdapter()
      this.lastReadiness = null
      return { authority_mode: validated.authority_mode, authority_id: validated.authority_id, authority_epoch: validated.authority_epoch, business_id: validated.business_id, outlet_id: validated.active_outlet_id, device_id: resultFields.device_id }
    } finally {
      transport.close()
      this.provisioning = false
    }
  }

  async resumeProvisioning(request = {}) {
    const pending = this.#readProvisioning()
    if (!pending) {
      throw new BarLocalAdapterError('PROVISIONING_NOT_FOUND', 'There is no saved local setup or pairing attempt to resume.')
    }
    // Both methods reload the protected pending request and replace these
    // values before using them. Keep the original empty runtime arguments.
    if (pending.kind === 'owner') return this.setupOwner(/** @type {Parameters<BarLocalElectronRuntime['setupOwner']>[0]} */ ({ owner_password: request.owner_password }))
    if (pending.kind === 'pairing') return this.pairDevice(/** @type {Parameters<BarLocalElectronRuntime['pairDevice']>[0]} */ ({}))
    throw new BarLocalAdapterError('PROVISIONING_STATE_CORRUPT', 'The saved local setup type is invalid. Preserve this till for recovery.')
  }

  #requireClient() {
    if (!this.adapter) throw new BarLocalAdapterError('WRONG_AUTHORITY', 'This installation has no local Bar authority profile.')
    return this.adapter.requireClient()
  }

  /** @param {Parameters<BarLocalClient['login']>[0]} request */
  async login(request) {
    const client = this.#requireClient()
    const session = await client.login(request)
    this.session = session
    if (this.trainingSupervisor) await this.trainingSupervisor.seed(this)
    try {
      this.lastReadiness = await client.healthReady()
    } catch (error) {
      this.lastReadiness = this.adapter?.router.markUnavailable((/** @type {{code?: string}|null|undefined} */ (error))?.code || 'SERVICE_UNAVAILABLE') ?? null
      throw error
    }
    return this.status()
  }

  async recoverOwnerPassword(request) {
    const client = this.#requireClient()
    return client.recoverOwnerPassword(request)
  }

  async logout() {
    const open = this.getOpenIntents()
    if (open.length > 0) {
      const first = open[0]
      throw new BarLocalAdapterError(
        'LOCAL_INTENT_RECOVERY_REQUIRED',
        `Sign-out is blocked because local operation ${first.operation_id} (${first.state}) is still unresolved. Recover or retry that saved operation with its original operation ID before signing out. Do not start a new sale.`,
        { operationId: first.operation_id, retrySameOperation: true, details: { open_intents: open } }
      )
    }
    const client = this.#requireClient()
    const result = await client.logout()
    this.session = null
    this.lastReadiness = null
    return result
  }

  /** @param {Parameters<BarLocalClient['startPairing']>[0]} [request] */
  async startPairing(request = {}) {
    return this.#requireClient().startPairing(request)
  }

  /** @param {Parameters<BarLocalClient['query']>[0]} name @param {Parameters<BarLocalClient['query']>[1]} [filters] */
  async query(name, filters = {}) {
    return this.#requireClient().query(name, filters)
  }

  /** @param {Parameters<BarLocalClient['requestApprovalForCommand']>[0]} request */
  async requestApprovalForCommand(request) {
    return this.#requireClient().requestApprovalForCommand(request)
  }

  /** @param {Parameters<BarLocalClient['command']>[0]} request */
  async command(request) {
    return this.#requireClient().command(request)
  }

  /** @param {Parameters<BarLocalClient['retryOperation']>[0]} operationId */
  async retryOperation(operationId) {
    return this.#requireClient().retryOperation(operationId)
  }

  #openIntents() {
    if (this.mode !== AUTHORITY_MODES.BAR_LOCAL) return []
    const journal = this.adapter?.journal
    if (!journal || typeof journal.list !== 'function' || journal.closed === true) {
      throw new BarLocalAdapterError(
        'LOCAL_INTENT_RECOVERY_REQUIRED',
        'The local operation journal is unavailable, so unresolved Bar operations cannot be checked. Keep this till open, restore the configured local Bar service and journal, then recover or retry every saved operation before signing out or quitting. Cloud fallback is disabled.'
      )
    }
    let records
    try {
      records = journal.list()
    } catch (error) {
      throw new BarLocalAdapterError(
        'LOCAL_INTENT_RECOVERY_REQUIRED',
        'The local operation journal could not be read, so unresolved Bar operations cannot be checked. Keep this till open, restore the configured local Bar service and journal, then recover or retry every saved operation before signing out or quitting. Cloud fallback is disabled.',
        { cause: error }
      )
    }
    if (!Array.isArray(records)) {
      throw new BarLocalAdapterError(
        'LOCAL_INTENT_RECOVERY_REQUIRED',
        'The local operation journal returned an invalid state, so unresolved Bar operations cannot be checked. Keep this till open and restore the journal before signing out or quitting. Cloud fallback is disabled.'
      )
    }
    return records.filter((intent) => !['committed_local', 'terminal_refusal', 'cancelled'].includes(intent.state))
  }

  getOpenIntents() {
    return this.#openIntents()
      .map((intent) => ({ operation_id: intent.operation_id, command: intent.command, state: intent.state, created_at: intent.created_at }))
  }

  /**
   * Fail-closed close/quit fence for the main entry point. Throws when the
   * journal is unavailable or any operation is still unresolved.
   */
  assertSafeToQuit() {
    const open = this.#openIntents()
    if (open.length === 0) return true
    const first = open[0]
    throw new BarLocalAdapterError(
      'LOCAL_INTENT_RECOVERY_REQUIRED',
      `Quitting is blocked because ${open.length} local operation${open.length === 1 ? ' is' : 's are'} still unresolved, starting with ${first.operation_id} (${first.state}). Recover or retry the saved operation${open.length === 1 ? '' : 's'} with the original operation ID before closing this till.`,
      {
        operationId: first.operation_id,
        retrySameOperation: true,
        details: {
          open_intents: open.map((intent) => ({
            operation_id: intent.operation_id,
            command: intent.command,
            state: intent.state,
            created_at: intent.created_at
          }))
        }
      }
    )
  }

  /** @param {string} operationId */
  async getOperation(operationId) {
    return this.#requireClient().getOperation(operationId)
  }

  async adminStatus() {
    return this.#requireClient().adminStatus()
  }

  async reconnectServer(request) {
    if (this.training || this.mode !== AUTHORITY_MODES.BAR_LOCAL || this.provisioning) throw new Error('Only an existing live local Bar till can connect to its replacement server.')
    const current = this.#readConfig()
    if (!current || current.authority_mode !== AUTHORITY_MODES.BAR_LOCAL) throw new Error('The original protected Bar profile is required.')
    const credential = this.#credentialStore().load()
    if (!credential) throw new Error('The original paired device credential is required. Do not delete this till profile.')
    const transport = createHttpTransport({ base_url: request.base_url, certificate_fingerprint: request.certificate_fingerprint, request_timeout_ms: 15000, connect_timeout_ms: 5000 })
    try {
      const proof = await verifyBarReplacement(
        { authority_id: current.authority_id, authority_epoch: current.authority_epoch, business_id: current.business_id, outlet_id: current.active_outlet_id ?? current.outlet_ids[0] },
        credential,
        request,
        (method, pathname, options) => method === 'GET'
          ? transport.get(pathname, { token: options.sessionToken, deviceId: options.deviceId })
          : transport.post(pathname, options.body, { token: options.sessionToken, deviceId: options.deviceId, deviceToken: options.deviceToken }),
        { base_url: transport.baseUrl, fingerprint: transport.fingerprint }
      )
      this.#persistConfig({ ...current, authority_epoch: proof.authority_epoch, local_service: { ...current.local_service, base_url: transport.baseUrl, certificate_fingerprint: transport.fingerprint } })
      this.restartRequired = true
      this.close() // Journal files and original device credential are retained.
      return { restart_required: true, saved_operations_preserved: true }
    } finally { transport.close() }
  }

  async adminBackups() {
    return this.#requireClient().adminBackups()
  }

  async adminRecoveryStatus() {
    return this.#requireClient().adminRecoveryStatus()
  }
  async adminCopyRecoverySet(request) {
    return this.#requireClient().adminCopyRecoverySet(request)
  }
  async adminSetRecoveryDestination(request) {
    return this.#requireClient().adminSetRecoveryDestination(request)
  }

  async adminRecoveryJob(id) {
    return this.#requireClient().adminRecoveryJob(id)
  }

  async adminCreateRecoveryBase(request) {
    return this.#requireClient().adminCreateRecoveryBase(request)
  }

  async adminVerifyRecoveryPoint(request) {
    return this.#requireClient().adminVerifyRecoveryPoint(request)
  }

  async adminExportRecoveryKeys(request) {
    return this.#requireClient().adminExportRecoveryKeys(request)
  }

  /** @param {Parameters<BarLocalClient['adminRunBackup']>[0]} request */
  async adminRunBackup(request) {
    return this.#requireClient().adminRunBackup(request)
  }

  /** @param {Parameters<BarLocalClient['adminVerifyBackup']>[0]} request */
  async adminVerifyBackup(request) {
    return this.#requireClient().adminVerifyBackup(request)
  }

  /** @param {Parameters<BarLocalClient['adminRestoreDrill']>[0]} request */
  async adminRestoreDrill(request) {
    return this.#requireClient().adminRestoreDrill(request)
  }

  async adminReplicationStatus() {
    return this.#requireClient().adminReplicationStatus()
  }

  /** @param {Parameters<BarLocalClient['adminSetDurability']>[0]} request */
  async adminSetDurability(request) {
    return this.#requireClient().adminSetDurability(request)
  }

  /** @param {Parameters<BarLocalClient['adminSwitchover']>[0]} request */
  async adminSwitchover(request) {
    return this.#requireClient().adminSwitchover(request)
  }

  async adminUpdateStatus() {
    return this.#requireClient().adminUpdateStatus()
  }

  /** @param {Parameters<BarLocalClient['adminStageUpdate']>[0]} request */
  async adminStageUpdate(request) {
    return this.#requireClient().adminStageUpdate(request)
  }

  /** @param {Parameters<BarLocalClient['adminApplyUpdate']>[0]} request */
  async adminApplyUpdate(request) {
    return this.#requireClient().adminApplyUpdate(request)
  }

  async adminCloudSyncStatus() {
    return this.#requireClient().adminCloudSyncStatus()
  }

  /** @param {Parameters<BarLocalClient['adminCloudSyncConfig']>[0]} request */
  async adminCloudSyncConfig(request) {
    return this.#requireClient().adminCloudSyncConfig(request)
  }

  /** @param {Parameters<BarLocalClient['adminCloudSyncRun']>[0]} [request] */
  async adminCloudSyncRun(request) {
    return this.#requireClient().adminCloudSyncRun(request)
  }

  async refreshReadiness() {
    try {
      this.lastReadiness = await this.#requireClient().healthReady()
      return this.lastReadiness
    } catch (error) {
      this.lastReadiness = this.adapter?.router.markUnavailable((/** @type {{code?: string}|null|undefined} */ (error))?.code || 'SERVICE_UNAVAILABLE') ?? null
      throw error
    }
  }

  /** @param {Parameters<BarLocalClient['refreshCatalogueSnapshot']>[0]} [options] */
  async catalogue(options = {}) {
    const client = this.#requireClient()
    const feed = await client.pollEvents()
    if (feed.gap_detected === true) {
      const floor = Number(feed.retention_floor_sequence)
      if (!Number.isSafeInteger(floor) || floor < 0) {
        throw new BarLocalAdapterError('CATALOGUE_RESYNC_REQUIRED', 'The local event feed is incomplete and did not provide a safe resynchronisation point. Refresh the local catalogue before trading.')
      }
      client.resetEventCursor(floor)
    }
    const result = await client.refreshCatalogueSnapshot(options)
    return {
      ...result.snapshot,
      catalogue_refreshed: result.reused !== true,
      catalogue_status: client.catalogueStatus()
    }
  }

  close() {
    this.adapter?.close()
    this.adapter = null
  }
}

/**
 * Registers a fixed IPC surface for the local adapter. It does not expose SQL,
 * arbitrary HTTP, authority-file writes, or Supabase. The local service still
 * enforces actor, outlet, entitlement and capabilities for every operation.
 */
/**
 * @param {{ ipcMain: import('electron').IpcMain, app: import('electron').App, safeStorage: import('electron').SafeStorage, buildProductId: string }} options
 */
export function registerBarLocalIpc({ ipcMain, app, safeStorage, dialog, buildProductId }) {
  const runtime = new BarLocalElectronRuntime({
    userDataPath: app.getPath('userData'),
    safeStorage,
    buildProductId
  })
  const serverSetup = new ServerSetupOrchestrator({
    runtime,
    userDataPath: app.getPath('userData'),
    basePath: typeof app.getAppPath === 'function' ? app.getAppPath() : process.cwd(),
    isPackaged: app.isPackaged === true,
    buildProductId,
    safeStorage
  })
  if (runtime.training) {
    runtime.trainingSupervisor = new TrainingSupervisor({
      userDataPath: app.getPath('userData'), safeStorage,
      payloadDir: app.isPackaged ? join(process.resourcesPath, 'bar-local-server') : join(app.getAppPath(), 'build', 'bar-local-server')
    })
    let closing = false
    app.on('before-quit', (event) => {
      if (closing) return
      event.preventDefault()
      closing = true
      runtime.close()
      void runtime.trainingSupervisor?.stop().then(() => app.exit(0), () => app.exit(1))
    })
  }
  // Fence every subsequently registered cloud IPC handler when this device
  // has a committed local authority. This is defense in depth behind the
  // renderer startup gate: an old screen, direct renderer call, or stale
  // cached session cannot reach a Supabase-backed handler on a local till.
  const registerHandler = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) => registerHandler(channel, async (event, ...args) => {
    const channelName = String(channel)
    const isLocalAuthorityOperation = channelName.startsWith('barLocal:')
    const isOfflineGuideOperation = channelName.startsWith('barGuides:')
    if (runtime.training && (channelName.startsWith('barLocal:serverSetup') || ['barLocal:selectCloudWorkspace', 'barLocal:openLocalBarWorkspace', 'barLocal:pairDevice', 'barLocal:startPairing', 'barLocal:setupOwner', 'barLocal:resumeProvisioning'].includes(channelName))) {
      throw new BarLocalAdapterError('WRONG_AUTHORITY', 'Practice mode cannot install a live server, join another Bar or switch to cloud.')
    }
    if (runtime.restartRequired && isLocalAuthorityOperation && channelName !== 'barLocal:getStatus') {
      throw new BarLocalAdapterError('LOCAL_RESTART_REQUIRED', 'Local setup was committed. Restart this application before signing in or trading; do not repeat setup or pairing.')
    }
    if ((runtime.mode === AUTHORITY_MODES.BAR_LOCAL || runtime.provisioning || runtime.restartRequired || runtime.cloudStartupDeferred) && !isLocalAuthorityOperation && !isOfflineGuideOperation) {
      throw new BarLocalAdapterError('LOCAL_WORKSPACE_NOT_ROUTED', 'This Bar installation is committed to its local authority. This cloud-backed action is blocked until its local workflow is connected.')
    }
    return listener(event, ...args)
  })
  ipcMain.handle('barLocal:getStatus', () => runtime.status())
  ipcMain.handle('barLocal:adminRecoveryStatus', () => runtime.adminRecoveryStatus())
  ipcMain.handle('barLocal:adminCopyRecoverySet', (_event, request) => runtime.adminCopyRecoverySet(request))
  ipcMain.handle('barLocal:adminChooseRecoveryDestination', async () => {
    if (!dialog) throw new Error('The recovery destination folder picker is unavailable.')
    await runtime.adminStatus()
    const selection = await dialog.showOpenDialog({ title: 'Choose attached recovery drive folder', properties: ['openDirectory'] })
    if (selection.canceled || !selection.filePaths[0]) return { cancelled: true }
    return runtime.adminSetRecoveryDestination({ folder: selection.filePaths[0], confirm: 'SET_RECOVERY_DESTINATION' })
  })
  ipcMain.handle('barLocal:adminRecoveryJob', (_event, id) => runtime.adminRecoveryJob(id))
  ipcMain.handle('barLocal:adminCreateRecoveryBase', (_event, request) => runtime.adminCreateRecoveryBase(request))
  ipcMain.handle('barLocal:adminVerifyRecoveryPoint', (_event, request) => runtime.adminVerifyRecoveryPoint(request))
  ipcMain.handle('barLocal:adminExportRecoveryKeys', async (_event, request) => {
    if (!dialog) throw new BarLocalAdapterError('SERVICE_UNAVAILABLE', 'The recovery key save dialog is unavailable.')
    await runtime.adminStatus()
    const selection = await dialog.showSaveDialog({ title: 'Save encrypted recovery keys', defaultPath: 'bar-recovery-keys.json', filters: [{ name: 'Encrypted recovery keys', extensions: ['json'] }] })
    if (selection.canceled || !selection.filePath) return { cancelled: true }
    const bundle = await runtime.adminExportRecoveryKeys(request)
    const encrypted = bundle.result
    if (!encrypted || typeof encrypted !== 'object' || encrypted.algorithm !== 'scrypt-aes-256-gcm') throw new BarLocalAdapterError('INTERNAL_ERROR', 'The service did not return an encrypted recovery key bundle.')
    writeDurableAtomic(selection.filePath, JSON.stringify(encrypted))
    return { saved: true, path: selection.filePath }
  })
  ipcMain.handle('barLocal:trainingLaunch', async () => {
    if (runtime.training) throw new Error('You are already in practice mode.')
    await runtime.adminStatus() // Service enforces the signed-in owner's settings capability.
    if (runtime.getOpenIntents().length) throw new Error('Resolve pending live operations before opening practice mode.')
    const env = { ...process.env }
    for (const key of Object.keys(env)) if (/^(BAR_LOCAL_|PG|SUPABASE_|DATABASE_URL$|ELECTRON_RUN_AS_NODE$|BOROKO_TEST_)/i.test(key)) delete env[key]
    const args = app.isPackaged ? ['--bar-training'] : [app.getAppPath(), '--bar-training']
    const child = spawn(process.execPath, args, { env, windowsHide: true, stdio: 'ignore' })
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    child.unref()
    return { opened: true, training: true }
  })
  ipcMain.handle('barLocal:trainingBegin', async (_event, request) => {
    if (!runtime.trainingSupervisor) throw new Error('Practice setup is available only in the isolated practice window.')
    const result = await runtime.trainingSupervisor.start(runtime, request?.pin)
    if (runtime.restartRequired) { app.relaunch(); app.quit() }
    return result
  })
  ipcMain.handle('barLocal:trainingReset', async (_event, request) => {
    if (!runtime.trainingSupervisor) throw new Error('The live workspace cannot be reset by practice controls.')
    await runtime.adminStatus()
    if (runtime.getOpenIntents().length) throw new Error('Resolve the saved practice operations before resetting practice.')
    const result = await runtime.trainingSupervisor.reset(request?.confirm, () => runtime.close())
    app.relaunch(); app.quit()
    return result
  })
  ipcMain.handle('barLocal:serverSetupPreflight', () => serverSetup.preflight())
  ipcMain.handle('barLocal:serverSetupStatus', () => serverSetup.status())
  ipcMain.handle('barLocal:serverSetupBegin', (_event, request) => serverSetup.begin(request))
  ipcMain.handle('barLocal:serverSetupUpdateOwnerEmail', (_event, request) => serverSetup.updateOwnerEmail(request))
  ipcMain.handle('barLocal:serverSetupResume', (_event, request) => provisionAndRestart(() => serverSetup.resume(request)))
  ipcMain.handle('barLocal:serverSetupCancel', () => serverSetup.cancel())
  ipcMain.handle('barLocal:selectCloudWorkspace', () => {
    const result = runtime.selectCloudWorkspace()
    if (result.restart_required) {
      try { app.relaunch(); app.exit(0) }
      catch (error) { runtime.logger.error?.('[BarLocal] Restart required to open the cloud workspace.', error) }
    }
    return result
  })
  // Hand a new local Bar to its own isolated workspace window. This process may
  // already be running another workspace, so commissioning here would mix two
  // authorities. Carry only the Bar's own details and require a visible-window
  // acknowledgement before reporting success.
  ipcMain.handle('barLocal:openLocalBarWorkspace', async (_event, request) => {
    runtime.assertCanOpenLocalBarWorkspace()
    if (request?.resume_existing === true) {
      const saved = join(dirname(dedicatedWorkspacePrefillPath(app.getPath('userData'))), 'bar-local', 'server-setup', 'server-setup.bin')
      if (!existsSync(saved)) throw new BarLocalAdapterError('SETUP_NOT_FOUND', 'No saved local Bar installation was found in this Windows profile. No new Bar was created. Contact support if you used another profile.')
    } else {
      const prefill = normalizeLocalBarSetupRequest(request)
      writeDurableAtomic(
        dedicatedWorkspacePrefillPath(app.getPath('userData')),
        JSON.stringify(buildWorkspacePrefill(prefill, new Date().toISOString()))
      )
    }
    const handoffToken = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')
    let acknowledge
    let rejectReady
    const ready = new Promise((resolve, reject) => { acknowledge = resolve; rejectReady = reject })
    const handoffServer = createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== `/ready/${handoffToken}`) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(204).end()
      acknowledge?.()
    })
    await new Promise((resolve, reject) => {
      handoffServer.once('error', reject)
      handoffServer.listen(0, '127.0.0.1', resolve)
    })
    const address = handoffServer.address()
    if (!address || typeof address === 'string') throw new Error('The local Bar setup window could not be confirmed.')
    const child = spawn(
      process.execPath,
      [...buildWorkspaceLaunchArguments({ isPackaged: app.isPackaged === true, appPath: app.getAppPath() }), `--bar-local-workspace-ready=${address.port}.${handoffToken}`],
      { env: sanitizeWorkspaceEnvironment(process.env), windowsHide: false, stdio: 'ignore' }
    )
    const timeout = setTimeout(() => rejectReady?.(new Error('The local Bar setup window did not become visible. Try again or restart the app.')), 25000)
    const exited = (code, signal) => rejectReady?.(new Error(`The local Bar setup window closed before it was ready (${signal || code || 'startup error'}). Try again or restart the app.`))
    child.once('error', (error) => rejectReady?.(new Error(`The local Bar setup window could not start: ${error.message}`)))
    child.once('exit', exited)
    try {
      await ready
      child.unref()
      return { opened: true, workspace: 'dedicated_local_bar' }
    } finally {
      clearTimeout(timeout)
      child.off('exit', exited)
      handoffServer.close()
    }
  })
  /** @param {() => Promise<unknown>} operation */
  const provisionAndRestart = async (operation) => {
    try {
      return await operation()
    } finally {
      if (runtime.restartRequired) {
        // Exit immediately after the protected profile is committed. If the
        // OS refuses relaunch/exit, the IPC fence remains active and the UI
        // instructs the operator to close and reopen instead of trading here.
        try { app.relaunch(); app.exit(0) }
        catch (error) { runtime.logger.error?.('[BarLocal] Restart required after local setup.', error) }
      }
    }
  }
  ipcMain.handle('barLocal:setupOwner', (_event, request) => provisionAndRestart(() => runtime.setupOwner(request)))
  ipcMain.handle('barLocal:pairDevice', (_event, request) => provisionAndRestart(() => runtime.pairDevice(request)))
  ipcMain.handle('barLocal:reconnectServer', (_event, request) => provisionAndRestart(() => runtime.reconnectServer(request)))
  ipcMain.handle('barLocal:resumeProvisioning', (_event, request) => provisionAndRestart(() => runtime.resumeProvisioning(request)))
  ipcMain.handle('barLocal:login', (_event, request) => runtime.login(request))
  ipcMain.handle('barLocal:recoverOwnerPassword', (_event, request) => serverSetup.recoverOwnerPassword(request))
  ipcMain.handle('barLocal:logout', () => runtime.logout())
  ipcMain.handle('barLocal:startPairing', (_event, request) => runtime.startPairing(request))
  ipcMain.handle('barLocal:query', (_event, name, filters) => runtime.query(name, filters))
  ipcMain.handle('barLocal:requestApprovalForCommand', (_event, request) => runtime.requestApprovalForCommand(request))
  /**
   * @param {() => Promise<unknown>} operation
   * @param {unknown} operationId
   */
  const executeFinancialIntent = async (operation, operationId) => {
    try {
      return await operation()
    } catch (error) {
      // Electron IPC does not reliably preserve custom Error properties.
      // Keep an ambiguous outcome explicit and serializable so the renderer
      // can retry the exact journaled operation rather than inventing a key.
      // The expected-data views below preserve existing thrown-object reads;
      // they do not validate the thrown value or its other fields.
      if (error && typeof error === 'object' && (/** @type {{ outcomeUnknown?: unknown }} */ (error)).outcomeUnknown === true) {
        return {
          ok: false,
          outcome: 'unknown',
          operation_id: (/** @type {{ operationId?: unknown }} */ (error)).operationId || operationId || null,
          error: {
            code: typeof (/** @type {{ code?: unknown }} */ (error)).code === 'string' ? (/** @type {{ code: string }} */ (error)).code : 'UNKNOWN_OUTCOME',
            message: typeof (/** @type {{ message?: unknown }} */ (error)).message === 'string' ? (/** @type {{ message: string }} */ (error)).message : 'The local operation outcome is unknown.',
            retry_same_operation: true
          }
        }
      }
      throw error
    }
  }
  ipcMain.handle('barLocal:command', (_event, request) => executeFinancialIntent(() => runtime.command(request), request?.operation_id))
  ipcMain.handle('barLocal:retryOperation', (_event, operationId) => executeFinancialIntent(() => runtime.retryOperation(operationId), operationId))
  ipcMain.handle('barLocal:getOpenIntents', () => runtime.getOpenIntents())
  ipcMain.handle('barLocal:getOperation', (_event, operationId) => runtime.getOperation(operationId))
  ipcMain.handle('barLocal:adminStatus', () => runtime.adminStatus())
  ipcMain.handle('barLocal:adminBackups', () => runtime.adminBackups())
  ipcMain.handle('barLocal:adminRunBackup', (_event, request) => runtime.adminRunBackup(request))
  ipcMain.handle('barLocal:adminVerifyBackup', (_event, request) => runtime.adminVerifyBackup(request))
  ipcMain.handle('barLocal:adminRestoreDrill', (_event, request) => runtime.adminRestoreDrill(request))
  ipcMain.handle('barLocal:adminReplicationStatus', () => runtime.adminReplicationStatus())
  ipcMain.handle('barLocal:adminSetDurability', (_event, request) => runtime.adminSetDurability(request))
  ipcMain.handle('barLocal:adminSwitchover', (_event, request) => runtime.adminSwitchover(request))
  ipcMain.handle('barLocal:adminUpdateStatus', () => runtime.adminUpdateStatus())
  ipcMain.handle('barLocal:adminImportUpdatePackage', async () => {
    if (!dialog) throw new BarLocalAdapterError('SERVICE_UNAVAILABLE', 'The local update package picker is unavailable.')
    const selection = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (selection.canceled || selection.filePaths.length !== 1) return { canceled: true }
    const response = await runtime.adminUpdateStatus()
    const candidates = [response, response?.data, response?.result]
    const inboxDir = candidates.find((candidate) => candidate && typeof candidate === 'object' && typeof candidate.inbox_dir === 'string')?.inbox_dir
    if (typeof inboxDir !== 'string' || inboxDir.trim() === '') {
      throw new BarLocalAdapterError('SERVICE_UNAVAILABLE', 'The local service did not provide a valid signed-update inbox path.')
    }
    return importUpdatePackageDirectory({ sourceDir: selection.filePaths[0], inboxDir })
  })
  ipcMain.handle('barLocal:adminStageUpdate', (_event, request) => runtime.adminStageUpdate(request))
  ipcMain.handle('barLocal:adminApplyUpdate', (_event, request) => runtime.adminApplyUpdate(request))
  ipcMain.handle('barLocal:adminCloudSyncStatus', () => runtime.adminCloudSyncStatus())
  ipcMain.handle('barLocal:adminCloudSyncConfig', (_event, request) => runtime.adminCloudSyncConfig(request))
  ipcMain.handle('barLocal:adminCloudSyncRun', (_event, request) => runtime.adminCloudSyncRun(request))
  ipcMain.handle('barLocal:refreshReadiness', () => runtime.refreshReadiness())
  ipcMain.handle('barLocal:getCatalogueSnapshot', (_event, options) => runtime.catalogue(options))
  // Do not silently abandon unresolved local operations on close. The first
  // quit attempt is blocked with an actionable recovery instruction. A second
  // deliberate quit is allowed so the operator is never permanently trapped,
  // and the durable journal remains on disk for the next recovery attempt.
  let quitFenceAcknowledged = false
  /** @param {import('electron').Event} event */
  const onBeforeQuit = (event) => {
    try {
      runtime.assertSafeToQuit()
    } catch (error) {
      if (!quitFenceAcknowledged) {
        quitFenceAcknowledged = true
        if (event && typeof event.preventDefault === 'function') event.preventDefault()
        runtime.logger.error?.(
          '[BarLocal] Quit blocked by unresolved local operations. Recover or retry the saved operation with its original operation ID before closing this till. Quit again only to leave with unresolved operations; the durable journal will remain for recovery.',
          error
        )
        return
      }
      runtime.logger.warn?.(
        '[BarLocal] Quitting with unresolved local operations. The durable journal remains on disk and must be recovered before further trading.',
        error
      )
    }
    runtime.close()
  }
  if (typeof app.on === 'function') app.on('before-quit', onBeforeQuit)
  else app.once('before-quit', onBeforeQuit)
  return runtime
}
