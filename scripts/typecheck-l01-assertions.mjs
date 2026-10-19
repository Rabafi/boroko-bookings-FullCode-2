import path from 'node:path'
import { STRICT_SUBOPTIONS, assertJsChecked } from './typecheck-pilot-checks.mjs'

function normalizeFile(fileName) {
  return path.resolve(fileName).replaceAll('\\', '/')
}

function normalizeLibs(libs) {
  return (libs ?? []).map((entry) => path.basename(entry).toLowerCase()).sort()
}

function sameValues(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
}

export function assertL01RuntimeOptions(options, expected, ts, label) {
  const problems = []
  for (const [key, value] of Object.entries({
    strict: true,
    allowJs: true,
    checkJs: false,
    noEmit: true,
    skipLibCheck: false,
  })) {
    if (options[key] !== value) problems.push(`${key}=${String(options[key])}; expected ${String(value)}`)
  }
  for (const key of STRICT_SUBOPTIONS) {
    if (options[key] === false) problems.push(`${key}=false disables a strict sub-option`)
  }
  const enumOptions = [
    ['target', ts.ScriptTarget, expected.target],
    ['module', ts.ModuleKind, expected.module],
    ['moduleResolution', ts.ModuleResolutionKind, expected.moduleResolution],
  ]
  for (const [key, enumMap, wantedName] of enumOptions) {
    const actualName = enumMap[options[key]]
    if (actualName !== wantedName) problems.push(`${key}=${actualName}; expected ${wantedName}`)
  }
  const actualLibs = normalizeLibs(options.lib)
  if (!sameValues(actualLibs, expected.lib)) {
    problems.push(`lib=${JSON.stringify(actualLibs)}; expected ${JSON.stringify([...expected.lib].sort())}`)
  }
  if (!Array.isArray(options.types)) {
    problems.push('types is omitted; an explicit runtime type list is required')
  } else if (!sameValues(options.types, expected.types)) {
    problems.push(`types=${JSON.stringify(options.types)}; expected ${JSON.stringify(expected.types)}`)
  }
  if (problems.length) throw new Error(`${label}: ${problems.join('; ')}`)
}

export function assertL01ProgramInventory({ expectedPaths, rootNames, programSourceFiles, label }) {
  const roots = new Set([...rootNames].map(normalizeFile))
  const sourceFiles = new Set([...programSourceFiles].map(normalizeFile))
  const missingRoots = expectedPaths.filter((file) => !roots.has(normalizeFile(file)))
  const missingSources = expectedPaths.filter((file) => !sourceFiles.has(normalizeFile(file)))
  if (missingRoots.length || missingSources.length) {
    const details = [
      ...missingRoots.map((file) => `not an explicit configured root: ${file}`),
      ...missingSources.map((file) => `absent from actual compiler program: ${file}`),
    ]
    throw new Error(`${label}: ${details.join('; ')}`)
  }
}

export function assertL01SourceChecked(sourceFile, options, ts, label) {
  assertJsChecked(sourceFile, options, ts, label)
}

export function assertNoNodeAmbientProvenance(programSourceFiles, repoRoot, label) {
  const nodeRoot = normalizeFile(path.join(repoRoot, 'node_modules', '@types', 'node')) + '/'
  const leaks = [...programSourceFiles]
    .map(normalizeFile)
    .filter((file) => file.toLowerCase().startsWith(nodeRoot.toLowerCase()))
  if (leaks.length) throw new Error(`${label}: Node declarations entered the browser program: ${leaks.join(', ')}`)
}
