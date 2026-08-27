import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const root = new URL('..', import.meta.url)
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8')

test('Starter Basic Report has a dedicated print and PDF bridge', () => {
  const ui = read('src/renderer/src/components/BasicReports.jsx')
  const preload = read('src/preload/index.js')
  const main = read('src/main/index.js')

  assert.match(ui, /id="printable-report"/)
  assert.match(ui, /basicSavePDF/)
  assert.match(ui, /basicPrint/)
  assert.match(ui, /Certification: \{certified \? 'Certified' : 'Not certified/)
  assert.match(ui, /CSV, Excel, and full report exports are not available in Starter/)
  assert.match(preload, /basicSavePDF: \(payload\) => invoke\('reports:basicSavePDF', payload\)/)
  assert.match(preload, /basicPrint: \(payload\) => invoke\('reports:basicPrint', payload\)/)
  assert.match(main, /ipcMain\.handle\('reports:basicSavePDF'/)
  assert.match(main, /ipcMain\.handle\('reports:basicPrint'/)
  assert.match(main, /requireCapability\('reports\.basic_view'\)/)
  assert.match(main, /webContents\.printToPDF\(pdfOptions\)/)
  assert.match(main, /webContents\.print\(printOptions/)
  assert.match(main, /Starter PDF and print are only available from the Basic Reports page/)
  assert.match(main, /basename\(result\.filePath\)/)
  assert.match(ui, /basicPrint[\s\S]*operationId: crypto\.randomUUID\(\)/)
  assert.match(main, /ipcMain\.handle\('reports:basicPrint', async \(event, payload = \{\}\)/)
  assert.match(main, /STARTER_PRINT_OPERATION_ID_PATTERN\.test\(operationId\)/)
  assert.match(main, /artifactId: `print-\$\{operationId\}`/)
  assert.doesNotMatch(main.match(/ipcMain\.handle\('reports:basicPrint'[\s\S]*?\n  \}\)/)?.[0] || '', /crypto\.randomUUID\(\)/)
})

test('Starter Basic Report output remains bounded to the selected report periods', () => {
  const main = read('src/main/index.js')
  const ui = read('src/renderer/src/components/BasicReports.jsx')
  assert.match(main, /\[1, 7, 30\]\.includes\(rangeDays\)/)
  assert.match(main, /filters: \[\{ name: 'PDF Files', extensions: \['pdf'\] \}\]/)
  assert.match(ui, /PDF\/print snapshot only/)
  assert.match(ui, /setGeneratedAt\(timestamp\)/)
})
