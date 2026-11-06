// Read only the public chooser result using Windows safeStorage. Never print
// decrypted authority/owner credentials and never connect to a database.
const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const temporaryProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'bar-chooser-readonly-'))
const useSavedBarContext = process.argv.includes('--use-saved-bar-key-context')
app.setPath('userData', useSavedBarContext
  ? 'C:/Users/Botswapelo Studios/AppData/Roaming/Tsa Bonno Restaurant & Bar POS Dev Desk/local-bar-workspace'
  : temporaryProfile)
if (useSavedBarContext && !app.requestSingleInstanceLock()) {
  console.log('READONLY_DIAGNOSTIC_REFUSED: Bar profile is already open')
  app.quit()
}
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const { readLocalBarChooserEntry } = await import(pathToFileURL(path.resolve(__dirname, '../../../../../src/main/bar-local/chooserEntry.js')).href)
    const entry = readLocalBarChooserEntry({
      userDataPath: 'C:/Users/Botswapelo Studios/AppData/Roaming/Tsa Bonno Restaurant & Bar POS Dev Desk',
      safeStorage
    })
    console.log('READONLY_CHOOSER_STATUS ' + JSON.stringify({ encryption_available: safeStorage.isEncryptionAvailable(), entry }))
    const { validateAuthorityConfig } = await import(pathToFileURL(path.resolve(__dirname, '../../../../../src/main/bar-local/authority.js')).href)
    const root = 'C:/Users/Botswapelo Studios/AppData/Roaming/Tsa Bonno Restaurant & Bar POS Dev Desk/local-bar-workspace/bar-local'
    for (const [kind, relative] of [['authority','authority.bin'],['setup','server-setup/server-setup.bin']]) {
      try {
        const value = JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(root, relative))))
        const view = { kind, readable: true, version: value.version ?? null, phase: value.phase ?? null,
          authority_mode: value.authority_mode ?? null, has_owner_object: !!value.owner && typeof value.owner === 'object' && !Array.isArray(value.owner) }
        if (kind === 'authority') {
          try { validateAuthorityConfig(value); view.valid = true }
          catch (error) { view.valid = false; view.validation_code = error.code || error.name; view.validation_message = error.message }
        }
        console.log('READONLY_PUBLIC_RECORD_CHECK ' + JSON.stringify(view))
      } catch (error) {
        console.log('READONLY_PUBLIC_RECORD_CHECK ' + JSON.stringify({ kind, readable: false, code: error?.code || error?.name }))
      }
    }
  } catch (error) {
    console.log('READONLY_CHOOSER_ERROR ' + JSON.stringify({ name: error?.name, code: error?.code || null }))
    process.exitCode = 1
  } finally { app.quit() }
})
