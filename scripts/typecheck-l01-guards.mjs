import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import {
  assertL01ProgramInventory,
  assertL01RuntimeOptions,
  assertL01SourceChecked,
  assertNoNodeAmbientProvenance,
} from './typecheck-l01-assertions.mjs'

const root = process.cwd()
if (ts.version !== '5.9.3') throw new Error(`Expected TypeScript 5.9.3, got ${ts.version}`)
const profiles = new Map([
  ['tsconfig.typecheck-l01-shared.json', { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['lib.es2022.d.ts'], types: [] }],
  ['tsconfig.typecheck-l01-browser-shared.json', { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: [] }],
  ['tsconfig.typecheck-l01-renderer-utils.json', { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: [] }],
  ['manager-pwa/tsconfig.typecheck-l01.json', { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: ['vite/client'] }],
  ['booking-site/tsconfig.typecheck-l01.json', { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: ['vite/client'] }],
  ['legacy-pos/tsconfig.typecheck-shared-l01.json', { target: 'ES2020', module: 'ESNext', moduleResolution: 'Bundler', lib: ['lib.es2020.d.ts'], types: [] }],
])

function config(project) {
  const configPath = path.resolve(root, project)
  const read = ts.readConfigFile(configPath, ts.sys.readFile)
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath), undefined, configPath)
  if (parsed.errors.length) throw new Error(ts.flattenDiagnosticMessageText(parsed.errors[0].messageText, '\n'))
  return parsed
}

function mustReject(name, expected, fn) {
  let message = ''
  try { fn() } catch (error) { message = error instanceof Error ? error.message : String(error) }
  if (!message.includes(expected)) throw new Error(`${name}: expected rejection containing '${expected}', got '${message || 'no rejection'}'`)
  console.log(`[typecheck-l01-guards] PASS ${name}: ${message}`)
}

function assertRejects(assertion, expected) {
  let message = ''
  try { assertion() } catch (error) { message = error instanceof Error ? error.message : String(error) }
  if (!message) throw new Error(`guard assertion did not reject expected '${expected}' (no-op mutation or weakened check)`)
  if (!message.includes(expected)) throw new Error(`guard assertion rejected for the wrong reason: ${message}`)
  return message
}

function mustRejectNoop(name, expected, actualAssertion) {
  assertRejects(actualAssertion, expected)
  const noOpMutation = () => {}
  let message = ''
  try { assertRejects(noOpMutation, expected) } catch (error) { message = error instanceof Error ? error.message : String(error) }
  if (!message.includes(`did not reject expected '${expected}'`)) {
    throw new Error(`${name}: a no-op assertion mutation was not detected for the intended reason: ${message}`)
  }
  console.log(`[typecheck-l01-guards] PASS ${name}-noop-sensitivity: rejected no-op mutation (${message})`)
}

for (const [project, expected] of profiles) {
  const parsed = config(project)
  assertL01RuntimeOptions(parsed.options, expected, ts, project)
}
console.log(`[typecheck-l01-guards] PASS effective options: ${profiles.size} runtime profiles; all strict sub-options, noEmit, allowJs, skipLibCheck, lib and types enforced`)

const managerPath = 'manager-pwa/tsconfig.typecheck-l01.json'
const manager = config(managerPath)
const managerExpected = profiles.get(managerPath)
mustReject('disabled-noImplicitAny', 'noImplicitAny=false', () => {
  assertL01RuntimeOptions({ ...manager.options, noImplicitAny: false }, managerExpected, ts, 'probe')
})
mustReject('disabled-strictNullChecks', 'strictNullChecks=false', () => {
  assertL01RuntimeOptions({ ...manager.options, strictNullChecks: false }, managerExpected, ts, 'probe')
})
mustRejectNoop('disabled-strict-assertion', 'noImplicitAny=false', () => {
  assertL01RuntimeOptions({ ...manager.options, noImplicitAny: false }, managerExpected, ts, 'probe')
})

const managerProgram = ts.createProgram({ rootNames: manager.fileNames, options: manager.options })
const programFiles = managerProgram.getSourceFiles().map((sourceFile) => sourceFile.fileName)
assertNoNodeAmbientProvenance(programFiles, root, 'Manager browser program')
const probePath = path.resolve(root, 'manager-pwa/__l01-browser-globals-probe__.ts')
const probeText = 'void process;\nvoid Buffer;\n'
const host = ts.createCompilerHost(manager.options)
const getSourceFile = host.getSourceFile.bind(host)
host.getSourceFile = (fileName, languageVersion, ...rest) => path.resolve(fileName) === probePath
  ? ts.createSourceFile(fileName, probeText, languageVersion, true)
  : getSourceFile(fileName, languageVersion, ...rest)
const fileExists = host.fileExists.bind(host)
host.fileExists = (fileName) => path.resolve(fileName) === probePath || fileExists(fileName)
const browserProbeProgram = ts.createProgram({
  rootNames: [...manager.fileNames, probePath],
  options: manager.options,
  host,
})
const browserProbeDiagnostics = ts.getPreEmitDiagnostics(browserProbeProgram)
  .filter((diagnostic) => diagnostic.file && path.resolve(diagnostic.file.fileName) === probePath)
if (browserProbeDiagnostics.length !== 2 || browserProbeDiagnostics.some((diagnostic) => diagnostic.code !== 2591)) {
  const detail = browserProbeDiagnostics.map((diagnostic) => `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`).join('; ')
  throw new Error(`browser globals probe: expected TS2591 for process and Buffer, got ${detail || 'no diagnostics'}`)
}
console.log('[typecheck-l01-guards] PASS browser globals: actual Manager program rejects process and Buffer with TS2591; Node declaration provenance absent')

const realManagerSource = managerProgram.getSourceFile(path.resolve(root, 'manager-pwa/src/lib/api.js'))
if (!realManagerSource) throw new Error('Manager production source missing from actual program')
const uncheckedVariant = ts.createSourceFile(realManagerSource.fileName, realManagerSource.text.replace(/^\/\/\s*@ts-check\s*\r?\n/, ''), ts.ScriptTarget.ES2022, true)
mustReject('unchecked-source', 'not checked', () => assertL01SourceChecked(uncheckedVariant, manager.options, ts, 'probe'))
mustRejectNoop('unchecked-source-assertion', 'not checked', () => {
  assertL01SourceChecked(uncheckedVariant, manager.options, ts, 'probe')
})

const expectedSource = path.resolve(root, 'manager-pwa/src/lib/api.js')
const rootSet = new Set(manager.fileNames)
const actualFiles = managerProgram.getSourceFiles().map((sourceFile) => sourceFile.fileName)
mustReject('omitted-production-source', 'absent from actual compiler program', () => assertL01ProgramInventory({
  expectedPaths: [expectedSource],
  rootNames: rootSet,
  programSourceFiles: actualFiles.filter((file) => path.resolve(file) !== expectedSource),
  label: 'probe',
}))
mustReject('omitted-configured-root', 'not an explicit configured root', () => assertL01ProgramInventory({
  expectedPaths: [expectedSource],
  rootNames: [...rootSet].filter((file) => path.resolve(file) !== expectedSource),
  programSourceFiles: actualFiles,
  label: 'probe',
}))
mustRejectNoop('actual-program-inventory-assertion', 'absent from actual compiler program', () => {
  assertL01ProgramInventory({
    expectedPaths: [expectedSource],
    rootNames: rootSet,
    programSourceFiles: actualFiles.filter((file) => path.resolve(file) !== expectedSource),
    label: 'probe',
  })
})

const nodeOptions = { ...manager.options, types: ['vite/client', 'node'] }
const nodeProgram = ts.createProgram({ rootNames: manager.fileNames, options: nodeOptions })
const nodeFiles = nodeProgram.getSourceFiles().map((sourceFile) => sourceFile.fileName)
mustReject('ambient-node-provenance', 'Node declarations entered the browser program', () => {
  assertNoNodeAmbientProvenance(nodeFiles, root, 'probe')
})
console.log('[typecheck-l01-guards] PASS: strict-option, ambient-provenance, browser-global, source-check and actual-program inventory guards exercised')
