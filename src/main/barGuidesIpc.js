import { join } from 'path'
import fs from 'fs'
import { BAR_GUIDE_DOCUMENTS, readBarGuideManifest, resolveBarGuideFile } from './barGuides.js'

/** @typedef {import('electron').IpcMainInvokeEvent} InvokeEvent */
/**
 * @typedef {object} BarGuideIpcDependencies
 * @property {import('electron').IpcMain} ipcMain
 * @property {import('electron').App} app
 * @property {import('electron').Shell} shell
 * @property {typeof import('electron').BrowserWindow} BrowserWindow
 * @property {import('electron').Dialog} dialog
 * @property {Pick<typeof fs, 'copyFileSync'>} [fsModule]
 * @property {string} buildProductId
 * @property {string} currentDir
 * @property {string} resourcesPath
 */

/** @param {unknown} error @param {string} fallback @returns {unknown} */
function caughtMessage(error, fallback) {
  // Keep the original optional property read for every thrown value; this is
  // a compile-time view of the already existing catch expression only.
  return /** @type {{ message?: unknown } | null | undefined} */ (error)?.message || fallback
}

/**
 * Register the two fixed Bar-guide IPC operations.
 *
 * Keeping this registration injectable makes the safety boundary executable in
 * tests without starting Electron. The production call supplies Electron's
 * ipcMain, dialog, BrowserWindow and shell objects.
 * @param {BarGuideIpcDependencies} dependencies
 */
export function registerBarGuideIpc(dependencies) {
  const {
  ipcMain,
  app,
  shell,
  BrowserWindow,
  dialog,
  fsModule = fs,
  buildProductId,
  currentDir,
  resourcesPath
  } = dependencies
  const barGuideContext = () => ({
    packaged: app.isPackaged,
    resourcesPath,
    currentDir
  })

  const requireBarGuideProduct = () => {
    if (buildProductId !== 'hospitality-pos') {
      throw new Error('Bar guides are available only in the hospitality-pos product.')
    }
  }

  const getBarGuideManifest = () => {
    requireBarGuideProduct()
    const manifest = readBarGuideManifest(barGuideContext())
    const manifestRows = Array.isArray(manifest.documents) ? manifest.documents : []
    return {
      success: true,
      productId: manifest.productId,
      operatingMode: manifest.operatingMode,
      appVersion: manifest.appVersion,
      supportedVersionRange: manifest.supportedVersionRange,
      reviewDate: manifest.reviewDate,
      documents: Object.values(BAR_GUIDE_DOCUMENTS).map((definition) => ({
        ...definition,
        ...(manifestRows.find((row) => row.id === definition.id) || {})
      }))
    }
  }

  ipcMain.handle('barGuides:getManifest', async () => {
    try {
      return getBarGuideManifest()
    } catch (error) {
      return { success: false, error: caughtMessage(error, 'Bar guide information is unavailable.') }
    }
  })

  ipcMain.handle('barGuides:open', /** @param {InvokeEvent} _event @param {string} documentId */ async (_event, documentId) => {
    try {
      requireBarGuideProduct()
      const guide = resolveBarGuideFile(documentId, barGuideContext())
      const error = await shell.openPath(guide.path)
      return error ? { success: false, error } : { success: true, documentId: guide.id }
    } catch (error) {
      return { success: false, error: caughtMessage(error, 'The guide could not be opened.') }
    }
  })

  ipcMain.handle('barGuides:save', /** @param {InvokeEvent} event @param {string} documentId */ async (event, documentId) => {
    try {
      requireBarGuideProduct()
      const guide = resolveBarGuideFile(documentId, barGuideContext())
      const win = BrowserWindow.fromWebContents(event.sender)
      // Electron's current declaration rejects null owners, while this existing
      // handler passes fromWebContents' nullable result through unchanged.
      const dialogWithNullableOwner = /** @type {import('electron').Dialog & {
       * showSaveDialog(owner: import('electron').BrowserWindow | null, options: import('electron').SaveDialogOptions): Promise<import('electron').SaveDialogReturnValue>
       * }} */ (dialog)
      const result = await dialogWithNullableOwner.showSaveDialog(win, {
        title: `Save ${guide.label}`,
        defaultPath: join(app.getPath('documents'), guide.filename),
        filters: [{ name: 'PDF documents', extensions: ['pdf'] }]
      })
      if (result.canceled || !result.filePath) return { success: false, canceled: true }
      fsModule.copyFileSync(guide.path, result.filePath)
      return { success: true, documentId: guide.id, filePath: result.filePath }
    } catch (error) {
      return { success: false, error: caughtMessage(error, 'The guide could not be saved.') }
    }
  })
}
