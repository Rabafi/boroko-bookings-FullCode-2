import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
if (ts.version !== '5.9.3') throw new Error(`Expected TypeScript 5.9.3, got ${ts.version}`)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const legacyRoot = resolve(repoRoot, 'legacy-pos')
const legacyNodeTypesRoot = resolve(legacyRoot, 'node_modules/electron/node_modules/@types')
const legacyNodeTypesPackage = resolve(legacyNodeTypesRoot, 'node/package.json')
const legacyRendererTypesRoot = resolve(legacyRoot, 'node_modules/@types')
const typescriptLibRoot = resolve(dirname(require.resolve('typescript')))
const expectedLegacyNodeTypesVersion = '16.18.126'
const expectedLegacyReactVersions = { react: '18.3.31', 'react-dom': '18.3.7' }
const strictSuboptions = ['alwaysStrict', 'noImplicitAny', 'noImplicitThis', 'strictBindCallApply', 'strictBuiltinIteratorReturn', 'strictFunctionTypes', 'strictNullChecks', 'strictPropertyInitialization', 'useUnknownInCatchVariables']
const evidenceDir = resolve(repoRoot, 'docs/engineering/typescript-migration/evidence')
const profiles = [
  { name: 'main', config: 'tsconfig.typecheck-main-l03.json', dirs: ['src/main', 'src/shared'] },
  { name: 'preload', config: 'tsconfig.typecheck-preload-l03.json', dirs: ['src/preload', 'src/shared'] },
  { name: 'renderer', config: 'tsconfig.typecheck-renderer-l03.json', dirs: ['src/renderer/src', 'src/shared'] },
]
const extensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const toRepoPath = (path) => relative(repoRoot, path).split(sep).join('/')
const isWithin = (path, directory) => {
  const rel = relative(resolve(directory), resolve(path))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const relativeRootHash = (paths) => sha256(paths.map(toRepoPath).sort().join('\n'))
const typescriptArtifactFiles = ['typescript.js', ...readdirSync(typescriptLibRoot).filter((name) => /^lib\..+\.d\.ts$/i.test(name)).sort()]
const typescriptArtifactSha256 = sha256(typescriptArtifactFiles.map((name) => `${name}\0${sha256(readFileSync(resolve(typescriptLibRoot, name)))}`).join('\n'))

function assertParsedConfigErrors(errors, label) {
  if (errors.length) throw new Error(`${label}: config parse errors: ${errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('; ')}`)
}

function assertStrictSuboptions(options, label) {
  const disabled = strictSuboptions.filter((name) => options[name] === false)
  if (disabled.length) throw new Error(`${label}: strict sub-options disabled: ${disabled.map((name) => `${name}=false`).join(', ')}`)
}

function assertProductionInventory(roots, actualPaths, expected, label) {
  const rootSet = new Set(roots.map((path) => resolve(path)))
  const expectedSet = new Set(expected.map((path) => resolve(path)))
  const actualSet = new Set(actualPaths.map((path) => resolve(path)))
  const missingRoots = expected.filter((path) => !rootSet.has(resolve(path)))
  const extraRoots = roots.filter((path) => !expectedSet.has(resolve(path)))
  if (missingRoots.length || extraRoots.length) throw new Error(`${label}: root inventory mismatch; missing=${missingRoots.map(toRepoPath).join(',')}; extra=${extraRoots.map(toRepoPath).join(',')}`)
  const missingActual = expected.filter((path) => !actualSet.has(resolve(path)))
  if (missingActual.length) throw new Error(`${label}: production roots missing from program.getSourceFiles(): ${missingActual.map(toRepoPath).join(', ')}`)
  const checked = expected.filter((path) => rootSet.has(resolve(path)) && actualSet.has(resolve(path)))
  if (checked.length !== expected.length) throw new Error(`${label}: expected every production root to be an actual checked source (${checked.length}/${expected.length})`)
}

function sourceSuppressions(sourceFile) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, sourceFile.text)
  const found = []
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) continue
    const comment = scanner.getTokenText()
    if (/@ts-(?:nocheck|ignore|expect-error)\b/.test(comment)) {
      const line = sourceFile.getLineAndCharacterOfPosition(scanner.getTokenPos()).line + 1
      found.push(`${line}: ${comment.trim()}`)
    }
  }
  return found
}

function assertNoSuppressions(expected, sourceFiles, label) {
  const sourceMap = new Map(sourceFiles.map((sourceFile) => [resolve(sourceFile.fileName), sourceFile]))
  const suppressions = expected.flatMap((path) => sourceSuppressions(sourceMap.get(resolve(path))))
  if (suppressions.length) throw new Error(`${label}: TypeScript suppression directives are prohibited in production roots: ${suppressions.join('; ')}`)
}

function isTypeScriptLib(path) {
  const name = path.split(sep).at(-1) ?? ''
  return /^lib\..+\.d\.ts$/i.test(name) && isWithin(path, typescriptLibRoot)
}

function assertStandardLibraryProvenance(sourcePaths, sourceFiles, profile) {
  const libPaths = sourcePaths.filter((path) => /^lib\..+\.d\.ts$/i.test(path.split(sep).at(-1) ?? ''))
  const impostors = libPaths.filter((path) => !isTypeScriptLib(path))
  if (impostors.length) throw new Error(`${profile.name}: standard library declarations did not come from pinned TypeScript ${ts.version}: ${impostors.map(toRepoPath).join(', ')}`)

  const references = sourceFiles.flatMap((sourceFile) => ts.preProcessFile(sourceFile.text).libReferenceDirectives.map((item) => ({ file: resolve(sourceFile.fileName), name: item.fileName.toLowerCase() })))
  if (profile.name === 'main' || profile.name === 'preload') {
    const allowedDomReference = resolve(legacyRoot, 'node_modules/cross-fetch/index.d.ts')
    const unexpected = references.filter(({ file, name }) => {
      if (isTypeScriptLib(file)) return false
      if (name === 'dom' && file === allowedDomReference) return false
      return name !== 'es2020' || !isWithin(file, legacyNodeTypesRoot)
    })
    const domLibs = libPaths.filter((path) => /^lib\.dom(?:\.|\.d\.ts)/i.test(path.split(sep).at(-1) ?? ''))
    if (unexpected.length || (domLibs.length && !references.some(({ file, name }) => file === allowedDomReference && name === 'dom'))) {
      throw new Error(`${profile.name}: unexpected standard-library reference in Node16 program: ${unexpected.map(({ file, name }) => `${toRepoPath(file)} -> ${name}`).join(', ') || 'DOM library without the known cross-fetch reference'}`)
    }
    const unsupported = libPaths.filter((path) => /lib\.(?:esnext|webworker|scripthost)/i.test(path.split(sep).at(-1) ?? ''))
    if (unsupported.length) throw new Error(`${profile.name}: unexpected standard-library family in Node16 program: ${unsupported.map(toRepoPath).join(', ')}`)
  } else {
    const allowed = new Set(['es2020', 'dom', 'dom.iterable'])
    const unexpected = references.filter(({ file, name }) => !isTypeScriptLib(file) && !allowed.has(name))
    const unsupported = libPaths.filter((path) => /lib\.(?:esnext|webworker|scripthost)/i.test(path.split(sep).at(-1) ?? ''))
    if (unexpected.length || unsupported.length) throw new Error(`${profile.name}: unexpected standard-library reference: ${[...unexpected.map(({ file, name }) => `${toRepoPath(file)} -> ${name}`), ...unsupported.map(toRepoPath)].join(', ')}`)
  }
}

function assertLegacyRendererOptions(options, label) {
  if (options.strict !== true || options.noEmit !== true || options.allowJs !== true || options.checkJs !== true || options.skipLibCheck !== false || options.target !== ts.ScriptTarget.ES2020) {
    throw new Error(`${label}: Legacy renderer strict profile options failed enforcement`)
  }
  assertStrictSuboptions(options, label)
  if (options.module !== ts.ModuleKind.ESNext || options.moduleResolution !== ts.ModuleResolutionKind.Bundler || options.jsx !== ts.JsxEmit.ReactJSX) {
    throw new Error(`${label}: renderer must retain ESNext/Bundler/ReactJSX settings`)
  }
  if (options.forceConsistentCasingInFileNames !== true) throw new Error(`${label}: renderer casing enforcement is required`)
  const libs = (options.lib ?? []).map((entry) => String(entry).split(/[\\/]/).pop().toLowerCase())
  const expectedLibs = ['lib.es2020.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts']
  if (JSON.stringify(libs) !== JSON.stringify(expectedLibs)) throw new Error(`${label}: renderer libs must be exactly ES2020, DOM and DOM.Iterable`)
  if (JSON.stringify(options.types) !== JSON.stringify(['vite/client', 'react', 'react-dom'])) throw new Error(`${label}: renderer ambient types must be exactly vite/client, react and react-dom`)
  if (options.typeRoots !== undefined) {
    const typeRoots = options.typeRoots.map((path) => resolve(path))
    if (typeRoots.length !== 1 || typeRoots[0] !== legacyRendererTypesRoot) throw new Error(`${label}: renderer typeRoots must resolve to the Legacy-local @types tree`)
  }
}

function assertLegacyRendererTypeOrigins(sourcePaths, label) {
  assertLegacyRendererHasNoNodeDeclarations(sourcePaths, label)
  const reactPaths = sourcePaths.filter((path) => path.includes(`${sep}@types${sep}react${sep}`))
  const reactDomPaths = sourcePaths.filter((path) => path.includes(`${sep}@types${sep}react-dom${sep}`))
  const misplaced = [...reactPaths.filter((path) => !isWithin(path, resolve(legacyRendererTypesRoot, 'react'))), ...reactDomPaths.filter((path) => !isWithin(path, resolve(legacyRendererTypesRoot, 'react-dom')))]
  if (!reactPaths.length || !reactDomPaths.length || misplaced.length) {
    throw new Error(`${label}: renderer must load React 18 declarations only from Legacy-local @types; offending or missing paths=${misplaced.map(toRepoPath).join(', ') || 'React/ReactDOM declarations missing'}`)
  }
}

function assertLegacyNodeTypeOrigins(sourcePaths, label) {
  const nodeDeclarations = sourcePaths.filter((path) => path.includes(`${sep}@types${sep}node${sep}`))
  const misplacedNode = nodeDeclarations.filter((path) => !isWithin(path, resolve(legacyNodeTypesRoot, 'node')))
  if (!nodeDeclarations.length || misplacedNode.length) {
    throw new Error(`${label}: Node declarations must come only from Electron 22's isolated Node16 tree: ${misplacedNode.map(toRepoPath).join(', ') || 'no Node declaration files loaded'}`)
  }
  const reactDeclarations = sourcePaths.filter((path) => path.includes(`${sep}@types${sep}react${sep}`) || path.includes(`${sep}@types${sep}react-dom${sep}`))
  if (reactDeclarations.length) throw new Error(`${label}: React declarations entered the Node16 program: ${reactDeclarations.map(toRepoPath).join(', ')}`)
}

function diagnosticSignature(diagnostic) {
  return JSON.stringify([diagnostic.path ?? null, diagnostic.code, diagnostic.message])
}

function classifyDiagnostics(current, previous) {
  const remaining = new Map()
  for (const diagnostic of previous) {
    const signature = diagnosticSignature(diagnostic)
    remaining.set(signature, (remaining.get(signature) ?? 0) + 1)
  }
  let unchanged = 0
  let introduced = 0
  const labels = current.map((diagnostic) => {
    const signature = diagnosticSignature(diagnostic)
    const count = remaining.get(signature) ?? 0
    if (count > 0) {
      remaining.set(signature, count - 1)
      unchanged += 1
      return { ...diagnostic, baselineChange: 'unchanged' }
    }
    introduced += 1
    return { ...diagnostic, baselineChange: 'introduced' }
  })
  const cleared = [...remaining.values()].reduce((sum, count) => sum + count, 0)
  return { labels, unchanged, introduced, cleared }
}

function compareDiagnosticBaseline(profileName, previousPath, previousRecords, currentDiagnostics, configHash, rootHash) {
  if (!previousPath) {
    return {
      summary: { status: 'unavailable', source: null, unchanged: null, introduced: null, cleared: null, uncompared: currentDiagnostics.length },
      labels: currentDiagnostics.map((diagnostic) => ({ ...diagnostic, baselineChange: 'uncompared' })),
    }
  }
  const previousMetadata = previousRecords.find((record) => record.recordType === 'metadata')
  const baselineComparable = previousMetadata?.profile === `L03-legacy-${profileName}` && previousMetadata?.typescriptVersion === ts.version && previousMetadata?.typescriptArtifactSha256 === typescriptArtifactSha256 && previousMetadata?.configSha256 === configHash && previousMetadata?.productionRootsSha256 === rootHash
  if (!baselineComparable) {
    return {
      summary: { status: 'historical-unverified', source: toRepoPath(previousPath), unchanged: null, introduced: null, cleared: null, uncompared: currentDiagnostics.length },
      labels: currentDiagnostics.map((diagnostic) => ({ ...diagnostic, baselineChange: 'uncompared' })),
    }
  }
  const previous = previousRecords.filter((record) => record.recordType === 'diagnostic')
  const comparison = classifyDiagnostics(currentDiagnostics, previous)
  return {
    summary: {
      status: 'compared', source: toRepoPath(previousPath), unchanged: comparison.unchanged,
      introduced: comparison.introduced, cleared: comparison.cleared, uncompared: 0,
    },
    labels: comparison.labels,
  }
}

function latestPriorSidecar(profileName) {
  const prefix = `L03-legacy-${profileName}-diagnostics-`
  const files = readdirSync(evidenceDir).filter((name) => name.startsWith(prefix) && name.endsWith('.jsonl')).sort()
  return files.length ? resolve(evidenceDir, files.at(-1)) : null
}

function assertLegacyNodeOptions(options, label, resolvedNodeTypesPath) {
  if (options.strict !== true || options.noEmit !== true || options.allowJs !== true || options.checkJs !== true || options.skipLibCheck !== false || options.target !== ts.ScriptTarget.ES2020) {
    throw new Error(`${label}: Legacy strict profile options failed enforcement`)
  }
  assertStrictSuboptions(options, label)
  if (options.forceConsistentCasingInFileNames !== true) throw new Error(`${label}: case-consistent path enforcement is required`)
  if (options.module !== ts.ModuleKind.Node16 || options.moduleResolution !== ts.ModuleResolutionKind.Node16) {
    throw new Error(`${label}: main/preload must retain Node16 module and resolution settings`)
  }
  if (JSON.stringify(options.lib) !== JSON.stringify(['lib.es2020.d.ts'])) {
    throw new Error(`${label}: main/preload must use only the ES2020 standard library`)
  }
  if (JSON.stringify(options.types) !== JSON.stringify(['node'])) {
    throw new Error(`${label}: main/preload ambient types must contain only node`)
  }
  const typeRoots = (options.typeRoots ?? []).map((path) => resolve(path))
  if (typeRoots.length !== 1 || typeRoots[0] !== legacyNodeTypesRoot) {
    throw new Error(`${label}: main/preload typeRoots must isolate Electron 22's Node16 declarations`)
  }
  if (!resolvedNodeTypesPath || !isWithin(resolvedNodeTypesPath, resolve(legacyNodeTypesRoot, 'node'))) {
    throw new Error(`${label}: node type reference resolved outside the isolated Node16 declarations`)
  }
}
function assertLegacyRendererHasNoNodeDeclarations(sourcePaths, label) {
  const leaked = sourcePaths.filter((path) => path.includes(`${sep}@types${sep}node${sep}`))
  if (leaked.length) {
    throw new Error(`${label}: Node declarations entered the Legacy renderer program: ${leaked.map(toRepoPath).join(', ')}`)
  }
}
function assertProfileGuardSensitivity() {
  const baseline = {
    strict: true,
    noEmit: true,
    allowJs: true,
    checkJs: true,
    skipLibCheck: false,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.Node16,
    moduleResolution: ts.ModuleResolutionKind.Node16,
    lib: ['lib.es2020.d.ts'],
    types: ['node'],
    typeRoots: [legacyNodeTypesRoot],
    forceConsistentCasingInFileNames: true,
  }
  const nodeEntry = resolve(legacyNodeTypesRoot, 'node/index.d.ts')
  assertLegacyNodeOptions(baseline, 'guard baseline', nodeEntry)
  const rendererBaseline = {
    strict: true, noEmit: true, allowJs: true, checkJs: true, skipLibCheck: false,
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    forceConsistentCasingInFileNames: true, lib: ['lib.es2020.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: ['vite/client', 'react', 'react-dom'], typeRoots: [legacyRendererTypesRoot],
  }
  assertLegacyRendererOptions(rendererBaseline, 'guard renderer baseline')
  for (const name of strictSuboptions) {
    let nodeRejected = false
    try { assertLegacyNodeOptions({ ...baseline, [name]: false }, `guard strict ${name}`, nodeEntry) } catch (error) { nodeRejected = String(error).includes(`${name}=false`) }
    if (!nodeRejected) throw new Error(`Legacy checker guard failed sensitivity case: Node ${name}=false`)
    let rendererRejected = false
    try { assertLegacyRendererOptions({ ...rendererBaseline, [name]: false }, `guard renderer strict ${name}`) } catch (error) { rendererRejected = String(error).includes(`${name}=false`) }
    if (!rendererRejected) throw new Error(`Legacy checker guard failed sensitivity case: renderer ${name}=false`)
  }
  let parseRejected = false
  const malformedConfig = ts.parseJsonConfigFileContent({ compilerOptions: { misspelledCompilerOption: true } }, ts.sys, legacyRoot)
  try { assertParsedConfigErrors(malformedConfig.errors, 'guard malformed config') } catch (error) { parseRejected = String(error).includes('config parse errors') }
  if (!malformedConfig.errors.length || !parseRejected) throw new Error('Legacy checker guard failed sensitivity case: parse errors')

  const realCommentSource = ts.createSourceFile('guard.tsx', '// @ts-ignore\n/* @ts-nocheck */\nconst text = "@ts-expect-error";\n', ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX)
  const foundSuppressions = sourceSuppressions(realCommentSource)
  if (foundSuppressions.length !== 2 || foundSuppressions.some((entry) => entry.includes('@ts-expect-error'))) throw new Error('Legacy checker guard failed sensitivity case: scanner comment/string distinction')
  const suppressionSourcePath = resolve(legacyRoot, 'src/main/guard-suppressions.tsx')
  const suppressionsSource = ts.createSourceFile(suppressionSourcePath, '// @ts-ignore\n/* @ts-nocheck */\n// @ts-expect-error\n', ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX)
  if (sourceSuppressions(suppressionsSource).length !== 3) throw new Error('Legacy checker guard failed sensitivity case: suppression directives')
  let productionSuppressionsRejected = false
  try { assertNoSuppressions([suppressionSourcePath], [suppressionsSource], 'guard production suppressions') } catch (error) { productionSuppressionsRejected = String(error).includes('suppression directives are prohibited') }
  if (!productionSuppressionsRejected) throw new Error('Legacy checker guard failed sensitivity case: production suppression enforcement')

  const expected = [resolve(legacyRoot, 'src/main/guard-one.js'), resolve(legacyRoot, 'src/main/guard-two.js')]
  const rootBaseline = [...expected]
  const actualBaseline = [...expected]
  assertProductionInventory(rootBaseline, actualBaseline, expected, 'guard inventory baseline')
  let missingRootRejected = false
  try { assertProductionInventory(rootBaseline.slice(1), actualBaseline, expected, 'guard missing root') } catch (error) { missingRootRejected = String(error).includes('root inventory mismatch') }
  if (!missingRootRejected) throw new Error('Legacy checker guard failed sensitivity case: omitted configured root')
  let missingActualRejected = false
  try { assertProductionInventory(rootBaseline, actualBaseline.slice(1), expected, 'guard missing actual') } catch (error) { missingActualRejected = String(error).includes('missing from program.getSourceFiles()') }
  if (!missingActualRejected) throw new Error('Legacy checker guard failed sensitivity case: omitted actual program source')

  let fakeLibRejected = false
  try { assertStandardLibraryProvenance([resolve(repoRoot, 'fake-ts-lib/lib.webworker.d.ts')], [], { name: 'renderer' }) } catch (error) { fakeLibRejected = String(error).includes('pinned TypeScript') }
  if (!fakeLibRejected) throw new Error('Legacy checker guard failed sensitivity case: fake standard-library provenance')

  const baseDiagnostic = { path: 'legacy-pos/src/main/a.js', code: 7006, message: 'implicit any' }
  const classified = classifyDiagnostics([baseDiagnostic, { ...baseDiagnostic, path: 'legacy-pos/src/main/b.js' }], [baseDiagnostic, { ...baseDiagnostic, path: 'legacy-pos/src/main/c.js' }])
  if (classified.unchanged !== 1 || classified.introduced !== 1 || classified.cleared !== 1 || classified.labels[0].baselineChange !== 'unchanged' || classified.labels[1].baselineChange !== 'introduced') {
    throw new Error('Legacy checker guard failed sensitivity case: baseline diagnostic change labels')
  }
  const configHashProbe = 'config-hash-probe'
  const rootHashProbe = 'root-hash-probe'
  const baselineMetadata = {
    recordType: 'metadata', profile: 'L03-legacy-main', typescriptVersion: ts.version,
    typescriptArtifactSha256, configSha256: configHashProbe, productionRootsSha256: rootHashProbe,
  }
  const priorDiagnostics = [baseDiagnostic, { ...baseDiagnostic, path: 'legacy-pos/src/main/c.js' }].map((diagnostic) => ({ recordType: 'diagnostic', ...diagnostic }))
  const currentDiagnostics = [baseDiagnostic, { ...baseDiagnostic, path: 'legacy-pos/src/main/b.js' }]
  const baselinePathProbe = resolve(evidenceDir, 'guard-baseline.jsonl')
  const staleBaselineFields = [
    ['profile', 'L03-legacy-preload'],
    ['typescriptVersion', '0.0.0'],
    ['typescriptArtifactSha256', 'stale-typescriptArtifactSha256'],
    ['configSha256', 'stale-configSha256'],
    ['productionRootsSha256', 'stale-productionRootsSha256'],
  ]
  for (const [field, staleValue] of staleBaselineFields) {
    const staleMetadata = { ...baselineMetadata, [field]: staleValue }
    const stale = compareDiagnosticBaseline('main', baselinePathProbe, [staleMetadata, ...priorDiagnostics], [baseDiagnostic], configHashProbe, rootHashProbe)
    if (stale.summary.status !== 'historical-unverified' || stale.summary.introduced !== null || stale.summary.uncompared !== 1 || stale.labels[0].baselineChange !== 'uncompared') {
      throw new Error(`Legacy checker guard failed sensitivity case: stale baseline ${field}`)
    }
  }
  const compatible = compareDiagnosticBaseline('main', baselinePathProbe, [baselineMetadata, ...priorDiagnostics], currentDiagnostics, configHashProbe, rootHashProbe)
  if (compatible.summary.status !== 'compared' || compatible.summary.unchanged !== 1 || compatible.summary.introduced !== 1 || compatible.summary.cleared !== 1 || compatible.labels[0].baselineChange !== 'unchanged' || compatible.labels[1].baselineChange !== 'introduced') {
    throw new Error('Legacy checker guard failed sensitivity case: comparable baseline diagnostic labels')
  }
  const unavailableBaseline = compareDiagnosticBaseline('main', null, [], [baseDiagnostic], '', '')
  if (unavailableBaseline.summary.status !== 'unavailable' || unavailableBaseline.summary.uncompared !== 1 || unavailableBaseline.summary.introduced !== null || unavailableBaseline.labels[0].baselineChange !== 'uncompared') throw new Error('Legacy checker guard failed sensitivity case: unavailable baseline is not treated as zero')
  const cases = [
    ['wrong-module', { ...baseline, module: ts.ModuleKind.CommonJS }],
    ['wrong-moduleResolution', { ...baseline, moduleResolution: ts.ModuleResolutionKind.Node10 }],
    ['extra-lib', { ...baseline, lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'] }],
    ['extra-ambient-types', { ...baseline, types: ['node', 'react'] }],
    ['wrong-typeRoots', { ...baseline, typeRoots: [resolve(legacyRoot, 'node_modules/@types')] }],
  ]
  for (const [name, options] of cases) {
    let rejected = false
    try { assertLegacyNodeOptions(options, `guard ${name}`, nodeEntry) } catch { rejected = true }
    if (!rejected) throw new Error(`Legacy checker guard failed sensitivity case: ${name}`)
  }
  const nodeTypePaths = [nodeEntry]
  assertLegacyNodeTypeOrigins(nodeTypePaths, 'guard node provenance baseline')
  let reactLeakRejected = false
  try { assertLegacyNodeTypeOrigins([...nodeTypePaths, resolve(legacyRoot, 'node_modules/@types/react/index.d.ts')], 'guard react-leak') } catch (error) { reactLeakRejected = String(error).includes('React declarations entered') }
  if (!reactLeakRejected) throw new Error('Legacy checker guard failed sensitivity case: React declarations entered Node profile')
  let nodeLeakRejected = false
  try { assertLegacyRendererTypeOrigins([resolve(legacyRoot, 'node_modules/@types/node/index.d.ts'), resolve(legacyRendererTypesRoot, 'react/index.d.ts'), resolve(legacyRendererTypesRoot, 'react-dom/index.d.ts')], 'guard renderer-node-leak') } catch (error) { nodeLeakRejected = String(error).includes('Node declarations entered') }
  if (!nodeLeakRejected) throw new Error('Legacy checker guard failed sensitivity case: Node declarations entered renderer')
  let wrongReactRejected = false
  try { assertLegacyRendererTypeOrigins([resolve(repoRoot, 'node_modules/@types/react/index.d.ts'), resolve(repoRoot, 'node_modules/@types/react-dom/index.d.ts')], 'guard renderer-react-provenance') } catch { wrongReactRejected = true }
  if (!wrongReactRejected) throw new Error('Legacy checker guard failed sensitivity case: non-Legacy React provenance')
  let rendererLeakRejected = false
  try {
    assertLegacyRendererHasNoNodeDeclarations([resolve(legacyRoot, 'node_modules/@types/node/index.d.ts')], 'guard renderer-node-leak')
  } catch { rendererLeakRejected = true }
  if (!rendererLeakRejected) throw new Error('Legacy checker guard failed sensitivity case: renderer-node-leak')
}
const legacyNodeTypes = JSON.parse(readFileSync(legacyNodeTypesPackage, 'utf8'))
if (legacyNodeTypes.version !== expectedLegacyNodeTypesVersion) {
  throw new Error(`Legacy main/preload require Electron 22's @types/node ${expectedLegacyNodeTypesVersion}, got ${legacyNodeTypes.version}`)
}
for (const [name, expected] of Object.entries(expectedLegacyReactVersions)) {
  const packagePath = resolve(legacyRendererTypesRoot, name, 'package.json')
  const installed = JSON.parse(readFileSync(packagePath, 'utf8'))
  if (installed.version !== expected) throw new Error(`Legacy renderer requires @types/${name} ${expected}, got ${installed.version}`)
}
assertProfileGuardSensitivity()
function filesUnder(directory) {
  const result = []
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = resolve(path, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'test' || entry.name === '__tests__') continue
        visit(full)
      } else if (entry.isFile() && extensions.has(extname(entry.name)) && !/\.(test|spec)\.[^.]+$/i.test(entry.name)) result.push(full)
    }
  }
  visit(directory)
  return result
}
for (const profile of profiles) {
  const configPath = resolve(legacyRoot, profile.config)
  const raw = ts.readConfigFile(configPath, ts.sys.readFile)
  if (raw.error) throw new Error(`${profile.name}: ${ts.flattenDiagnosticMessageText(raw.error.messageText, '\n')}`)
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, dirname(configPath), undefined, configPath)
  assertParsedConfigErrors(parsed.errors, profile.name)
  const { options } = parsed
  let resolvedNodeTypesPath = null
  if (profile.name === 'main' || profile.name === 'preload') {
    const nodeReference = ts.resolveTypeReferenceDirective('node', configPath, options, ts.sys).resolvedTypeReferenceDirective
    resolvedNodeTypesPath = nodeReference?.resolvedFileName ? resolve(nodeReference.resolvedFileName) : null
    assertLegacyNodeOptions(options, profile.name, resolvedNodeTypesPath)
  } else {
    assertLegacyRendererOptions(options, profile.name)
  }
  const roots = parsed.fileNames.map((path) => resolve(path)).sort()
  const expected = profile.dirs.flatMap((dir) => filesUnder(resolve(legacyRoot, dir))).sort()
  const rootSet = new Set(roots)
  const missingRoots = expected.filter((path) => !rootSet.has(path))
  const extraRoots = roots.filter((path) => !expected.includes(path))
  if (missingRoots.length || extraRoots.length) throw new Error(`${profile.name}: root inventory mismatch; missing=${missingRoots.map(toRepoPath).join(',')}; extra=${extraRoots.map(toRepoPath).join(',')}`)
  const program = ts.createProgram({ rootNames: roots, options })
  const actual = program.getSourceFiles()
  const actualPaths = actual.map((sourceFile) => resolve(sourceFile.fileName))
  const actualSet = new Set(actual.map((sourceFile) => resolve(sourceFile.fileName)))
  assertProductionInventory(roots, actualPaths, expected, profile.name)
  assertNoSuppressions(expected, actual, profile.name)
  assertStandardLibraryProvenance(actualPaths, actual, profile)
  if (profile.name === 'main' || profile.name === 'preload') {
    const sourcePaths = actual.map((sourceFile) => resolve(sourceFile.fileName))
    assertLegacyNodeTypeOrigins(sourcePaths, profile.name)
    const domLibFiles = sourcePaths.filter((path) => path.split(sep).at(-1)?.startsWith('lib.dom'))
    const domReferenceSources = actual
      .filter((sourceFile) => ts.preProcessFile(sourceFile.text).libReferenceDirectives.some((item) => item.fileName.toLowerCase() === 'dom'))
      .map((sourceFile) => resolve(sourceFile.fileName))
    const allowedDomReference = resolve(legacyRoot, 'node_modules/cross-fetch/index.d.ts')
    const unexpectedDomReferences = domReferenceSources.filter((path) => path !== allowedDomReference)
    if (domLibFiles.length && (!domReferenceSources.includes(allowedDomReference) || unexpectedDomReferences.length)) {
      throw new Error(`${profile.name}: unexpected DOM declaration edge in Node16 program: ${unexpectedDomReferences.map(toRepoPath).join(', ') || 'DOM library present without the known cross-fetch reference'}`)
    }
  } else if (profile.name === 'renderer') {
    assertLegacyRendererTypeOrigins(actualPaths, profile.name)
  }
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
  const configHash = sha256(readFileSync(configPath))
  const rootHash = relativeRootHash(expected)
  const currentDiagnostics = diagnostics.map((diagnostic) => ({ path: diagnostic.file ? toRepoPath(diagnostic.file.fileName) : null, line: diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : null, code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') }))
  const previousPath = latestPriorSidecar(profile.name)
  const previousRecords = previousPath ? readFileSync(previousPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : []
  const baselineComparison = compareDiagnosticBaseline(profile.name, previousPath, previousRecords, currentDiagnostics, configHash, rootHash)
  const diagnosticBaseline = baselineComparison.summary
  const diagnosticLabels = baselineComparison.labels
  const countsByCode = {}
  for (const diagnostic of diagnostics) countsByCode[`TS${diagnostic.code}`] = (countsByCode[`TS${diagnostic.code}`] ?? 0) + 1
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const sidecar = resolve(evidenceDir, `L03-legacy-${profile.name}-diagnostics-${stamp}.jsonl`)
  mkdirSync(evidenceDir, { recursive: true })
  const records = [{ recordType: 'metadata', profile: `L03-legacy-${profile.name}`, typescriptVersion: ts.version, typescriptArtifactSha256, configPath: toRepoPath(configPath), configSha256: configHash, productionRoots: roots.length, productionRootsSha256: rootHash, actualProgramFiles: actual.length, actualDeclarationProgramFiles: actual.filter((sourceFile) => sourceFile.isDeclarationFile).length, actualCheckedProductionRoots: expected.length, diagnostics: diagnostics.length, countsByCode, diagnosticBaseline }, ...diagnosticLabels.map((diagnostic) => ({ recordType: 'diagnostic', ...diagnostic }))]
  writeFileSync(sidecar, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
  console.log(`[typecheck-legacy-l03] ${profile.name}: roots=${roots.length}, actualProgramFiles=${actual.length}, checkedProductionRoots=${expected.length}, errors=${diagnostics.length}, baseline=${diagnosticBaseline.status}${diagnosticBaseline.status === 'compared' ? ` unchanged=${diagnosticBaseline.unchanged} introduced=${diagnosticBaseline.introduced} cleared=${diagnosticBaseline.cleared}` : ` uncompared=${diagnosticBaseline.uncompared}`}, sidecar=${toRepoPath(sidecar)}`)
  if (diagnostics.length) process.exitCode = 1
}
