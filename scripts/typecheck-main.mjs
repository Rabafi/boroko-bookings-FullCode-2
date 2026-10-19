/**
 * Node-only desktop-main typecheck runner (B02-B).
 *
 * Covers src/main/domains/fileStore.js under strict checking with NodeNext
 * module/resolution (raw ESM Node consumers), checkJs:true, and explicitly
 * declared Node 24 typings. Uses the pinned local TypeScript compiler API,
 * never executes or emits fixtures, and exits nonzero when a fixture is
 * excluded, a rejection disappears, or checking weakens. Guard cases run
 * in-memory below.
 */
import { createRequire } from 'node:module';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import {
  STRICT_SUBOPTIONS,
  EXPECTED_LIB_BASENAME,
  assertJsChecked,
  isStdLibFile,
} from './typecheck-pilot-checks.mjs';

const require = createRequire(import.meta.url);
let ts;
try {
  ts = require('typescript');
} catch (err) {
  console.error(`[typecheck-main] FAIL: cannot load pinned local 'typescript' dependency: ${err?.message ?? err}`);
  process.exit(2);
}
if (ts.version !== '5.9.3') {
  console.error(`[typecheck-main] FAIL: pinned compiler is ${ts.version}, want 5.9.3`);
  process.exit(2);
}
let tsLibDir;
try {
  tsLibDir = dirname(require.resolve('typescript'));
} catch (err) {
  console.error(`[typecheck-main] FAIL: cannot resolve pinned local 'typescript' library directory: ${err?.message ?? err}`);
  process.exit(2);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const toRepoRel = (p) => relative(repoRoot, p).split(sep).join('/');

const MAIN_CONFIG = resolve(repoRoot, 'tsconfig.typecheck-main.json');
const FILESTORE_SOURCE = resolve(repoRoot, 'src/main/domains/fileStore.js');
const VALID_FIXTURE = resolve(repoRoot, 'tests/typecheck/main-file-store/valid.ts');
const INVALID_CONFIG = resolve(repoRoot, 'tests/typecheck/main-file-store/tsconfig.invalid.json');
const INVALID_FIXTURE = resolve(repoRoot, 'tests/typecheck/main-file-store/invalid.ts');

function fail(message) {
  console.error(`[typecheck-main] FAIL: ${message}`);
  process.exit(1);
}

/** Directly resolved @types/node version (reads the installed package file). */
function readResolvedNodeTypesVersion() {
  const pkgPath = resolve(repoRoot, 'node_modules/@types/node/package.json');
  if (!existsSync(pkgPath)) throw new Error('directly declared @types/node is not installed (node_modules/@types/node/package.json missing)');
  const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  if (typeof version !== 'string' || version.length === 0) throw new Error('cannot read installed @types/node version');
  return version;
}

/** Read the repository root manifest (separate function so guards can inject synthetic metadata). */
function readRootManifest() {
  return JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
}

/**
 * Require the resolved Node typings to match the manifest's exact pin (major 24).
 * Reads through injectable callbacks so regression guards exercise this same
 * function with synthetic metadata; production calls use the real-file defaults.
 * Throws with the specific reason on any mismatch.
 */
function checkNodeTypesVersion(label, getManifest = readRootManifest, getResolvedVersion = readResolvedNodeTypesVersion) {
  const manifest = getManifest();
  const declared = manifest?.devDependencies?.['@types/node'];
  const resolved = getResolvedVersion();
  const major = Number(String(resolved).split('.')[0]);
  if (!declared) throw new Error(`${label}: package.json declares no direct @types/node`);
  if (major !== 24) throw new Error(`${label}: resolved Node typings major is ${major} (want 24; resolved ${resolved})`);
  if (resolved !== declared) throw new Error(`${label}: resolved @types/node ${resolved} != manifest pin ${declared}`);
}

/** Effective main-scope options. Throws on any mismatch. */
function checkMainOptions(options, label) {
  const problems = [];
  if (options.strict !== true) problems.push(`strict=${options.strict} (want true)`);
  if (options.allowJs !== true) problems.push(`allowJs=${options.allowJs} (want true)`);
  if (options.checkJs !== true) problems.push(`checkJs=${options.checkJs} (want true for this scope)`);
  if (options.noEmit !== true) problems.push(`noEmit=${options.noEmit} (want true)`);
  if (options.target !== ts.ScriptTarget.ES2022) {
    problems.push(`target=${options.target} (want ScriptTarget.ES2022=${ts.ScriptTarget.ES2022})`);
  }
  if (options.module !== ts.ModuleKind.NodeNext) {
    problems.push(`module=${options.module} (want ModuleKind.NodeNext=${ts.ModuleKind.NodeNext})`);
  }
  if (options.moduleResolution !== ts.ModuleResolutionKind.NodeNext) {
    problems.push(`moduleResolution=${options.moduleResolution} (want ModuleResolutionKind.NodeNext=${ts.ModuleResolutionKind.NodeNext})`);
  }
  if (options.esModuleInterop !== true) problems.push(`esModuleInterop=${options.esModuleInterop} (want true)`);
  const lib = options.lib ?? [];
  if (!(Array.isArray(lib) && lib.length === 1 && String(lib[0]).toLowerCase().endsWith(EXPECTED_LIB_BASENAME))) {
    problems.push(`lib=${JSON.stringify(lib)} (want exactly ["${EXPECTED_LIB_BASENAME}"])`);
  }
  // types must be EXPLICITLY ["node"]; omitted or ambient entries rejected.
  if (!Array.isArray(options.types)) {
    problems.push('types is missing (want explicit ["node"])');
  } else if (options.types.length !== 1 || options.types[0] !== 'node') {
    problems.push(`types=${JSON.stringify(options.types)} (want ["node"])`);
  }
  for (const name of STRICT_SUBOPTIONS) {
    if (options[name] === false) problems.push(`${name}=false (strict default disabled)`);
  }
  if (options.skipLibCheck !== false) problems.push(`skipLibCheck=${options.skipLibCheck} (want false)`);
  if (options.forceConsistentCasingInFileNames !== true) {
    problems.push(`forceConsistentCasingInFileNames=${options.forceConsistentCasingInFileNames} (want true)`);
  }
  if (problems.length > 0) throw new Error(`${label}: unexpected effective options: ${problems.join('; ')}`);
}

function requireFilesPresent(fileNames, required, label) {
  const have = new Set(fileNames.map((f) => resolve(f)));
  for (const req of required) {
    if (!have.has(resolve(req))) throw new Error(`${label}: required file missing: ${toRepoRel(req)}`);
  }
}

/** Directory roots of the verified declaration dependencies. */
function dependencyRoots() {
  return [
    resolve(repoRoot, 'node_modules/@types/node'),
    resolve(repoRoot, 'node_modules/undici-types'),
  ];
}

/**
 * The single `buffer` shim declaration pulled into the closure because
 * @types/node 24.19.1 re-exports bare "buffer" (buffer.d.ts) and imports it
 * (os.d.ts) under NodeNext resolution. buffer@5.7.1 itself is a pre-existing
 * transitive package (via madge), untouched by this batch.
 */
function bufferShimDeclaration() {
  return resolve(repoRoot, 'node_modules/buffer/index.d.ts');
}

function isVerifiedDependencyFile(fileName) {
  const normalized = String(fileName).replace(/\\/g, '/');
  for (const root of dependencyRoots()) {
    const dir = root.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalized.toLowerCase().startsWith(`${dir.toLowerCase()}/`) && normalized.toLowerCase().endsWith('.d.ts')) {
      return true;
    }
  }
  return false;
}

function parseConfig(configPath) {
  if (!existsSync(configPath)) fail(`missing config file: ${toRepoRel(configPath)}`);
  const readResult = ts.readConfigFile(configPath, (p) => readFileSync(p, 'utf8'));
  if (readResult.error) {
    fail(`config parse error in ${toRepoRel(configPath)}: ${ts.flattenDiagnosticMessageText(readResult.error.messageText, ' ')}`);
  }
  const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, dirname(configPath));
  if (parsed.errors.length > 0) {
    fail(`config parse error in ${toRepoRel(configPath)}: ${ts.flattenDiagnosticMessageText(parsed.errors[0].messageText, ' ')}`);
  }
  return parsed;
}

function checkProgramInventory(program, requiredAbsPaths, label) {
  const files = program.getSourceFiles().map((f) => f.fileName);
  const rels = files.map(toRepoRel).sort();
  console.log(`[typecheck-main] ${label} program files (${files.length}):`);
  for (const r of rels) console.log(`  - ${r}`);
  try {
    requireFilesPresent(files, requiredAbsPaths, label);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  // Enumerated provenance: only the pilot source/fixture, pinned compiler
  // libs, and verified Node declaration dependencies may appear. Anything
  // else (maintained app files, DOM libs, other ambient packages) fails openly.
  const allowed = new Set(requiredAbsPaths.map((p) => resolve(p)));
  const bad = [];
  for (const f of files) {
    if (allowed.has(resolve(f))) continue;
    if (isStdLibFile(f, tsLibDir)) continue;
    if (isVerifiedDependencyFile(f)) continue;
    if (resolve(f) === bufferShimDeclaration()) continue;
    bad.push(toRepoRel(f));
  }
  if (bad.length > 0) {
    fail(`${label}: unexpected files in program (undeclared dependency?): ${bad.join(', ')}`);
  }
  return files;
}

function checkSourceChecked(program, options, label) {
  const sourceFile = program.getSourceFile(FILESTORE_SOURCE);
  if (!sourceFile) fail(`${label}: production source file not in program: ${toRepoRel(FILESTORE_SOURCE)}`);
  try {
    assertJsChecked(sourceFile, options, ts, `${label}:${toRepoRel(FILESTORE_SOURCE)}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

function summarize(d) {
  const file = d.file ? toRepoRel(d.file.fileName) : '<no-file>';
  const line = d.file ? d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1 : 0;
  return `${file}(${line}): code TS${d.code} category=${d.category === ts.DiagnosticCategory.Error ? 'error' : d.category}`;
}

function fixtureLineOf(content, needle) {
  const idx = content.split(/\r?\n/).findIndex((ln) => ln.includes(needle));
  return idx < 0 ? -1 : idx + 1;
}

function checkOptions(options, label) {
  try {
    checkMainOptions(options, label);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

function checkTypesVersion(label) {
  try {
    checkNodeTypesVersion(label);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

// ---- positive program ----
for (const p of [FILESTORE_SOURCE, VALID_FIXTURE, MAIN_CONFIG]) {
  if (!existsSync(p)) fail(`missing required main file: ${toRepoRel(p)}`);
}
checkTypesVersion('positive');
const positive = parseConfig(MAIN_CONFIG);
checkOptions(positive.options, 'main config');
try {
  requireFilesPresent(positive.fileNames, [FILESTORE_SOURCE, VALID_FIXTURE], 'main config');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
if (positive.fileNames.some((f) => f.endsWith('main-file-store/invalid.ts'))) {
  fail('main config must not include the negative fixture');
}
const positiveProgram = ts.createProgram(positive.fileNames, positive.options);
checkProgramInventory(positiveProgram, [FILESTORE_SOURCE, VALID_FIXTURE], 'positive');
checkSourceChecked(positiveProgram, positive.options, 'positive');
const positiveDiags = ts.getPreEmitDiagnostics(positiveProgram);
if (positiveDiags.length !== 0) {
  for (const d of positiveDiags) console.error(`[typecheck-main] unexpected positive diagnostic: ${summarize(d)}`);
  fail(`positive program has ${positiveDiags.length} diagnostic(s), want 0`);
}
console.log('[typecheck-main] positive: 0 diagnostics (pass)');

// ---- negative program (compile-only; fixtures contain filesystem calls, never executed) ----
for (const p of [INVALID_CONFIG, INVALID_FIXTURE]) {
  if (!existsSync(p)) fail(`missing required main file: ${toRepoRel(p)}`);
}
checkTypesVersion('negative');
const negative = parseConfig(INVALID_CONFIG);
checkOptions(negative.options, 'negative config');
try {
  requireFilesPresent(negative.fileNames, [FILESTORE_SOURCE, INVALID_FIXTURE], 'negative config');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
const negativeProgram = ts.createProgram(negative.fileNames, negative.options);
checkProgramInventory(negativeProgram, [FILESTORE_SOURCE, INVALID_FIXTURE], 'negative');
checkSourceChecked(negativeProgram, negative.options, 'negative');
const negativeDiags = ts.getPreEmitDiagnostics(negativeProgram);
const sourceDiags = negativeDiags.filter((d) => d.file && resolve(d.file.fileName) === resolve(FILESTORE_SOURCE));
if (sourceDiags.length !== 0) {
  for (const d of sourceDiags) console.error(`[typecheck-main] production-source diagnostic: ${summarize(d)}`);
  fail(`negative program: production source has ${sourceDiags.length} diagnostic(s), want 0`);
}
const fixtureDiags = negativeDiags.filter((d) => d.file && resolve(d.file.fileName) === resolve(INVALID_FIXTURE));
const otherDiags = negativeDiags.filter((d) => !d.file || (resolve(d.file.fileName) !== resolve(INVALID_FIXTURE) && resolve(d.file.fileName) !== resolve(FILESTORE_SOURCE)));
if (otherDiags.length !== 0) {
  for (const d of otherDiags) console.error(`[typecheck-main] unrelated diagnostic: ${summarize(d)}`);
  fail(`negative program: ${otherDiags.length} unrelated diagnostic(s)`);
}
const content = readFileSync(INVALID_FIXTURE, 'utf8');
const lineEnsure = fixtureLineOf(content, 'ensureDir(42)');
const lineWrite = fixtureLineOf(content, 'writeJsonFile(42, { ok: true })');
const lineUnknown = fixtureLineOf(content, 'const unsafeValue = loaded.name');
const lineDom = fixtureLineOf(content, 'const blockedGlobal = document');
if (lineEnsure < 0 || lineWrite < 0 || lineUnknown < 0 || lineDom < 0) {
  fail('negative fixture: cannot locate intended misuse lines');
}
if (fixtureDiags.length !== 4) {
  for (const d of fixtureDiags) console.error(`[typecheck-main] fixture diagnostic: ${summarize(d)}`);
  fail(`negative fixture: want exactly 4 diagnostics, found ${fixtureDiags.length} (rejection disappeared?)`);
}
const byLine = new Map(fixtureDiags.map((d) => [d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1, d]));
const expectations = new Map([
  [lineEnsure, 2345],
  [lineWrite, 2345],
  [lineUnknown, 18046],
  [lineDom, 2584],
]);
for (const [line, code] of expectations) {
  const d = byLine.get(line);
  if (!d) fail(`negative fixture: missing TS${code} diagnostic on line ${line}`);
  if (d.category !== ts.DiagnosticCategory.Error || d.code !== code) {
    fail(`negative fixture: diagnostic TS${d.code} != TS${code}: ${summarize(d)}`);
  }
}
console.log(`[typecheck-main] negative: TS2345 lines ${lineEnsure},${lineWrite} + TS18046 line ${lineUnknown} + TS2584 line ${lineDom} (pass)`);

// ---- in-memory guard cases (weakened states fail for the intended reason) ----
let guards = 0;
function expectThrow(name, fn, want) {
  let message = null;
  try {
    fn();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  if (message === null) fail(`guard ${name}: expected rejection containing "${want}", but nothing threw`);
  if (!message.includes(want)) fail(`guard ${name}: rejection did not name the intended guard (want "${want}"): ${message}`);
  guards += 1;
  console.log(`[typecheck-main] guard PASS ${name}: rejected (${message})`);
}
const base = positive.options;
expectThrow('wrong-module', () => checkMainOptions({ ...base, module: ts.ModuleKind.ESNext }, 'guard'), 'module=');
expectThrow('wrong-moduleResolution', () => checkMainOptions({ ...base, moduleResolution: ts.ModuleResolutionKind.Bundler }, 'guard'), 'moduleResolution=');
expectThrow('missing-esModuleInterop', () => checkMainOptions({ ...base, esModuleInterop: false }, 'guard'), 'esModuleInterop=');
expectThrow('added-dom-lib', () => checkMainOptions({ ...base, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] }, 'guard'), 'lib=');
expectThrow('omitted-types', () => {
  const mutated = { ...base };
  delete mutated.types;
  checkMainOptions(mutated, 'guard');
}, 'types is missing');
expectThrow('ambient-package-types', () => checkMainOptions({ ...base, types: ['node', 'jest'] }, 'guard'), 'types=');
expectThrow('strict-suboptions-disabled', () => {
  checkMainOptions({ ...base, strict: true, noImplicitAny: false, strictNullChecks: false }, 'guard');
}, 'noImplicitAny=');
expectThrow('checkJs-false', () => checkMainOptions({ ...base, checkJs: false }, 'guard'), 'checkJs=');
// Same-validator version guards: synthetic metadata through the real
// checkNodeTypesVersion used by both programs (live values read once here;
// the wrong inputs below are inert objects, never written to disk).
const liveDeclared = readRootManifest()?.devDependencies?.['@types/node'];
const liveResolved = readResolvedNodeTypesVersion();
const pinnedManifest = () => ({ devDependencies: { '@types/node': liveDeclared } });
try {
  checkNodeTypesVersion('guard', pinnedManifest, () => liveResolved);
  if (liveDeclared !== '24.19.1' || liveResolved !== '24.19.1') {
    fail(`guard typings-version-accept: live metadata drifted (declared ${liveDeclared}, resolved ${liveResolved}); update these guard cases, do not weaken them`);
  }
  guards += 1;
  console.log(`[typecheck-main] guard PASS typings-version-accept: accepted (declared ${liveDeclared}, resolved ${liveResolved})`);
} catch (err) {
  fail(`guard typings-version-accept: valid metadata rejected: ${err instanceof Error ? err.message : err}`);
}
expectThrow('wrong-typings-major', () => checkNodeTypesVersion('guard', pinnedManifest, () => '25.5.0'), 'major is 25');
expectThrow('missing-typings-declaration', () => checkNodeTypesVersion('guard', () => ({ devDependencies: {} }), () => liveResolved), 'declares no direct @types/node');
expectThrow('typings-pin-mismatch', () => checkNodeTypesVersion('guard', pinnedManifest, () => (liveDeclared === '24.19.0' ? '24.19.1' : '24.19.0')), '!= manifest pin');
expectThrow('missing-production-source', () => {
  requireFilesPresent([VALID_FIXTURE], [FILESTORE_SOURCE, VALID_FIXTURE], 'guard');
}, 'fileStore.js');
expectThrow('missing-fixture', () => {
  requireFilesPresent([FILESTORE_SOURCE], [FILESTORE_SOURCE, VALID_FIXTURE], 'guard');
}, 'valid.ts');
if (isStdLibFile('C:/evil/typescript/lib/lib.es2022.d.ts', tsLibDir)) fail('guard stdlib-impostor: fake path recognized');
guards += 1;
console.log('[typecheck-main] guard PASS stdlib-impostor: rejected');
const unchecked = ts.createSourceFile('store.js', 'export function f(a) { return a; }\n', ts.ScriptTarget.ES2022, true);
try {
  assertJsChecked(unchecked, base, ts, 'guard');
  fail('guard js-directive-absent: unchecked source accepted');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes('not checked')) fail(`guard js-directive-absent: wrong rejection: ${message}`);
  guards += 1;
  console.log(`[typecheck-main] guard PASS js-directive-absent: rejected (${message})`);
}

console.log(`[typecheck-main] OK: 2/2 programs matched (1 positive + 1 negative) + ${guards} guard cases.`);
