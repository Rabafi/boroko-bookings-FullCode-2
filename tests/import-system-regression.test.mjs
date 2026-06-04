import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

async function run() {
  const mainIndex = await read('src/main/index.js')
  const importParseHandler = mainIndex.match(/ipcMain\.handle\('import:parseExcel'[\s\S]*?\n  \}\)/)?.[0] || ''
  assert.match(importParseHandler, /XLSX\.read\(fs\.readFileSync\(filePath\),\s*\{\s*type:\s*'buffer'/)
  assert.doesNotMatch(importParseHandler, /XLSX\.readFile\(/)
  assert.match(importParseHandler, /providedFilePath/)
  assert.match(importParseHandler, /Choose an Excel file ending in \.xlsx/)
  assert.match(importParseHandler, /sheetRows:\s*501/)
  assert.match(importParseHandler, /stats\.size > 10 \* 1024 \* 1024/)
  assert.match(importParseHandler, /blankrows:\s*false/)
  assert.match(importParseHandler, /normalizeParsedImportRows\(rawRows\)/)
  assert.match(importParseHandler, /truncated:\s*rows\.length > 500/)
  assert.match(mainIndex, /function buildImportTemplateWorkbook/)
  assert.match(mainIndex, /book_append_sheet\(wb, dataSheet, 'Import Data'\)/)
  assert.match(mainIndex, /book_append_sheet\(wb, readMeSheet, 'Read Me'\)/)
  assert.match(mainIndex, /Keep the header row unchanged/)
  assert.match(mainIndex, /online database access/)

  const importUi = await read('src/renderer/src/components/DataImport.jsx')
  const preload = await read('src/preload/index.js')
  assert.match(preload, /webUtils/)
  assert.match(preload, /getDroppedFilePath:\s*\(file\)\s*=>\s*webUtils\?\.getPathForFile\?\.\(file\) \|\| file\?\.path \|\| ''/)
  assert.match(importUi, /Check Room Overlaps/)
  assert.match(importUi, /supportsBookingOverlapCheck/)
  assert.match(importUi, /Only the first 500 rows were loaded/)
  assert.match(importUi, /dryRunErrors\.slice\(0, 6\)/)
  assert.match(importUi, /run a dry check/)
  assert.match(importUi, /"Import Data" sheet/)
  assert.match(importUi, /function detectImportType/)
  assert.match(importUi, /Smart mapping confidence/)
  assert.match(importUi, /setImportType\(detected\.key\)/)
  assert.match(importUi, /online database/)
  assert.match(importUi, /Drop an Excel file here/)
  assert.match(importUi, /getDroppedFilePath/)
  assert.match(importUi, /function normalizeImportStatus/)
  assert.match(importUi, /function buildImportRisk/)
  assert.match(importUi, /Export Issues/)
  assert.match(importUi, /normaliseDate/)
  assert.match(importUi, /function scoreHeaderMatch/)
  assert.match(importUi, /function applyMappingMemory/)
  assert.match(importUi, /function saveMappingMemory/)
  assert.match(importUi, /IMPORT_MAPPING_MEMORY_KEY/)
  assert.match(importUi, /payment mode/)
  assert.doesNotMatch(importUi, /Supabase/)

  const misc = await read('src/main/domains/misc.js')
  assert.match(misc, /function suggestRoomNumbers/)
  assert.match(misc, /suggestions:\s*\{\s*room_number/)

  console.log('import-system-regression: ok')
}

run().catch((error) => {
  console.error('import-system-regression: failed')
  console.error(error?.stack || error?.message || error)
  process.exitCode = 1
})
