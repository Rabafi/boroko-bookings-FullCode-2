/**
 * Desktop preload transport typecheck runner (B02-G).
 *
 * Covers src/preload/transport.js (a small factory extracted from the actual
 * preload, wired back into it) under strict checking with NodeNext
 * module/resolution, checkJs:true, an explicit browser + Node typing set
 * (ES2022 + DOM + DOM.Iterable libs, types:["node"]) and the real installed
 * Electron + Node 24 declarations. Uses the pinned root TypeScript 5.9.3
 * compiler API, never executes or emits fixtures, and exits nonzero when a
 * file is excluded, a rejection disappears, or checking weakens. Guard cases
 * and integrated in-memory probes below call the same assertions used by the
 * real programs.
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
  console.error(`[typecheck-preload] FAIL: cannot load pinned local 'typescript' dependency: ${err?.message ?? err}`);
  process.exit(2);
}
if (ts.version !== '5.9.3') {
  console.error(`[typecheck-preload] FAIL: pinned compiler is ${ts.version}, want 5.9.3`);
  process.exit(2);
}
let tsLibDir;
try {
  tsLibDir = dirname(require.resolve('typescript'));
} catch (err) {
  console.error(`[typecheck-preload] FAIL: cannot resolve pinned local 'typescript' library directory: ${err?.message ?? err}`);
  process.exit(2);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const toRepoRel = (p) => relative(repoRoot, p).split(sep).join('/');

const PRELOAD_CONFIG = resolve(repoRoot, 'tsconfig.typecheck-preload.json');
const TRANSPORT_SOURCE = resolve(repoRoot, 'src/preload/transport.js');
const PRELOAD_API_SOURCE = resolve(repoRoot, 'src/preload/index.js');
const DESKTOP_API_TYPES_SOURCE = resolve(repoRoot, 'src/renderer/src/types/desktop-api.d.ts');
const ADMIN_EXPORT_TYPES_SOURCE = resolve(repoRoot, 'src/renderer/src/types/admin-export.d.ts');
const IPC_CONTRACT_TYPES_SOURCE = resolve(repoRoot, 'src/shared/desktopIpcContracts.d.ts');
const DECLARATION_DEPENDENCIES = [IPC_CONTRACT_TYPES_SOURCE];
const VALID_FIXTURE = resolve(repoRoot, 'tests/typecheck/preload-transport/valid.ts');
const INVALID_CONFIG = resolve(repoRoot, 'tests/typecheck/preload-transport/tsconfig.invalid.json');
const INVALID_FIXTURE = resolve(repoRoot, 'tests/typecheck/preload-transport/invalid.ts');

/** Exact effective library set for this scope (lowercase basenames). */
const EXPECTED_LIBS = ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'];

/**
 * Static pinned-compiler library basenames recorded in reviewer preflight
 * (61 entries). Copied as literals — never derived from a live program, so a
 * contaminated closure cannot widen this rule.
 */
const STATIC_TS_LIBS = [
  'lib.decorators.d.ts',
  'lib.decorators.legacy.d.ts',
  'lib.dom.d.ts',
  'lib.dom.iterable.d.ts',
  'lib.es2015.collection.d.ts',
  'lib.es2015.core.d.ts',
  'lib.es2015.d.ts',
  'lib.es2015.generator.d.ts',
  'lib.es2015.iterable.d.ts',
  'lib.es2015.promise.d.ts',
  'lib.es2015.proxy.d.ts',
  'lib.es2015.reflect.d.ts',
  'lib.es2015.symbol.d.ts',
  'lib.es2015.symbol.wellknown.d.ts',
  'lib.es2016.array.include.d.ts',
  'lib.es2016.d.ts',
  'lib.es2016.intl.d.ts',
  'lib.es2017.arraybuffer.d.ts',
  'lib.es2017.d.ts',
  'lib.es2017.date.d.ts',
  'lib.es2017.intl.d.ts',
  'lib.es2017.object.d.ts',
  'lib.es2017.sharedmemory.d.ts',
  'lib.es2017.string.d.ts',
  'lib.es2017.typedarrays.d.ts',
  'lib.es2018.asyncgenerator.d.ts',
  'lib.es2018.asynciterable.d.ts',
  'lib.es2018.d.ts',
  'lib.es2018.intl.d.ts',
  'lib.es2018.promise.d.ts',
  'lib.es2018.regexp.d.ts',
  'lib.es2019.array.d.ts',
  'lib.es2019.d.ts',
  'lib.es2019.intl.d.ts',
  'lib.es2019.object.d.ts',
  'lib.es2019.string.d.ts',
  'lib.es2019.symbol.d.ts',
  'lib.es2020.bigint.d.ts',
  'lib.es2020.d.ts',
  'lib.es2020.date.d.ts',
  'lib.es2020.intl.d.ts',
  'lib.es2020.number.d.ts',
  'lib.es2020.promise.d.ts',
  'lib.es2020.sharedmemory.d.ts',
  'lib.es2020.string.d.ts',
  'lib.es2020.symbol.wellknown.d.ts',
  'lib.es2021.d.ts',
  'lib.es2021.intl.d.ts',
  'lib.es2021.promise.d.ts',
  'lib.es2021.string.d.ts',
  'lib.es2021.weakref.d.ts',
  'lib.es2022.array.d.ts',
  'lib.es2022.d.ts',
  'lib.es2022.error.d.ts',
  'lib.es2022.intl.d.ts',
  'lib.es2022.object.d.ts',
  'lib.es2022.regexp.d.ts',
  'lib.es2022.string.d.ts',
  'lib.es5.d.ts',
  'lib.esnext.disposable.d.ts',
  'lib.esnext.float16.d.ts',
];

/** Actual root @types/node inventory recorded in reviewer preflight (66 files). */
const DEP_NODE_FILES = [
  'node_modules/@types/node/assert.d.ts',
  'node_modules/@types/node/assert/strict.d.ts',
  'node_modules/@types/node/async_hooks.d.ts',
  'node_modules/@types/node/buffer.buffer.d.ts',
  'node_modules/@types/node/buffer.d.ts',
  'node_modules/@types/node/child_process.d.ts',
  'node_modules/@types/node/cluster.d.ts',
  'node_modules/@types/node/compatibility/iterators.d.ts',
  'node_modules/@types/node/console.d.ts',
  'node_modules/@types/node/constants.d.ts',
  'node_modules/@types/node/crypto.d.ts',
  'node_modules/@types/node/dgram.d.ts',
  'node_modules/@types/node/diagnostics_channel.d.ts',
  'node_modules/@types/node/dns.d.ts',
  'node_modules/@types/node/dns/promises.d.ts',
  'node_modules/@types/node/domain.d.ts',
  'node_modules/@types/node/events.d.ts',
  'node_modules/@types/node/fs.d.ts',
  'node_modules/@types/node/fs/promises.d.ts',
  'node_modules/@types/node/globals.d.ts',
  'node_modules/@types/node/globals.typedarray.d.ts',
  'node_modules/@types/node/http.d.ts',
  'node_modules/@types/node/http2.d.ts',
  'node_modules/@types/node/https.d.ts',
  'node_modules/@types/node/index.d.ts',
  'node_modules/@types/node/inspector.d.ts',
  'node_modules/@types/node/inspector.generated.d.ts',
  'node_modules/@types/node/module.d.ts',
  'node_modules/@types/node/net.d.ts',
  'node_modules/@types/node/os.d.ts',
  'node_modules/@types/node/path.d.ts',
  'node_modules/@types/node/perf_hooks.d.ts',
  'node_modules/@types/node/process.d.ts',
  'node_modules/@types/node/punycode.d.ts',
  'node_modules/@types/node/querystring.d.ts',
  'node_modules/@types/node/readline.d.ts',
  'node_modules/@types/node/readline/promises.d.ts',
  'node_modules/@types/node/repl.d.ts',
  'node_modules/@types/node/sea.d.ts',
  'node_modules/@types/node/sqlite.d.ts',
  'node_modules/@types/node/stream.d.ts',
  'node_modules/@types/node/stream/consumers.d.ts',
  'node_modules/@types/node/stream/promises.d.ts',
  'node_modules/@types/node/stream/web.d.ts',
  'node_modules/@types/node/string_decoder.d.ts',
  'node_modules/@types/node/test.d.ts',
  'node_modules/@types/node/timers.d.ts',
  'node_modules/@types/node/timers/promises.d.ts',
  'node_modules/@types/node/tls.d.ts',
  'node_modules/@types/node/trace_events.d.ts',
  'node_modules/@types/node/tty.d.ts',
  'node_modules/@types/node/url.d.ts',
  'node_modules/@types/node/util.d.ts',
  'node_modules/@types/node/v8.d.ts',
  'node_modules/@types/node/vm.d.ts',
  'node_modules/@types/node/wasi.d.ts',
  'node_modules/@types/node/web-globals/abortcontroller.d.ts',
  'node_modules/@types/node/web-globals/crypto.d.ts',
  'node_modules/@types/node/web-globals/domexception.d.ts',
  'node_modules/@types/node/web-globals/events.d.ts',
  'node_modules/@types/node/web-globals/fetch.d.ts',
  'node_modules/@types/node/web-globals/navigator.d.ts',
  'node_modules/@types/node/web-globals/storage.d.ts',
  'node_modules/@types/node/web-globals/streams.d.ts',
  'node_modules/@types/node/worker_threads.d.ts',
  'node_modules/@types/node/zlib.d.ts',
];

/** Actual root undici-types inventory recorded in reviewer preflight (43 files). */
const DEP_UNDICI_FILES = [
  'node_modules/undici-types/agent.d.ts',
  'node_modules/undici-types/api.d.ts',
  'node_modules/undici-types/balanced-pool.d.ts',
  'node_modules/undici-types/cache-interceptor.d.ts',
  'node_modules/undici-types/cache.d.ts',
  'node_modules/undici-types/client-stats.d.ts',
  'node_modules/undici-types/client.d.ts',
  'node_modules/undici-types/connector.d.ts',
  'node_modules/undici-types/content-type.d.ts',
  'node_modules/undici-types/cookies.d.ts',
  'node_modules/undici-types/diagnostics-channel.d.ts',
  'node_modules/undici-types/dispatcher.d.ts',
  'node_modules/undici-types/env-http-proxy-agent.d.ts',
  'node_modules/undici-types/errors.d.ts',
  'node_modules/undici-types/eventsource.d.ts',
  'node_modules/undici-types/fetch.d.ts',
  'node_modules/undici-types/formdata.d.ts',
  'node_modules/undici-types/global-dispatcher.d.ts',
  'node_modules/undici-types/global-origin.d.ts',
  'node_modules/undici-types/h2c-client.d.ts',
  'node_modules/undici-types/handlers.d.ts',
  'node_modules/undici-types/header.d.ts',
  'node_modules/undici-types/index.d.ts',
  'node_modules/undici-types/interceptors.d.ts',
  'node_modules/undici-types/mock-agent.d.ts',
  'node_modules/undici-types/mock-call-history.d.ts',
  'node_modules/undici-types/mock-client.d.ts',
  'node_modules/undici-types/mock-errors.d.ts',
  'node_modules/undici-types/mock-interceptor.d.ts',
  'node_modules/undici-types/mock-pool.d.ts',
  'node_modules/undici-types/patch.d.ts',
  'node_modules/undici-types/pool-stats.d.ts',
  'node_modules/undici-types/pool.d.ts',
  'node_modules/undici-types/proxy-agent.d.ts',
  'node_modules/undici-types/readable.d.ts',
  'node_modules/undici-types/retry-agent.d.ts',
  'node_modules/undici-types/retry-handler.d.ts',
  'node_modules/undici-types/round-robin-pool.d.ts',
  'node_modules/undici-types/snapshot-agent.d.ts',
  'node_modules/undici-types/socks5-proxy-agent.d.ts',
  'node_modules/undici-types/util.d.ts',
  'node_modules/undici-types/utility.d.ts',
  'node_modules/undici-types/websocket.d.ts',
];

/** Exact singleton dependency declarations recorded in reviewer preflight. */
const DEP_BUFFER_FILE = 'node_modules/buffer/index.d.ts';
const DEP_ELECTRON_FILE = 'node_modules/electron/electron.d.ts';

function fail(message) {
  console.error(`[typecheck-preload] FAIL: ${message}`);
  process.exit(1);
}

function readRootManifest() {
  return JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
}

function readInstalledPackageVersion(relDir) {
  const pkgPath = resolve(repoRoot, relDir, 'package.json');
  if (!existsSync(pkgPath)) throw new Error(`installed package metadata missing (${toRepoRel(pkgPath)})`);
  const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  if (typeof version !== 'string' || version.length === 0) throw new Error(`cannot read installed version (${toRepoRel(pkgPath)})`);
  return version;
}

function parseVersionTriple(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(text).trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareTriples(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Require declared/resolved dependency metadata to match. Reads through
 * injectable callbacks so guards exercise this same function with inert
 * synthetic metadata; production calls use the real-file defaults. Throws
 * with the specific reason on any mismatch.
 */
function checkDependencyMetadata(
  label,
  getManifest = readRootManifest,
  getNodeVersion = () => readInstalledPackageVersion('node_modules/@types/node'),
  getElectronVersion = () => readInstalledPackageVersion('node_modules/electron'),
) {
  const manifest = getManifest();
  const declaredNode = manifest?.devDependencies?.['@types/node'];
  const resolvedNode = getNodeVersion();
  const nodeMajor = Number(String(resolvedNode).split('.')[0]);
  if (!declaredNode) throw new Error(`${label}: package.json declares no direct @types/node`);
  if (nodeMajor !== 24) throw new Error(`${label}: resolved Node typings major is ${nodeMajor} (want 24; resolved ${resolvedNode})`);
  if (resolvedNode !== declaredNode) throw new Error(`${label}: resolved @types/node ${resolvedNode} != manifest pin ${declaredNode}`);
  const declaredElectron = manifest?.devDependencies?.electron;
  const resolvedElectron = getElectronVersion();
  const base = declaredElectron && declaredElectron.startsWith('^')
    ? parseVersionTriple(declaredElectron.slice(1))
    : parseVersionTriple(declaredElectron ?? '');
  const resolved = parseVersionTriple(resolvedElectron);
  if (!base || !resolved) throw new Error(`${label}: cannot parse Electron versions (declared ${declaredElectron}, resolved ${resolvedElectron})`);
  if (resolved[0] !== base[0] || compareTriples(resolved, base) < 0) {
    throw new Error(`${label}: installed Electron ${resolvedElectron} does not satisfy manifest range ${declaredElectron}`);
  }
}

/** Effective preload-scope options. Throws on any mismatch. */
function checkPreloadOptions(options, label) {
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
  const libNames = Array.isArray(lib) ? lib.map((entry) => String(entry).split(/[\\/]/).pop().toLowerCase()) : [];
  if (libNames.length !== EXPECTED_LIBS.length || !EXPECTED_LIBS.every((want, i) => libNames[i] === want)) {
    problems.push(`lib=${JSON.stringify(lib)} (want exactly ${JSON.stringify(EXPECTED_LIBS)})`);
  }
  // types must be EXPLICITLY ["node"]; omitted or other entries rejected.
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

/**
 * Pure throwing inventory assertion: require every intended source/own-fixture
 * path, then permit only those paths plus the static pinned-compiler closure
 * and the recorded root dependency declarations (Node/undici/buffer/Electron).
 * Anything else — extra app source, ambient packages, nested Node22, fake
 * Electron declarations, Vite/Manager/global API files — throws naming the
 * unexpected files and label. Returns the file list for reporting; never
 * exits or logs success itself.
 */
function assertPreloadInventory(fileNames, requiredAbsPaths, label) {
  requireFilesPresent(fileNames, requiredAbsPaths, label);
  const allowedMaintained = new Set(requiredAbsPaths.map((p) => resolve(p)));
  const allowedDeclarationDependencies = new Set(DECLARATION_DEPENDENCIES.map((p) => resolve(p)));
  const staticLibs = new Set(STATIC_TS_LIBS);
  const depFiles = new Set([
    ...DEP_NODE_FILES.map((rel) => resolve(repoRoot, rel)),
    ...DEP_UNDICI_FILES.map((rel) => resolve(repoRoot, rel)),
    resolve(repoRoot, DEP_BUFFER_FILE),
    resolve(repoRoot, DEP_ELECTRON_FILE),
  ]);
  const libDir = tsLibDir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const bad = [];
  for (const f of fileNames) {
    const abs = resolve(f);
    if (allowedMaintained.has(abs)) continue;
    if (allowedDeclarationDependencies.has(abs)) continue;
    const normalized = String(f).replace(/\\/g, '/');
    const base = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase();
    if (normalized.toLowerCase().startsWith(`${libDir}/`) && staticLibs.has(base)) continue;
    if (depFiles.has(abs) && normalized.toLowerCase().endsWith('.d.ts')) continue;
    bad.push(toRepoRel(f));
  }
  if (bad.length > 0) {
    throw new Error(`${label}: unexpected files in program (ambient leakage?): ${bad.join(', ')}`);
  }
  return fileNames;
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
  console.log(`[typecheck-preload] ${label} program files (${files.length}):`);
  for (const r of rels) console.log(`  - ${r}`);
  const declarationDependencies = files.filter((file) => DECLARATION_DEPENDENCIES.includes(resolve(file)));
  console.log(`[typecheck-preload] ${label} imported declaration dependencies: ${declarationDependencies.map(toRepoRel).join(', ') || '(none)'}`);
  try {
    assertPreloadInventory(files, requiredAbsPaths, label);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  return files;
}

function checkSourceChecked(program, options, label) {
  const productionSources = label === 'positive' ? [TRANSPORT_SOURCE, PRELOAD_API_SOURCE] : [TRANSPORT_SOURCE];
  for (const sourcePath of productionSources) {
    const sourceFile = program.getSourceFile(sourcePath);
    if (!sourceFile) fail(`${label}: production source file not in program: ${toRepoRel(sourcePath)}`);
    try {
      assertJsChecked(sourceFile, options, ts, `${label}:${toRepoRel(sourcePath)}`);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  }
}

function summarize(d) {
  const file = d.file ? toRepoRel(d.file.fileName) : '<no-file>';
  const line = d.file ? d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1 : 0;
  const message = ts.flattenDiagnosticMessageText(d.messageText, ' ');
  return `${file}(${line}): TS${d.code}: ${message}`;
}

function fixtureLineOf(content, needle) {
  const idx = content.split(/\r?\n/).findIndex((ln) => ln.includes(needle));
  return idx < 0 ? -1 : idx + 1;
}

function checkOptions(options, label) {
  try {
    checkPreloadOptions(options, label);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

function checkMetadata(label) {
  try {
    checkDependencyMetadata(label);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

/** Verify the six intended negative diagnostics. Throws for the exact gap. */
function assertNegativeDiagnostics(fixtureDiags, content, label) {
  const lineChannel = fixtureLineOf(content, 'transport.invoke(42);');
  const lineCallback = fixtureLineOf(content, "(value: string) => value.toUpperCase());");
  const linePromise = fixtureLineOf(content, 'const result: Promise<string> = transport.invoke(');
  const lineMissing = fixtureLineOf(content, '.missing;');
  const lineResult = fixtureLineOf(content, 'const cleanupValue: string = transport.onIpc(');
  const lineManager = fixtureLineOf(content, '__BOROKO_APP_VERSION__');
  if (lineChannel < 0 || lineCallback < 0 || linePromise < 0 || lineMissing < 0 || lineResult < 0 || lineManager < 0) {
    throw new Error(`${label}: cannot locate intended misuse lines`);
  }
  if (fixtureDiags.length !== 6) {
    for (const d of fixtureDiags) console.error(`[typecheck-preload] fixture diagnostic: ${summarize(d)}`);
    throw new Error(`${label}: want exactly 6 diagnostics, found ${fixtureDiags.length} (rejection disappeared?)`);
  }
  const byLine = new Map(fixtureDiags.map((d) => [d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1, d]));
  const expectations = new Map([
    [lineChannel, 2345],
    [lineCallback, 2345],
    [linePromise, 2322],
    [lineMissing, 2339],
    [lineResult, 2322],
    [lineManager, 2304],
  ]);
  for (const [line, code] of expectations) {
    const d = byLine.get(line);
    if (!d) throw new Error(`${label}: missing TS${code} diagnostic on line ${line}`);
    if (d.category !== ts.DiagnosticCategory.Error || d.code !== code) {
      throw new Error(`${label}: diagnostic TS${d.code} != TS${code}: ${summarize(d)}`);
    }
  }
  return { lineChannel, lineCallback, linePromise, lineMissing, lineResult, lineManager };
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
const POSITIVE_ROOTS = [TRANSPORT_SOURCE, PRELOAD_API_SOURCE, VALID_FIXTURE];
const POSITIVE_REQUIRED = [...POSITIVE_ROOTS, DESKTOP_API_TYPES_SOURCE, ADMIN_EXPORT_TYPES_SOURCE, IPC_CONTRACT_TYPES_SOURCE];
for (const p of [...POSITIVE_REQUIRED, PRELOAD_CONFIG]) {
  if (!existsSync(p)) fail(`missing required preload file: ${toRepoRel(p)}`);
}
checkMetadata('positive');
const positive = parseConfig(PRELOAD_CONFIG);
checkOptions(positive.options, 'preload config');
try {
  requireFilesPresent(positive.fileNames, POSITIVE_ROOTS, 'preload config');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
if (positive.fileNames.some((f) => f.endsWith('preload-transport/invalid.ts'))) {
  fail('preload config must not include the negative fixture');
}
const positiveProgram = ts.createProgram(positive.fileNames, positive.options);
checkProgramInventory(positiveProgram, POSITIVE_REQUIRED, 'positive');
checkSourceChecked(positiveProgram, positive.options, 'positive');
const positiveDiags = ts.getPreEmitDiagnostics(positiveProgram);
if (positiveDiags.length !== 0) {
  for (const d of positiveDiags) console.error(`[typecheck-preload] unexpected positive diagnostic: ${summarize(d)}`);
  fail(`positive program has ${positiveDiags.length} diagnostic(s), want 0`);
}
console.log('[typecheck-preload] positive: 0 diagnostics (pass)');

// ---- negative program (compile-only; fixtures contain browser calls, never executed) ----
for (const p of [INVALID_CONFIG, INVALID_FIXTURE]) {
  if (!existsSync(p)) fail(`missing required preload file: ${toRepoRel(p)}`);
}
checkMetadata('negative');
const negative = parseConfig(INVALID_CONFIG);
checkOptions(negative.options, 'negative config');
try {
  requireFilesPresent(negative.fileNames, [TRANSPORT_SOURCE, INVALID_FIXTURE], 'negative config');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
const negativeProgram = ts.createProgram(negative.fileNames, negative.options);
checkProgramInventory(negativeProgram, [TRANSPORT_SOURCE, INVALID_FIXTURE], 'negative');
checkSourceChecked(negativeProgram, negative.options, 'negative');
const negativeDiags = ts.getPreEmitDiagnostics(negativeProgram);
const sourceDiags = negativeDiags.filter((d) => d.file && resolve(d.file.fileName) === resolve(TRANSPORT_SOURCE));
if (sourceDiags.length !== 0) {
  for (const d of sourceDiags) console.error(`[typecheck-preload] production-source diagnostic: ${summarize(d)}`);
  fail(`negative program: production source has ${sourceDiags.length} diagnostic(s), want 0`);
}
const fixtureDiags = negativeDiags.filter((d) => d.file && resolve(d.file.fileName) === resolve(INVALID_FIXTURE));
const otherDiags = negativeDiags.filter((d) => !d.file || (resolve(d.file.fileName) !== resolve(INVALID_FIXTURE) && resolve(d.file.fileName) !== resolve(TRANSPORT_SOURCE)));
if (otherDiags.length !== 0) {
  for (const d of otherDiags) console.error(`[typecheck-preload] unrelated diagnostic: ${summarize(d)}`);
  fail(`negative program: ${otherDiags.length} unrelated diagnostic(s)`);
}
const content = readFileSync(INVALID_FIXTURE, 'utf8');
let lines;
try {
  lines = assertNegativeDiagnostics(fixtureDiags, content, 'negative fixture');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
console.log(`[typecheck-preload] negative: TS2345 lines ${lines.lineChannel},${lines.lineCallback} + TS2322 lines ${lines.linePromise},${lines.lineResult} + TS2339 line ${lines.lineMissing} + TS2304 line ${lines.lineManager} (pass)`);

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
  console.log(`[typecheck-preload] guard PASS ${name}: rejected (${message})`);
}
function expectPass(name, fn) {
  try {
    fn();
  } catch (err) {
    fail(`guard ${name}: expected acceptance, threw: ${err instanceof Error ? err.message : err}`);
  }
  guards += 1;
  console.log(`[typecheck-preload] guard PASS ${name}: accepted`);
}
const base = positive.options;
const liveManifest = readRootManifest();
const liveNodeDecl = liveManifest?.devDependencies?.['@types/node'];
const liveNodeResolved = readInstalledPackageVersion('node_modules/@types/node');
const liveElectronDecl = liveManifest?.devDependencies?.electron;
const liveElectronResolved = readInstalledPackageVersion('node_modules/electron');
const pinnedManifest = () => ({
  devDependencies: { '@types/node': liveNodeDecl, electron: liveElectronDecl },
});
expectPass('baseline-accepted', () => checkPreloadOptions({ ...base }, 'guard'));
expectThrow('wrong-target', () => checkPreloadOptions({ ...base, target: ts.ScriptTarget.ES2020 }, 'guard'), 'target=');
expectThrow('wrong-module', () => checkPreloadOptions({ ...base, module: ts.ModuleKind.ESNext }, 'guard'), 'module=');
expectThrow('wrong-moduleResolution', () => checkPreloadOptions({ ...base, moduleResolution: ts.ModuleResolutionKind.Bundler }, 'guard'), 'moduleResolution=');
expectThrow('omitted-lib', () => checkPreloadOptions({ ...base, lib: ['ES2022', 'DOM'] }, 'guard'), 'lib=');
expectThrow('extra-lib', () => checkPreloadOptions({ ...base, lib: ['ES2022', 'DOM', 'DOM.Iterable', 'WebWorker'] }, 'guard'), 'lib=');
expectThrow('omitted-types', () => {
  const mutated = { ...base };
  delete mutated.types;
  checkPreloadOptions(mutated, 'guard');
}, 'types is missing');
expectThrow('wrong-types', () => checkPreloadOptions({ ...base, types: [] }, 'guard'), 'types=');
expectThrow('checkJs-false', () => checkPreloadOptions({ ...base, checkJs: false }, 'guard'), 'checkJs=');
for (const subOption of STRICT_SUBOPTIONS) {
  expectThrow(`strict-suboption-${subOption}`, () => {
    checkPreloadOptions({ ...base, [subOption]: false }, 'guard');
  }, `${subOption}=`);
}
expectThrow('missing-production-source', () => {
  assertPreloadInventory([VALID_FIXTURE], [TRANSPORT_SOURCE, VALID_FIXTURE], 'guard');
}, 'transport.js');
expectThrow('missing-fixture', () => {
  assertPreloadInventory([TRANSPORT_SOURCE], [TRANSPORT_SOURCE, VALID_FIXTURE], 'guard');
}, 'valid.ts');
expectThrow('missing-shared-ipc-contract', () => {
  const withoutContract = positiveProgram.getSourceFiles().map((source) => resolve(source.fileName)).filter((path) => path !== IPC_CONTRACT_TYPES_SOURCE);
  assertPreloadInventory(withoutContract, POSITIVE_REQUIRED, 'guard');
}, 'desktopIpcContracts.d.ts');
expectThrow('unexpected-app-file', () => {
  assertPreloadInventory(
    [TRANSPORT_SOURCE, VALID_FIXTURE, resolve(repoRoot, 'src/main/domains/fileStore.js')],
    [TRANSPORT_SOURCE, VALID_FIXTURE],
    'guard',
  );
}, 'fileStore.js');
expectThrow('outside-directory-stdlib-impostor', () => {
  assertPreloadInventory(
    [TRANSPORT_SOURCE, VALID_FIXTURE, 'C:/evil/typescript/lib/lib.es2022.d.ts'],
    [TRANSPORT_SOURCE, VALID_FIXTURE],
    'guard',
  );
}, 'lib.es2022.d.ts');
expectThrow('electron-impostor', () => {
  assertPreloadInventory(
    [TRANSPORT_SOURCE, VALID_FIXTURE, 'C:/evil/node_modules/electron/electron.d.ts'],
    [TRANSPORT_SOURCE, VALID_FIXTURE],
    'guard',
  );
}, 'electron.d.ts');
expectThrow('unexpected-pinned-webworker-lib', () => {
  assertPreloadInventory(
    [...positiveProgram.getSourceFiles().map((source) => source.fileName), resolve(tsLibDir, 'lib.webworker.d.ts')],
    POSITIVE_REQUIRED,
    'guard',
  );
}, 'lib.webworker.d.ts');
expectThrow('unexpected-pinned-esnext-lib', () => {
  assertPreloadInventory(
    [...positiveProgram.getSourceFiles().map((source) => source.fileName), resolve(tsLibDir, 'lib.esnext.array.d.ts')],
    POSITIVE_REQUIRED,
    'guard',
  );
}, 'lib.esnext.array.d.ts');
expectPass('inventory-accepted', () => {
  assertPreloadInventory(positiveProgram.getSourceFiles().map((f) => f.fileName), POSITIVE_REQUIRED, 'guard');
});
const unchecked = ts.createSourceFile('transport-check.js', 'export function f(a) { return a; }\n', ts.ScriptTarget.ES2022, true);
try {
  assertJsChecked(unchecked, base, ts, 'guard');
  fail('guard js-directive-absent: unchecked source accepted');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes('not checked')) fail(`guard js-directive-absent: wrong rejection: ${message}`);
  guards += 1;
  console.log(`[typecheck-preload] guard PASS js-directive-absent: rejected (${message})`);
}
// Metadata probes call the SAME real validator with inert readers/values.
expectPass('metadata-accepted', () => {
  checkDependencyMetadata(
    'guard',
    pinnedManifest,
    () => liveNodeResolved,
    () => liveElectronResolved,
  );
  if (liveNodeDecl !== '24.19.1' || liveNodeResolved !== '24.19.1' || liveElectronDecl !== '^42.10.0' || liveElectronResolved !== '42.11.10') {
    fail(`guard metadata-accepted: live metadata drifted (node ${liveNodeDecl}/${liveNodeResolved}, electron ${liveElectronDecl}/${liveElectronResolved}); update these guard cases, do not weaken them`);
  }
});
expectThrow('metadata-wrong-node-major', () => {
  checkDependencyMetadata('guard', pinnedManifest, () => '25.5.0', () => liveElectronResolved);
}, 'major is 25');
expectThrow('metadata-missing-node-declaration', () => {
  checkDependencyMetadata('guard', () => ({ devDependencies: { electron: liveElectronDecl } }), () => liveNodeResolved, () => liveElectronResolved);
}, 'declares no direct @types/node');
expectThrow('metadata-node-pin-mismatch', () => {
  checkDependencyMetadata('guard', pinnedManifest, () => (liveNodeDecl === '24.19.0' ? '24.19.1' : '24.19.0'), () => liveElectronResolved);
}, '!= manifest pin');
expectThrow('metadata-wrong-electron-major', () => {
  checkDependencyMetadata('guard', pinnedManifest, () => liveNodeResolved, () => '43.0.0');
}, 'does not satisfy manifest range');

// ---- integrated probes on in-memory variants (actual files untouched) ----
const realSourceText = readFileSync(TRANSPORT_SOURCE, 'utf8');

// Probe 1: a forbidden esnext.array triple-slash reference on a virtual
// positive fixture must add ONLY lib.esnext.array.d.ts with ZERO compiler
// diagnostics, so the actual inventory safeguard — not a diagnostic
// accident — supplies the rejection naming it.
const forbiddenRefText = `/// <reference lib="esnext.array" />\n${readFileSync(VALID_FIXTURE, 'utf8')}`;
const forbiddenProgram = createVariantProgram(
  [TRANSPORT_SOURCE, VALID_FIXTURE],
  base,
  new Map([[VALID_FIXTURE, forbiddenRefText]]),
);
{
  const forbiddenDiags = ts.getPreEmitDiagnostics(forbiddenProgram);
  if (forbiddenDiags.length !== 0) {
    for (const d of forbiddenDiags) console.error(`[typecheck-preload] forbidden-probe diagnostic: ${summarize(d)}`);
    fail(`integrated forbidden-library probe: virtual reference caused ${forbiddenDiags.length} compiler diagnostic(s), want 0`);
  }
  const files = forbiddenProgram.getSourceFiles().map((f) => f.fileName);
  const added = files.filter((f) => !positiveProgram.getSourceFiles().some((p) => resolve(p.fileName) === resolve(f)));
  const addedRels = added.map(toRepoRel).sort();
  if (addedRels.length !== 1 || !addedRels[0].endsWith('lib.esnext.array.d.ts')) {
    fail(`integrated forbidden-library probe: expected only lib.esnext.array.d.ts added, found: ${addedRels.join(', ') || 'none'}`);
  }
  try {
    assertPreloadInventory(files, [TRANSPORT_SOURCE, VALID_FIXTURE], 'integrated-forbidden-library');
    fail('integrated forbidden-library probe: forbidden reference silently accepted');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('lib.esnext.array.d.ts') || !message.includes('unexpected files')) {
      fail(`integrated forbidden-library probe: wrong rejection: ${message}`);
    }
    guards += 1;
    console.log(`[typecheck-preload] guard PASS integrated-forbidden-library: rejected (${message})`);
  }
}

// Probe 2: absent @ts-check in a production variant — the real assertJsChecked
// against a real program object must report the file as unchecked.
const noDirectiveText = realSourceText.replace('// @ts-check\n', '');
if (noDirectiveText === realSourceText) fail('integrated directive probe: cannot locate the active @ts-check line');
const noDirectiveProgram = createVariantProgram(
  [TRANSPORT_SOURCE, INVALID_FIXTURE],
  negative.options,
  new Map([[TRANSPORT_SOURCE, noDirectiveText]]),
);
const noDirectiveFile = noDirectiveProgram.getSourceFile(TRANSPORT_SOURCE);
if (!noDirectiveFile) fail('integrated directive probe: variant source missing from program');
try {
  assertJsChecked(noDirectiveFile, negative.options, ts, 'integrated-directive-probe');
  fail('integrated directive probe: unchecked variant accepted');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes('not checked')) fail(`integrated directive probe: wrong rejection: ${message}`);
  guards += 1;
  console.log(`[typecheck-preload] guard PASS integrated-directive-absent: rejected (${message})`);
}

// Probe 3: a real output-contract rejection disappearing — change the numeric
// number annotation to string in an in-memory fixture while retaining the
// original full marker in a same-line comment. Actual source stays error-free
// while the SAME assertNegativeDiagnostics used above fails 6 -> 5 for that
// gap. Never compensate with another error.
const benignInvalidText = content.replace(
  'transport.invoke(42);',
  "transport.invoke('review:probe'); // transport.invoke(42);",
);
if (benignInvalidText === content) fail('integrated benign probe: cannot locate the channel misuse line');
const benignProgram = createVariantProgram(
  [TRANSPORT_SOURCE, INVALID_FIXTURE],
  negative.options,
  new Map([[INVALID_FIXTURE, benignInvalidText]]),
);
const benignDiags = ts.getPreEmitDiagnostics(benignProgram);
const benignSourceDiags = benignDiags.filter((d) => d.file && resolve(d.file.fileName) === resolve(TRANSPORT_SOURCE));
if (benignSourceDiags.length !== 0) {
  for (const d of benignSourceDiags) console.error(`[typecheck-preload] benign-probe source diagnostic: ${summarize(d)}`);
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
  console.log(`[typecheck-preload] guard PASS integrated-rejection-disappearance: rejected (${message})`);
}

console.log(`[typecheck-preload] OK: 2/2 programs matched (1 positive + 1 negative) + ${guards} guard cases.`);
