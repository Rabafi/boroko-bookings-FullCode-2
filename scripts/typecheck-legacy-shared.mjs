/**
 * Legacy shared-pure typecheck runner (B02-F).
 *
 * Covers legacy-pos/src/shared/errors.js under strict checking with an
 * isolated ES2020 pure profile (ES2020 target, ESNext module, Bundler
 * resolution, checkJs:true, exact [lib.es2020.d.ts], explicit types:[]).
 * No Node/DOM/Electron/React/Vite/Manager globals are allowed: the library
 * inventory uses a constrained ES2020-family provenance rule, so a DOM file
 * arriving through compiler options OR a triple-slash reference is rejected.
 * Uses the pinned root TypeScript 5.9.3 compiler API, never executes or emits
 * fixtures, and exits nonzero when a file is excluded, a rejection
 * disappears, or checking weakens. Guard cases and integrated in-memory
 * probes below call the same assertions used by the real programs.
 */
import { createRequire } from 'node:module';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import {
  STRICT_SUBOPTIONS,
  assertJsChecked,
  isStdLibFile,
} from './typecheck-pilot-checks.mjs';

const require = createRequire(import.meta.url);
let ts;
try {
  ts = require('typescript');
} catch (err) {
  console.error(`[typecheck-legacy-shared] FAIL: cannot load pinned local 'typescript' dependency: ${err?.message ?? err}`);
  process.exit(2);
}
if (ts.version !== '5.9.3') {
  console.error(`[typecheck-legacy-shared] FAIL: pinned compiler is ${ts.version}, want 5.9.3`);
  process.exit(2);
}
let tsLibDir;
try {
  tsLibDir = dirname(require.resolve('typescript'));
} catch (err) {
  console.error(`[typecheck-legacy-shared] FAIL: cannot resolve pinned local 'typescript' library directory: ${err?.message ?? err}`);
  process.exit(2);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const toRepoRel = (p) => relative(repoRoot, p).split(sep).join('/');

const LEGACY_CONFIG = resolve(repoRoot, 'legacy-pos/tsconfig.typecheck-shared.json');
const ERRORS_SOURCE = resolve(repoRoot, 'legacy-pos/src/shared/errors.js');
const VALID_FIXTURE = resolve(repoRoot, 'tests/typecheck/legacy-errors/valid.ts');
const INVALID_CONFIG = resolve(repoRoot, 'tests/typecheck/legacy-errors/tsconfig.invalid.json');
const INVALID_FIXTURE = resolve(repoRoot, 'tests/typecheck/legacy-errors/invalid.ts');

/**
 * Constrained ES2020 pure-profile library rule (static, never derived from a
 * live program): after verifying pinned compiler provenance, permit only
 * lib.es5.d.ts, the lib.es2015–lib.es2020 families with component suffixes,
 * and the two decorator declarations the pinned compiler requires. Reject
 * lib.dom*, lib.webworker*, lib.scripthost*, ES2021+/esnext libraries and
 * every external ambient package/app/declaration file.
 */
const ES2020_FAMILY = /^lib\.es20(15|16|17|18|19|20)(\..+)?\.d\.ts$/;
function isAllowedLegacyLib(fileName) {
  if (!isStdLibFile(fileName, tsLibDir)) return false;
  const base = String(fileName).replace(/\\/g, '/').split('/').pop().toLowerCase();
  if (base === 'lib.es5.d.ts') return true;
  if (base === 'lib.decorators.d.ts' || base === 'lib.decorators.legacy.d.ts') return true;
  return ES2020_FAMILY.test(base);
}

function fail(message) {
  console.error(`[typecheck-legacy-shared] FAIL: ${message}`);
  process.exit(1);
}

/** Effective legacy-scope options. Throws on any mismatch. */
function checkLegacyOptions(options, label) {
  const problems = [];
  if (options.strict !== true) problems.push(`strict=${options.strict} (want true)`);
  if (options.allowJs !== true) problems.push(`allowJs=${options.allowJs} (want true)`);
  if (options.checkJs !== true) problems.push(`checkJs=${options.checkJs} (want true for this scope)`);
  if (options.noEmit !== true) problems.push(`noEmit=${options.noEmit} (want true)`);
  if (options.target !== ts.ScriptTarget.ES2020) {
    problems.push(`target=${options.target} (want ScriptTarget.ES2020=${ts.ScriptTarget.ES2020})`);
  }
  if (options.module !== ts.ModuleKind.ESNext) {
    problems.push(`module=${options.module} (want ModuleKind.ESNext=${ts.ModuleKind.ESNext})`);
  }
  if (options.moduleResolution !== ts.ModuleResolutionKind.Bundler) {
    problems.push(`moduleResolution=${options.moduleResolution} (want ModuleResolutionKind.Bundler=${ts.ModuleResolutionKind.Bundler})`);
  }
  const lib = options.lib ?? [];
  const libNames = Array.isArray(lib) ? lib.map((entry) => String(entry).split(/[\\/]/).pop().toLowerCase()) : [];
  if (libNames.length !== 1 || libNames[0] !== 'lib.es2020.d.ts') {
    problems.push(`lib=${JSON.stringify(lib)} (want exactly ["lib.es2020.d.ts"])`);
  }
  // types must be EXPLICITLY []; omitted or ambient entries rejected, so the
  // Node typings installed for the desktop-main checker cannot leak in here.
  if (!Array.isArray(options.types)) {
    problems.push('types is missing (want explicit [])');
  } else if (options.types.length !== 0) {
    problems.push(`types=${JSON.stringify(options.types)} (want [])`);
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

/**
 * Pure throwing inventory assertion: require every intended source/own-fixture
 * path, then permit only those paths and libraries accepted by the static
 * ES2020-family provenance rule. A DOM file is rejected here even though it
 * ships with the pinned compiler — whether it arrives via options or a
 * triple-slash reference. Throws an Error naming unexpected files and label
 * when contamination exists; returns the file list for reporting. Never exits
 * or logs success itself — the CLI wrapper converts throws via fail().
 */
function assertProgramInventory(fileNames, requiredAbsPaths, label) {
  requireFilesPresent(fileNames, requiredAbsPaths, label);
  const allowed = new Set(requiredAbsPaths.map((p) => resolve(p)));
  const bad = [];
  for (const f of fileNames) {
    if (allowed.has(resolve(f))) continue;
    if (isAllowedLegacyLib(f)) continue;
    bad.push(toRepoRel(f));
  }
  if (bad.length > 0) {
    throw new Error(`${label}: unexpected files in program (ambient leakage?): ${bad.join(', ')}`);
  }
  return fileNames;
}

function checkProgramInventory(program, requiredAbsPaths, label) {
  const files = program.getSourceFiles().map((f) => f.fileName);
  const rels = files.map(toRepoRel).sort();
  console.log(`[typecheck-legacy-shared] ${label} program files (${files.length}):`);
  for (const r of rels) console.log(`  - ${r}`);
  try {
    assertProgramInventory(files, requiredAbsPaths, label);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  return files;
}

function checkSourceChecked(program, options, label) {
  const sourceFile = program.getSourceFile(ERRORS_SOURCE);
  if (!sourceFile) fail(`${label}: production source file not in program: ${toRepoRel(ERRORS_SOURCE)}`);
  try {
    assertJsChecked(sourceFile, options, ts, `${label}:${toRepoRel(ERRORS_SOURCE)}`);
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
    checkLegacyOptions(options, label);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

/** Verify the five intended negative diagnostics. Throws for the exact gap. */
function assertNegativeDiagnostics(fixtureDiags, content, label) {
  const lineNumber = fixtureLineOf(content, "const numeric: number = sanitizePosError('fetch failed');");
  const lineProperty = fixtureLineOf(content, 'const success = message.success;');
  const lineNode = fixtureLineOf(content, 'process.version');
  const lineDom = fixtureLineOf(content, 'const browserDocument = document;');
  const lineManager = fixtureLineOf(content, '__BOROKO_APP_VERSION__');
  if (lineNumber < 0 || lineProperty < 0 || lineNode < 0 || lineDom < 0 || lineManager < 0) {
    throw new Error(`${label}: cannot locate intended misuse lines`);
  }
  if (fixtureDiags.length !== 5) {
    for (const d of fixtureDiags) console.error(`[typecheck-legacy-shared] fixture diagnostic: ${summarize(d)}`);
    throw new Error(`${label}: want exactly 5 diagnostics, found ${fixtureDiags.length} (rejection disappeared?)`);
  }
  const byLine = new Map(fixtureDiags.map((d) => [d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1, d]));
  const expectations = new Map([
    [lineNumber, 2322],
    [lineProperty, 2339],
    [lineNode, 2591],
    [lineDom, 2584],
    [lineManager, 2304],
  ]);
  for (const [line, code] of expectations) {
    const d = byLine.get(line);
    if (!d) throw new Error(`${label}: missing TS${code} diagnostic on line ${line}`);
    if (d.category !== ts.DiagnosticCategory.Error || d.code !== code) {
      throw new Error(`${label}: diagnostic TS${d.code} != TS${code}: ${summarize(d)}`);
    }
  }
  return { lineNumber, lineProperty, lineNode, lineDom, lineManager };
}

/**
 * Create a program with in-memory source overrides (absolute path -> text).
 * All path comparisons use resolved absolute paths, so Windows separators and
 * drive-letter casing compare consistently. Everything else resolves from
 * disk. Used only by integrated probes; real programs compile unmodified files
 * (and therefore need no import.meta.url/createRequire adaptations here).
 */
function createVariantProgram(rootNames, options, overrides) {
  const host = ts.createCompilerHost(options);
  const baseGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) => {
    const hit = [...overrides.entries()].find(([abs]) => resolve(fileName) === resolve(abs));
    if (hit) return ts.createSourceFile(fileName, hit[1], languageVersion, true);
    return baseGetSourceFile(fileName, languageVersion, ...rest);
  };
  const baseFileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => {
    if ([...overrides.keys()].some((abs) => resolve(fileName) === resolve(abs))) return true;
    return baseFileExists(fileName);
  };
  return ts.createProgram(rootNames, options, host);
}

// ---- positive program ----
for (const p of [ERRORS_SOURCE, VALID_FIXTURE, LEGACY_CONFIG]) {
  if (!existsSync(p)) fail(`missing required legacy file: ${toRepoRel(p)}`);
}
const positive = parseConfig(LEGACY_CONFIG);
checkOptions(positive.options, 'legacy config');
try {
  requireFilesPresent(positive.fileNames, [ERRORS_SOURCE, VALID_FIXTURE], 'legacy config');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
if (positive.fileNames.some((f) => f.endsWith('legacy-errors/invalid.ts'))) {
  fail('legacy config must not include the negative fixture');
}
const positiveProgram = ts.createProgram(positive.fileNames, positive.options);
checkProgramInventory(positiveProgram, [ERRORS_SOURCE, VALID_FIXTURE], 'positive');
checkSourceChecked(positiveProgram, positive.options, 'positive');
const positiveDiags = ts.getPreEmitDiagnostics(positiveProgram);
if (positiveDiags.length !== 0) {
  for (const d of positiveDiags) console.error(`[typecheck-legacy-shared] unexpected positive diagnostic: ${summarize(d)}`);
  fail(`positive program has ${positiveDiags.length} diagnostic(s), want 0`);
}
console.log('[typecheck-legacy-shared] positive: 0 diagnostics (pass)');

// ---- negative program (compile-only; fixtures contain browser calls, never executed) ----
for (const p of [INVALID_CONFIG, INVALID_FIXTURE]) {
  if (!existsSync(p)) fail(`missing required legacy file: ${toRepoRel(p)}`);
}
const negative = parseConfig(INVALID_CONFIG);
checkOptions(negative.options, 'negative config');
try {
  requireFilesPresent(negative.fileNames, [ERRORS_SOURCE, INVALID_FIXTURE], 'negative config');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
const negativeProgram = ts.createProgram(negative.fileNames, negative.options);
checkProgramInventory(negativeProgram, [ERRORS_SOURCE, INVALID_FIXTURE], 'negative');
checkSourceChecked(negativeProgram, negative.options, 'negative');
const negativeDiags = ts.getPreEmitDiagnostics(negativeProgram);
const sourceDiags = negativeDiags.filter((d) => d.file && resolve(d.file.fileName) === resolve(ERRORS_SOURCE));
if (sourceDiags.length !== 0) {
  for (const d of sourceDiags) console.error(`[typecheck-legacy-shared] production-source diagnostic: ${summarize(d)}`);
  fail(`negative program: production source has ${sourceDiags.length} diagnostic(s), want 0`);
}
const fixtureDiags = negativeDiags.filter((d) => d.file && resolve(d.file.fileName) === resolve(INVALID_FIXTURE));
const otherDiags = negativeDiags.filter((d) => !d.file || (resolve(d.file.fileName) !== resolve(INVALID_FIXTURE) && resolve(d.file.fileName) !== resolve(ERRORS_SOURCE)));
if (otherDiags.length !== 0) {
  for (const d of otherDiags) console.error(`[typecheck-legacy-shared] unrelated diagnostic: ${summarize(d)}`);
  fail(`negative program: ${otherDiags.length} unrelated diagnostic(s)`);
}
const content = readFileSync(INVALID_FIXTURE, 'utf8');
let lines;
try {
  lines = assertNegativeDiagnostics(fixtureDiags, content, 'negative fixture');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
console.log(`[typecheck-legacy-shared] negative: TS2322 line ${lines.lineNumber} + TS2339 line ${lines.lineProperty} + TS2591 line ${lines.lineNode} + TS2584 line ${lines.lineDom} + TS2304 line ${lines.lineManager} (pass)`);

// ---- guard cases: same assertions as the real programs, intended messages ----
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
  console.log(`[typecheck-legacy-shared] guard PASS ${name}: rejected (${message})`);
}
function expectPass(name, fn) {
  try {
    fn();
  } catch (err) {
    fail(`guard ${name}: expected acceptance, threw: ${err instanceof Error ? err.message : err}`);
  }
  guards += 1;
  console.log(`[typecheck-legacy-shared] guard PASS ${name}: accepted`);
}
const base = positive.options;
expectPass('baseline-accepted', () => checkLegacyOptions({ ...base }, 'guard'));
expectThrow('wrong-target', () => checkLegacyOptions({ ...base, target: ts.ScriptTarget.ES2022 }, 'guard'), 'target=');
expectThrow('wrong-module', () => checkLegacyOptions({ ...base, module: ts.ModuleKind.CommonJS }, 'guard'), 'module=');
expectThrow('wrong-moduleResolution', () => checkLegacyOptions({ ...base, moduleResolution: ts.ModuleResolutionKind.Classic }, 'guard'), 'moduleResolution=');
expectThrow('missing-lib', () => checkLegacyOptions({ ...base, lib: [] }, 'guard'), 'lib=');
expectThrow('extra-lib', () => checkLegacyOptions({ ...base, lib: ['ES2020', 'DOM'] }, 'guard'), 'lib=');
expectThrow('omitted-types', () => {
  const mutated = { ...base };
  delete mutated.types;
  checkLegacyOptions(mutated, 'guard');
}, 'types is missing');
expectThrow('nonempty-types', () => checkLegacyOptions({ ...base, types: ['node'] }, 'guard'), 'types=');
expectThrow('checkJs-false', () => checkLegacyOptions({ ...base, checkJs: false }, 'guard'), 'checkJs=');
expectThrow('strict-suboptions-disabled', () => {
  checkLegacyOptions({ ...base, strict: true, noImplicitAny: false, strictNullChecks: false }, 'guard');
}, 'noImplicitAny=');
expectThrow('missing-production-source', () => {
  assertProgramInventory([VALID_FIXTURE], [ERRORS_SOURCE, VALID_FIXTURE], 'guard');
}, 'errors.js');
expectThrow('missing-fixture', () => {
  assertProgramInventory([ERRORS_SOURCE], [ERRORS_SOURCE, VALID_FIXTURE], 'guard');
}, 'valid.ts');
if (isAllowedLegacyLib('C:/evil/lib.es2020.d.ts', tsLibDir)) fail('guard lib-provenance-impostor: fake path recognized');
guards += 1;
console.log('[typecheck-legacy-shared] guard PASS lib-provenance-impostor: rejected');
if (!isAllowedLegacyLib(resolve(tsLibDir, 'lib.es2020.d.ts'), tsLibDir)) fail('guard lib-provenance-baseline: real ES2020 lib rejected');
guards += 1;
console.log('[typecheck-legacy-shared] guard PASS lib-provenance-baseline: accepted');
if (isAllowedLegacyLib(resolve(tsLibDir, 'lib.dom.d.ts'), tsLibDir)) fail('guard dom-lib-rejected: real pinned DOM lib accepted');
guards += 1;
console.log('[typecheck-legacy-shared] guard PASS dom-lib-rejected: rejected');
expectThrow('unexpected-ambient-file', () => {
  assertProgramInventory(
    [ERRORS_SOURCE, VALID_FIXTURE, resolve(repoRoot, 'legacy-pos/src/shared/totals.js')],
    [ERRORS_SOURCE, VALID_FIXTURE],
    'guard',
  );
}, 'totals.js');
expectPass('inventory-accepted', () => {
  assertProgramInventory(
    positiveProgram.getSourceFiles().map((f) => f.fileName),
    [ERRORS_SOURCE, VALID_FIXTURE],
    'guard',
  );
});
expectThrow('inventory-dom-reference', () => {
  assertProgramInventory(
    [...positive.fileNames, resolve(tsLibDir, 'lib.dom.d.ts')],
    [ERRORS_SOURCE, VALID_FIXTURE],
    'guard',
  );
}, 'lib.dom.d.ts');
const unchecked = ts.createSourceFile('errors.js', 'export function f(a) { return a; }\n', ts.ScriptTarget.ES2022, true);
try {
  assertJsChecked(unchecked, base, ts, 'guard');
  fail('guard js-directive-absent: unchecked source accepted');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes('not checked')) fail(`guard js-directive-absent: wrong rejection: ${message}`);
  guards += 1;
  console.log(`[typecheck-legacy-shared] guard PASS js-directive-absent: rejected (${message})`);
}

// ---- integrated probes on in-memory variants (actual files untouched) ----

// Probe 1: a DOM triple-slash reference in a fixture variant must be rejected
// by the ACTUAL inventory assertion (the DOM file is pinned, but not in the
// allowed ES2020 family). First confirm the variant truly loads the real
// pinned lib.dom.d.ts; then require the same-assertion rejection naming it.
// Presence alone is not proof of rejection.
const domRefText = `/// <reference lib="dom" />\n${readFileSync(VALID_FIXTURE, 'utf8')}`;
const domRefProgram = createVariantProgram(
  [ERRORS_SOURCE, VALID_FIXTURE],
  base,
  new Map([[VALID_FIXTURE, domRefText]]),
);
{
  const files = domRefProgram.getSourceFiles().map((f) => f.fileName);
  const domPath = resolve(tsLibDir, 'lib.dom.d.ts');
  if (!files.some((f) => resolve(f) === domPath)) {
    fail('integrated dom-tripleslash probe: lib.dom.d.ts not pulled into the variant program');
  }
  try {
    assertProgramInventory(files, [ERRORS_SOURCE, VALID_FIXTURE], 'integrated-dom-tripleslash');
    fail('integrated dom-tripleslash probe: DOM reference silently accepted');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('lib.dom.d.ts') || !message.includes('unexpected files')) {
      fail(`integrated dom-tripleslash probe: wrong rejection: ${message}`);
    }
    guards += 1;
    console.log(`[typecheck-legacy-shared] guard PASS integrated-dom-tripleslash: rejected (${message})`);
  }
}

// Probe 2: ambient Node leakage — a virtual file touching process.version must
// fail with TS2591 inside this program's option/inventory boundary.
const VIRTUAL_PROBE = resolve(repoRoot, 'tests/typecheck/legacy-errors/__probe-node-leak__.ts');
const leakProgram = createVariantProgram(
  [ERRORS_SOURCE, VIRTUAL_PROBE],
  base,
  new Map([[VIRTUAL_PROBE, 'const probeNodeVersion = process.version;\nvoid probeNodeVersion;\n']]),
);
const leakDiags = ts
  .getPreEmitDiagnostics(leakProgram)
  .filter((d) => d.file && resolve(d.file.fileName) === resolve(VIRTUAL_PROBE));
if (leakDiags.length !== 1 || leakDiags[0].code !== 2591 || leakDiags[0].category !== ts.DiagnosticCategory.Error) {
  for (const d of leakDiags) console.error(`[typecheck-legacy-shared] leak-probe diagnostic: ${summarize(d)}`);
  fail(`integrated node-leak probe: want exactly one TS2591 error, found ${leakDiags.length} diagnostic(s)`);
}
guards += 1;
console.log('[typecheck-legacy-shared] guard PASS integrated-node-leak: rejected (TS2591: Cannot find name \'process\')');

// Probe 3: absent @ts-check in a production variant — the real assertJsChecked
// against a real program object must report the file as unchecked.
const realSourceText = readFileSync(ERRORS_SOURCE, 'utf8');
const noDirectiveText = realSourceText.replace('// @ts-check\n', '');
if (noDirectiveText === realSourceText) fail('integrated directive probe: cannot locate the active @ts-check line');
const noDirectiveProgram = createVariantProgram(
  [ERRORS_SOURCE, INVALID_FIXTURE],
  negative.options,
  new Map([[ERRORS_SOURCE, noDirectiveText]]),
);
const noDirectiveFile = noDirectiveProgram.getSourceFile(ERRORS_SOURCE);
if (!noDirectiveFile) fail('integrated directive probe: variant source missing from program');
try {
  assertJsChecked(noDirectiveFile, negative.options, ts, 'integrated-directive-probe');
  fail('integrated directive probe: unchecked variant accepted');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes('not checked')) fail(`integrated directive probe: wrong rejection: ${message}`);
  guards += 1;
  console.log(`[typecheck-legacy-shared] guard PASS integrated-directive-absent: rejected (${message})`);
}

// Probe 4: a real output-contract error disappearing — change the numeric
// number annotation to string in an in-memory fixture while retaining the
// original full marker in a same-line comment. Actual source stays error-free
// while the SAME assertNegativeDiagnostics used above fails 5 -> 4 for that
// gap. Never compensate with another error.
const benignInvalidText = content.replace(
  "const numeric: number = sanitizePosError('fetch failed');",
  "const numeric: string = sanitizePosError('fetch failed'); // const numeric: number = sanitizePosError('fetch failed');",
);
if (benignInvalidText === content) fail('integrated benign probe: cannot locate the output-contract misuse line');
const benignProgram = createVariantProgram(
  [ERRORS_SOURCE, INVALID_FIXTURE],
  negative.options,
  new Map([[INVALID_FIXTURE, benignInvalidText]]),
);
const benignDiags = ts.getPreEmitDiagnostics(benignProgram);
const benignSourceDiags = benignDiags.filter((d) => d.file && resolve(d.file.fileName) === resolve(ERRORS_SOURCE));
if (benignSourceDiags.length !== 0) {
  for (const d of benignSourceDiags) console.error(`[typecheck-legacy-shared] benign-probe source diagnostic: ${summarize(d)}`);
  fail(`integrated benign probe: production source gained ${benignSourceDiags.length} error(s)`);
}
const benignFixtureDiags = benignDiags.filter((d) => d.file && resolve(d.file.fileName) === resolve(INVALID_FIXTURE));
try {
  assertNegativeDiagnostics(benignFixtureDiags, benignInvalidText, 'integrated-benign-probe');
  fail('integrated benign probe: removed rejection still passes');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes('want exactly 5 diagnostics, found 4')) fail(`integrated benign probe: wrong rejection: ${message}`);
  guards += 1;
  console.log(`[typecheck-legacy-shared] guard PASS integrated-rejection-disappearance: rejected (${message})`);
}

console.log(`[typecheck-legacy-shared] OK: 2/2 programs matched (1 positive + 1 negative) + ${guards} guard cases.`);
