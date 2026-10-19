import { createRequire } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const ts = require('typescript');
if (ts.version !== '5.9.3') throw new Error(`TypeScript ${ts.version}; expected pinned 5.9.3`);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(root, 'tsconfig.typecheck-main-surface.json');
const rel = (path) => relative(root, path).split(sep).join('/');
const strictSuboptions = [
  'noImplicitAny', 'noImplicitThis', 'strictNullChecks', 'strictFunctionTypes',
  'strictBindCallApply', 'strictPropertyInitialization', 'strictBuiltinIteratorReturn',
  'alwaysStrict', 'useUnknownInCatchVariables',
];

function inventory(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return path === resolve(root, 'src/main/assets') ? [] : inventory(path);
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : [];
  }).sort();
}

function assertOptions(options) {
  const errors = [];
  for (const [name, expected] of [
    ['strict', true], ['allowJs', true], ['checkJs', true], ['noEmit', true],
    ['skipLibCheck', false], ['forceConsistentCasingInFileNames', true],
    ['target', ts.ScriptTarget.ES2022], ['module', ts.ModuleKind.NodeNext],
    ['moduleResolution', ts.ModuleResolutionKind.NodeNext], ['esModuleInterop', true],
  ]) if (options[name] !== expected) errors.push(`${name}=${options[name]} (expected ${expected})`);
  const libs = (options.lib ?? []).map((lib) => String(lib).split(/[\\/]/).pop().toLowerCase());
  if (JSON.stringify(libs) !== JSON.stringify(['lib.es2022.d.ts'])) errors.push(`lib=${JSON.stringify(libs)}`);
  if (JSON.stringify(options.types) !== JSON.stringify(['node'])) errors.push(`types=${JSON.stringify(options.types)}`);
  // TypeScript leaves strict:true sub-options undefined when they inherit the
  // strict defaults. Explicit false still weakens that effective strict mode.
  for (const name of strictSuboptions) if (options[name] === false) errors.push(`${name}=false`);
  if (options.exactOptionalPropertyTypes !== true) errors.push(`exactOptionalPropertyTypes=${options.exactOptionalPropertyTypes}`);
  if (errors.length) throw new Error(`invalid desktop main options: ${errors.join('; ')}`);
}

function assertInventory(paths, roots, sourceFiles) {
  const missingRoots = paths.filter((path) => !roots.has(path));
  const missingSources = paths.filter((path) => !sourceFiles.has(path));
  if (missingRoots.length || missingSources.length) {
    throw new Error(`production inventory mismatch: missing configured roots=[${missingRoots.map(rel).join(', ')}]; missing actual program sources=[${missingSources.map(rel).join(', ')}]`);
  }
}

function assertJsChecked(sourceFile, options, label) {
  let checked = false;
  try {
    checked = ts.isCheckJsEnabledForFile(sourceFile, options) === true;
  } catch {
    checked = false;
  }
  if (!checked) throw new Error(`${label}: production JavaScript is not checked by the TypeScript program`);
}

function assertCoverageEnforcementWired() {
  const sourceText = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const sourceFile = ts.createSourceFile('typecheck-main-surface.mjs', sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const calls = new Set();
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === 'assertInventory') {
      calls.add(node.arguments.map((argument) => argument.getText(sourceFile)).join(','));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!calls.has('expected,configured,actual')) {
    throw new Error('actual-program coverage enforcement call was removed from the main checker');
  }
  if (!calls.has('[probe],rootsWithoutProbe,sourcesWithoutProbe')) {
    throw new Error('actual-program coverage sensitivity call was removed from the main checker');
  }
}

const read = ts.readConfigFile(configPath, (path) => readFileSync(path, 'utf8'));
if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, configPath);
if (parsed.errors.length) throw new Error(parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
assertOptions(parsed.options);
assertCoverageEnforcementWired();
for (const option of strictSuboptions) {
  try {
    assertOptions({ ...parsed.options, [option]: false });
  } catch (error) {
    if (error instanceof Error && error.message.includes(`${option}=false`)) continue;
    throw new Error(`strict-option sensitivity ${option}: wrong rejection: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`strict-option sensitivity failed to reject ${option}=false`);
}
for (const [option, value, expected] of [
  ['checkJs', false, 'checkJs=false'],
  ['noEmit', false, 'noEmit=false'],
  ['skipLibCheck', true, 'skipLibCheck=true'],
]) {
  try {
    assertOptions({ ...parsed.options, [option]: value });
  } catch (error) {
    if (error instanceof Error && error.message.includes(expected)) continue;
    throw new Error(`option sensitivity ${option}: wrong rejection: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`option sensitivity failed to reject ${option}=${value}`);
}
const expected = inventory(resolve(root, 'src/main'));
const configured = new Set(parsed.fileNames.map((path) => resolve(path)));
const missingRoots = expected.filter((path) => !configured.has(path));
const extraRoots = parsed.fileNames.map((path) => resolve(path)).filter((path) => path.startsWith(resolve(root, 'src/main') + sep) && !expected.includes(path));
if (missingRoots.length || extraRoots.length) {
  throw new Error(`configured source inventory mismatch: missing roots=${missingRoots.map(rel).join(', ')}; unexpected roots=${extraRoots.map(rel).join(', ')}`);
}

const program = ts.createProgram(parsed.fileNames, parsed.options);
const actual = new Set(program.getSourceFiles().map((file) => resolve(file.fileName)));
assertInventory(expected, configured, actual);
for (const path of expected) {
  const sourceFile = program.getSourceFile(path);
  if (!sourceFile) throw new Error(`production source missing from actual compiler program: ${rel(path)}`);
  assertJsChecked(sourceFile, parsed.options, rel(path));
}
const mainRootSet = new Set(expected);
const importedLocalJs = program.getSourceFiles()
  .map((file) => resolve(file.fileName))
  .filter((path) => path.startsWith(resolve(root, 'src') + sep) && path.endsWith('.js') && !mainRootSet.has(path));
for (const path of importedLocalJs) {
  const sourceFile = program.getSourceFile(path);
  if (!sourceFile) throw new Error(`imported local JavaScript missing from compiler program: ${rel(path)}`);
  assertJsChecked(sourceFile, parsed.options, `imported:${rel(path)}`);
}
const probe = expected[0];
const rootsWithoutProbe = new Set(configured);
const sourcesWithoutProbe = new Set(actual);
rootsWithoutProbe.delete(probe);
sourcesWithoutProbe.delete(probe);
let omissionDetected = false;
try {
  assertInventory([probe], rootsWithoutProbe, sourcesWithoutProbe);
} catch (error) {
  omissionDetected = error instanceof Error && error.message.includes('missing configured roots') && error.message.includes('missing actual program sources');
}
if (!omissionDetected) throw new Error('actual-program inventory sensitivity failed to detect an omitted source/root');
const uncheckedProbe = ts.createSourceFile(
  'main-checkjs-probe.js',
  '// @ts-nocheck\nexport const unchecked = true;\n',
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.JS,
);
let checkJsSensitivityDetected = false;
try {
  assertJsChecked(uncheckedProbe, parsed.options, 'sensitivity:main-checkjs');
} catch (error) {
  checkJsSensitivityDetected = error instanceof Error && error.message.includes('not checked');
}
if (!checkJsSensitivityDetected) throw new Error('actual CheckJs enforcement sensitivity failed to reject an unchecked JavaScript source');
console.log(`[typecheck-main-surface] checked production roots: ${expected.length}; actual program source files: ${actual.size}`);
console.log(`[typecheck-main-surface] imported local JS files outside src/main inventory: ${importedLocalJs.length} (checked but not counted as src/main production coverage)`);
console.log(`[typecheck-main-surface] sensitivity: detected omitted root and actual program source (${rel(probe)})`);
console.log('[typecheck-main-surface] sensitivity: verified the real and omission-probe paths both call the same inventory assertion');
console.log('[typecheck-main-surface] sensitivity: detected @ts-nocheck through the same TypeScript API enforcement');
console.log(`[typecheck-main-surface] sensitivity: rejected each of ${strictSuboptions.length} weakened strict sub-options and disabled checkJs/noEmit/skipLibCheck`);

const diagnostics = ts.getPreEmitDiagnostics(program);
const errors = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
const byFile = new Map();
const byCode = new Map();
const diagnosticCountsByFile = new Map();
for (const diagnostic of errors) {
  const file = diagnostic.file ? rel(diagnostic.file.fileName) : '<no-file>';
  diagnosticCountsByFile.set(file, (diagnosticCountsByFile.get(file) ?? 0) + 1);
  const item = byFile.get(file) ?? { count: 0, samples: [] };
  item.count++;
  if (item.samples.length < 3) {
    const pos = diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : null;
    const location = pos ? `(${pos.line + 1},${pos.character + 1})` : '';
    item.samples.push(`${file}${location} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
  }
  byFile.set(file, item);
  byCode.set(diagnostic.code, (byCode.get(diagnostic.code) ?? 0) + 1);
}
const evidenceDirectory = resolve(root, 'docs/engineering/typescript-migration/evidence');
mkdirSync(evidenceDirectory, { recursive: true });
const coverageStamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const coveragePath = resolve(evidenceDirectory, `L02-main-surface-coverage-${coverageStamp}.csv`);
const diagnosticsPath = resolve(evidenceDirectory, `L02-main-surface-diagnostics-${coverageStamp}.jsonl`);
const csv = (value) => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const coverage = [['path', 'runtime', 'explicit_root', 'actual_program_source', 'checkJs', 'error_count']];
for (const path of expected) coverage.push([rel(path), 'electron-main-node', configured.has(path), actual.has(path), parsed.options.checkJs, diagnosticCountsByFile.get(rel(path)) ?? 0]);
writeFileSync(coveragePath, `${coverage.map((row) => row.map(csv).join(',')).join('\n')}\n`);
const diagnosticRecords = errors.map((diagnostic) => {
  const start = diagnostic.start ?? null;
  const location = diagnostic.file && start !== null
    ? diagnostic.file.getLineAndCharacterOfPosition(start)
    : null;
  return {
    recordType: 'diagnostic',
    path: diagnostic.file ? rel(diagnostic.file.fileName) : null,
    line: location ? location.line + 1 : null,
    column: location ? location.character + 1 : null,
    start,
    length: diagnostic.length ?? null,
    code: diagnostic.code,
    category: ts.DiagnosticCategory[diagnostic.category]?.toLowerCase() ?? String(diagnostic.category),
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  };
});
if (diagnosticRecords.length !== errors.length) throw new Error('main diagnostic sidecar count mismatch');
const rootsWithErrors = expected.filter((path) => (diagnosticCountsByFile.get(rel(path)) ?? 0) > 0).length;
const countsByCode = Object.fromEntries([...byCode].map(([code, count]) => [`TS${code}`, count]));
const diagnosticMetadata = {
  recordType: 'metadata',
  profile: 'L02-main-surface',
  typescriptVersion: ts.version,
  configPath: rel(configPath),
  configSha256: createHash('sha256').update(readFileSync(configPath)).digest('hex'),
  productionInventory: {
    coverageCsvPath: rel(coveragePath),
    coverageCsvSha256: createHash('sha256').update(readFileSync(coveragePath)).digest('hex'),
    rootListSha256: createHash('sha256').update(JSON.stringify(expected.map(rel))).digest('hex'),
  },
  inventory: {
    productionRoots: expected.length,
    actualProgramSourceFiles: actual.size,
    importedLocalJavaScriptOutsideRoots: importedLocalJs.length,
    productionRootsWithDiagnostics: rootsWithErrors,
    productionRootsWithoutDiagnostics: expected.length - rootsWithErrors,
  },
  diagnosticCount: errors.length,
  countsByCode,
};
const diagnosticLines = [diagnosticMetadata, ...diagnosticRecords].map((record) => JSON.stringify(record));
if (diagnosticLines.length - 1 !== errors.length) throw new Error('main diagnostic sidecar length does not match reported error count');
writeFileSync(diagnosticsPath, `${diagnosticLines.join('\n')}\n`);
console.log(`[typecheck-main-surface] production coverage inventory: ${rel(coveragePath)}`);
console.log(`[typecheck-main-surface] complete diagnostic sidecar: ${rel(diagnosticsPath)} (${diagnosticRecords.length} records)`);
console.log(`[typecheck-main-surface] errors: ${errors.length}; codes: ${[...byCode].sort((a, b) => b[1] - a[1]).map(([code, count]) => `TS${code}=${count}`).join(', ')}`);
for (const [file, item] of [...byFile].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${file}: ${item.count}`);
  for (const sample of item.samples) console.log(`    ${sample}`);
}
if (errors.length) process.exitCode = 1;
else console.log(`[typecheck-main-surface] PASS: all ${expected.length} maintained src/main JavaScript modules are checked under strict NodeNext.`);
