/**
 * Local Bar desktop release delivery is not wired to an approved release
 * source yet. This bridge reports that limitation without invoking the hosted
 * updater or conflating application releases with local service packages.
 * @param {{ipcMain:{handle:(channel:string,listener:(...args:any[])=>unknown)=>unknown},getVersion:()=>string}} options
 */
export function registerLocalDesktopUpdateStatus({ ipcMain, getVersion }) {
  const message = 'Desktop software update availability is not checked from this local Bar sign-in screen. Ask your administrator for approved release instructions.'
  const state = () => ({ phase: 'idle', currentVersion: getVersion(), version: null, releaseName: '', releaseDate: '', releaseNotes: '', progress: null, error: '', availability: 'unsupported', message })
  ipcMain.handle('update:check', () => ({ success: false, unsupported: true, error: message, state: state() }))
  ipcMain.handle('update:download', () => ({ success: false, unsupported: true, error: message }))
  ipcMain.handle('update:install', () => ({ success: false, unsupported: true, error: message }))
  ipcMain.handle('update:getState', () => state())
}
