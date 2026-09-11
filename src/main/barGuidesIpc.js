import { join } from 'path'
import fs from 'fs'
import { BAR_GUIDE_DOCUMENTS, readBarGuideManifest, resolveBarGuideFile } from './barGuides.js'

/**
 * Register the two fixed Bar-guide IPC operations.
 *
 * Keeping this registration injectable makes the safety boundary executable in
 * tests without starting Electron. The production call supplies Electron's
 * ipcMain, dialog, BrowserWindow and shell objects.
 */
export function registerBarGuideIpc({
  ipcMain,
  app,
  shell,
  BrowserWindow,
  dialog,
  fsModule = fs,
  buildProductId,
  currentDir,
  resourcesPath
}) {
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
      return { success: false, error: error?.message || 'Bar guide information is unavailable.' }
    }
  })

  ipcMain.handle('barGuides:open', async (_, documentId) => {
    try {
      requireBarGuideProduct()
      const guide = resolveBarGuideFile(documentId, barGuideContext())
      const error = await shell.openPath(guide.path)
      return error ? { success: false, error } : { success: true, documentId: guide.id }
    } catch (error) {
      return { success: false, error: error?.message || 'The guide could not be opened.' }
    }
  })

  ipcMain.handle('barGuides:save', async (event, documentId) => {
    try {
      requireBarGuideProduct()
      const guide = resolveBarGuideFile(documentId, barGuideContext())
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showSaveDialog(win, {
        title: `Save ${guide.label}`,
        defaultPath: join(app.getPath('documents'), guide.filename),
        filters: [{ name: 'PDF documents', extensions: ['pdf'] }]
      })
      if (result.canceled || !result.filePath) return { success: false, canceled: true }
      fsModule.copyFileSync(guide.path, result.filePath)
      return { success: true, documentId: guide.id, filePath: result.filePath }
    } catch (error) {
      return { success: false, error: error?.message || 'The guide could not be saved.' }
    }
  })
}