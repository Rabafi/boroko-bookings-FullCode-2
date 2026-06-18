// ── Admin Export Utility ──────────────────────────────────────────────────────
// Generic Excel/PDF export for Command Central data.
// Uses IPC to main process which has @e965/xlsx.

/**
 * Export admin data as Excel via IPC.
 * @param {string} title - human-readable title (e.g. 'Companies')
 * @param {Array<Object>} rows - flat data rows
 * @param {Object} [options] - { sheetName, columns: [{key, header, width}] }
 * @returns {Promise<{success: boolean, filePath?: string, error?: string}>}
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
 * @param {Array<Object>} rows
 * @param {Object} [options] - { columns: [{key, header}] }
 * @returns {Promise<{success: boolean, filePath?: string, error?: string}>}
 */
export async function exportAdminPdf(title, rows, options = {}) {
  return window.api.admin.exportPdf({
    title,
    rows,
    columns: options.columns
  })
}
