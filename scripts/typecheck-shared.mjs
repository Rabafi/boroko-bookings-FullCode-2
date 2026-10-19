/**
 * Shared-pure typecheck runner (B02-A).
 *
 * Covers packages/product-config/index.js + src/shared/brandIdentity.js under
 * strict checking with global checkJs:true (this scope only; B01's pilot keeps
 * checkJs:false). Uses the pinned local TypeScript compiler API, never executes
 * negative fixtures, and exits nonzero when a fixture is excluded, a rejection
 * disappears, or checking weakens. In-memory guard cases are included below.
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
  console.error(`[typecheck-shared] FAIL: cannot load pinned local 'typescript' dependency: ${err?.message ?? err}`);
  process.exit(2);
}
if (ts.version !== '5.9.3') {
  console.error(`[typecheck-shared] FAIL: pinned compiler is ${ts.version}, want 5.9.3`);
  process.exit(2);
}
let tsLibDir;
try {
  tsLibDir = dirname(require.resolve('typescript'));
} catch (err) {
  console.error(`[typecheck-shared] FAIL: cannot resolve pinned local 'typescript' library directory: ${err?.message ?? err}`);
  process.exit(2);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const toRepoRel = (p) => relative(repoRoot, p).split(sep).join('/');

const SHARED_CONFIG = resolve(repoRoot, 'tsconfig.typecheck-shared.json');
const PRODUCT_SOURCE = resolve(repoRoot, 'packages/product-config/index.js');
const BRAND_SOURCE = resolve(repoRoot, 'src/shared/brandIdentity.js');
const VALID_FIXTURE = resolve(repoRoot, 'tests/typecheck/shared-brand/valid.ts');
const INVALID_CONFIG = resolve(repoRoot, 'tests/typecheck/shared-brand/tsconfig.invalid.json');
const INVALID_FIXTURE = resolve(repoRoot, 'tests/typecheck/shared-brand/invalid.ts');
const PRODUCTION_SOURCES = [PRODUCT_SOURCE, BRAND_SOURCE];

function fail(message) {
  console.error(`[typecheck-shared] FAIL: ${message}`);
  process.exit(1);
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

/** Effective shared-scope options. Throws on any mismatch (checkJs:true here). */
function checkSharedOptions(options, label) {
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
  if (!(Array.isArray(lib) && lib.length === 1 && String(lib[0]).toLowerCase().endsWith(EXPECTED_LIB_BASENAME))) {
    problems.push(`lib=${JSON.stringify(lib)} (want exactly ["${EXPECTED_LIB_BASENAME}"])`);
  }
  // types must be EXPLICITLY []; omitted parses to undefined and is rejected.
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

/** Require every path in `required` to appear in `fileNames`. Throws. */
function requireFilesPresent(fileNames, required, label) {
  const have = new Set(fileNames.map((f) => resolve(f)));
  for (const req of required) {
    if (!have.has(resolve(req))) throw new Error(`${label}: required file missing: ${toRepoRel(req)}`);
  }
}

function checkProgramInventory(program, requiredAbsPaths, label) {
  const files = program.getSourceFiles().map((f) => f.fileName);
  const rels = files.map(toRepoRel).sort();
  console.log(`[typecheck-shared] ${label} program files (${files.length}):`);
  for (const r of rels) console.log(`  - ${r}`);
  try {
    requireFilesPresent(files, requiredAbsPaths, label);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const allowed = new Set(requiredAbsPaths.map((p) => resolve(p)));
  const bad = [];
  for (const f of files) {
    if (allowed.has(resolve(f))) continue;
    if (isStdLibFile(f, tsLibDir)) continue;
    bad.push(toRepoRel(f));
  }
  if (bad.length > 0) {
    fail(`${label}: unexpected maintained/app files in program (broad include?): ${bad.join(', ')}`);
  }
  return files;
}

function checkBothSourcesChecked(program, options, label) {
  for (const src of PRODUCTION_SOURCES) {
    const sourceFile = program.getSourceFile(src);
    if (!sourceFile) fail(`${label}: production source file not in program: ${toRepoRel(src)}`);
    try {
      assertJsChecked(sourceFile, options, ts, `${label}:${toRepoRel(src)}`);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
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

// ---- positive program ----
for (const p of [...PRODUCTION_SOURCES, VALID_FIXTURE, SHARED_CONFIG]) {
  if (!existsSync(p)) fail(`missing required shared file: ${toRepoRel(p)}`);
}
const positive = parseConfig(SHARED_CONFIG);
try {
  checkSharedOptions(positive.options, 'shared config');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
try {
  requireFilesPresent(positive.fileNames, [...PRODUCTION_SOURCES, VALID_FIXTURE], 'shared config');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
if (positive.fileNames.some((f) => f.endsWith('shared-brand/invalid.ts') || f.endsWith('product-config/invalid-product-id.ts') || f.endsWith('product-config/readonly-products.ts'))) {
  fail('shared config must not include negative fixtures');
}
const positiveProgram = ts.createProgram(positive.fileNames, positive.options);
checkProgramInventory(positiveProgram, [...PRODUCTION_SOURCES, VALID_FIXTURE], 'positive');
checkBothSourcesChecked(positiveProgram, positive.options, 'positive');
const positiveDiags = ts.getPreEmitDiagnostics(positiveProgram);
if (positiveDiags.length !== 0) {
  for (const d of positiveDiags) console.error(`[typecheck-shared] unexpected positive diagnostic: ${summarize(d)}`);
  fail(`positive program has ${positiveDiags.length} diagnostic(s), want 0`);
}
console.log('[typecheck-shared] positive: 0 diagnostics (pass)');

// ---- negative program (compile-only; never executed) ----
for (const p of [INVALID_CONFIG, INVALID_FIXTURE]) {
  if (!existsSync(p)) fail(`missing required shared file: ${toRepoRel(p)}`);
}
const negative = parseConfig(INVALID_CONFIG);
try {
  checkSharedOptions(negative.options, 'negative config');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
try {
  requireFilesPresent(negative.fileNames, [...PRODUCTION_SOURCES, INVALID_FIXTURE], 'negative config');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
const negativeProgram = ts.createProgram(negative.fileNames, negative.options);
checkProgramInventory(negativeProgram, [...PRODUCTION_SOURCES, INVALID_FIXTURE], 'negative');
checkBothSourcesChecked(negativeProgram, negative.options, 'negative');
const negativeDiags = ts.getPreEmitDiagnostics(negativeProgram);
const sourceDiags = negativeDiags.filter((d) => d.file && PRODUCTION_SOURCES.some((s) => resolve(d.file.fileName) === resolve(s)));
if (sourceDiags.length !== 0) {
  for (const d of sourceDiags) console.error(`[typecheck-shared] production-source diagnostic: ${summarize(d)}`);
  fail(`negative program: production sources have ${sourceDiags.length} diagnostic(s), want 0`);
}
const fixtureDiags = negativeDiags.filter((d) => d.file && resolve(d.file.fileName) === resolve(INVALID_FIXTURE));
const otherDiags = negativeDiags.filter(
  (d) => !d.file || (resolve(d.file.fileName) !== resolve(INVALID_FIXTURE) && !PRODUCTION_SOURCES.some((s) => resolve(d.file.fileName) === resolve(s))),
);
if (otherDiags.length !== 0) {
  for (const d of otherDiags) console.error(`[typecheck-shared] unrelated diagnostic: ${summarize(d)}`);
  fail(`negative program: ${otherDiags.length} unrelated diagnostic(s)`);
}
const content = readFileSync(INVALID_FIXTURE, 'utf8');
const lineId = fixtureLineOf(content, 'const badId: ProductId = "unsupported-product"');
const lineReadonly = fixtureLineOf(content, 'PRODUCT_BRANDS.hotel.name = "Renamed Hotel"');
const lineUnknown = fixtureLineOf(content, 'const unsafeName = uncertain.name');
if (lineId < 0 || lineReadonly < 0 || lineUnknown < 0) fail('negative fixture: cannot locate intended misuse lines');
if (fixtureDiags.length !== 3) {
  for (const d of fixtureDiags) console.error(`[typecheck-shared] fixture diagnostic: ${summarize(d)}`);
  fail(`negative fixture: want exactly 3 diagnostics, found ${fixtureDiags.length} (rejection disappeared?)`);
}
const byLine = new Map(fixtureDiags.map((d) => [d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1, d]));
const dId = byLine.get(lineId);
const dRo = byLine.get(lineReadonly);
const dUn = byLine.get(lineUnknown);
if (!dId) fail(`negative fixture: missing TS2322 diagnostic on line ${lineId}`);
if (!dRo) fail(`negative fixture: missing TS2540 diagnostic on line ${lineReadonly}`);
if (!dUn) fail(`negative fixture: missing TS18046 diagnostic on line ${lineUnknown}`);
for (const [d, code] of [[dId, 2322], [dRo, 2540], [dUn, 18046]]) {
  if (d.category !== ts.DiagnosticCategory.Error || d.code !== code) {
    fail(`negative fixture: diagnostic TS${d.code} != TS${code}: ${summarize(d)}`);
  }
}
console.log(`[typecheck-shared] negative: TS2322 line ${lineId} + TS2540 line ${lineReadonly} + TS18046 line ${lineUnknown} (pass)`);

// ---- in-memory guard cases (weakened states must fail for the intended reason) ----
let guards = 0;
function expectThrow(name, fn, want) {
  let message = null;
  try {
    fn();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  if (message === null) {
    fail(`guard ${name}: expected rejection containing "${want}", but nothing threw`);
  }
  if (!message.includes(want)) {
    fail(`guard ${name}: rejection did not name the intended guard (want "${want}"): ${message}`);
  }
  guards += 1;
  console.log(`[typecheck-shared] guard PASS ${name}: rejected (${message})`);
}
const base = positive.options;
expectThrow('added-dom-lib', () => checkSharedOptions({ ...base, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] }, 'guard'), 'lib=');
expectThrow('omitted-types', () => {
  const mutated = { ...base };
  delete mutated.types;
  checkSharedOptions(mutated, 'guard');
}, 'types is missing');
expectThrow('nonempty-types', () => checkSharedOptions({ ...base, types: ['node'] }, 'guard'), 'types=');
expectThrow('wrong-target', () => checkSharedOptions({ ...base, target: ts.ScriptTarget.ES2020 }, 'guard'), 'target=');
expectThrow('wrong-module', () => checkSharedOptions({ ...base, module: ts.ModuleKind.CommonJS }, 'guard'), 'module=');
expectThrow('wrong-moduleResolution', () => checkSharedOptions({ ...base, moduleResolution: ts.ModuleResolutionKind.Classic }, 'guard'), 'moduleResolution=');
expectThrow('strict-suboptions-disabled', () => {
  checkSharedOptions({ ...base, strict: true, noImplicitAny: false, strictNullChecks: false }, 'guard');
}, 'noImplicitAny=');
expectThrow('checkJs-false', () => checkSharedOptions({ ...base, checkJs: false }, 'guard'), 'checkJs=');
expectThrow('missing-production-source', () => {
  requireFilesPresent([PRODUCT_SOURCE, VALID_FIXTURE], [...PRODUCTION_SOURCES, VALID_FIXTURE], 'guard');
}, 'brandIdentity.js');
expectThrow('missing-fixture', () => {
  requireFilesPresent([...PRODUCTION_SOURCES], [...PRODUCTION_SOURCES, VALID_FIXTURE], 'guard');
}, 'valid.ts');
if (isStdLibFile('C:/evil/typescript/lib/lib.es2022.d.ts', tsLibDir)) {
  fail('guard stdlib-impostor: fake path recognized as stdlib');
}
guards += 1;
console.log('[typecheck-shared] guard PASS stdlib-impostor: rejected');
const unchecked = ts.createSourceFile(
  'brand.js',
  'export const X = Object.freeze({ a: 1 });\n',
  ts.ScriptTarget.ES2022,
  true,
);
try {
  assertJsChecked(unchecked, base, ts, 'guard');
  fail('guard js-directive-absent: unchecked source accepted');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes('not checked')) fail(`guard js-directive-absent: wrong rejection: ${message}`);
  guards += 1;
  console.log(`[typecheck-shared] guard PASS js-directive-absent: rejected (${message})`);
}

console.log(`[typecheck-shared] OK: 2/2 programs matched (1 positive + 1 negative) + ${guards} guard cases.`);
