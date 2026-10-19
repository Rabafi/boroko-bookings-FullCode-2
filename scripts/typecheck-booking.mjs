/**
 * Public booking browser typecheck runner (B02-E).
 *
 * Covers booking-site/src/lib/utils.js under strict checking with the
 * bundler module/resolution of the booking Vite app, checkJs:true, and an
 * explicit browser-only library set (ES2022 + DOM + DOM.Iterable, types:[]).
 * Node/Electron ambient declarations, Manager build globals and any
 * window.api fiction stay out of this program. Uses the pinned root
 * TypeScript 5.9.3 compiler API, never executes or emits fixtures (fixture
 * URLs are never navigated, no messages sent), and exits nonzero when a file
 * is excluded, a rejection disappears, or checking weakens. Guard cases and
 * integrated in-memory probes below call the same assertions used by the real
 * programs.
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
  console.error(`[typecheck-booking] FAIL: cannot load pinned local 'typescript' dependency: ${err?.message ?? err}`);
  process.exit(2);
}
if (ts.version !== '5.9.3') {
  console.error(`[typecheck-booking] FAIL: pinned compiler is ${ts.version}, want 5.9.3`);
  process.exit(2);
}
let tsLibDir;
try {
  tsLibDir = dirname(require.resolve('typescript'));
} catch (err) {
  console.error(`[typecheck-booking] FAIL: cannot resolve pinned local 'typescript' library directory: ${err?.message ?? err}`);
  process.exit(2);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const toRepoRel = (p) => relative(repoRoot, p).split(sep).join('/');

const BOOKING_CONFIG = resolve(repoRoot, 'booking-site/tsconfig.typecheck.json');
const UTILS_SOURCE = resolve(repoRoot, 'booking-site/src/lib/utils.js');
const VALID_FIXTURE = resolve(repoRoot, 'tests/typecheck/booking-utils/valid.ts');
const INVALID_CONFIG = resolve(repoRoot, 'tests/typecheck/booking-utils/tsconfig.invalid.json');
const INVALID_FIXTURE = resolve(repoRoot, 'tests/typecheck/booking-utils/invalid.ts');

/** Exact effective library set for this browser scope (lowercase basenames). */
const EXPECTED_LIBS = ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'];

function fail(message) {
  console.error(`[typecheck-booking] FAIL: ${message}`);
  process.exit(1);
}

/** Effective booking-scope options. Throws on any mismatch. */
function checkBookingOptions(options, label) {
  const problems = [];
  if (options.strict !== true) problems.push(`strict=${options.strict} (want true)`);
  if (options.allowJs !== true) problems.push(`allowJs=${options.allowJs} (want true)`);
  if (options.checkJs !== true) problems.push(`checkJs=${options.checkJs} (want true for this scope)`);
  if (options.noEmit !== true) problems.push(`noEmit=${options.noEmit} (want true)`);
  if (options.target !== ts.ScriptTarget.ES2022) {
    problems.push(`target=${options.target} (want ScriptTarget.ES2022=${ts.ScriptTarget.ES2022})`);
  }
  if (options.module !== ts.ModuleKind.ESNext) {
    problems.push(`module=${options.module} (want ModuleKind.ESNext=${ts.ModuleKind.ESNext})`);
  }
  if (options.moduleResolution !== ts.ModuleResolutionKind.Bundler) {
    problems.push(`moduleResolution=${options.moduleResolution} (want ModuleResolutionKind.Bundler=${ts.ModuleResolutionKind.Bundler})`);
  }
  const lib = options.lib ?? [];
  const libNames = Array.isArray(lib) ? lib.map((entry) => String(entry).split(/[\\/]/).pop().toLowerCase()) : [];
  if (libNames.length !== EXPECTED_LIBS.length || !EXPECTED_LIBS.every((want, i) => libNames[i] === want)) {
    problems.push(`lib=${JSON.stringify(lib)} (want exactly ${JSON.stringify(EXPECTED_LIBS)})`);
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

/** True for the real pinned lib.dom.d.ts / lib.dom.iterable.d.ts in a program. */
function programHasDomLibs(program) {
  const prefix = tsLibDir.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
  const names = program.getSourceFiles().map((f) => String(f.fileName).replace(/\\/g, '/').toLowerCase());
  return names.some((n) => n === `${prefix}/lib.dom.d.ts`) && names.some((n) => n === `${prefix}/lib.dom.iterable.d.ts`);
}

function checkProgramInventory(program, requiredAbsPaths, label) {
  const files = program.getSourceFiles().map((f) => f.fileName);
  const rels = files.map(toRepoRel).sort();
  console.log(`[typecheck-booking] ${label} program files (${files.length}):`);
  for (const r of rels) console.log(`  - ${r}`);
  try {
    requireFilesPresent(files, requiredAbsPaths, label);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  // Enumerated provenance: only the intended source/fixture and pinned
  // compiler standard libs may appear. There is deliberately NO node_modules
  // exception here — a Node, Electron, React, Vite, Manager-globals or other
  // ambient package file fails openly instead of being concealed.
  const allowed = new Set(requiredAbsPaths.map((p) => resolve(p)));
  const bad = [];
  for (const f of files) {
    if (allowed.has(resolve(f))) continue;
    if (isStdLibFile(f, tsLibDir)) continue;
    bad.push(toRepoRel(f));
  }
  if (bad.length > 0) {
    fail(`${label}: unexpected files in program (ambient leakage?): ${bad.join(', ')}`);
  }
  if (!programHasDomLibs(program)) {
    fail(`${label}: real pinned lib.dom.d.ts and lib.dom.iterable.d.ts are not both present`);
  }
  return files;
}

function checkSourceChecked(program, options, label) {
  const sourceFile = program.getSourceFile(UTILS_SOURCE);
  if (!sourceFile) fail(`${label}: production source file not in program: ${toRepoRel(UTILS_SOURCE)}`);
  try {
    assertJsChecked(sourceFile, options, ts, `${label}:${toRepoRel(UTILS_SOURCE)}`);
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
    checkBookingOptions(options, label);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

/** Verify the six intended negative diagnostics. Throws for the exact gap. */
function assertNegativeDiagnostics(fixtureDiags, content, label) {
  const lineNull = fixtureLineOf(content, 'url.toLowerCase()');
  const lineCountry = fixtureLineOf(content, 'defaultCountryCode: 267');
  const lineCheckIn = fixtureLineOf(content, 'check_in: 42');
  const lineSlug = fixtureLineOf(content, "const numeric: number = isValidSlug('my-lodge');");
  const lineNode = fixtureLineOf(content, 'process.version');
  const lineBridge = fixtureLineOf(content, 'window.api');
  if (lineNull < 0 || lineCountry < 0 || lineCheckIn < 0 || lineSlug < 0 || lineNode < 0 || lineBridge < 0) {
    throw new Error(`${label}: cannot locate intended misuse lines`);
  }
  if (fixtureDiags.length !== 6) {
    for (const d of fixtureDiags) console.error(`[typecheck-booking] fixture diagnostic: ${summarize(d)}`);
    throw new Error(`${label}: want exactly 6 diagnostics, found ${fixtureDiags.length} (rejection disappeared?)`);
  }
  const byLine = new Map(fixtureDiags.map((d) => [d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1, d]));
  const expectations = new Map([
    [lineNull, 18047],
    [lineCountry, 2322],
    [lineCheckIn, 2322],
    [lineSlug, 2322],
    [lineNode, 2591],
    [lineBridge, 2339],
  ]);
  for (const [line, code] of expectations) {
    const d = byLine.get(line);
    if (!d) throw new Error(`${label}: missing TS${code} diagnostic on line ${line}`);
    if (d.category !== ts.DiagnosticCategory.Error || d.code !== code) {
      throw new Error(`${label}: diagnostic TS${d.code} != TS${code}: ${summarize(d)}`);
    }
  }
  return { lineNull, lineCountry, lineCheckIn, lineSlug, lineNode, lineBridge };
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
for (const p of [UTILS_SOURCE, VALID_FIXTURE, BOOKING_CONFIG]) {
  if (!existsSync(p)) fail(`missing required booking file: ${toRepoRel(p)}`);
}
const positive = parseConfig(BOOKING_CONFIG);
checkOptions(positive.options, 'booking config');
try {
  requireFilesPresent(positive.fileNames, [UTILS_SOURCE, VALID_FIXTURE], 'booking config');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
if (positive.fileNames.some((f) => f.endsWith('booking-utils/invalid.ts'))) {
  fail('booking config must not include the negative fixture');
}
const positiveProgram = ts.createProgram(positive.fileNames, positive.options);
checkProgramInventory(positiveProgram, [UTILS_SOURCE, VALID_FIXTURE], 'positive');
checkSourceChecked(positiveProgram, positive.options, 'positive');
const positiveDiags = ts.getPreEmitDiagnostics(positiveProgram);
if (positiveDiags.length !== 0) {
  for (const d of positiveDiags) console.error(`[typecheck-booking] unexpected positive diagnostic: ${summarize(d)}`);
  fail(`positive program has ${positiveDiags.length} diagnostic(s), want 0`);
}
console.log('[typecheck-booking] positive: 0 diagnostics (pass)');

// ---- negative program (compile-only; fixtures contain browser calls, never executed) ----
for (const p of [INVALID_CONFIG, INVALID_FIXTURE]) {
  if (!existsSync(p)) fail(`missing required booking file: ${toRepoRel(p)}`);
}
const negative = parseConfig(INVALID_CONFIG);
checkOptions(negative.options, 'negative config');
try {
  requireFilesPresent(negative.fileNames, [UTILS_SOURCE, INVALID_FIXTURE], 'negative config');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
const negativeProgram = ts.createProgram(negative.fileNames, negative.options);
checkProgramInventory(negativeProgram, [UTILS_SOURCE, INVALID_FIXTURE], 'negative');
checkSourceChecked(negativeProgram, negative.options, 'negative');
const negativeDiags = ts.getPreEmitDiagnostics(negativeProgram);
const sourceDiags = negativeDiags.filter((d) => d.file && resolve(d.file.fileName) === resolve(UTILS_SOURCE));
if (sourceDiags.length !== 0) {
  for (const d of sourceDiags) console.error(`[typecheck-booking] production-source diagnostic: ${summarize(d)}`);
  fail(`negative program: production source has ${sourceDiags.length} diagnostic(s), want 0`);
}
const fixtureDiags = negativeDiags.filter((d) => d.file && resolve(d.file.fileName) === resolve(INVALID_FIXTURE));
const otherDiags = negativeDiags.filter((d) => !d.file || (resolve(d.file.fileName) !== resolve(INVALID_FIXTURE) && resolve(d.file.fileName) !== resolve(UTILS_SOURCE)));
if (otherDiags.length !== 0) {
  for (const d of otherDiags) console.error(`[typecheck-booking] unrelated diagnostic: ${summarize(d)}`);
  fail(`negative program: ${otherDiags.length} unrelated diagnostic(s)`);
}
const content = readFileSync(INVALID_FIXTURE, 'utf8');
let lines;
try {
  lines = assertNegativeDiagnostics(fixtureDiags, content, 'negative fixture');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
console.log(`[typecheck-booking] negative: TS18047 line ${lines.lineNull} + TS2322 lines ${lines.lineCountry},${lines.lineCheckIn},${lines.lineSlug} + TS2591 line ${lines.lineNode} + TS2339 line ${lines.lineBridge} (pass)`);

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
  console.log(`[typecheck-booking] guard PASS ${name}: rejected (${message})`);
}
function expectPass(name, fn) {
  try {
    fn();
  } catch (err) {
    fail(`guard ${name}: expected acceptance, threw: ${err instanceof Error ? err.message : err}`);
  }
  guards += 1;
  console.log(`[typecheck-booking] guard PASS ${name}: accepted`);
}
const base = positive.options;
expectPass('baseline-accepted', () => checkBookingOptions({ ...base }, 'guard'));
expectThrow('missing-dom-lib', () => checkBookingOptions({ ...base, lib: ['lib.es2022.d.ts'] }, 'guard'), 'lib=');
expectThrow('missing-dom-iterable-lib', () => checkBookingOptions({ ...base, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] }, 'guard'), 'lib=');
expectThrow('added-lib', () => checkBookingOptions({ ...base, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts', 'lib.webworker.d.ts'] }, 'guard'), 'lib=');
expectThrow('omitted-types', () => {
  const mutated = { ...base };
  delete mutated.types;
  checkBookingOptions(mutated, 'guard');
}, 'types is missing');
expectThrow('nonempty-types', () => checkBookingOptions({ ...base, types: ['node'] }, 'guard'), 'types=');
expectThrow('wrong-target', () => checkBookingOptions({ ...base, target: ts.ScriptTarget.ES2020 }, 'guard'), 'target=');
expectThrow('wrong-module', () => checkBookingOptions({ ...base, module: ts.ModuleKind.CommonJS }, 'guard'), 'module=');
expectThrow('wrong-moduleResolution', () => checkBookingOptions({ ...base, moduleResolution: ts.ModuleResolutionKind.Node10 }, 'guard'), 'moduleResolution=');
expectThrow('checkJs-false', () => checkBookingOptions({ ...base, checkJs: false }, 'guard'), 'checkJs=');
expectThrow('strict-suboptions-disabled', () => {
  checkBookingOptions({ ...base, strict: true, noImplicitAny: false, strictNullChecks: false }, 'guard');
}, 'noImplicitAny=');
expectThrow('missing-production-source', () => {
  requireFilesPresent([VALID_FIXTURE], [UTILS_SOURCE, VALID_FIXTURE], 'guard');
}, 'utils.js');
expectThrow('missing-fixture', () => {
  requireFilesPresent([UTILS_SOURCE], [UTILS_SOURCE, VALID_FIXTURE], 'guard');
}, 'valid.ts');
if (isStdLibFile('C:/evil/typescript/lib/lib.dom.d.ts', tsLibDir)) fail('guard stdlib-impostor: fake compiler-lib path recognized');
guards += 1;
console.log('[typecheck-booking] guard PASS stdlib-impostor: rejected');
const unchecked = ts.createSourceFile('links.js', 'export function f(a) { return a; }\n', ts.ScriptTarget.ES2022, true);
try {
  assertJsChecked(unchecked, base, ts, 'guard');
  fail('guard js-directive-absent: unchecked source accepted');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes('not checked')) fail(`guard js-directive-absent: wrong rejection: ${message}`);
  guards += 1;
  console.log(`[typecheck-booking] guard PASS js-directive-absent: rejected (${message})`);
}

// ---- integrated probes on in-memory variants (actual files untouched) ----

// Probe 1: Manager build globals are NOT shared into booking — a virtual file
// touching __BOROKO_APP_VERSION__ must fail with TS2304 in this program.
const VIRTUAL_MANAGER_PROBE = resolve(repoRoot, 'tests/typecheck/booking-utils/__probe-manager-global__.ts');
const managerLeakProgram = createVariantProgram(
  [UTILS_SOURCE, VIRTUAL_MANAGER_PROBE],
  base,
  new Map([[VIRTUAL_MANAGER_PROBE, 'const probeManagerVersion: string = __BOROKO_APP_VERSION__;\nvoid probeManagerVersion;\n']]),
);
const managerLeakDiags = ts
  .getPreEmitDiagnostics(managerLeakProgram)
  .filter((d) => d.file && resolve(d.file.fileName) === resolve(VIRTUAL_MANAGER_PROBE));
if (managerLeakDiags.length !== 1 || managerLeakDiags[0].code !== 2304 || managerLeakDiags[0].category !== ts.DiagnosticCategory.Error) {
  for (const d of managerLeakDiags) console.error(`[typecheck-booking] manager-leak-probe diagnostic: ${summarize(d)}`);
  fail(`integrated manager-global probe: want exactly one TS2304 error, found ${managerLeakDiags.length} diagnostic(s)`);
}
guards += 1;
console.log('[typecheck-booking] guard PASS integrated-manager-global-excluded: rejected (TS2304: Cannot find name \'__BOROKO_APP_VERSION__\')');

// Probe 2: ambient Node leakage — a virtual file touching process.version must
// fail with TS2591 inside this program's option/inventory boundary.
const VIRTUAL_PROBE = resolve(repoRoot, 'tests/typecheck/booking-utils/__probe-node-leak__.ts');
const leakProgram = createVariantProgram(
  [UTILS_SOURCE, VIRTUAL_PROBE],
  base,
  new Map([[VIRTUAL_PROBE, 'const probeNodeVersion = process.version;\nvoid probeNodeVersion;\n']]),
);
const leakDiags = ts
  .getPreEmitDiagnostics(leakProgram)
  .filter((d) => d.file && resolve(d.file.fileName) === resolve(VIRTUAL_PROBE));
if (leakDiags.length !== 1 || leakDiags[0].code !== 2591 || leakDiags[0].category !== ts.DiagnosticCategory.Error) {
  for (const d of leakDiags) console.error(`[typecheck-booking] leak-probe diagnostic: ${summarize(d)}`);
  fail(`integrated node-leak probe: want exactly one TS2591 error, found ${leakDiags.length} diagnostic(s)`);
}
guards += 1;
console.log('[typecheck-booking] guard PASS integrated-node-leak: rejected (TS2591: Cannot find name \'process\')');

// Probe 3: absent @ts-check in a production variant — the real assertJsChecked
// against a real program object must report the file as unchecked.
const realSourceText = readFileSync(UTILS_SOURCE, 'utf8');
const noDirectiveText = realSourceText.replace('// @ts-check\n', '');
if (noDirectiveText === realSourceText) fail('integrated directive probe: cannot locate the active @ts-check line');
const noDirectiveProgram = createVariantProgram(
  [UTILS_SOURCE, INVALID_FIXTURE],
  negative.options,
  new Map([[UTILS_SOURCE, noDirectiveText]]),
);
const noDirectiveFile = noDirectiveProgram.getSourceFile(UTILS_SOURCE);
if (!noDirectiveFile) fail('integrated directive probe: variant source missing from program');
try {
  assertJsChecked(noDirectiveFile, negative.options, ts, 'integrated-directive-probe');
  fail('integrated directive probe: unchecked variant accepted');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes('not checked')) fail(`integrated directive probe: wrong rejection: ${message}`);
  guards += 1;
  console.log(`[typecheck-booking] guard PASS integrated-directive-absent: rejected (${message})`);
}

// Probe 4: a real negative rejection disappearing — change the wrong
// country-code 267 to a string in an in-memory fixture while retaining the
// original full marker in a same-line comment. Production source must stay
// error-free while the SAME assertNegativeDiagnostics used above fails 6 -> 5
// for that gap. Never compensate with another error.
const benignInvalidText = content.replace(
  '{ defaultCountryCode: 267 });',
  '{ defaultCountryCode: "267" }); // { defaultCountryCode: 267 }',
);
if (benignInvalidText === content) fail('integrated benign probe: cannot locate the country-code misuse line');
const benignProgram = createVariantProgram(
  [UTILS_SOURCE, INVALID_FIXTURE],
  negative.options,
  new Map([[INVALID_FIXTURE, benignInvalidText]]),
);
const benignDiags = ts.getPreEmitDiagnostics(benignProgram);
const benignSourceDiags = benignDiags.filter((d) => d.file && resolve(d.file.fileName) === resolve(UTILS_SOURCE));
if (benignSourceDiags.length !== 0) {
  for (const d of benignSourceDiags) console.error(`[typecheck-booking] benign-probe source diagnostic: ${summarize(d)}`);
  fail(`integrated benign probe: production source gained ${benignSourceDiags.length} error(s)`);
}
const benignFixtureDiags = benignDiags.filter((d) => d.file && resolve(d.file.fileName) === resolve(INVALID_FIXTURE));
try {
  assertNegativeDiagnostics(benignFixtureDiags, benignInvalidText, 'integrated-benign-probe');
  fail('integrated benign probe: removed rejection still passes');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes('want exactly 6 diagnostics, found 5')) fail(`integrated benign probe: wrong rejection: ${message}`);
  guards += 1;
  console.log(`[typecheck-booking] guard PASS integrated-rejection-disappearance: rejected (${message})`);
}

console.log(`[typecheck-booking] OK: 2/2 programs matched (1 positive + 1 negative) + ${guards} guard cases.`);
