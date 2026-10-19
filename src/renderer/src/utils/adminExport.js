// @ts-check
// ── Admin Export Utility ──────────────────────────────────────────────────────
// Generic Excel/PDF export for Command Central data.
// Uses IPC to main process which has @e965/xlsx.

/**
 * Export admin data as Excel via IPC.
 * @param {string} title - human-readable title (e.g. 'Companies')
 * @param {Array<Record<string, unknown>>} rows - flat data rows
 * @param {{sheetName?: string, columns?: import('../types/admin-export').AdminExportColumn[]}} [options]
 * @returns {Promise<unknown>} The underlying IPC response remains unvalidated.
 */
export async function exportAdminExcel(title, rows, options = {}) {
  const { sheetName, columns } = options
  return window.api.admin.exportExcel({
    title,
    rows,
    sheetName: sheetName || title,
    columns
  })
}

/**
 * Export admin data as PDF via IPC (prints a styled HTML table).
 * @param {string} title
 * @param {Array<Record<string, unknown>>} rows
 * @param {{columns?: import('../types/admin-export').AdminExportColumn[]}} [options]
 * @returns {Promise<unknown>} The underlying IPC response remains unvalidated.
 */
export async function exportAdminPdf(title, rows, options = {}) {
  return window.api.admin.exportPdf({
    title,
    rows,
    columns: options.columns
  })
}
