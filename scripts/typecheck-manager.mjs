/**
 * Manager PWA typecheck runner (B02-D).
 *
 * Covers manager-pwa/src/lib/buildInfo.js plus the sole type-only globals
 * declaration manager-pwa/src/types/build-info.d.ts (the two real Vite build
 * globals, nothing else) under strict checking with an explicit browser-only
 * library set (ES2022 + DOM + DOM.Iterable, types:[]). Node/Electron ambient
 * declarations and any window.api fiction stay out of this program. Uses the
 * pinned root TypeScript 5.9.3 compiler API, never executes or emits fixtures,
 * and exits nonzero when a file is excluded, a rejection disappears, or
 * checking weakens. Guard cases and integrated in-memory probes below call the
 * same assertions used by the real programs.
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
  console.error(`[typecheck-manager] FAIL: cannot load pinned local 'typescript' dependency: ${err?.message ?? err}`);
  process.exit(2);
}
if (ts.version !== '5.9.3') {
  console.error(`[typecheck-manager] FAIL: pinned compiler is ${ts.version}, want 5.9.3`);
  process.exit(2);
}
let tsLibDir;
try {
  tsLibDir = dirname(require.resolve('typescript'));
} catch (err) {
  console.error(`[typecheck-manager] FAIL: cannot resolve pinned local 'typescript' library directory: ${err?.message ?? err}`);
  process.exit(2);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const toRepoRel = (p) => relative(repoRoot, p).split(sep).join('/');

const MANAGER_CONFIG = resolve(repoRoot, 'manager-pwa/tsconfig.typecheck.json');
const BUILDINFO_SOURCE = resolve(repoRoot, 'manager-pwa/src/lib/buildInfo.js');
const GLOBALS_DECL = resolve(repoRoot, 'manager-pwa/src/types/build-info.d.ts');
const VALID_FIXTURE = resolve(repoRoot, 'tests/typecheck/manager-build-info/valid.ts');
const INVALID_CONFIG = resolve(repoRoot, 'tests/typecheck/manager-build-info/tsconfig.invalid.json');
const INVALID_FIXTURE = resolve(repoRoot, 'tests/typecheck/manager-build-info/invalid.ts');

/** Exact effective library set for this browser scope (lowercase basenames). */
const EXPECTED_LIBS = ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'];

/** Exact ambient globals approved for the Manager program, in file order. */
const EXPECTED_GLOBALS = ['__BOROKO_APP_VERSION__', '__BOROKO_APP_BUILD_ID__'];

function fail(message) {
  console.error(`[typecheck-manager] FAIL: ${message}`);
  process.exit(1);
}

/** Effective manager-scope options. Throws on any mismatch. */
function checkManagerOptions(options, label) {
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

/**
 * Validate the globals declaration AST: exactly two ambient const statements
 * with the approved names, each a bare `declare const NAME: string;` — the
 * declare modifier and nothing else, string type, no initializer, no extra
 * binding or statement. Comments are trivia, but compiler-recognized
 * suppression directives (@ts-nocheck via checkJsDirective, @ts-ignore /
 * @ts-expect-error via commentDirectives) are rejected using the pinned
 * compiler's own metadata — ordinary prose mentioning those words, or the
 * same text inside string literals, does not count. Throws with the exact
 * gap found.
 */
function checkGlobalsDeclaration(sourceFile, label) {
  const problems = [];
  if (!String(sourceFile.fileName).toLowerCase().endsWith('.d.ts')) {
    problems.push('declaration file must be a .d.ts (no runtime emit)');
  }
  const suppressions = [];
  const directive = sourceFile.checkJsDirective;
  if (directive && directive.enabled === false) suppressions.push('@ts-nocheck');
  for (const commentDirective of sourceFile.commentDirectives ?? []) {
    const text = String(sourceFile.text ?? '').slice(commentDirective.range.pos, commentDirective.range.end);
    suppressions.push(text.includes('expect-error') ? '@ts-expect-error' : '@ts-ignore');
  }
  if (suppressions.length > 0) {
    problems.push(`active suppression directive(s) ${suppressions.join(', ')} (declarations must stay checked)`);
  }
  const statements = [...(sourceFile.statements ?? [])];
  const declared = [];
  for (const statement of statements) {
    if (!ts.isVariableStatement(statement)) {
      let detail = '';
      if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) {
        detail = ` ${statement.name.text}`;
      }
      problems.push(`unexpected statement kind ${ts.SyntaxKind[statement.kind]}${detail} (want only ambient const declarations)`);
      continue;
    }
    const list = statement.declarationList;
    if ((list.flags & ts.NodeFlags.Const) === 0) problems.push('ambient declaration is not const');
    if (list.declarations.length !== 1) {
      problems.push(`ambient statement declares ${list.declarations.length} bindings (want exactly 1)`);
      continue;
    }
    const declarator = list.declarations[0];
    const name = ts.isIdentifier(declarator.name) ? declarator.name.text : null;
    if (!name) {
      problems.push('ambient declarator name is not a plain identifier');
      continue;
    }
    const modifiers = [...(statement.modifiers ?? [])];
    if (modifiers.length === 0) {
      problems.push(`global ${name} is missing declare modifier (declare-only required)`);
    } else {
      for (const modifier of modifiers) {
        if (modifier.kind !== ts.SyntaxKind.DeclareKeyword) {
          const token = (ts.tokenToString && ts.tokenToString(modifier.kind)) || ts.SyntaxKind[modifier.kind];
          problems.push(`global ${name} has unexpected ${token} modifier (declare-only required)`);
        }
      }
    }
    if (!declarator.type || declarator.type.kind !== ts.SyntaxKind.StringKeyword) {
      problems.push(`global ${name} does not have an explicit string type`);
    }
    if (declarator.initializer) problems.push(`global ${name} has an initializer (declarations only)`);
    declared.push(name);
  }
  if (declared.length !== EXPECTED_GLOBALS.length || !EXPECTED_GLOBALS.every((want, i) => declared[i] === want)) {
    problems.push(`globals ${JSON.stringify(declared)} != approved ${JSON.stringify(EXPECTED_GLOBALS)}`);
  }
  if (problems.length > 0) throw new Error(`${label}: invalid globals declaration: ${problems.join('; ')}`);
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

/**
 * Classify one program file: the intended JS source, the intended fixture,
 * the approved globals declaration, a pinned compiler lib, or unexpected.
 * The unexpected branch is what rejects ambient leakage instead of hiding it
 * behind a node_modules allowance (there is none in this checker).
 */
function classifyProgramFile(fileName, maintainedSet) {
  const abs = resolve(fileName);
  if (maintainedSet.has(abs)) return 'maintained';
  if (abs === resolve(GLOBALS_DECL)) return 'globals';
  if (isStdLibFile(fileName, tsLibDir)) return 'stdlib';
  return 'unexpected';
}

/** Throw listing any program file that is not intended source/fixture, the approved globals, or a pinned lib. */
function assertNoUnexpectedFiles(files, maintainedSet, label) {
  const bad = files.filter((f) => classifyProgramFile(f, maintainedSet) === 'unexpected');
  if (bad.length > 0) {
    throw new Error(`${label}: unexpected files in program (ambient leakage?): ${bad.map(toRepoRel).join(', ')}`);
  }
}

function checkProgramInventory(program, sourceAbs, fixtureAbs, label) {
  const files = program.getSourceFiles().map((f) => f.fileName);
  const rels = files.map(toRepoRel).sort();
  console.log(`[typecheck-manager] ${label} program files (${files.length}):`);
  for (const r of rels) console.log(`  - ${r}`);
  const maintained = new Set([resolve(sourceAbs), resolve(fixtureAbs)]);
  try {
    requireFilesPresent(files, [sourceAbs, GLOBALS_DECL, fixtureAbs], label);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  try {
    assertNoUnexpectedFiles(files, maintained, label);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  if (!programHasDomLibs(program)) {
    fail(`${label}: real pinned lib.dom.d.ts and lib.dom.iterable.d.ts are not both present`);
  }
  return files;
}

function checkSourceChecked(program, options, label) {
  const sourceFile = program.getSourceFile(BUILDINFO_SOURCE);
  if (!sourceFile) fail(`${label}: production source file not in program: ${toRepoRel(BUILDINFO_SOURCE)}`);
  try {
    assertJsChecked(sourceFile, options, ts, `${label}:${toRepoRel(BUILDINFO_SOURCE)}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

function checkGlobalsChecked(program, label) {
  const declFile = program.getSourceFile(GLOBALS_DECL);
  if (!declFile) fail(`${label}: globals declaration not in program: ${toRepoRel(GLOBALS_DECL)}`);
  try {
    checkGlobalsDeclaration(declFile, `${label}:${toRepoRel(GLOBALS_DECL)}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

/** Throw unless the production source has zero diagnostics in this program. */
function assertZeroSourceDiagnostics(allDiags, label) {
  const sourceDiags = allDiags.filter((d) => d.file && resolve(d.file.fileName) === resolve(BUILDINFO_SOURCE));
  if (sourceDiags.length !== 0) {
    for (const d of sourceDiags) console.error(`[typecheck-manager] production-source diagnostic: ${summarize(d)}`);
    throw new Error(`${label}: production source has ${sourceDiags.length} diagnostic(s), want 0`);
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
    checkManagerOptions(options, label);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

/** Verify the five intended negative diagnostics. Throws for the exact gap. */
function assertNegativeDiagnostics(fixtureDiags, content, label) {
  const lineNumber = fixtureLineOf(content, 'const numeric: number = APP_VERSION;');
  const lineOptional = fixtureLineOf(content, 'const upper = info.buildId.toUpperCase();');
  const lineWorker = fixtureLineOf(content, 'getWorkerBuildInfo(42);');
  const lineNode = fixtureLineOf(content, 'process.version');
  const lineBridge = fixtureLineOf(content, 'window.api');
  if (lineNumber < 0 || lineOptional < 0 || lineWorker < 0 || lineNode < 0 || lineBridge < 0) {
    throw new Error(`${label}: cannot locate intended misuse lines`);
  }
  if (fixtureDiags.length !== 5) {
    for (const d of fixtureDiags) console.error(`[typecheck-manager] fixture diagnostic: ${summarize(d)}`);
    throw new Error(`${label}: want exactly 5 diagnostics, found ${fixtureDiags.length} (rejection disappeared?)`);
  }
  const byLine = new Map(fixtureDiags.map((d) => [d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1, d]));
  const expectations = new Map([
    [lineNumber, 2322],
    [lineOptional, 18048],
    [lineWorker, 2345],
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
  return { lineNumber, lineOptional, lineWorker, lineNode, lineBridge };
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
for (const p of [BUILDINFO_SOURCE, GLOBALS_DECL, VALID_FIXTURE, MANAGER_CONFIG]) {
  if (!existsSync(p)) fail(`missing required manager file: ${toRepoRel(p)}`);
}
const positive = parseConfig(MANAGER_CONFIG);
checkOptions(positive.options, 'manager config');
try {
  requireFilesPresent(positive.fileNames, [BUILDINFO_SOURCE, GLOBALS_DECL, VALID_FIXTURE], 'manager config');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
if (positive.fileNames.some((f) => f.endsWith('manager-build-info/invalid.ts'))) {
  fail('manager config must not include the negative fixture');
}
const positiveProgram = ts.createProgram(positive.fileNames, positive.options);
checkProgramInventory(positiveProgram, BUILDINFO_SOURCE, VALID_FIXTURE, 'positive');
checkSourceChecked(positiveProgram, positive.options, 'positive');
checkGlobalsChecked(positiveProgram, 'positive');
const positiveDiags = ts.getPreEmitDiagnostics(positiveProgram);
if (positiveDiags.length !== 0) {
  for (const d of positiveDiags) console.error(`[typecheck-manager] unexpected positive diagnostic: ${summarize(d)}`);
  fail(`positive program has ${positiveDiags.length} diagnostic(s), want 0`);
}
console.log('[typecheck-manager] positive: 0 diagnostics (pass)');

// ---- negative program (compile-only; fixtures contain browser calls, never executed) ----
for (const p of [INVALID_CONFIG, INVALID_FIXTURE]) {
  if (!existsSync(p)) fail(`missing required manager file: ${toRepoRel(p)}`);
}
const negative = parseConfig(INVALID_CONFIG);
checkOptions(negative.options, 'negative config');
try {
  requireFilesPresent(negative.fileNames, [BUILDINFO_SOURCE, GLOBALS_DECL, INVALID_FIXTURE], 'negative config');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
const negativeProgram = ts.createProgram(negative.fileNames, negative.options);
checkProgramInventory(negativeProgram, BUILDINFO_SOURCE, INVALID_FIXTURE, 'negative');
checkSourceChecked(negativeProgram, negative.options, 'negative');
checkGlobalsChecked(negativeProgram, 'negative');
const negativeDiags = ts.getPreEmitDiagnostics(negativeProgram);
try {
  assertZeroSourceDiagnostics(negativeDiags, 'negative program');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
const fixtureDiags = negativeDiags.filter((d) => d.file && resolve(d.file.fileName) === resolve(INVALID_FIXTURE));
// The globals declaration has NO exemption here: any compiler diagnostic on
// it fails openly as unrelated. Only the five intended fixture errors survive.
const otherDiags = negativeDiags.filter((d) => !d.file || (resolve(d.file.fileName) !== resolve(INVALID_FIXTURE) && resolve(d.file.fileName) !== resolve(BUILDINFO_SOURCE)));
if (otherDiags.length !== 0) {
  for (const d of otherDiags) console.error(`[typecheck-manager] unrelated diagnostic: ${summarize(d)}`);
  fail(`negative program: ${otherDiags.length} unrelated diagnostic(s)`);
}
const content = readFileSync(INVALID_FIXTURE, 'utf8');
let lines;
try {
  lines = assertNegativeDiagnostics(fixtureDiags, content, 'negative fixture');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
console.log(`[typecheck-manager] negative: TS2322 line ${lines.lineNumber} + TS18048 line ${lines.lineOptional} + TS2345 line ${lines.lineWorker} + TS2591 line ${lines.lineNode} + TS2339 line ${lines.lineBridge} (pass)`);

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
  console.log(`[typecheck-manager] guard PASS ${name}: rejected (${message})`);
}
function expectPass(name, fn) {
  try {
    fn();
  } catch (err) {
    fail(`guard ${name}: expected acceptance, threw: ${err instanceof Error ? err.message : err}`);
  }
  guards += 1;
  console.log(`[typecheck-manager] guard PASS ${name}: accepted`);
}
const base = positive.options;
expectPass('baseline-accepted', () => checkManagerOptions({ ...base }, 'guard'));
expectThrow('missing-dom-lib', () => checkManagerOptions({ ...base, lib: ['lib.es2022.d.ts'] }, 'guard'), 'lib=');
expectThrow('missing-dom-iterable-lib', () => checkManagerOptions({ ...base, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] }, 'guard'), 'lib=');
expectThrow('added-lib', () => checkManagerOptions({ ...base, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts', 'lib.webworker.d.ts'] }, 'guard'), 'lib=');
expectThrow('omitted-types', () => {
  const mutated = { ...base };
  delete mutated.types;
  checkManagerOptions(mutated, 'guard');
}, 'types is missing');
expectThrow('nonempty-types', () => checkManagerOptions({ ...base, types: ['node'] }, 'guard'), 'types=');
expectThrow('wrong-target', () => checkManagerOptions({ ...base, target: ts.ScriptTarget.ES2020 }, 'guard'), 'target=');
expectThrow('wrong-module', () => checkManagerOptions({ ...base, module: ts.ModuleKind.CommonJS }, 'guard'), 'module=');
expectThrow('wrong-moduleResolution', () => checkManagerOptions({ ...base, moduleResolution: ts.ModuleResolutionKind.Node10 }, 'guard'), 'moduleResolution=');
expectThrow('checkJs-false', () => checkManagerOptions({ ...base, checkJs: false }, 'guard'), 'checkJs=');
expectThrow('strict-suboptions-disabled', () => {
  checkManagerOptions({ ...base, strict: true, noImplicitAny: false, strictNullChecks: false }, 'guard');
}, 'noImplicitAny=');
expectThrow('missing-production-source', () => {
  requireFilesPresent([GLOBALS_DECL, VALID_FIXTURE], [BUILDINFO_SOURCE, GLOBALS_DECL, VALID_FIXTURE], 'guard');
}, 'buildInfo.js');
expectThrow('missing-globals-declaration', () => {
  requireFilesPresent([BUILDINFO_SOURCE, VALID_FIXTURE], [BUILDINFO_SOURCE, GLOBALS_DECL, VALID_FIXTURE], 'guard');
}, 'build-info.d.ts');
expectThrow('missing-fixture', () => {
  requireFilesPresent([BUILDINFO_SOURCE, GLOBALS_DECL], [BUILDINFO_SOURCE, GLOBALS_DECL, VALID_FIXTURE], 'guard');
}, 'valid.ts');
const realDecl = positiveProgram.getSourceFile(GLOBALS_DECL);
if (!realDecl) fail('guard globals-shape-baseline: declaration missing from positive program');
expectPass('globals-shape-baseline', () => checkGlobalsDeclaration(realDecl, 'guard'));
for (const [name, text, want] of [
  ['globals-renamed-global', 'declare const __BOROKO_APP_VERSION__: string;\ndeclare const __BOROKO_APP_BUILD_WRONG__: string;\n', '__BOROKO_APP_BUILD_ID__'],
  ['globals-wrong-type', 'declare const __BOROKO_APP_VERSION__: string;\ndeclare const __BOROKO_APP_BUILD_ID__: number;\n', 'explicit string type'],
  ['globals-with-initializer', 'declare const __BOROKO_APP_VERSION__: string;\ndeclare const __BOROKO_APP_BUILD_ID__: string = "x";\n', 'initializer'],
  ['globals-extra-interface', 'declare const __BOROKO_APP_VERSION__: string;\ndeclare const __BOROKO_APP_BUILD_ID__: string;\ninterface Window { api: unknown }\n', 'Window'],
  ['globals-index-signature', 'declare const __BOROKO_APP_VERSION__: string;\ndeclare const __BOROKO_APP_BUILD_ID__: string;\ninterface Loose { [key: string]: unknown }\n', 'Loose'],
  ['globals-missing-declare', 'const __BOROKO_APP_VERSION__: string;\nconst __BOROKO_APP_BUILD_ID__: string;\n', 'missing declare modifier'],
  ['globals-exported-declare', 'export declare const __BOROKO_APP_VERSION__: string;\nexport declare const __BOROKO_APP_BUILD_ID__: string;\n', 'unexpected export modifier'],
  ['globals-active-nocheck', '// @ts-nocheck\ndeclare const __BOROKO_APP_VERSION__: string;\ndeclare const __BOROKO_APP_BUILD_ID__: string;\n', '@ts-nocheck'],
  ['globals-ignore-directive', '// @ts-ignore\ndeclare const __BOROKO_APP_VERSION__: string;\ndeclare const __BOROKO_APP_BUILD_ID__: string;\n', '@ts-ignore'],
  ['globals-expect-error-directive', '// @ts-expect-error\ndeclare const __BOROKO_APP_VERSION__: string;\ndeclare const __BOROKO_APP_BUILD_ID__: string;\n', '@ts-expect-error'],
]) {
  const variant = ts.createSourceFile('build-info.d.ts', text, ts.ScriptTarget.ES2022, true);
  expectThrow(name, () => checkGlobalsDeclaration(variant, 'guard'), want);
}
expectThrow('unexpected-ambient-file', () => {
  assertNoUnexpectedFiles(
    [BUILDINFO_SOURCE, GLOBALS_DECL, VALID_FIXTURE, resolve(repoRoot, 'manager-pwa/src/lib/appUpdate.js')],
    new Set([resolve(BUILDINFO_SOURCE), resolve(VALID_FIXTURE)]),
    'guard',
  );
}, 'appUpdate.js');
if (isStdLibFile('C:/evil/typescript/lib/lib.dom.d.ts', tsLibDir)) fail('guard stdlib-impostor: fake compiler-lib path recognized');
guards += 1;
console.log('[typecheck-manager] guard PASS stdlib-impostor: rejected');
const unchecked = ts.createSourceFile('build.js', 'export function f(a) { return a; }\n', ts.ScriptTarget.ES2022, true);
try {
  assertJsChecked(unchecked, base, ts, 'guard');
  fail('guard js-directive-absent: unchecked source accepted');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes('not checked')) fail(`guard js-directive-absent: wrong rejection: ${message}`);
  guards += 1;
  console.log(`[typecheck-manager] guard PASS js-directive-absent: rejected (${message})`);
}

// ---- integrated probes on in-memory variants (actual files untouched) ----
const realSourceText = readFileSync(BUILDINFO_SOURCE, 'utf8');

// Probe 1: missing build globals — a program built without the declaration
// file must fail on real production-source errors (TS2304 unknown names),
// not by inventing substitutes.
const noGlobalsProgram = ts.createProgram([BUILDINFO_SOURCE, VALID_FIXTURE], base);
const noGlobalsDiags = ts.getPreEmitDiagnostics(noGlobalsProgram);
try {
  assertZeroSourceDiagnostics(noGlobalsDiags, 'integrated-missing-globals-probe');
  fail('integrated missing-globals probe: global-less program accepted');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes('production source has 2 diagnostic(s)')) fail(`integrated missing-globals probe: wrong rejection: ${message}`);
  guards += 1;
  console.log(`[typecheck-manager] guard PASS integrated-missing-globals: rejected (${message})`);
}

// Probe 2: ambient Node leakage — a virtual file touching process.version
// must fail with TS2591 inside this program's option/inventory boundary.
const VIRTUAL_PROBE = resolve(repoRoot, 'tests/typecheck/manager-build-info/__probe-node-leak__.ts');
const leakProgram = createVariantProgram(
  [BUILDINFO_SOURCE, GLOBALS_DECL, VIRTUAL_PROBE],
  base,
  new Map([[VIRTUAL_PROBE, 'const probeNodeVersion = process.version;\nvoid probeNodeVersion;\n']]),
);
const leakDiags = ts
  .getPreEmitDiagnostics(leakProgram)
  .filter((d) => d.file && resolve(d.file.fileName) === resolve(VIRTUAL_PROBE));
if (leakDiags.length !== 1 || leakDiags[0].code !== 2591 || leakDiags[0].category !== ts.DiagnosticCategory.Error) {
  for (const d of leakDiags) console.error(`[typecheck-manager] leak-probe diagnostic: ${summarize(d)}`);
  fail(`integrated node-leak probe: want exactly one TS2591 error, found ${leakDiags.length} diagnostic(s)`);
}
guards += 1;
console.log('[typecheck-manager] guard PASS integrated-node-leak: rejected (TS2591: Cannot find name \'process\')');

// Probe 3: weakened globals in a production variant — declare keywords removed
// plus an active // @ts-nocheck — must fail the REAL checkGlobalsDeclaration
// on a real program object for the intended globals-validation reason. The
// actual on-disk declaration is untouched.
const realDeclText = readFileSync(GLOBALS_DECL, 'utf8');
const weakenedDeclText = `// @ts-nocheck\n${realDeclText.replace(/declare /g, '')}`;
if (!weakenedDeclText.includes('@ts-nocheck') || weakenedDeclText.includes('declare const')) {
  fail('integrated globals probe: cannot build the weakened variant');
}
const weakenedProgram = createVariantProgram(
  [BUILDINFO_SOURCE, GLOBALS_DECL, INVALID_FIXTURE],
  negative.options,
  new Map([[GLOBALS_DECL, weakenedDeclText]]),
);
const weakenedFile = weakenedProgram.getSourceFile(GLOBALS_DECL);
if (!weakenedFile) fail('integrated globals probe: variant declaration missing from program');
try {
  checkGlobalsDeclaration(weakenedFile, 'integrated-globals-probe');
  fail('integrated globals probe: weakened declaration accepted');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes('@ts-nocheck') || !message.includes('missing declare modifier')) {
    fail(`integrated globals probe: wrong rejection: ${message}`);
  }
  guards += 1;
  console.log(`[typecheck-manager] guard PASS integrated-globals-weakened: rejected (${message})`);
}
// Probe 4: absent @ts-check in a production variant — the real assertJsChecked against
// a real program object must report the file as unchecked.
const noDirectiveText = realSourceText.replace('// @ts-check\n', '');
if (noDirectiveText === realSourceText) fail('integrated directive probe: cannot locate the active @ts-check line');
const noDirectiveProgram = createVariantProgram(
  [BUILDINFO_SOURCE, GLOBALS_DECL, INVALID_FIXTURE],
  negative.options,
  new Map([[BUILDINFO_SOURCE, noDirectiveText]]),
);
const noDirectiveFile = noDirectiveProgram.getSourceFile(BUILDINFO_SOURCE);
if (!noDirectiveFile) fail('integrated directive probe: variant source missing from program');
try {
  assertJsChecked(noDirectiveFile, negative.options, ts, 'integrated-directive-probe');
  fail('integrated directive probe: unchecked variant accepted');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes('not checked')) fail(`integrated directive probe: wrong rejection: ${message}`);
  guards += 1;
  console.log(`[typecheck-manager] guard PASS integrated-directive-absent: rejected (${message})`);
}

// Probe 5: a real negative rejection disappearing — change getWorkerBuildInfo(42)
// to a benign call in an in-memory fixture while retaining the original marker
// as a same-line comment. Production source must stay error-free while the
// SAME assertNegativeDiagnostics used above fails 5 -> 4 for that gap. Never
// compensate with another error.
const benignInvalidText = content.replace(
  'getWorkerBuildInfo(42);',
  'getWorkerBuildInfo(null); // getWorkerBuildInfo(42);',
);
if (benignInvalidText === content) fail('integrated benign probe: cannot locate the worker misuse line');
const benignProgram = createVariantProgram(
  [BUILDINFO_SOURCE, GLOBALS_DECL, INVALID_FIXTURE],
  negative.options,
  new Map([[INVALID_FIXTURE, benignInvalidText]]),
);
const benignDiags = ts.getPreEmitDiagnostics(benignProgram);
try {
  assertZeroSourceDiagnostics(benignDiags, 'integrated-benign-probe');
} catch (err) {
  fail(`integrated benign probe: production source gained errors: ${err instanceof Error ? err.message : err}`);
}
const benignFixtureDiags = benignDiags.filter((d) => d.file && resolve(d.file.fileName) === resolve(INVALID_FIXTURE));
try {
  assertNegativeDiagnostics(benignFixtureDiags, benignInvalidText, 'integrated-benign-probe');
  fail('integrated benign probe: removed rejection still passes');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes('want exactly 5 diagnostics, found 4')) fail(`integrated benign probe: wrong rejection: ${message}`);
  guards += 1;
  console.log(`[typecheck-manager] guard PASS integrated-rejection-disappearance: rejected (${message})`);
}

console.log(`[typecheck-manager] OK: 2/2 programs matched (1 positive + 1 negative) + ${guards} guard cases.`);
