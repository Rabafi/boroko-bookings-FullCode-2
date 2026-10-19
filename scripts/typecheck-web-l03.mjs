import { createRequire } from 'node:module'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
if (ts.version !== '5.9.3') throw new Error(`Expected TypeScript 5.9.3, got ${ts.version}`)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidenceDir = resolve(repoRoot, 'docs/engineering/typescript-migration/evidence')
const apps = [
  { name: 'manager-pwa', config: 'manager-pwa/tsconfig.typecheck-l03.json' },
  { name: 'booking-site', config: 'booking-site/tsconfig.typecheck-l03.json' },
]
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const toRepoPath = (path) => relative(repoRoot, path).split(sep).join('/')

function productionInventory(appRoot) {
  const found = []
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'test' || entry.name === '__tests__') continue
        visit(full)
      } else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
        if (/\.(test|spec)\.[^.]+$/i.test(entry.name)) continue
        found.push(full)
      }
    }
  }
  visit(appRoot)
  return found.sort()
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sourceSuppressions(sourceFile) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, sourceFile.text)
  const found = []
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) continue
    const comment = scanner.getTokenText()
    if (/@ts-(?:nocheck|ignore|expect-error)\b/.test(comment)) {
      const position = scanner.getTokenPos()
      const line = sourceFile.getLineAndCharacterOfPosition(position).line + 1
      found.push(`${line}: ${comment.trim()}`)
    }
  }
  return found
}

for (const app of apps) {
  const configPath = resolve(repoRoot, app.config)
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
  if (configFile.error) throw new Error(`${app.name}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`)
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(configPath), undefined, configPath)
  if (parsed.errors.length) throw new Error(`${app.name}: config parse errors: ${parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('; ')}`)
  const { options } = parsed
  const libs = (options.lib ?? []).map((entry) => String(entry).split(/[\\/]/).pop().toLowerCase())
  const expectedLibs = ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts']
  const browserTypesOnly = Array.isArray(options.types) && options.types.length === 1 && options.types[0] === 'vite/client'
  const strictOptions = ['alwaysStrict', 'noImplicitAny', 'noImplicitThis', 'strictBindCallApply', 'strictBuiltinIteratorReturn', 'strictFunctionTypes', 'strictNullChecks', 'strictPropertyInitialization', 'useUnknownInCatchVariables']
  const expectedOptions = options.strict === true && strictOptions.every((name) => options[name] !== false) && options.noEmit === true && options.allowJs === true && options.checkJs === true && options.skipLibCheck === false && options.target === ts.ScriptTarget.ES2022 && options.module === ts.ModuleKind.ESNext && options.moduleResolution === ts.ModuleResolutionKind.Bundler && options.jsx === ts.JsxEmit.ReactJSX && options.forceConsistentCasingInFileNames === true && browserTypesOnly && libs.length === expectedLibs.length && expectedLibs.every((want, index) => libs[index] === want)
  if (!expectedOptions) throw new Error(`${app.name}: strict browser L03 compiler settings failed enforcement`)
  const roots = parsed.fileNames.map((path) => resolve(path)).sort()
  const expected = productionInventory(resolve(repoRoot, app.name, 'src'))
  const rootSet = new Set(roots)
  const missingRoots = expected.filter((path) => !rootSet.has(path))
  const outsideRoots = roots.filter((path) => !expected.includes(path))
  if (missingRoots.length || outsideRoots.length) {
    throw new Error(`${app.name}: production root inventory mismatch; missing ${missingRoots.map(toRepoPath).join(', ')}; unexpected ${outsideRoots.map(toRepoPath).join(', ')}`)
  }

  const program = ts.createProgram({ rootNames: roots, options })
  const actual = program.getSourceFiles()
  const actualSet = new Set(actual.map((sourceFile) => resolve(sourceFile.fileName)))
  const missingActual = expected.filter((path) => !actualSet.has(path))
  if (missingActual.length) throw new Error(`${app.name}: configured production roots missing from program.getSourceFiles(): ${missingActual.map(toRepoPath).join(', ')}`)
  const excludedActualRoots = expected.filter((path) => !roots.includes(path) || !actualSet.has(path))
  if (excludedActualRoots.length) throw new Error(`${app.name}: production roots are not checked: ${excludedActualRoots.map(toRepoPath).join(', ')}`)
  const suppressions = expected.flatMap((path) => sourceSuppressions(program.getSourceFile(path)))
  if (suppressions.length) throw new Error(`${app.name}: TypeScript suppression directives are prohibited in production roots: ${suppressions.join('; ')}`)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  const errors = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
  const time = new Date().toISOString().replace(/[:.]/g, '-')
  const sidecarPath = resolve(evidenceDir, `L03-${app.name}-diagnostics-${time}.jsonl`)
  mkdirSync(evidenceDir, { recursive: true })
  const inventoryHash = sha256(expected.map((path) => `${toRepoPath(path)}\0${sha256(readFileSync(path))}`).join('\n'))
  const declarationFiles = actual.filter((sourceFile) => sourceFile.isDeclarationFile)
  const records = [{
    recordType: 'metadata', profile: `L03-${app.name}`, typescriptVersion: ts.version,
    configPath: toRepoPath(configPath), productionRoots: roots.length,
    configSha256: sha256(readFileSync(configPath)), productionInventorySha256: inventoryHash,
    actualProgramFiles: actual.length, actualNonDeclarationProgramFiles: actual.length - declarationFiles.length,
    actualDeclarationProgramFiles: declarationFiles.length, actualCheckedProductionRoots: expected.length, diagnostics: errors.length,
    countsByCode: Object.fromEntries([...new Set(errors.map((d) => `TS${d.code}`))].map((code) => [code, errors.filter((d) => `TS${d.code}` === code).length])),
  }, ...errors.map((diagnostic) => ({
    recordType: 'diagnostic', path: diagnostic.file ? toRepoPath(diagnostic.file.fileName) : null,
    line: diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : null,
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }))]
  writeFileSync(sidecarPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
  console.log(`[typecheck-l03] ${app.name}: roots=${roots.length}, actualProgramFiles=${actual.length}, actualNonDeclarationProgramFiles=${actual.length - declarationFiles.length}, checkedProductionRoots=${expected.length}, errors=${errors.length}, sidecar=${toRepoPath(sidecarPath)}`)
  if (errors.length) process.exitCode = 1
}



