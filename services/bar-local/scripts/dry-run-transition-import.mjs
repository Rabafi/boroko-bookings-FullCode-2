#!/usr/bin/env node
/**
 * Offline, read-only validator for the versioned Bar cloud-transition export.
 * This tool never connects to PostgreSQL and never writes business records.
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const VERSION = 1
const COLLECTIONS = [
  'businesses', 'outlets', 'staff', 'devices', 'products', 'recipes', 'customers',
  'sales', 'tenders', 'returns', 'voids', 'stock_movements', 'stocktakes', 'transfers',
  'tabs', 'vouchers', 'credit_accounts', 'credit_entries', 'cashups', 'tips', 'tip_payouts',
  'expenses', 'journal_entries', 'audit_events', 'pending_operations'
]
const OUTLET_SCOPED_COLLECTIONS = new Set([
  'sales', 'tenders', 'returns', 'voids', 'stock_movements', 'stocktakes', 'transfers',
  'tabs', 'cashups', 'tips', 'tip_payouts', 'expenses', 'pending_operations'
])

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function decimalUnits(value, scale) {
  if (typeof value !== 'string' || !Number.isInteger(scale) || scale < 0 || scale > 6) return null
  const match = value.match(/^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/)
  if (!match || (match[3]?.length ?? 0) > scale) return null
  const fraction = (match[3] ?? '').padEnd(scale, '0')
  const units = BigInt(match[2]) * (10n ** BigInt(scale)) + BigInt(fraction || '0')
  return match[1] === '-' ? -units : units
}

function decimalText(units, scale) {
  const negative = units < 0n
  const absolute = negative ? -units : units
  if (scale === 0) return `${negative ? '-' : ''}${absolute}`
  const divisor = 10n ** BigInt(scale)
  const whole = absolute / divisor
  const fraction = (absolute % divisor).toString().padStart(scale, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

function inspectExport(input) {
  const errors = []
  const warnings = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { errors: ['Export must be a JSON object.'], warnings, report: null }
  }
  if (input.format !== 'tsa-bonno-bar-transition-export' || input.version !== VERSION) {
    errors.push(`Expected format tsa-bonno-bar-transition-export version ${VERSION}.`)
  }
  if (!input.source || typeof input.source.business_id !== 'string' || !input.source.business_id.trim()) {
    errors.push('A source.business_id is required.')
  }
  if (!input.source || !Array.isArray(input.source.outlet_ids) || input.source.outlet_ids.length === 0 || input.source.outlet_ids.some((id) => typeof id !== 'string' || !id.trim())) {
    errors.push('At least one source.outlet_ids entry is required.')
  } else if (new Set(input.source.outlet_ids).size !== input.source.outlet_ids.length) {
    errors.push('source.outlet_ids must not contain duplicate outlet identities.')
  }
  if (!input.snapshot || typeof input.snapshot.exported_at !== 'string' || typeof input.snapshot.complete !== 'boolean') {
    errors.push('snapshot.exported_at and snapshot.complete are required.')
  } else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.snapshot.exported_at)
    || !Number.isFinite(Date.parse(input.snapshot.exported_at))) {
    errors.push('snapshot.exported_at must be a valid ISO-8601 timestamp with an explicit timezone.')
  }
  if (input.snapshot?.complete !== true) errors.push('Incomplete source snapshots cannot be prepared for import.')
  if (!input.collections || typeof input.collections !== 'object' || Array.isArray(input.collections)) {
    errors.push('collections must be an object of complete source collections.')
  }
  if (!Array.isArray(input.relationships)) {
    errors.push('relationships must be declared as an array, including when the export has no relationships.')
  }
  if (!Array.isArray(input.reconciliations)) {
    errors.push('reconciliations must be declared as an array, including when the export has no financial parent/child checks.')
  }

  const counts = {}
  const rejected = []
  const seen = new Map()
  for (const name of COLLECTIONS) {
    const rows = input.collections?.[name]
    if (!Array.isArray(rows)) {
      errors.push(`collections.${name} must be present as an array, including when empty.`)
      counts[name] = null
      continue
    }
    counts[name] = rows.length
    const ids = new Set()
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        rejected.push({ collection: name, index, reason: 'row_not_object' })
        continue
      }
      if (typeof row.source_id !== 'string' || !row.source_id.trim()) {
        rejected.push({ collection: name, index, reason: 'source_id_missing' })
        continue
      }
      if (ids.has(row.source_id)) rejected.push({ collection: name, index, source_id: row.source_id, reason: 'duplicate_source_id_in_collection' })
      ids.add(row.source_id)
      if (!seen.has(row.source_id)) seen.set(row.source_id, new Set())
      seen.get(row.source_id).add(name)
      if (typeof row.business_id !== 'string' || !row.business_id.trim()) {
        rejected.push({ collection: name, index, source_id: row.source_id, reason: 'business_scope_missing' })
      } else if (input.source?.business_id && row.business_id !== input.source.business_id) {
        rejected.push({ collection: name, index, source_id: row.source_id, reason: 'foreign_business_scope' })
      }
      if (OUTLET_SCOPED_COLLECTIONS.has(name)
        && (typeof row.outlet_id !== 'string' || !row.outlet_id.trim())) {
        rejected.push({ collection: name, index, source_id: row.source_id, reason: 'outlet_scope_missing' })
      } else if (row.outlet_id && Array.isArray(input.source?.outlet_ids) && !input.source.outlet_ids.includes(row.outlet_id)) {
        rejected.push({ collection: name, index, source_id: row.source_id, reason: 'foreign_outlet_scope' })
      }
    }
  }
  for (const [sourceId, collections] of seen) {
    // IDs are namespaced by collection at source systems; this reports the exact mapping,
    // rather than treating a shared UUID across different tables as a duplicate.
    if (collections.size > 1) warnings.push({ source_id: sourceId, collections: [...collections].sort(), code: 'source_id_reused_across_collections' })
  }
  if (Array.isArray(input.collections?.businesses) && typeof input.source?.business_id === 'string') {
    const businessRows = input.collections.businesses.filter((row) => row?.source_id === input.source.business_id)
    if (businessRows.length !== 1) errors.push('The source business must appear exactly once in collections.businesses.')
  }
  if (Array.isArray(input.collections?.outlets) && Array.isArray(input.source?.outlet_ids)) {
    const exportedOutlets = input.collections.outlets.map((row) => row?.source_id).filter((id) => typeof id === 'string')
    const expected = [...input.source.outlet_ids].sort()
    const actual = [...exportedOutlets].sort()
    if (canonical(actual) !== canonical(expected)) errors.push('collections.outlets must contain exactly the declared source outlet set, once each.')
  }
  const relationResults = []
  if (Array.isArray(input.relationships)) {
    const relationNames = new Set()
    for (const relation of input.relationships) {
      if (!relation || typeof relation.name !== 'string' || !relation.name.trim() || relationNames.has(relation.name)) {
        errors.push('Relationship names must be non-empty and unique.')
        continue
      }
      relationNames.add(relation.name)
      const sourceRows = input.collections?.[relation.source_collection]
      const targetRows = input.collections?.[relation.target_collection]
      if (!Array.isArray(sourceRows) || !Array.isArray(targetRows)
        || typeof relation.source_field !== 'string' || !relation.source_field.trim()
        || typeof relation.nullable !== 'boolean'
        || !['business', 'same_outlet', 'none'].includes(relation.scope ?? 'business')) {
        errors.push(`Relationship ${relation.name} has an invalid collection, field, nullability or scope contract.`)
        continue
      }
      const targetsById = new Map()
      for (const row of targetRows) {
        if (typeof row?.source_id !== 'string') continue
        if (!targetsById.has(row.source_id)) targetsById.set(row.source_id, [])
        targetsById.get(row.source_id).push(row)
      }
      let linked = 0
      let nulls = 0
      for (let index = 0; index < sourceRows.length; index += 1) {
        const sourceRow = sourceRows[index]
        if (!sourceRow || typeof sourceRow !== 'object' || Array.isArray(sourceRow)) continue
        const targetId = sourceRow[relation.source_field]
        if (targetId === undefined || targetId === null || targetId === '') {
          if (relation.nullable) { nulls += 1; continue }
          rejected.push({ collection: relation.source_collection, index, source_id: sourceRow.source_id ?? null, reason: `relationship_missing:${relation.name}` })
          continue
        }
        const matches = typeof targetId === 'string' ? targetsById.get(targetId) ?? [] : []
        if (matches.length !== 1) {
          rejected.push({ collection: relation.source_collection, index, source_id: sourceRow.source_id ?? null, reason: `relationship_target_missing:${relation.name}` })
          continue
        }
        const target = matches[0]
        if (relation.scope !== 'none' && (!sourceRow.business_id || !target.business_id)) {
          rejected.push({ collection: relation.source_collection, index, source_id: sourceRow.source_id ?? null, reason: `relationship_scope_missing:${relation.name}` })
          continue
        }
        if (relation.scope !== 'none' && sourceRow.business_id !== target.business_id) {
          rejected.push({ collection: relation.source_collection, index, source_id: sourceRow.source_id ?? null, reason: `relationship_business_scope:${relation.name}` })
          continue
        }
        if (relation.scope === 'same_outlet' && (!sourceRow.outlet_id || !target.outlet_id)) {
          rejected.push({ collection: relation.source_collection, index, source_id: sourceRow.source_id ?? null, reason: `relationship_scope_missing:${relation.name}` })
          continue
        }
        if (relation.scope === 'same_outlet' && sourceRow.outlet_id !== target.outlet_id) {
          rejected.push({ collection: relation.source_collection, index, source_id: sourceRow.source_id ?? null, reason: `relationship_outlet_scope:${relation.name}` })
          continue
        }
        linked += 1
      }
      relationResults.push({ name: relation.name, source_collection: relation.source_collection,
        source_field: relation.source_field, target_collection: relation.target_collection,
        scope: relation.scope ?? 'business', linked_rows: linked, nullable_rows: nulls })
    }
  }
  for (let index = 0; index < (input.collections?.pending_operations?.length ?? 0); index += 1) {
    const row = input.collections.pending_operations[index]
    if (row?.resolution_status !== 'resolved' || typeof row?.resolution_receipt_id !== 'string' || !row.resolution_receipt_id.trim()) {
      rejected.push({ collection: 'pending_operations', index, source_id: row?.source_id ?? null, reason: 'unresolved_source_operation' })
    }
  }
  if (rejected.length) errors.push(`${rejected.length} source row(s) failed structural or scope validation.`)

  const declared = input.control_totals
  const actualControlTotals = { collection_counts: counts, measures: [] }
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
    errors.push('control_totals must be supplied by the source export.')
  } else {
    if (canonical(declared.collection_counts) !== canonical(counts)) {
      errors.push('Declared collection_counts do not match the exported rows.')
    }
    if (!Array.isArray(declared.measures)) {
      errors.push('control_totals.measures must list source-reconcilable exact decimal totals, including an empty array when none are available.')
    } else {
      const names = new Set()
      for (const measure of declared.measures) {
        if (!measure || typeof measure.name !== 'string' || !measure.name.trim() || names.has(measure.name)) {
          errors.push('Control measure names must be non-empty and unique.')
          continue
        }
        names.add(measure.name)
        const rows = input.collections?.[measure.collection]
        if (!Array.isArray(rows) || typeof measure.field !== 'string' || !measure.field.trim()) {
          errors.push(`Control measure ${measure.name} names an unknown collection or field.`)
          continue
        }
        if (!Number.isInteger(measure.scale) || measure.scale < 0 || measure.scale > 6) {
          errors.push(`Control measure ${measure.name} has an invalid decimal scale.`)
          continue
        }
        let sum = 0n
        let valid = true
        for (let index = 0; index < rows.length; index += 1) {
          const units = decimalUnits(rows[index]?.[measure.field], measure.scale)
          if (units === null) {
            rejected.push({ collection: measure.collection, index, source_id: rows[index]?.source_id ?? null, reason: `control_measure_invalid:${measure.name}` })
            valid = false
          } else sum += units
        }
        const actual = { name: measure.name, collection: measure.collection, field: measure.field, scale: measure.scale, rows: rows.length, total: valid ? decimalText(sum, measure.scale) : null }
        actualControlTotals.measures.push(actual)
        if (measure.rows !== rows.length || !valid || measure.total !== actual.total) {
          errors.push(`Control measure ${measure.name} does not reconcile to source rows.`)
        }
      }
      if (rejected.length && !errors.some((error) => error.includes('source row(s) failed'))) {
        errors.push(`${rejected.length} source row(s) failed structural or scope validation.`)
      }
    }
  }
  const reconciliationResults = []
  if (Array.isArray(input.reconciliations)) {
    const names = new Set()
    for (const check of input.reconciliations) {
      if (!check || typeof check.name !== 'string' || !check.name.trim() || names.has(check.name)) {
        errors.push('Reconciliation names must be non-empty and unique.')
        continue
      }
      names.add(check.name)
      const parents = input.collections?.[check.parent_collection]
      const children = input.collections?.[check.child_collection]
      if (!Array.isArray(parents) || !Array.isArray(children)
        || typeof check.parent_field !== 'string' || !check.parent_field.trim()
        || typeof check.parent_key !== 'string' || !check.parent_key.trim()
        || typeof check.child_field !== 'string' || !check.child_field.trim()
        || typeof check.child_fk !== 'string' || !check.child_fk.trim()
        || !Number.isInteger(check.scale) || check.scale < 0 || check.scale > 6
        || !['business', 'same_outlet'].includes(check.scope ?? 'business')) {
        errors.push(`Reconciliation ${check.name} has an invalid collection, field, scale or scope contract.`)
        continue
      }
      const parentByKey = new Map()
      let valid = true
      for (let index = 0; index < parents.length; index += 1) {
        const row = parents[index]
        const key = row?.[check.parent_key]
        const expected = decimalUnits(row?.[check.parent_field], check.scale)
        if (typeof key !== 'string' || !key.trim() || parentByKey.has(key) || expected === null) {
          rejected.push({ collection: check.parent_collection, index, source_id: row?.source_id ?? null, reason: `reconciliation_parent_invalid:${check.name}` })
          valid = false
          continue
        }
        parentByKey.set(key, { row, expected, actual: 0n, children: 0 })
      }
      for (let index = 0; index < children.length; index += 1) {
        const row = children[index]
        const key = row?.[check.child_fk]
        const amount = decimalUnits(row?.[check.child_field], check.scale)
        const parent = typeof key === 'string' ? parentByKey.get(key) : null
        if (!parent || amount === null) {
          rejected.push({ collection: check.child_collection, index, source_id: row?.source_id ?? null, reason: `reconciliation_child_invalid:${check.name}` })
          valid = false
          continue
        }
        const sameBusiness = row.business_id === parent.row.business_id
        const sameOutlet = row.outlet_id === parent.row.outlet_id
        if (!sameBusiness || (check.scope === 'same_outlet' && !sameOutlet)) {
          rejected.push({ collection: check.child_collection, index, source_id: row?.source_id ?? null, reason: `reconciliation_scope_mismatch:${check.name}` })
          valid = false
          continue
        }
        parent.actual += amount
        parent.children += 1
      }
      let matched = 0
      for (const [key, parent] of parentByKey) {
        const match = parent.expected === parent.actual
        if (match) matched += 1
        else {
          errors.push(`Reconciliation ${check.name} does not balance for parent ${key}.`)
          valid = false
        }
      }
      reconciliationResults.push({ name: check.name, parent_collection: check.parent_collection,
        child_collection: check.child_collection, parents: parentByKey.size,
        children: children.length, balanced_parents: matched, accepted: valid && matched === parentByKey.size })
    }
  }
  if (rejected.length && !errors.some((error) => error.includes('source row(s) failed'))) {
    errors.push(`${rejected.length} source row(s) failed structural or scope validation.`)
  }
  const sourceHash = sha256(canonical(input))
  const receipt = {
    format: 'tsa-bonno-bar-transition-dry-run-receipt',
    version: VERSION,
    source_business_id: input.source?.business_id ?? null,
    outlet_ids: input.source?.outlet_ids ?? [],
    snapshot_exported_at: input.snapshot?.exported_at ?? null,
    source_sha256: sourceHash,
    accepted_for_rehearsal: errors.length === 0,
    import_performed: false,
    database_contacted: false,
    control_totals: actualControlTotals,
    relationships: relationResults,
    reconciliations: reconciliationResults,
    rejected_rows: rejected,
    warnings,
    errors
  }
  return { errors, warnings, report: receipt }
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2)
  if (!inputPath || !outputPath) {
    console.error('Usage: node scripts/dry-run-transition-import.mjs <export.json> <receipt.json>')
    process.exitCode = 2
    return
  }
  let input
  try {
    input = JSON.parse(await readFile(resolve(inputPath), 'utf8'))
  } catch (error) {
    console.error(`Could not read source export: ${error.message}`)
    process.exitCode = 2
    return
  }
  const result = inspectExport(input)
  await writeFile(resolve(outputPath), `${JSON.stringify(result.report, null, 2)}\n`, { flag: 'wx' })
  console.log(`${result.report.accepted_for_rehearsal ? 'DRY-RUN ACCEPTED' : 'DRY-RUN REFUSED'} source_sha256=${result.report.source_sha256}`)
  if (result.errors.length) process.exitCode = 1
}

export { COLLECTIONS, inspectExport }

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main()
