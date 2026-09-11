import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import test from 'node:test'
import {
  BAR_GUIDE_DOCUMENTS,
  readBarGuideManifest,
  resolveBarGuideFile
} from '../src/main/barGuides.js'
import { registerBarGuideIpc } from '../src/main/barGuidesIpc.js'

const root = process.cwd()
const manualRoot = path.join(root, 'docs', 'bar-manual')
const pdfRoot = path.join(root, 'output', 'pdf')
const builder = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'hospitality-pos', 'electron-builder.json'), 'utf8'))
const mainSource = fs.readFileSync(path.join(root, 'src', 'main', 'index.js'), 'utf8')
const hposLayoutSource = fs.readFileSync(path.join(root, 'src', 'renderer', 'src', 'components', 'hospitality-pos', 'HposLayout.jsx'), 'utf8')
const hposNavSource = fs.readFileSync(path.join(root, 'src', 'renderer', 'src', 'components', 'hospitality-pos', 'HposNav.jsx'), 'utf8')

const terminalSource = fs.readFileSync(path.join(root, 'src', 'renderer', 'src', 'components', 'hospitality-pos', 'HposTerminal.jsx'), 'utf8')

function createHarness({ packaged = false, shellError = '', fsModule = fs } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tsa-bonno-bar-guides-'))
  const documentsPath = path.join(tempRoot, 'documents')
  fs.mkdirSync(documentsPath, { recursive: true })
  const handlers = new Map()
  const openedPaths = []
  const dialogCalls = []
  const dialogResults = []
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) }
  const app = { isPackaged: packaged, getPath: (name) => { assert.equal(name, 'documents'); return documentsPath } }
  const shell = { openPath: async (filePath) => { openedPaths.push(filePath); return shellError } }
  const BrowserWindow = { fromWebContents: (sender) => ({ sender }) }
  const dialog = { showSaveDialog: async (win, options) => { dialogCalls.push({ win, options }); return dialogResults.shift() || { canceled: true } } }
  registerBarGuideIpc({ ipcMain, app, shell, BrowserWindow, dialog, fsModule, buildProductId: 'hospitality-pos', currentDir: path.join(root, 'src', 'main'), resourcesPath: tempRoot })
  return { tempRoot, documentsPath, handlers, openedPaths, dialogCalls, dialogResults }
}

function getHandler(harness, channel) {
  const value = harness.handlers.get(channel)
  assert.equal(typeof value, 'function', `${channel} must be registered`)
  return value
}

function cleanupHarness(harness) {
  fs.rmSync(harness.tempRoot, { recursive: true, force: true })
}
function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase()
}

test('approved Bar guide manifest matches both release PDFs', () => {
  const manifest = readBarGuideManifest({ currentDir: path.join(root, 'src', 'main') })
  assert.equal(manifest.productId, 'hospitality-pos')
  assert.equal(manifest.operatingMode, 'bar_only')
  assert.equal(manifest.appVersion, '1.5.7')
  assert.equal(manifest.documents.length, 2)
  for (const definition of Object.values(BAR_GUIDE_DOCUMENTS)) {
    const row = manifest.documents.find((item) => item.id === definition.id)
    assert.ok(row, `${definition.id} must be in the manifest`)
    const filePath = path.join(pdfRoot, definition.filename)
    assert.ok(fs.existsSync(filePath), `${definition.filename} must exist`)
    assert.equal(row.filename, definition.filename)
    assert.equal(sha256(filePath), row.sha256, `${definition.filename} checksum must match approval manifest`)
  }
})

test('hospitality-pos packages only the approved Bar guide pair and manifest', () => {
  const resources = Array.isArray(builder.extraResources) ? builder.extraResources : []
  const pdfResource = resources.find((item) => item.from === 'output/pdf' && item.to === 'bar-guides')
  assert.ok(pdfResource, 'Bar PDF resource mapping must exist')
  assert.deepEqual(new Set(pdfResource.filter), new Set(Object.values(BAR_GUIDE_DOCUMENTS).map((item) => item.filename)))
  assert.ok(resources.some((item) => item.from === 'docs/bar-manual/document-manifest.json' && item.to === 'bar-guides/document-manifest.json'))
})

test('Bar guide resolver accepts fixed IDs and rejects arbitrary identifiers or paths', () => {
  const resolved = resolveBarGuideFile('bar-manual', { currentDir: path.join(root, 'src', 'main') })
  assert.equal(path.basename(resolved.path), BAR_GUIDE_DOCUMENTS['bar-manual'].filename)
  assert.throws(() => resolveBarGuideFile('../output/pdf/Tsa-Bonno-Bar-Customer-Manual.pdf', { currentDir: path.join(root, 'src', 'main') }), /Unknown Bar guide/)
  assert.throws(() => resolveBarGuideFile('file:///customer.pdf', { currentDir: path.join(root, 'src', 'main') }), /Unknown Bar guide/)
})

test('existing directory package contains the approved guide pair', (t) => {
  const packagedRoot = path.join(root, 'dist', 'hospitality-pos', 'win-unpacked', 'resources', 'bar-guides')
  if (!fs.existsSync(packagedRoot)) {
    t.skip('directory package is not present; run the Bar packaging gate to verify packaged resources')
    return
  }
  const manifestPath = path.join(packagedRoot, 'document-manifest.json')
  assert.ok(fs.existsSync(manifestPath), 'packaged guide manifest must exist')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.productId, 'hospitality-pos')
  assert.equal(manifest.operatingMode, 'bar_only')
  for (const definition of Object.values(BAR_GUIDE_DOCUMENTS)) {
    const packagedPath = path.join(packagedRoot, definition.filename)
    assert.ok(fs.existsSync(packagedPath), `${definition.filename} must be in the directory package`)
    assert.equal(sha256(packagedPath), sha256(path.join(pdfRoot, definition.filename)), `${definition.filename} package checksum must match approved PDF`)
  }
})
test('Help & guides is exposed from the actual Bar Hpos top-right menu', () => {
  assert.match(hposLayoutSource, /import HposNav from '\.\/HposNav'/)
  assert.match(hposLayoutSource, /<HposNav[\s\S]*barOnly=\{barOnly\}/)
  assert.match(hposNavSource, /const \[showGuides, setShowGuides\] = useState\(false\)/)
  assert.match(hposNavSource, /barOnly && \([\s\S]*Help &amp; guides/)
  assert.match(hposNavSource, /setShowGuides\(true\)/)
  assert.match(hposNavSource, /<HposBarGuidesPanel settings=\{settings\} onClose=\{\(\) => setShowGuides\(false\)\}/)
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'src', 'renderer', 'src', 'components', 'Layout.jsx'), 'utf8'), /BarGuidesPanel/)
})
test('main process delegates Bar guide IPC to the tested registration module', () => {
  assert.match(mainSource, /import \{ registerBarGuideIpc \} from '\.\/barGuidesIpc\.js'/)
  assert.match(mainSource, /registerBarGuideIpc\(\{/)
  assert.doesNotMatch(mainSource, /title:\s*Save\b/)
})

test('Bar guide handlers execute open and save successfully for both document IDs', async () => {
  const harness = createHarness()
  try {
    const open = getHandler(harness, 'barGuides:open')
    const save = getHandler(harness, 'barGuides:save')
    for (const definition of Object.values(BAR_GUIDE_DOCUMENTS)) {
      const openResult = await open({ sender: 'test-web-contents' }, definition.id)
      assert.deepEqual(openResult, { success: true, documentId: definition.id })
      assert.equal(harness.openedPaths.at(-1), path.join(pdfRoot, definition.filename))

      const destination = path.join(harness.documentsPath, definition.filename)
      harness.dialogResults.push({ canceled: false, filePath: destination })
      const saveResult = await save({ sender: 'test-web-contents' }, definition.id)
      assert.deepEqual(saveResult, { success: true, documentId: definition.id, filePath: destination })
      assert.equal(sha256(destination), sha256(path.join(pdfRoot, definition.filename)))
      assert.equal(harness.dialogCalls.at(-1).options.title, 'Save ' + definition.label)
      assert.equal(harness.dialogCalls.at(-1).options.defaultPath, destination)
    }
  } finally {
    cleanupHarness(harness)
  }
})

test('Bar guide save reports cancellation without copying for both document IDs', async () => {
  const harness = createHarness()
  try {
    const save = getHandler(harness, 'barGuides:save')
    for (const definition of Object.values(BAR_GUIDE_DOCUMENTS)) {
      harness.dialogResults.push({ canceled: true })
      const result = await save({ sender: 'test-web-contents' }, definition.id)
      assert.deepEqual(result, { success: false, canceled: true })
    }
    assert.equal(harness.dialogCalls.length, 2)
  } finally {
    cleanupHarness(harness)
  }
})

test('Bar guide save reports copy failures safely', async () => {
  const harness = createHarness({
    fsModule: {
      copyFileSync() {
        throw new Error('copy denied')
      }
    }
  })
  try {
    const save = getHandler(harness, 'barGuides:save')
    const destination = path.join(harness.documentsPath, 'manual-copy.pdf')
    harness.dialogResults.push({ canceled: false, filePath: destination })
    const result = await save({ sender: 'test-web-contents' }, 'bar-manual')
    assert.equal(result.success, false)
    assert.match(result.error, /copy denied/)
  } finally {
    cleanupHarness(harness)
  }
})

test('Bar guide open reports viewer failures safely for both document IDs', async () => {
  const harness = createHarness({ shellError: 'PDF viewer failed' })
  try {
    const open = getHandler(harness, 'barGuides:open')
    for (const definition of Object.values(BAR_GUIDE_DOCUMENTS)) {
      const result = await open({ sender: 'test-web-contents' }, definition.id)
      assert.deepEqual(result, { success: false, error: 'PDF viewer failed' })
    }
  } finally {
    cleanupHarness(harness)
  }
})

test('Bar guide handlers report missing packaged files without opening a dialog', async () => {
  const harness = createHarness({ packaged: true })
  try {
    const open = getHandler(harness, 'barGuides:open')
    const save = getHandler(harness, 'barGuides:save')
    for (const definition of Object.values(BAR_GUIDE_DOCUMENTS)) {
      const openResult = await open({ sender: 'test-web-contents' }, definition.id)
      assert.equal(openResult.success, false)
      assert.match(openResult.error, /not included in this app build/)
      const saveResult = await save({ sender: 'test-web-contents' }, definition.id)
      assert.equal(saveResult.success, false)
      assert.match(saveResult.error, /not included in this app build/)
    }
    assert.equal(harness.dialogCalls.length, 0)
  } finally {
    cleanupHarness(harness)
  }
})

test('Bar Till initializes outlet state before favourite effects read it', () => {
  const declaration = terminalSource.indexOf('const [selectedOutlet, setSelectedOutlet]')
  const firstRead = terminalSource.indexOf('selectedOutlet?.id')
  assert.ok(declaration >= 0, 'selectedOutlet state declaration must exist')
  assert.ok(firstRead >= 0, 'selectedOutlet must be used by the favourites effects')
  assert.ok(declaration < firstRead, 'selectedOutlet must be initialized before the effects read it')
})

