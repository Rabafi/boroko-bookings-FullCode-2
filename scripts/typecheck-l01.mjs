import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import ts from 'typescript'
import { applyManagerBrowserSdkTypePatches, assertPatchSensitivity } from './patch-manager-browser-sdk-types.mjs'
import {
  assertL01ProgramInventory,
  assertL01RuntimeOptions,
  assertL01SourceChecked,
  assertNoNodeAmbientProvenance,
} from './typecheck-l01-assertions.mjs'

const root = process.cwd()
const patchedManagerDeclarations = applyManagerBrowserSdkTypePatches(root)
assertPatchSensitivity(root)
console.log(`L01 Manager browser SDK declarations: ${patchedManagerDeclarations.join('; ')}; declaration-patch sensitivity passed`)
const projects = [
  'tsconfig.typecheck-l01-shared.json',
  'tsconfig.typecheck-l01-browser-shared.json',
  'tsconfig.typecheck-l01-renderer-utils.json',
  'manager-pwa/tsconfig.typecheck-l01.json',
  'booking-site/tsconfig.typecheck-l01.json',
  'legacy-pos/tsconfig.typecheck-shared-l01.json'
]
const runtimeProfiles = new Map([
  ['tsconfig.typecheck-l01-shared.json', { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['lib.es2022.d.ts'], types: [] }],
  ['tsconfig.typecheck-l01-browser-shared.json', { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: [] }],
  ['tsconfig.typecheck-l01-renderer-utils.json', { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: [] }],
  ['manager-pwa/tsconfig.typecheck-l01.json', { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: ['vite/client'] }],
  ['booking-site/tsconfig.typecheck-l01.json', { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: ['vite/client'] }],
  ['legacy-pos/tsconfig.typecheck-shared-l01.json', { target: 'ES2020', module: 'ESNext', moduleResolution: 'Bundler', lib: ['lib.es2020.d.ts'], types: [] }]
])
const sourceRoots = [
  'packages/product-config',
  'src/shared',
  'src/renderer/src/utils',
  'manager-pwa/src/lib',
  'booking-site/src/lib',
  'legacy-pos/src/shared'
]
function listJavaScriptFiles(directory) {
  const absolute = path.join(root, directory)
  if (!fs.existsSync(absolute)) throw new Error(`Missing inventory directory: ${directory}`)
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name).replaceAll('\\', '/')
    if (entry.isDirectory()) return listJavaScriptFiles(relative)
    return entry.isFile() && /\.(?:c|m)?js$/i.test(entry.name) ? [relative] : []
  })
}

function normalized(fileName) {
  return path.resolve(fileName).replaceAll('\\', '/')
}

function hasActiveCheckDirective(sourceText) {
  const leading = sourceText.replace(/^\uFEFF/, '').match(/^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*/)?.[0] ?? ''
  return /^\s*\/\/\s*@ts-check\b/m.test(leading) && !/^\s*\/\/\s*@ts-nocheck\b/m.test(leading)
}

const expected = sourceRoots.flatMap(listJavaScriptFiles).sort()
const programs = []
const allDiagnostics = []
const rootNames = new Set()
const actualProductionSourceFiles = new Set()
const explicitRootProfiles = new Map()
const actualSourceProfiles = new Map()
const productionDiagnosticCounts = new Map()
const profileDiagnosticCounts = new Map()
const sourceCheckFailures = []

for (const projectPath of projects) {
  const configPath = path.resolve(root, projectPath)
  const configText = ts.readConfigFile(configPath, ts.sys.readFile)
  if (configText.error) throw new Error(ts.flattenDiagnosticMessageText(configText.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(configText.config, ts.sys, path.dirname(configPath), undefined, configPath)
  if (parsed.errors.length) {
    allDiagnostics.push(...parsed.errors)
    continue
  }
  const options = parsed.options
  const profile = runtimeProfiles.get(projectPath)
  if (!profile) throw new Error(`${projectPath}: no declared runtime profile`)
  assertL01RuntimeOptions(options, profile, ts, projectPath)
  const program = ts.createProgram({ rootNames: parsed.fileNames, options })
  programs.push({ projectPath, program, configuredRoots: parsed.fileNames })
  for (const fileName of parsed.fileNames) rootNames.add(normalized(fileName))
  const projectDiagnostics = ts.getPreEmitDiagnostics(program)
  allDiagnostics.push(...projectDiagnostics)
  profileDiagnosticCounts.set(projectPath, projectDiagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error).length)
  console.log(`L01 ${projectPath}: ${parsed.fileNames.length} configured roots; ${projectDiagnostics.length} diagnostics`)
  for (const fileName of parsed.fileNames) {
    const file = normalized(fileName)
    if (!explicitRootProfiles.has(file)) explicitRootProfiles.set(file, new Set())
    explicitRootProfiles.get(file).add(projectPath)
  }
  for (const diagnostic of projectDiagnostics) {
    if (!diagnostic.file) continue
    const file = normalized(diagnostic.file.fileName)
    if (!expected.some((rel) => normalized(path.join(root, rel)) === file)) continue
    productionDiagnosticCounts.set(file, (productionDiagnosticCounts.get(file) ?? 0) + 1)
  }
  const compilerSourceFiles = program.getSourceFiles()
  for (const sourceFile of compilerSourceFiles) {
    const file = normalized(sourceFile.fileName)
    if (expected.some((rel) => normalized(path.join(root, rel)) === file)) {
      actualProductionSourceFiles.add(file)
      try {
        assertL01SourceChecked(sourceFile, options, ts, `${projectPath}:${path.relative(root, sourceFile.fileName)}`)
      } catch (error) {
        sourceCheckFailures.push(error instanceof Error ? error.message : String(error))
      }
      if (!actualSourceProfiles.has(file)) actualSourceProfiles.set(file, new Set())
      actualSourceProfiles.get(file).add(projectPath)
    }
  }
  if (projectPath === 'manager-pwa/tsconfig.typecheck-l01.json') {
    assertNoNodeAmbientProvenance(compilerSourceFiles.map((file) => file.fileName), root, projectPath)
  }
}

function inspectInventory(paths, roots, compilerSources) {
  const missingRoots = paths.filter((rel) => !roots.has(normalized(path.join(root, rel))))
  const missingProgramFiles = paths.filter((rel) => !compilerSources.has(normalized(path.join(root, rel))))
  const missingDirectives = paths.filter((rel) => !hasActiveCheckDirective(fs.readFileSync(path.join(root, rel), 'utf8')))
  return [
    ...missingRoots.map((file) => `production source is not an explicit configured root: ${file}`),
    ...missingProgramFiles.map((file) => `production source is absent from all actual TypeScript programs: ${file}`),
    ...missingDirectives.map((file) => `production source lacks an active @ts-check directive: ${file}`)
  ]
}

const configFailures = allDiagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
const inventoryFailures = inspectInventory(expected, rootNames, actualProductionSourceFiles)
try {
  assertL01ProgramInventory({
    expectedPaths: expected.map((file) => path.join(root, file)),
    rootNames,
    programSourceFiles: actualProductionSourceFiles,
    label: 'L01 actual production inventory',
  })
} catch (error) {
  inventoryFailures.push(error instanceof Error ? error.message : String(error))
}
inventoryFailures.push(...sourceCheckFailures)

// Sensitivity check: run the same inventory enforcement after removing one
// real production path from the observed compiler inventory. This must detect
// both omissions; otherwise the production inventory gate is a no-op.
const sensitivityPath = expected[0]
if (sensitivityPath) {
  const missingPath = normalized(path.join(root, sensitivityPath))
  const rootsWithoutProbe = new Set(rootNames)
  const sourcesWithoutProbe = new Set(actualProductionSourceFiles)
  rootsWithoutProbe.delete(missingPath)
  sourcesWithoutProbe.delete(missingPath)
  const probeFailures = inspectInventory([sensitivityPath], rootsWithoutProbe, sourcesWithoutProbe)
  if (!probeFailures.some((failure) => failure.includes('not an explicit configured root')) ||
      !probeFailures.some((failure) => failure.includes('absent from all actual TypeScript programs'))) {
    inventoryFailures.push('actual-program inventory sensitivity probe did not detect the removed production root/source')
  } else {
    console.log(`L01 inventory sensitivity: detected omitted production root and compiler source (${sensitivityPath})`)
  }
}

console.log(`L01 production JS inventory: ${expected.length}`)
console.log(`L01 explicit configured roots: ${rootNames.size}; actual programs: ${programs.length}`)
console.log(`L01 actual production source files: ${actualProductionSourceFiles.size}`)

function csvCell(value) {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function runtimeFor(file) {
  if (file.startsWith('packages/')) return 'shared-package'
  if (file === 'src/shared/tillSound.js') return 'browser-dom'
  if (file.startsWith('src/shared/')) return 'shared-es2022'
  if (file.startsWith('src/renderer/src/utils/')) return 'desktop-renderer'
  if (file.startsWith('manager-pwa/src/lib/')) return 'manager-pwa-browser'
  if (file.startsWith('booking-site/src/lib/')) return 'booking-browser'
  if (file.startsWith('legacy-pos/src/shared/')) return 'legacy-es2020'
  return 'unassigned'
}

const coveragePath = path.join(root, 'docs', 'engineering', 'typescript-migration', 'evidence', 'L02-l01-production-coverage-2026-10-15.csv')
fs.mkdirSync(path.dirname(coveragePath), { recursive: true })
const coverageRows = [['path', 'runtime', 'configured_profiles', 'explicit_root', 'actual_program_profiles', 'actual_program_source', 'active_ts_check', 'source_diagnostic_count', 'source_strict_clean', 'profile_diagnostic_count', 'profile_clean']]
for (const file of expected) {
  const absolute = normalized(path.join(root, file))
  const configured = [...(explicitRootProfiles.get(absolute) ?? [])].sort()
  const actualProfiles = [...(actualSourceProfiles.get(absolute) ?? [])].sort()
  const directive = hasActiveCheckDirective(fs.readFileSync(path.join(root, file), 'utf8'))
  const diagnosticCount = productionDiagnosticCounts.get(absolute) ?? 0
  const profileDiagnosticCount = configured.reduce((count, projectPath) => count + (profileDiagnosticCounts.get(projectPath) ?? 0), 0)
  const rooted = configured.length > 0
  const present = actualProductionSourceFiles.has(absolute)
  const clean = rooted && present && directive && diagnosticCount === 0
  coverageRows.push([file, runtimeFor(file), configured.join(';'), rooted, actualProfiles.join(';'), present, directive, diagnosticCount, clean, profileDiagnosticCount, profileDiagnosticCount === 0])
}
fs.writeFileSync(coveragePath, `${coverageRows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`)
console.log(`L01 per-file production coverage inventory: ${path.relative(root, coveragePath)}`)

for (const diagnostic of configFailures) {
  const location = diagnostic.file && diagnostic.start !== undefined
    ? `${path.relative(root, diagnostic.file.fileName)}(${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1},${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).character + 1})`
    : ''
  console.error(`${location} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)
}
for (const failure of inventoryFailures) console.error(`INVENTORY: ${failure}`)

if (configFailures.length || inventoryFailures.length) {
  console.error(`FAIL: ${configFailures.length} TypeScript diagnostics; ${inventoryFailures.length} inventory failures.`)
  process.exitCode = 1
} else {
  console.log(`PASS: ${actualProductionSourceFiles.size}/${expected.length} inventoried production JavaScript files are explicit roots, in actual compiler programs, and checked with active @ts-check.`)
}

const denoCheck = spawnSync(process.execPath, [path.join(root, 'scripts', 'typecheck-l01-deno.mjs')], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true
})
if (denoCheck.error) throw denoCheck.error
if (denoCheck.status !== 0) process.exitCode = denoCheck.status ?? 1
