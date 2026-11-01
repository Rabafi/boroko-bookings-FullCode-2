import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { IntentJournal, isUuid } from './intents.js';
import { completeLegacyBarPairing, createLegacyBarLocalTransport, LegacyBarLocalClient } from './client.js';
import { verifyBarReplacement } from '../../../../src/shared/barLocalReplacement.js';
import { journalProtection } from '../../../../src/shared/barLocalJournalProtection.js';

/**
 * Keep Legacy cloud IPC unreachable after this device commits to local Bar.
 * The renderer must still go through the fixed `pos:bar-local:*` bridge.
 * @param {{ handle: (channel: string, listener: (...args: any[]) => unknown) => unknown }} ipcMain
 * @param {{ status: () => { authority_mode?: string, restart_required?: boolean, workspace_choice_required?: boolean, provisioning?: boolean } }} runtime
 */
export function installLegacyBarLocalIpcFence(ipcMain, runtime) {
  const registerHandler = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => registerHandler(channel, async (event, ...args) => {
    const status = runtime.status();
    const isLocal = String(channel).startsWith('pos:bar-local:');
    if (status.restart_required && isLocal && channel !== 'pos:bar-local:get-status') {
      throw Object.assign(new Error('Restart this till before signing in or trading. Do not repeat pairing.'), { code: 'LOCAL_RESTART_REQUIRED' });
    }
    if ((status.authority_mode === 'bar_local' || status.workspace_choice_required || status.provisioning) && !isLocal) {
      const error = new Error('This Legacy till is committed to its local Bar authority. This cloud-backed action is blocked until its local workflow is connected.');
      error.code = 'LOCAL_WORKSPACE_NOT_ROUTED';
      throw error;
    }
    return listener(event, ...args);
  });
}

const PROFILE_FILE = 'authority.bin';
const CREDENTIAL_FILE = 'device-credential.bin';
const PROVISIONING_FILE = 'provisioning.bin';
const JOURNAL_FILE = 'intents.jsonl';

function writeAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, value);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, filePath);
    if (process.platform !== 'win32') {
      const directory = openSync(path.dirname(filePath), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

function validateProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.authority_mode !== 'bar_local'
    || !isUuid(value.authority_id) || !Number.isSafeInteger(value.authority_epoch) || value.authority_epoch < 1
    || !isUuid(value.business_id) || !isUuid(value.outlet_id) || !isUuid(value.device_id)
    || typeof value.base_url !== 'string') {
    const error = new Error('The saved Legacy Bar authority profile is invalid. Repair or re-pair this till.');
    error.code = 'AUTHORITY_CONFIG_INVALID';
    throw error;
  }
  return Object.freeze({ ...value });
}

export class LegacyBarLocalRuntime {
  constructor(options) {
    this.userDataPath = options.userDataPath;
    this.safeStorage = options.safeStorage;
    this.root = path.join(options.userDataPath, 'bar-local');
    this.profilePath = path.join(this.root, PROFILE_FILE);
    this.credentialPath = path.join(this.root, CREDENTIAL_FILE);
    this.provisioningPath = path.join(this.root, PROVISIONING_FILE);
    this.journalPath = path.join(this.root, JOURNAL_FILE);
    this.profile = null;
    this.journal = null;
    this.client = null;
    this.session = null;
    this.profileError = null;
    this.journalError = null;
    this.provisioning = false;
    this.readiness = null;
    this.restartRequired = false;
    this.#load();
    this.cloudStartupDeferred = !this.profile && !this.profileError && !this.#hasCloudChoice();
  }

  #hasCloudChoice() {
    try {
      const choice = JSON.parse(readFileSync(path.join(this.root, 'workspace-choice.json'), 'utf8'));
      return choice?.version === 1 && choice.workspace === 'cloud';
    } catch { return false; }
  }

  hasSavedCloudBusiness() {
    // A saved endpoint or any cached business/queue data requires transition
    // review. Missing files are fresh; unreadable state is never assumed empty.
    try {
      if (existsSync(path.join(this.userDataPath, 'pos-config.json'))) return true;
      const cache = path.join(this.userDataPath, 'pos-cache');
      return existsSync(cache) && readdirSync(cache).length > 0;
    } catch { return true; }
  }

  selectCloudWorkspace() {
    if (this.profile || this.profileError || this.provisioning || this.restartRequired) {
      throw Object.assign(new Error('A paired or recovering local Bar cannot switch to cloud.'), { code: 'WRONG_AUTHORITY' });
    }
    writeAtomic(path.join(this.root, 'workspace-choice.json'), JSON.stringify({ version: 1, workspace: 'cloud' }));
    return { restart_required: this.cloudStartupDeferred };
  }

  #decrypt(filePath) {
    const encrypted = readFileSync(filePath);
    if (!this.safeStorage.isEncryptionAvailable()) {
      const error = new Error('Windows secure storage is unavailable; local Bar credentials and profile cannot be opened.');
      error.code = 'SECURE_STORAGE_UNAVAILABLE';
      throw error;
    }
    return this.safeStorage.decryptString(encrypted);
  }

  #readProfile() {
    try {
      return validateProfile(JSON.parse(this.#decrypt(this.profilePath)));
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        if (existsSync(this.credentialPath)) {
          const recovery = new Error('A paired device credential exists without its committed authority profile. Repair or revoke this pairing before continuing.');
          recovery.code = 'PAIRING_RECOVERY_REQUIRED';
          throw recovery;
        }
        const previousPath = path.join(this.root, 'authority.json');
        try {
          const old = JSON.parse(readFileSync(previousPath, 'utf8'));
          if (old && old.authority_mode === 'bar_local') {
            const upgrade = new Error('A previous plaintext Bar authority profile requires secure migration. Cloud fallback is disabled for local Bar work.');
            upgrade.code = 'AUTHORITY_PROFILE_UPGRADE_REQUIRED';
            throw upgrade;
          }
          return null;
        } catch (previousError) {
          if (previousError && previousError.code === 'ENOENT') return null;
          if (previousError && previousError.code === 'AUTHORITY_PROFILE_UPGRADE_REQUIRED') throw previousError;
          const invalid = new Error('A previous Bar authority profile cannot be read safely. Repair is required.');
          invalid.code = 'AUTHORITY_CONFIG_INVALID';
          throw invalid;
        }
      }
      if (error && error.code) throw error;
      const invalid = new Error('The protected Legacy Bar authority profile is invalid. Repair is required before local trading.');
      invalid.code = 'AUTHORITY_CONFIG_INVALID';
      invalid.cause = error;
      throw invalid;
    }
  }

  #readCredential() {
    const parsed = JSON.parse(this.#decrypt(this.credentialPath));
    if (!parsed || typeof parsed.device_id !== 'string' || typeof parsed.device_token !== 'string'
      || !isUuid(parsed.device_id) || parsed.device_token.length < 20) {
      const error = new Error('The protected Legacy Bar device credential is malformed.');
      error.code = 'DEVICE_CREDENTIAL_UNAVAILABLE';
      throw error;
    }
    return parsed;
  }

  #writeProtected(filePath, plaintext) {
    if (!this.safeStorage.isEncryptionAvailable()) {
      const error = new Error('Windows secure storage is unavailable; device credentials were not saved.');
      error.code = 'SECURE_STORAGE_UNAVAILABLE';
      throw error;
    }
    writeAtomic(filePath, this.safeStorage.encryptString(plaintext));
  }

  #readProvisioning() {
    try {
      const value = JSON.parse(this.#decrypt(this.provisioningPath));
      if (!value || value.kind !== 'pairing' || !value.request || typeof value.request !== 'object') {
        const error = new Error('The protected pairing recovery record is invalid. Preserve this till for recovery.');
        error.code = 'PROVISIONING_STATE_CORRUPT';
        throw error;
      }
      return value;
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  #clearProvisioning() {
    try { unlinkSync(this.provisioningPath); }
    catch (error) { if (!error || error.code !== 'ENOENT') throw error; }
  }

  #load() {
    try {
      this.profile = this.#readProfile();
      if (!this.profile) return;
      const credential = this.#readCredential();
      if (credential.device_id !== this.profile.device_id) {
        const error = new Error('The saved device credential does not match the committed Legacy Bar profile.');
        error.code = 'DEVICE_CREDENTIAL_SCOPE_MISMATCH';
        throw error;
      }
      // A crash after profile/credential commit but before staging cleanup
      // leaves a harmless encrypted recovery file. Clear only when the
      // staged secret is exactly the credential already bound to this device.
      try {
        const pending = this.#readProvisioning();
        if (pending && pending.request.deviceToken === credential.device_token) this.#clearProvisioning();
      } catch (error) {
        // Keep unreadable or unrelated recovery evidence for an explicit
        // repair path; it must never replace the committed profile.
        this.provisioningRecoveryError = error;
      }
      try {
        this.journal = new IntentJournal({ filePath: this.journalPath, protection: journalProtection(this.safeStorage) });
      } catch (error) {
        this.journalError = error;
        throw error;
      }
      this.client = this.#createClient(credential.device_token);
    } catch (error) {
      this.profileError = error;
      this.client = null;
      this.journal = null;
    }
  }

  #createClient(deviceToken) {
    return new LegacyBarLocalClient({
      scope: {
        authority_id: this.profile.authority_id,
        authority_epoch: this.profile.authority_epoch,
        business_id: this.profile.business_id,
        outlet_id: this.profile.outlet_id,
        device_id: this.profile.device_id,
        deviceToken
      },
      baseUrl: this.profile.base_url,
      certificateFingerprint: this.profile.certificate_fingerprint,
      journal: this.journal
    });
  }

  status() {
    const configured = this.profile !== null;
    let provisioningRecovery = null;
    try {
      const pending = this.#readProvisioning();
      if (pending) provisioningRecovery = { pending: true, kind: pending.kind, recoverable: true };
    } catch (error) {
      provisioningRecovery = { pending: true, kind: 'pairing', recoverable: false, code: error.code || 'PROVISIONING_STATE_CORRUPT' };
    }
    return Object.freeze({
      authority_mode: configured || this.profileError ? 'bar_local' : 'cloud',
      configured,
      workspace_choice_required: this.cloudStartupDeferred,
      has_saved_cloud_business: this.hasSavedCloudBusiness(),
      restart_required: this.restartRequired,
      provisioning: this.provisioning,
      provisioning_recovery: provisioningRecovery,
      ready_for_local_session: configured && this.client !== null,
      session_active: Boolean(this.session),
      staff: this.session ? this.session.staff : null,
      authority_id: this.profile?.authority_id || null,
      authority_epoch: this.profile?.authority_epoch || null,
      business_id: this.profile?.business_id || null,
      outlet_id: this.profile?.outlet_id || null,
      device_id: this.profile?.device_id || null,
      journal_available: this.journal !== null,
      journal_error: this.journalError
        ? { code: this.journalError.code || 'JOURNAL_UNAVAILABLE', message: this.journalError.message }
        : null,
      pending_intents: this.journal ? this.journal.listOpenIntents().length : null,
      readiness: this.readiness,
      blocked_reason: this.profileError ? { code: this.profileError.code || 'RECOVERY_REQUIRED', message: this.profileError.message } : null
    });
  }

  async pairDevice(options) {
    if (this.profile || this.profileError) {
      const error = new Error('This Legacy till already has a Bar authority profile or requires repair.');
      error.code = 'SETUP_ALREADY_COMMISSIONED';
      throw error;
    }
    if (this.provisioning) {
      const error = new Error('Another Legacy Bar pairing operation is already running.');
      error.code = 'SETUP_IN_PROGRESS';
      throw error;
    }
    if (this.hasSavedCloudBusiness()) {
      throw Object.assign(new Error('This till has saved cloud configuration or business data. Preserve its queue and complete a verified migration before local pairing.'), { code: 'CLOUD_TRANSITION_REQUIRED' });
    }
    if (!this.cloudStartupDeferred) {
      // The cloud workspace is already live in this process (its queue, mesh
      // and Supabase client started at boot). Pairing here would create a
      // second authority. A fresh process must choose local first.
      throw Object.assign(
        new Error('This Legacy till is set to the cloud workspace and that workspace has already started. Local Bar pairing must be chosen from the workspace chooser on a fresh launch.'),
        { code: 'CLOUD_WORKSPACE_ACTIVE' }
      );
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      const error = new Error('Windows secure storage is required before pairing this Legacy till.');
      error.code = 'SECURE_STORAGE_UNAVAILABLE';
      throw error;
    }
    let pending = this.#readProvisioning();
    if (pending) options = pending.request;
    else {
      const tokenBytes = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      pending = { kind: 'pairing', request: {
        baseUrl: options.baseUrl || options.base_url,
        certificateFingerprint: options.certificateFingerprint || options.certificate_fingerprint,
        pairingCode: options.pairingCode || options.pairing_code,
        deviceName: options.deviceName || options.device_name,
        provisioningId: randomUUID(),
        deviceToken: `bld_${tokenBytes}`
      } };
      this.#writeProtected(this.provisioningPath, JSON.stringify(pending));
    }
    this.provisioning = true;
    let result = null;
    try {
      // Recover and durably establish the journal before consuming the code.
      this.journal = new IntentJournal({ filePath: this.journalPath, protection: journalProtection(this.safeStorage) });
      result = await completeLegacyBarPairing(pending.request);
      const profile = validateProfile(result.profile);
      this.#writeProtected(this.credentialPath, JSON.stringify({ device_id: profile.device_id, device_token: result.deviceToken }));
      try {
        this.#writeProtected(this.profilePath, JSON.stringify(profile));
      } catch (error) {
        try { unlinkSync(this.credentialPath); } catch {}
        throw error;
      }
      this.profile = profile;
      this.#clearProvisioning();
      this.client = new LegacyBarLocalClient({
        scope: { ...this.profile, deviceToken: result.deviceToken },
        journal: this.journal,
        transport: result.transport
      });
      return this.status();
    } catch (error) {
      if (result && result.transport) result.transport.close();
      throw error;
    } finally {
      this.provisioning = false;
    }
  }

  async resumeProvisioning() {
    const pending = this.#readProvisioning();
    if (!pending || pending.kind !== 'pairing') {
      throw Object.assign(new Error('There is no saved Legacy Bar pairing to resume.'), { code: 'PROVISIONING_NOT_FOUND' });
    }
    return this.pairDevice({});
  }

  async login(staffId, pin) {
    if (!this.client) throw this.profileError || Object.assign(new Error('No paired local Bar authority is configured.'), { code: 'WRONG_AUTHORITY' });
    const session = await this.client.login(staffId, pin);
    this.session = { staff: session.staff, outlet_id: session.outlet_id, expires_at: session.expires_at };
    return { ok: true, staff: session.staff, outlet_id: session.outlet_id, expires_at: session.expires_at };
  }

  async reconnectServer(request) {
    if (!this.profile || this.provisioning) throw new Error('The original local Bar profile is required.');
    const credential = this.#readCredential();
    const transport = createLegacyBarLocalTransport({ baseUrl: request.base_url, certificateFingerprint: request.certificate_fingerprint });
    try {
      const proof = await verifyBarReplacement(
        this.profile,
        credential,
        request,
        (method, pathname, options) => transport.request(method, pathname, options),
        { base_url: transport.baseUrl, fingerprint: transport.fingerprint }
      );
      const next = validateProfile({ ...this.profile, authority_epoch: proof.authority_epoch, base_url: transport.baseUrl, certificate_fingerprint: transport.fingerprint });
      this.#writeProtected(this.profilePath, JSON.stringify(next));
      this.profile = next; this.restartRequired = true; this.close();
      return { restart_required: true, saved_operations_preserved: true };
    } finally { transport.close(); }
  }

  async logout() {
    const result = await this.#requireClient().logout();
    this.session = null;
    return result;
  }
  async startPairing(options = {}) { return this.#requireClient().startPairing(options); }
  async adminStatus() { return this.#requireClient().adminStatus(); }
  async adminBackups() { return this.#requireClient().adminBackups(); }
  async adminRunBackup(request = {}) { return this.#requireClient().adminRunBackup(request); }
  async adminVerifyBackup(request) { return this.#requireClient().adminVerifyBackup(request); }
  async adminRestoreDrill(request) { return this.#requireClient().adminRestoreDrill(request); }
  async adminReplicationStatus() { return this.#requireClient().adminReplicationStatus(); }
  async adminSetDurability(request) { return this.#requireClient().adminSetDurability(request); }
  async adminSwitchover(request) { return this.#requireClient().adminSwitchover(request); }
  async adminUpdateStatus() { return this.#requireClient().adminUpdateStatus(); }
  async adminCloudSyncStatus() { return this.#requireClient().adminCloudSyncStatus(); }
  async adminCloudSyncConfig(request) { return this.#requireClient().adminCloudSyncConfig(request); }
  async adminCloudSyncRun(request = {}) { return this.#requireClient().adminCloudSyncRun(request); }
  async query(name, filters = {}) { return this.#requireClient().query(name, filters); }
  async events(after = 0, limit = 200) { return this.#requireClient().events(after, limit); }
  async requestApproval(command, payload, pin, options = {}) { return this.#requireClient().requestApproval(command, payload, pin, options); }
  async command(command, payload, options = {}) { return this.#requireClient().command(command, payload, options); }
  async retry(operationId) { return this.#requireClient().retry(operationId); }
  async resolve(operationId) { return this.#requireClient().resolve(operationId); }
  async getOperation(operationId) { return this.#requireClient().getOperation(operationId); }
  getOpenIntents() {
    if (!this.journal) {
      // Never report "no unresolved work" when the durable journal could not be
      // read. A paired till must show the recovery block instead of trading on
      // an empty, invented queue.
      if (this.profile) {
        throw this.profileError || Object.assign(
          new Error('The local Bar intent journal is unavailable. Trading is paused until it is recovered.'),
          { code: 'RECOVERY_REQUIRED' }
        );
      }
      return [];
    }
    return this.journal.listOpenIntents().map((intent) => ({
      operation_id: intent.operation_id,
      command: intent.command,
      state: intent.state,
      attempts: intent.attempts,
      created_at: intent.created_at,
      updated_at: intent.updated_at
    }));
  }
  async refreshReadiness() {
    try { this.readiness = await this.#requireClient().healthReady(); return this.readiness; }
    catch (error) { this.readiness = null; throw error; }
  }

  #requireClient() {
    if (!this.client) throw this.profileError || Object.assign(new Error('No paired local Bar authority is configured.'), { code: 'WRONG_AUTHORITY' });
    return this.client;
  }

  close() {
    if (this.client && this.client.transport) this.client.transport.close();
    this.client = null;
    this.session = null;
    this.journal = null;
  }
}
