import { createRequire } from 'node:module'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
if (ts.version !== '5.9.3') throw new Error(`Expected TypeScript 5.9.3, got ${ts.version}`)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const legacyRoot = resolve(repoRoot, 'legacy-pos')
const evidenceDir = resolve(repoRoot, 'docs/engineering/typescript-migration/evidence')
const profiles = [
  { name: 'main', config: 'tsconfig.typecheck-main-l03.json', dirs: ['src/main', 'src/shared'] },
  { name: 'preload', config: 'tsconfig.typecheck-preload-l03.json', dirs: ['src/preload', 'src/shared'] },
  { name: 'renderer', config: 'tsconfig.typecheck-renderer-l03.json', dirs: ['src/renderer/src', 'src/shared'] },
]
const extensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const toRepoPath = (path) => relative(repoRoot, path).split(sep).join('/')
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
  const { options } = parsed
  const mustBeStrict = options.strict === true && options.noEmit === true && options.allowJs === true && options.checkJs === true && options.skipLibCheck === false && options.target === ts.ScriptTarget.ES2020
  if (!mustBeStrict) throw new Error(`${profile.name}: Legacy strict profile options failed enforcement`)
  const roots = parsed.fileNames.map((path) => resolve(path)).sort()
  const expected = profile.dirs.flatMap((dir) => filesUnder(resolve(legacyRoot, dir))).sort()
  const rootSet = new Set(roots)
  const missingRoots = expected.filter((path) => !rootSet.has(path))
  const extraRoots = roots.filter((path) => !expected.includes(path))
  if (missingRoots.length || extraRoots.length) throw new Error(`${profile.name}: root inventory mismatch; missing=${missingRoots.map(toRepoPath).join(',')}; extra=${extraRoots.map(toRepoPath).join(',')}`)
  const program = ts.createProgram({ rootNames: roots, options })
  const actual = program.getSourceFiles()
  const actualSet = new Set(actual.map((sourceFile) => resolve(sourceFile.fileName)))
  const missingActual = expected.filter((path) => !actualSet.has(path))
  if (missingActual.length) throw new Error(`${profile.name}: roots missing from program.getSourceFiles(): ${missingActual.map(toRepoPath).join(', ')}`)
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
  const countsByCode = {}
  for (const diagnostic of diagnostics) countsByCode[`TS${diagnostic.code}`] = (countsByCode[`TS${diagnostic.code}`] ?? 0) + 1
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const sidecar = resolve(evidenceDir, `L03-legacy-${profile.name}-diagnostics-${stamp}.jsonl`)
  mkdirSync(evidenceDir, { recursive: true })
  const records = [{ recordType: 'metadata', profile: `L03-legacy-${profile.name}`, typescriptVersion: ts.version, configPath: toRepoPath(configPath), productionRoots: roots.length, actualProgramFiles: actual.length, diagnostics: diagnostics.length, countsByCode }, ...diagnostics.map((diagnostic) => ({ recordType: 'diagnostic', path: diagnostic.file ? toRepoPath(diagnostic.file.fileName) : null, line: diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : null, code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') }))]
  writeFileSync(sidecar, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
  console.log(`[typecheck-legacy-l03] ${profile.name}: roots=${roots.length}, actualProgramFiles=${actual.length}, errors=${diagnostics.length}, sidecar=${toRepoPath(sidecar)}`)
  if (diagnostics.length) process.exitCode = 1
}
