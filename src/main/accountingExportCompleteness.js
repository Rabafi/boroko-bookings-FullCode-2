// @ts-check

/**
 * Shapes emitted by the existing accounting export RPC wrappers and report
 * export producer. These comments describe the current wire envelope only;
 * they add no runtime validation.
 * @typedef {object} ExportReasonSource
 * @property {unknown} [completeness_reasons]
 */
/**
 * @typedef {ExportReasonSource & {
 *   complete?: unknown,
 *   payload?: ExportReasonSource | null,
 *   data?: ExportReasonSource | null,
 *   result?: (ExportReasonSource & { payload?: ExportReasonSource | null }) | null,
 *   export_manifest?: (ExportReasonSource & { completeness?: unknown }) | null,
 *   exportManifest?: (ExportReasonSource & { completeness?: unknown }) | null,
 *   dataset_status?: unknown,
 *   export_id?: unknown,
 *   dataset_hash?: unknown,
 *   report_run_id?: unknown,
 *   data_hash?: unknown
 * }} AccountingExportEnvelope
 */

/** @param {AccountingExportEnvelope | null | undefined} source @returns {string[]} */
export function accountingCompletenessDetails(source) {
  const candidates = [
    source?.completeness_reasons,
    source?.payload?.completeness_reasons,
    source?.data?.completeness_reasons,
    source?.result?.completeness_reasons,
    source?.result?.payload?.completeness_reasons,
    source?.export_manifest?.completeness_reasons,
    source?.exportManifest?.completeness_reasons
  ]
  /** @param {unknown} value @returns {value is unknown[]} */
  const hasReasons = (value) => Array.isArray(value) && value.length > 0
  const rows = candidates.find(hasReasons) || []
  const seen = new Set()
  return rows.flatMap((reason) => {
    if (!reason || typeof reason !== 'object') return []
    // The guard above is the original acceptance check for a reason row.
    const reasonRecord = /** @type {Record<string, unknown>} */ (reason)
    const code = typeof reasonRecord.code === 'string' ? reasonRecord.code.trim() : ''
    const message = typeof reasonRecord.message === 'string' ? reasonRecord.message.trim() : ''
    if (!code && !message) return []
    const identity = `${code}\u0000${message}`
    if (seen.has(identity)) return []
    seen.add(identity)
    const count = typeof reasonRecord.count === 'number' && Number.isFinite(reasonRecord.count) ? reasonRecord.count : null
    return [`${code ? `${code}: ` : ''}${message || 'Resolve this accounting source exception.'}${count == null ? '' : ` (${count} affected)`}`]
  })
}

/** @param {AccountingExportEnvelope | null | undefined} source @returns {AccountingExportEnvelope} */
export function assertCompleteAccountingExport(source) {
  if (!source || source.complete !== true || source.export_manifest?.completeness === 'INCOMPLETE' || source.exportManifest?.completeness === 'INCOMPLETE') {
    const reasons = accountingCompletenessDetails(source)
    const suffix = reasons.length ? ` Reasons: ${reasons.join(' | ')}` : ''
    throw new Error(`Accounting export is INCOMPLETE: the server did not certify every required source and reconciliation.${suffix} Resolve the named source or reconciliation in its normal workflow, refresh, then retry the same export scope. Do not bypass the check or create replacement financial records.`)
  }
  if (source.dataset_status === 'certified' && source.export_id && source.dataset_hash) return source
  const manifest = source.export_manifest || source.exportManifest
  if (!manifest || manifest.completeness !== 'COMPLETE' || !source.report_run_id || !source.data_hash) {
    throw new Error('Accounting export is missing its complete report-run identity or dataset hash.')
  }
  return source
}
