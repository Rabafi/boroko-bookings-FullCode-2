import { array, boolean, fail, integer, object, optionalBoolean, optionalString, string, uuid } from './validation.js'
import type { Payload } from './validation.js'

const DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const DATABASE_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const HASH_RE = /^[0-9a-f]{64}$/

export interface CommandReceipt extends Payload {
  operation_id: string
  outcome: 'committed_local'
  authority_id: string
  authority_epoch: number
  business_id: string
  outlet_id: string
  device_id: string
  actor_staff_id: string
  commit_sequence: number
  business_date: string
  server_committed_at: string
  cloud_status: 'integration_disabled'
}

export interface CommandRefusal extends Payload {
  code: string
  message: string
  retry_same_operation: boolean
  requires_manager: boolean
}

export interface CommandOutcome extends Payload {
  ok: boolean
  outcome: 'committed_local' | 'refused'
  replayed?: boolean
  receipt?: CommandReceipt
  result?: Payload
  error?: CommandRefusal
}

export interface QueryPagination extends Payload {
  next_cursor: string | null
  has_more: boolean
}

export interface QueryScope extends Payload {
  business_id: string
  outlet_id: string
  actor_staff_id: string
  role: string
  device_id: string
}

export interface QueryResult extends Payload {
  data: Payload | unknown[]
  pagination: QueryPagination
  snapshot_watermark: number
  scope: QueryScope
  as_of: string
  complete: boolean
  unavailable: string[]
}

export interface EventScope extends Payload {
  business_id: string
  outlet_id: string
  device_id: string
}

export interface EventRecord extends Payload {
  commit_sequence: number
  event_index: number
  event_type: string
  operation_id: string
  payload: Payload
  payload_hash: string
  created_at: string
}

export interface EventFeed extends Payload {
  events: EventRecord[]
  event_count: number
  next_cursor: number
  latest_commit_sequence: number
  latest_event_sequence: number
  retention_floor_sequence: number | null
  gap_detected: boolean
  complete: boolean
  scope: EventScope
}

export interface OperationStatusResult extends Payload {
  operation_id: string
  command: string
  status: 'executing' | 'committed' | 'refused'
  outcome: string | null
  receipt: CommandReceipt | null
  result: Payload | null
  error: CommandRefusal | null
  commit_sequence: number | null
  business_date: string | null
  created_at: string
  committed_at: string | null
  refused_at: string | null
}

export interface ReadinessResult extends Payload {
  ready: boolean
  authority_epoch: number
  authority_id: string
  business_id: string
  outlet_id: string
  schema_version: string
  commit_sequence: number
  blockers: string[]
  cloud_export: 'integration_disabled'
}

function validateReceipt(value: unknown): CommandReceipt {
  const receipt = object(value, 'command.receipt')
  uuid(receipt.operation_id, 'command.receipt.operation_id')
  if (receipt.outcome !== 'committed_local') {
    fail('command.receipt.outcome', 'must be committed_local')
  }
  uuid(receipt.authority_id, 'command.receipt.authority_id')
  integer(receipt.authority_epoch, 'command.receipt.authority_epoch', { min: 1 })
  uuid(receipt.business_id, 'command.receipt.business_id')
  uuid(receipt.outlet_id, 'command.receipt.outlet_id')
  uuid(receipt.device_id, 'command.receipt.device_id')
  uuid(receipt.actor_staff_id, 'command.receipt.actor_staff_id')
  integer(receipt.commit_sequence, 'command.receipt.commit_sequence', { min: 1 })
  string(receipt.business_date, 'command.receipt.business_date', { pattern: DATE_RE })
  string(receipt.server_committed_at, 'command.receipt.server_committed_at', { pattern: TIMESTAMP_RE })
  if (receipt.cloud_status !== 'integration_disabled') {
    fail('command.receipt.cloud_status', 'must be integration_disabled')
  }
  return receipt as CommandReceipt
}

export function validateCommandOutcome(value: unknown): CommandOutcome {
  const outcome = object(value, 'command')
  const ok = boolean(outcome.ok, 'command.ok')
  const state = string(outcome.outcome, 'command.outcome', { min: 1, max: 40 })
  optionalBoolean(outcome.replayed, 'command.replayed')
  if (ok) {
    if (state !== 'committed_local') fail('command.outcome', 'must be committed_local for a successful command')
    validateReceipt(outcome.receipt)
    object(outcome.result, 'command.result')
    return outcome as CommandOutcome
  }
  if (state !== 'refused') fail('command.outcome', 'must be refused for an unsuccessful command')
  const error = object(outcome.error, 'command.error')
  string(error.code, 'command.error.code', { min: 1, max: 80 })
  string(error.message, 'command.error.message', { min: 1, max: 2000 })
  boolean(error.retry_same_operation, 'command.error.retry_same_operation')
  boolean(error.requires_manager, 'command.error.requires_manager')
  return outcome as CommandOutcome
}

export function validateQueryResult(value: unknown): QueryResult {
  const result = object(value, 'query')
  if (Array.isArray(result.data)) {
    array(result.data, 'query.data', { max: 10000 })
  } else {
    object(result.data, 'query.data')
  }

  const pagination = object(result.pagination, 'query.pagination')
  const nextCursor = optionalString(pagination.next_cursor, 'query.pagination.next_cursor', { max: 500 })
  const hasMore = boolean(pagination.has_more, 'query.pagination.has_more')
  if (hasMore && nextCursor === null) {
    fail('query.pagination.next_cursor', 'must be present when has_more is true')
  }

  integer(result.snapshot_watermark, 'query.snapshot_watermark', { min: 0 })

  const scope = object(result.scope, 'query.scope')
  uuid(scope.business_id, 'query.scope.business_id')
  uuid(scope.outlet_id, 'query.scope.outlet_id')
  uuid(scope.actor_staff_id, 'query.scope.actor_staff_id')
  string(scope.role, 'query.scope.role', { min: 1, max: 40 })
  uuid(scope.device_id, 'query.scope.device_id')

  string(result.as_of, 'query.as_of', { pattern: TIMESTAMP_RE })
  boolean(result.complete, 'query.complete')
  const unavailable = array(result.unavailable, 'query.unavailable', { max: 100 })
  unavailable.forEach((reason, index) => {
    string(reason, `query.unavailable[${index}]`, { min: 1, max: 500 })
  })

  return result as QueryResult
}

function nullableObject(value: unknown, field: string): Payload | null {
  if (value === undefined || value === null) return null
  return object(value, field)
}

function nullableInteger(value: unknown, field: string, options: { min?: number } = {}): number | null {
  if (value === undefined || value === null) return null
  return integer(value, field, options)
}

function nullableUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  return uuid(value, field)
}

function nullableTimestamp(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  return string(value, field, { pattern: DATABASE_TIMESTAMP_RE })
}

function validateRefusal(value: unknown, field: string): CommandRefusal {
  const error = object(value, field)
  string(error.code, `${field}.code`, { min: 1, max: 80 })
  string(error.message, `${field}.message`, { min: 1, max: 2000 })
  boolean(error.retry_same_operation, `${field}.retry_same_operation`)
  boolean(error.requires_manager, `${field}.requires_manager`)
  return error as CommandRefusal
}

function validateEventRecord(value: unknown, index: number): EventRecord {
  const event = object(value, `events[${index}]`)
  integer(event.commit_sequence, `events[${index}].commit_sequence`, { min: 1 })
  integer(event.event_index, `events[${index}].event_index`, { min: 0 })
  string(event.event_type, `events[${index}].event_type`, { min: 1, max: 120 })
  uuid(event.operation_id, `events[${index}].operation_id`)
  object(event.payload, `events[${index}].payload`)
  string(event.payload_hash, `events[${index}].payload_hash`, { pattern: HASH_RE })
  string(event.created_at, `events[${index}].created_at`, { pattern: DATABASE_TIMESTAMP_RE })
  return event as EventRecord
}

export function validateEventFeed(value: unknown): EventFeed {
  const feed = object(value, 'events')
  const events = array(feed.events, 'events.events', { max: 1000 })
    .map((event, index) => validateEventRecord(event, index))
  const eventCount = integer(feed.event_count, 'events.event_count', { min: 0, max: 1000 })
  if (eventCount !== events.length) fail('events.event_count', 'must equal the number of returned events')

  const nextCursor = integer(feed.next_cursor, 'events.next_cursor', { min: 0 })
  const latestCommit = integer(feed.latest_commit_sequence, 'events.latest_commit_sequence', { min: 0 })
  const latestEvent = integer(feed.latest_event_sequence, 'events.latest_event_sequence', { min: 0 })
  if (latestCommit < latestEvent) fail('events.latest_commit_sequence', 'must not be below the latest event sequence')
  const retentionFloor = nullableInteger(feed.retention_floor_sequence, 'events.retention_floor_sequence', { min: 0 })
  const gapDetected = boolean(feed.gap_detected, 'events.gap_detected')
  const complete = boolean(feed.complete, 'events.complete')
  if (gapDetected && retentionFloor === null) fail('events.retention_floor_sequence', 'must be present when a gap is detected')
  if (complete !== (nextCursor >= latestEvent)) fail('events.complete', 'must reflect whether the cursor has reached the latest event')
  if (events.length > 0 && nextCursor !== events[events.length - 1].commit_sequence) {
    fail('events.next_cursor', 'must equal the last returned commit sequence')
  }
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1]
    const current = events[index]
    if (current.commit_sequence < previous.commit_sequence
      || (current.commit_sequence === previous.commit_sequence && current.event_index <= previous.event_index)) {
      fail(`events.events[${index}]`, 'must be ordered by commit sequence and event index')
    }
  }

  const scope = object(feed.scope, 'events.scope')
  uuid(scope.business_id, 'events.scope.business_id')
  uuid(scope.outlet_id, 'events.scope.outlet_id')
  uuid(scope.device_id, 'events.scope.device_id')
  return feed as EventFeed
}

export function validateOperationStatus(value: unknown): OperationStatusResult {
  const operation = object(value, 'operation')
  const operationId = uuid(operation.operation_id, 'operation.operation_id')
  string(operation.command, 'operation.command', { min: 1, max: 80 })
  const status = string(operation.status, 'operation.status', { min: 1, max: 20 })
  if (status !== 'executing' && status !== 'committed' && status !== 'refused') {
    fail('operation.status', 'must be executing, committed or refused')
  }
  const outcome = optionalString(operation.outcome, 'operation.outcome', { max: 40 })
  const receipt = nullableObject(operation.receipt, 'operation.receipt')
  const result = nullableObject(operation.result, 'operation.result')
  const error = operation.error === undefined || operation.error === null
    ? null
    : validateRefusal(operation.error, 'operation.error')
  const commitSequence = nullableInteger(operation.commit_sequence, 'operation.commit_sequence', { min: 1 })
  const businessDate = operation.business_date === undefined || operation.business_date === null
    ? null
    : string(operation.business_date, 'operation.business_date', { pattern: DATE_RE })
  string(operation.created_at, 'operation.created_at', { pattern: DATABASE_TIMESTAMP_RE })
  const committedAt = nullableTimestamp(operation.committed_at, 'operation.committed_at')
  const refusedAt = nullableTimestamp(operation.refused_at, 'operation.refused_at')

  if (status === 'committed') {
    if (outcome !== 'committed_local') fail('operation.outcome', 'must be committed_local for a committed operation')
    if (!receipt) fail('operation.receipt', 'must be present for a committed operation')
    const validated = validateReceipt(receipt)
    if (validated.operation_id !== operationId) fail('operation.receipt.operation_id', 'must match the operation identifier')
    if (!result) fail('operation.result', 'must be present for a committed operation')
    if (error) fail('operation.error', 'must be absent for a committed operation')
    if (commitSequence === null) fail('operation.commit_sequence', 'must be present for a committed operation')
    if (businessDate === null) fail('operation.business_date', 'must be present for a committed operation')
    if (committedAt === null) fail('operation.committed_at', 'must be present for a committed operation')
    if (refusedAt !== null) fail('operation.refused_at', 'must be absent for a committed operation')
  } else if (status === 'refused') {
    if (outcome !== 'refused') fail('operation.outcome', 'must be refused for a refused operation')
    if (receipt) fail('operation.receipt', 'must be absent for a refused operation')
    if (result) fail('operation.result', 'must be absent for a refused operation')
    if (!error) fail('operation.error', 'must be present for a refused operation')
    if (commitSequence !== null) fail('operation.commit_sequence', 'must be absent for a refused operation')
    if (businessDate !== null) fail('operation.business_date', 'must be absent for a refused operation')
    if (committedAt !== null) fail('operation.committed_at', 'must be absent for a refused operation')
    if (refusedAt === null) fail('operation.refused_at', 'must be present for a refused operation')
  } else {
    if (outcome !== null) fail('operation.outcome', 'must be absent while an operation is executing')
    if (receipt) fail('operation.receipt', 'must be absent while an operation is executing')
    if (result) fail('operation.result', 'must be absent while an operation is executing')
    if (error) fail('operation.error', 'must be absent while an operation is executing')
    if (commitSequence !== null) fail('operation.commit_sequence', 'must be absent while an operation is executing')
    if (businessDate !== null) fail('operation.business_date', 'must be absent while an operation is executing')
    if (committedAt !== null) fail('operation.committed_at', 'must be absent while an operation is executing')
    if (refusedAt !== null) fail('operation.refused_at', 'must be absent while an operation is executing')
  }

  return operation as OperationStatusResult
}

export function validateReadiness(value: unknown): ReadinessResult {
  const readiness = object(value, 'readiness')
  const ready = boolean(readiness.ready, 'readiness.ready')
  integer(readiness.authority_epoch, 'readiness.authority_epoch', { min: 1 })
  uuid(readiness.authority_id, 'readiness.authority_id')
  uuid(readiness.business_id, 'readiness.business_id')
  uuid(readiness.outlet_id, 'readiness.outlet_id')
  string(readiness.schema_version, 'readiness.schema_version', { min: 1, max: 80 })
  integer(readiness.commit_sequence, 'readiness.commit_sequence', { min: 0 })
  const blockers = array(readiness.blockers, 'readiness.blockers', { max: 100 })
    .map((blocker, index) => string(blocker, `readiness.blockers[${index}]`, { min: 1, max: 200 }))
  if (new Set(blockers).size !== blockers.length) fail('readiness.blockers', 'must not contain duplicates')
  if (readiness.cloud_export !== 'integration_disabled') fail('readiness.cloud_export', 'must be integration_disabled')
  if (ready !== (blockers.length === 0)) fail('readiness.ready', 'must reflect whether any blockers remain')
  return readiness as ReadinessResult
}


