import { createHash } from 'node:crypto'

const HASH_PATTERN = /^[0-9a-f]{64}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ExportManifestEvent {
  readonly event_id: string
  readonly commit_sequence: number
  readonly event_index: number
  readonly event_type: string
  readonly operation_id: string
  readonly authority_epoch: number
  readonly payload: unknown
  readonly payload_hash: string
  readonly created_at: string
}

export interface ExportManifestInput {
  readonly batch_id: string
  readonly authority_id: string
  readonly authority_epoch: number
  readonly business_id: string
  readonly outlet_id: string
  readonly from_sequence: number
  readonly to_sequence: number
  readonly checkpoint: number
  readonly created_at: string
  readonly events: readonly ExportManifestEvent[]
}

export interface ExportManifest {
  readonly schema: 'bar-local-export-bundle'
  readonly schema_version: 1
  readonly batch_id: string
  readonly authority_id: string
  readonly authority_epoch: number
  readonly business_id: string
  readonly outlet_id: string
  readonly from_sequence: number
  readonly to_sequence: number
  readonly checkpoint: number
  readonly event_count: number
  readonly created_at: string
  readonly events: readonly ExportManifestEvent[]
}

export interface ExportBundle extends ExportManifest {
  readonly manifest_hash: string
  readonly status: 'integration_disabled'
  readonly signature: null
  readonly signature_key_id: null
  readonly signature_status: 'unavailable'
  readonly transport_status: 'integration_disabled'
}

export interface SignedExportBundle extends ExportManifest {
  readonly manifest_hash: string
  readonly status: 'integration_disabled'
  readonly signature: string
  readonly signature_key_id: string
  readonly signature_status: 'signed'
  readonly signature_algorithm: string
  readonly transport_status: 'integration_disabled'
}

export interface ExportSigner {
  readonly keyId: string
  readonly algorithm: string
  sign(payloadHash: string): Promise<string>
}

export interface FakeReceiverAcknowledgement {
  readonly accepted: boolean
  readonly idempotent: boolean
  readonly receiver_reference: string | null
  readonly reason: string | null
}

export interface FakeExportReceiver {
  readonly received: readonly ExportBundle[]
  receive(bundle: ExportBundle): Promise<FakeReceiverAcknowledgement>
}

export class ExportIntegrationDisabledError extends Error {
  readonly code = 'EXPORT_DISABLED'

  constructor(message = 'Local export signing is not available. The bundle remains unsigned and cloud transport is disabled.') {
    super(message)
    this.name = 'ExportIntegrationDisabledError'
  }
}

export class ExportBundleIntegrityError extends Error {
  readonly code = 'EXPORT_BUNDLE_INTEGRITY_FAILED'

  constructor(message: string) {
    super(message)
    this.name = 'ExportBundleIntegrityError'
  }
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function ensureSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ExportBundleIntegrityError(`${label} must be a non-negative safe integer.`)
  }
}

function ensureUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new ExportBundleIntegrityError(`${label} must be a UUID.`)
  }
}

function encodeJson(value: unknown, depth: number, seen: Set<object>): string {
  if (depth > 64) {
    throw new ExportBundleIntegrityError('The export value exceeds the supported nesting depth.')
  }
  if (value === null) return 'null'
  const kind = typeof value
  if (kind === 'string') return JSON.stringify(value)
  if (kind === 'boolean') return value ? 'true' : 'false'
  if (kind === 'number') {
    if (!Number.isFinite(value)) {
      throw new ExportBundleIntegrityError('The export value contains a non-finite number.')
    }
    return JSON.stringify(value)
  }
  if (kind !== 'object') {
    throw new ExportBundleIntegrityError(`The export value contains an unsupported ${kind} value.`)
  }
  const object = value as object
  if (seen.has(object)) {
    throw new ExportBundleIntegrityError('The export value contains a circular reference.')
  }
  seen.add(object)
  try {
    if (Array.isArray(value)) {
      const items: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new ExportBundleIntegrityError('The export value contains a sparse array.')
        }
        items.push(encodeJson(value[index], depth + 1, seen))
      }
      return `[${items.join(',')}]`
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ExportBundleIntegrityError('The export value contains an unsupported object type.')
    }
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort(compareUtf8)
    const members = keys.map((key) => {
      const member = record[key]
      if (member === undefined) {
        throw new ExportBundleIntegrityError(`The export value contains an undefined member: ${key}`)
      }
      return `${JSON.stringify(key)}:${encodeJson(member, depth + 1, seen)}`
    })
    return `{${members.join(',')}}`
  } finally {
    seen.delete(object)
  }
}

export function canonicalJson(value: unknown): string {
  return encodeJson(value, 0, new Set<object>())
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function hashExportEvent(event: ExportManifestEvent): string {
  return sha256Hex(canonicalJson(event.payload))
}

function normalizeEvent(event: ExportManifestEvent): ExportManifestEvent {
  ensureUuid(event.event_id, 'event_id')
  ensureUuid(event.operation_id, 'operation_id')
  ensureSafeInteger(event.commit_sequence, 'commit_sequence')
  ensureSafeInteger(event.event_index, 'event_index')
  ensureSafeInteger(event.authority_epoch, 'authority_epoch')
  if (event.event_type.length === 0) {
    throw new ExportBundleIntegrityError('event_type cannot be empty.')
  }
  if (!HASH_PATTERN.test(event.payload_hash)) {
    throw new ExportBundleIntegrityError('payload_hash must be a lowercase SHA-256 hex digest.')
  }
  if (hashExportEvent(event) !== event.payload_hash) {
    throw new ExportBundleIntegrityError(`Export event ${event.event_id} payload_hash does not match its payload.`)
  }
  if (event.created_at.length === 0) {
    throw new ExportBundleIntegrityError('created_at cannot be empty.')
  }
  return {
    event_id: event.event_id,
    commit_sequence: event.commit_sequence,
    event_index: event.event_index,
    event_type: event.event_type,
    operation_id: event.operation_id,
    authority_epoch: event.authority_epoch,
    payload: event.payload,
    payload_hash: event.payload_hash,
    created_at: event.created_at
  }
}

export function buildExportManifest(input: ExportManifestInput): ExportManifest {
  ensureUuid(input.batch_id, 'batch_id')
  ensureUuid(input.authority_id, 'authority_id')
  ensureUuid(input.business_id, 'business_id')
  ensureUuid(input.outlet_id, 'outlet_id')
  ensureSafeInteger(input.authority_epoch, 'authority_epoch')
  ensureSafeInteger(input.from_sequence, 'from_sequence')
  ensureSafeInteger(input.to_sequence, 'to_sequence')
  ensureSafeInteger(input.checkpoint, 'checkpoint')
  if (input.to_sequence < input.from_sequence) {
    throw new ExportBundleIntegrityError('to_sequence cannot be before from_sequence.')
  }
  if (input.checkpoint !== input.to_sequence) {
    throw new ExportBundleIntegrityError('The export checkpoint must equal to_sequence.')
  }
  if (input.created_at.length === 0) {
    throw new ExportBundleIntegrityError('created_at cannot be empty.')
  }
  const events = input.events.map(normalizeEvent)
  const eventIds = new Set<string>()
  const eventKeys = new Set<string>()
  for (const event of events) {
    if (eventIds.has(event.event_id)) {
      throw new ExportBundleIntegrityError(`Duplicate export event_id: ${event.event_id}`)
    }
    eventIds.add(event.event_id)
    const key = `${event.commit_sequence}:${event.event_index}`
    if (eventKeys.has(key)) {
      throw new ExportBundleIntegrityError(`Duplicate export event position: ${key}`)
    }
    eventKeys.add(key)
    if (event.commit_sequence < input.from_sequence || event.commit_sequence > input.to_sequence) {
      throw new ExportBundleIntegrityError('An export event is outside the declared sequence range.')
    }
  }
  events.sort((left, right) => left.commit_sequence - right.commit_sequence || left.event_index - right.event_index)
  return {
    schema: 'bar-local-export-bundle',
    schema_version: 1,
    batch_id: input.batch_id,
    authority_id: input.authority_id,
    authority_epoch: input.authority_epoch,
    business_id: input.business_id,
    outlet_id: input.outlet_id,
    from_sequence: input.from_sequence,
    to_sequence: input.to_sequence,
    checkpoint: input.checkpoint,
    event_count: events.length,
    created_at: input.created_at,
    events
  }
}

export function hashExportManifest(manifest: ExportManifest): string {
  return sha256Hex(canonicalJson(manifest))
}

export function buildExportBundle(input: ExportManifestInput): ExportBundle {
  const manifest = buildExportManifest(input)
  return {
    ...manifest,
    manifest_hash: hashExportManifest(manifest),
    status: 'integration_disabled',
    signature: null,
    signature_key_id: null,
    signature_status: 'unavailable',
    transport_status: 'integration_disabled'
  }
}

function manifestFromBundle(bundle: ExportBundle | SignedExportBundle): ExportManifest {
  return {
    schema: bundle.schema,
    schema_version: bundle.schema_version,
    batch_id: bundle.batch_id,
    authority_id: bundle.authority_id,
    authority_epoch: bundle.authority_epoch,
    business_id: bundle.business_id,
    outlet_id: bundle.outlet_id,
    from_sequence: bundle.from_sequence,
    to_sequence: bundle.to_sequence,
    checkpoint: bundle.checkpoint,
    event_count: bundle.event_count,
    created_at: bundle.created_at,
    events: bundle.events
  }
}

export function verifyExportBundle(bundle: ExportBundle | SignedExportBundle): void {
  const manifest = manifestFromBundle(bundle)
  const normalizedManifest = buildExportManifest(manifest)
  if (canonicalJson(normalizedManifest) !== canonicalJson(manifest)) {
    throw new ExportBundleIntegrityError('The export manifest events are not in canonical sequence order.')
  }
  const expected = hashExportManifest(manifest)
  if (expected !== bundle.manifest_hash) {
    throw new ExportBundleIntegrityError('The export manifest hash does not match its contents.')
  }
  if (manifest.event_count !== manifest.events.length) {
    throw new ExportBundleIntegrityError('The export manifest event_count does not match its events.')
  }
  if (!HASH_PATTERN.test(bundle.manifest_hash)) {
    throw new ExportBundleIntegrityError('manifest_hash must be a lowercase SHA-256 hex digest.')
  }
}

export async function signExportBundle(bundle: ExportBundle, signer?: ExportSigner): Promise<SignedExportBundle> {
  verifyExportBundle(bundle)
  if (signer === undefined) {
    throw new ExportIntegrationDisabledError()
  }
  if (signer.keyId.trim().length === 0 || signer.algorithm.trim().length === 0) {
    throw new ExportBundleIntegrityError('The export signer must identify its key and algorithm.')
  }
  const signature = await signer.sign(bundle.manifest_hash)
  if (signature.trim().length < 16 || /^(fake|test|unsigned|placeholder)$/i.test(signature.trim())) {
    throw new ExportBundleIntegrityError('The export signer did not return a usable signature.')
  }
  return {
    ...manifestFromBundle(bundle),
    manifest_hash: bundle.manifest_hash,
    status: 'integration_disabled',
    signature,
    signature_key_id: signer.keyId,
    signature_status: 'signed',
    signature_algorithm: signer.algorithm,
    transport_status: 'integration_disabled'
  }
}

export function createFakeExportReceiver(): FakeExportReceiver {
  const received: ExportBundle[] = []
  const batchHashes = new Map<string, string>()
  const eventIds = new Set<string>()
  return {
    get received() {
      return structuredClone(received)
    },
    async receive(bundle: ExportBundle): Promise<FakeReceiverAcknowledgement> {
      verifyExportBundle(bundle)
      const previousHash = batchHashes.get(bundle.batch_id)
      if (previousHash !== undefined) {
        if (previousHash !== bundle.manifest_hash) {
          return { accepted: false, idempotent: false, receiver_reference: null, reason: 'batch_payload_conflict' }
        }
        return {
          accepted: true,
          idempotent: true,
          receiver_reference: `fake-receiver:${bundle.batch_id}`,
          reason: null
        }
      }
      for (const event of bundle.events) {
        if (eventIds.has(event.event_id)) {
          return {
            accepted: false,
            idempotent: false,
            receiver_reference: null,
            reason: `duplicate_event:${event.event_id}`
          }
        }
      }
      batchHashes.set(bundle.batch_id, bundle.manifest_hash)
      for (const event of bundle.events) {
        eventIds.add(event.event_id)
      }
      received.push(structuredClone(bundle))
      return {
        accepted: true,
        idempotent: false,
        receiver_reference: `fake-receiver:${bundle.batch_id}`,
        reason: null
      }
    }
  }
}
