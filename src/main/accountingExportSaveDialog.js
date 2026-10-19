import { resolve } from 'node:path';

// @ts-check

// Tests may replace only the native save-dialog selection. The export handler
// still runs in the real main process, invokes the real authenticated RPC,
// validates and writes the server-certified artifact, and registers its hash.
// Packaged applications always use Electron's native dialog.
/**
 * @param {object} dependencies
 * @param {import('electron').App} dependencies.app
 * @param {import('electron').Dialog} dependencies.dialog
 * @param {import('electron').BrowserWindow | null} dependencies.parentWindow
 * @param {import('electron').SaveDialogOptions} dependencies.options
 * @param {NodeJS.ProcessEnv} [dependencies.env]
 * @returns {Promise<import('electron').SaveDialogReturnValue>}
 */
export async function showAccountingExportSaveDialog({ app, dialog, parentWindow, options, env = process.env }) {
  const target = String(env.BOROKO_TEST_ACCOUNTING_EXPORT_SAVE_PATH || '').trim();
  const enabled = !app?.isPackaged && env.BOROKO_TEST_ACCOUNTING_EXPORT_DIALOG_REDIRECT === '1';
  if (enabled && target) {
    delete env.BOROKO_TEST_ACCOUNTING_EXPORT_SAVE_PATH;
    delete env.BOROKO_TEST_ACCOUNTING_EXPORT_DIALOG_REDIRECT;
    return { filePath: resolve(target), canceled: false };
  }
  // Electron's declarations omit null from the owner-window overload, while
  // this existing path passes BrowserWindow.getFocusedWindow() through as-is.
  // Keep that argument tuple unchanged; the regression test covers the null
  // owner call and the production caller preserves Electron's current result.
  const dialogWithNullableOwner = /** @type {import('electron').Dialog & { showSaveDialog: (owner: import('electron').BrowserWindow | null, options: import('electron').SaveDialogOptions) => Promise<import('electron').SaveDialogReturnValue> }} */ (dialog)
  return dialogWithNullableOwner.showSaveDialog(parentWindow, options)
}
