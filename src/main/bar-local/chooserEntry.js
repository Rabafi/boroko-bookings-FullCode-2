// @ts-check

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LOCAL_BAR_WORKSPACE_DIR } from '../../shared/barLocalWorkspace.js'
import { AUTHORITY_MODES, validateAuthorityConfig } from './authority.js'

const SETUP_PHASES = new Set(['prepared', 'installing', 'installed', 'owner_pending', 'complete', 'failed'])
const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** @param {unknown} value */
function safeLabel(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null
}

/** @param {string} file @param {{isEncryptionAvailable(): boolean, decryptString(value: Buffer): string}} safeStorage */
function readProtectedRecord(file, safeStorage) {
  if (!existsSync(file)) return { exists: false, value: null, readable: true }
  if (!safeStorage.isEncryptionAvailable()) return { exists: true, value: null, readable: false }
  try {
    const value = JSON.parse(safeStorage.decryptString(readFileSync(file)))
    return { exists: true, value: value && typeof value === 'object' && !Array.isArray(value) ? value : null, readable: Boolean(value && typeof value === 'object' && !Array.isArray(value)) }
  } catch {
    return { exists: true, value: null, readable: false }
  }
}

/**
 * Read only the public chooser identity from the dedicated Bar workspace.
 * Completion is based on its durable owner-complete record or committed
 * authority profile; service reachability/readiness is deliberately excluded.
 * @param {{userDataPath: string, safeStorage: {isEncryptionAvailable(): boolean, decryptString(value: Buffer): string}}} options
 */
export function readLocalBarChooserEntry({ userDataPath, safeStorage }) {
  const root = join(userDataPath, LOCAL_BAR_WORKSPACE_DIR, 'bar-local')
  const setup = readProtectedRecord(join(root, 'server-setup', 'server-setup.bin'), safeStorage)
  const authority = readProtectedRecord(join(root, 'authority.bin'), safeStorage)
  const hasLegacyProvisioning = existsSync(join(root, 'provisioning.bin'))
  let linkedProfileId = null
  const link = readProtectedRecord(join(root, 'chooser-link.bin'), safeStorage).value
  if (link?.version === 1 && typeof link.profile_id === 'string' && PROFILE_ID.test(link.profile_id)) linkedProfileId = link.profile_id

  const state = setup.value
  const validSetup = setup.readable && state?.version === 1 && SETUP_PHASES.has(state.phase)
    && state.owner && typeof state.owner === 'object' && !Array.isArray(state.owner)
  const setupName = validSetup
    ? safeLabel(state.owner.business_name) || safeLabel(state.owner.business_profile?.company_name)
    : null
  let committedLocalAuthority = false
  if (authority.readable && authority.value) {
    try { committedLocalAuthority = validateAuthorityConfig(authority.value).authority_mode === AUTHORITY_MODES.BAR_LOCAL }
    catch {}
  }

  if (committedLocalAuthority || (validSetup && state.phase === 'complete')) {
    return { status: 'ready', label: setupName || safeLabel(authority.value?.business_name) || 'Local Bar', origin_profile_id: linkedProfileId }
  }
  if (validSetup) {
    return { status: 'draft', label: setupName || 'Saved Bar setup', origin_profile_id: linkedProfileId }
  }
  const hasSavedRecord = setup.exists || authority.exists || hasLegacyProvisioning
  if (hasSavedRecord) {
    return { status: 'recovery', label: 'Saved Bar setup', origin_profile_id: linkedProfileId }
  }
  return { status: 'none', label: null, origin_profile_id: null }
}

/** @param {unknown} value */
export function isLocalProfileId(value) {
  return typeof value === 'string' && PROFILE_ID.test(value)
}

/**
 * Explicitly associate one real draft profile with a saved local Bar attempt.
 * The profile cache remains untouched; only the encrypted chooser relationship
 * is written. No display-name comparison is used.
 * @param {{userDataPath: string, safeStorage: {isEncryptionAvailable(): boolean, encryptString(value: string): Buffer, decryptString(value: Buffer): string}, profileId: unknown}} options
 */
export function linkLocalBarChooserDraft({ userDataPath, safeStorage, profileId }) {
  if (!isLocalProfileId(profileId)) throw new Error('Select a saved draft profile to link to this Bar.')
  const entry = readLocalBarChooserEntry({ userDataPath, safeStorage })
  if (entry.status === 'none') throw new Error('No saved local Bar setup was found. The profile was not changed.')
  const registryPath = join(userDataPath, 'profiles.json')
  let registry
  try { registry = JSON.parse(readFileSync(registryPath, 'utf8')) }
  catch { throw new Error('Saved business profiles could not be checked. Nothing was linked.') }
  const profile = Array.isArray(registry?.profiles)
    ? registry.profiles.find((item) => item && item.lodge_id === profileId && item.status === 'draft')
    : null
  if (!profile) throw new Error('That saved draft was not found. Nothing was linked.')
  if (entry.origin_profile_id && entry.origin_profile_id !== profileId) {
    throw new Error('This Bar is already linked to a different saved draft. Nothing was changed.')
  }
  if (entry.origin_profile_id === profileId) return entry

  const file = join(userDataPath, LOCAL_BAR_WORKSPACE_DIR, 'bar-local', 'chooser-link.bin')
  if (existsSync(file) && !entry.origin_profile_id) throw new Error('The saved Bar profile link could not be verified. Nothing was changed.')
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`
  mkdirSync(dirname(file), { recursive: true })
  let fd
  try {
    fd = openSync(temporary, 'wx', 0o600)
    writeFileSync(fd, safeStorage.encryptString(JSON.stringify({ version: 1, profile_id: profileId })))
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(temporary, file)
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temporary) } catch {}
    throw error
  }
  return readLocalBarChooserEntry({ userDataPath, safeStorage })
}
