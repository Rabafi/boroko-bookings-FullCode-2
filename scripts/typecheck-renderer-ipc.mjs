/**
 * Strict browser-only checking for the desktop renderer's real IPC callers.
 *
 * The caller inventory is a reviewed root list, not a glob that silently
 * widens into the unrelated remaining renderer migration. Imported local
 * JavaScript is reported separately; checkJs:true makes it genuinely checked
 * when present in the TypeScript program.
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  assertJsChecked,
  STRICT_SUBOPTIONS,
} from './typecheck-pilot-checks.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
if (ts.version !== '5.9.3') {
  console.error(`[typecheck-renderer-ipc] FAIL: TypeScript ${ts.version}, want 5.9.3`);
  process.exit(2);
}
const tsLibDir = dirname(require.resolve('typescript'));
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDirectory = resolve(repoRoot, 'docs/engineering/typescript-migration/evidence');
const toRel = (p) => relative(repoRoot, p).split(sep).join('/');
const configPath = resolve(repoRoot, 'tsconfig.typecheck-renderer-ipc.json');
const invalidConfigPath = resolve(repoRoot, 'tsconfig.typecheck-renderer-ipc.invalid.json');
const inventoryPath = resolve(repoRoot, 'docs/engineering/typescript-migration/evidence/L02-renderer-ipc-caller-inventory-2026-10-14.txt');
const apiTypesPath = resolve(repoRoot, 'src/renderer/src/types/desktop-api.d.ts');
const positiveFixture = resolve(repoRoot, 'tests/typecheck/renderer-desktop-api/valid.ts');
const negativeFixture = resolve(repoRoot, 'tests/typecheck/renderer-desktop-api/invalid.ts');
const inventorySha256 = '30C24B5C0380AB1982FD24D68EE37E9A708669CFE29C0C8D81B0D4EF80BA0F6B';

function fail(message) {
  console.error(`[typecheck-renderer-ipc] FAIL: ${message}`);
  process.exit(1);
}

function readJsonConfig(path) {
  if (!existsSync(path)) fail(`missing config: ${toRel(path)}`);
  const result = ts.readConfigFile(path, (name) => readFileSync(name, 'utf8'));
  if (result.error) fail(`${toRel(path)}: ${ts.flattenDiagnosticMessageText(result.error.messageText, ' ')}`);
  const parsed = ts.parseJsonConfigFileContent(result.config, ts.sys, dirname(path));
  if (parsed.errors.length) fail(`${toRel(path)}: ${ts.flattenDiagnosticMessageText(parsed.errors[0].messageText, ' ')}`);
  return parsed;
}

function readCallerInventory() {
  const raw = readFileSync(inventoryPath, 'utf8');
  const hash = createHash('sha256').update(raw).digest('hex').toUpperCase();
  if (hash !== inventorySha256) fail(`reviewed caller inventory hash changed (${hash}); reconcile the inventory deliberately`);
  const files = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => resolve(repoRoot, line));
  if (files.length !== 170 || new Set(files).size !== files.length) fail(`caller inventory has ${files.length} entries or duplicates; expected 170 unique paths`);
  for (const file of files) {
    if (!existsSync(file)) fail(`caller path missing: ${toRel(file)}`);
    if (!/^\.(?:js|jsx|ts|tsx)$/i.test(extname(file))) fail(`unexpected caller extension: ${toRel(file)}`);
  }
  return files;
}

function validateOptions(options, label) {
  const errors = [];
  const equals = (key, expected) => {
    if (options[key] !== expected) errors.push(`${key}=${options[key]} (want ${expected})`);
  };
  equals('strict', true);
  equals('allowJs', true);
  equals('checkJs', false);
  equals('noEmit', true);
  equals('skipLibCheck', false);
  equals('forceConsistentCasingInFileNames', true);
  equals('target', ts.ScriptTarget.ES2022);
  equals('module', ts.ModuleKind.ESNext);
  equals('moduleResolution', ts.ModuleResolutionKind.Bundler);
  equals('jsx', ts.JsxEmit.ReactJSX);
  const libs = (options.lib ?? []).map((v) => String(v).split(/[\\/]/).pop().toLowerCase());
  const expectedLibs = ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'];
  if (JSON.stringify(libs) !== JSON.stringify(expectedLibs)) errors.push(`lib=${JSON.stringify(libs)} (want ${JSON.stringify(expectedLibs)})`);
  if (JSON.stringify(options.types) !== JSON.stringify(['react', 'react-dom'])) errors.push(`types=${JSON.stringify(options.types)} (want ["react","react-dom"])`);
  const expectedTypeRoots = [resolve(repoRoot, 'manager-pwa/node_modules/@types')];
  if (JSON.stringify((options.typeRoots ?? []).map((root) => resolve(root))) !== JSON.stringify(expectedTypeRoots)) {
    errors.push(`typeRoots=${JSON.stringify(options.typeRoots)} (want the isolated Manager React 19 declaration root)`);
  }
  const paths = options.paths ?? {};
  if (JSON.stringify(paths['@renderer/*']) !== JSON.stringify(['src/renderer/src/*'])) errors.push('paths[@renderer/*] must resolve to src/renderer/src/*');
  for (const [alias, target] of Object.entries({
    react: ['manager-pwa/node_modules/@types/react/index.d.ts'],
    'react/*': ['manager-pwa/node_modules/@types/react/*'],
    'react-dom': ['manager-pwa/node_modules/@types/react-dom/index.d.ts'],
    'react-dom/*': ['manager-pwa/node_modules/@types/react-dom/*'],
  })) {
    if (JSON.stringify(paths[alias]) !== JSON.stringify(target)) errors.push(`paths[${alias}] must resolve to the isolated React 19 declarations`);
  }
  if (!options.baseUrl || resolve(repoRoot, options.baseUrl) !== repoRoot) errors.push(`baseUrl=${options.baseUrl} (want repository root)`);
  for (const option of STRICT_SUBOPTIONS) if (options[option] === false) errors.push(`${option}=false`);
  if (errors.length) fail(`${label}: invalid effective options: ${errors.join('; ')}`);
}

function requireProgramSources(program, required, label) {
  const sourceFiles = program.getSourceFiles();
  const have = new Set(sourceFiles.map((source) => resolve(source.fileName)));
  for (const file of required) if (!have.has(resolve(file))) fail(`${label}: required source excluded from actual program: ${toRel(file)}`);
  const options = program.getCompilerOptions();
  if (label === 'positive') {
    const jsCallers = callers.filter((file) => /\.(?:js|jsx)$/i.test(extname(file)));
    for (const file of jsCallers) {
      const source = program.getSourceFile(file);
      if (!source) fail(`${label}: JavaScript IPC caller excluded from actual program: ${toRel(file)}`);
      try {
        assertJsChecked(source, options, ts, `${label}:${toRel(file)}`);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    }
  }
  const forbidden = sourceFiles.map((source) => source.fileName.replace(/\\/g, '/').toLowerCase()).filter((name) =>
    name.includes('/@types/node/') || name.includes('/node_modules/electron/') || name.includes('/@types/electron/'));
  if (forbidden.length) fail(`${label}: Node/Electron declarations leaked into browser program: ${forbidden.map(toRel).join(', ')}`);
  if (!sourceFiles.some((source) => resolve(source.fileName).toLowerCase() === resolve(tsLibDir, 'lib.dom.d.ts').toLowerCase()) ||
      !sourceFiles.some((source) => resolve(source.fileName).toLowerCase() === resolve(tsLibDir, 'lib.dom.iterable.d.ts').toLowerCase())) {
    fail(`${label}: expected real pinned DOM standard libraries are missing`);
  }
  const callerSet = new Set(callers.map((file) => resolve(file)));
  const importedLocalJs = sourceFiles.filter((source) => {
    const normalized = resolve(source.fileName).replace(/\\/g, '/');
    return normalized.startsWith(`${repoRoot.replace(/\\/g, '/')}/src/`) && /\.jsx?$/i.test(normalized) && !callerSet.has(resolve(source.fileName));
  });
  const checkedImported = importedLocalJs.filter((source) => ts.isCheckJsEnabledForFile(source, options));
  const uncheckedImported = importedLocalJs.filter((source) => !ts.isCheckJsEnabledForFile(source, options));
  console.log(`[typecheck-renderer-ipc] ${label} actual program files: ${sourceFiles.length}; caller roots: ${callerSet.size}; imported local JS outside caller inventory: ${importedLocalJs.length} (${checkedImported.length} opt-in checked; ${uncheckedImported.length} unchecked and not counted as caller coverage)`);
  for (const source of importedLocalJs) console.log(`  imported ${checkedImported.includes(source) ? 'checked' : 'unchecked'}: ${toRel(source.fileName)}`);
  return sourceFiles;
}

function diagnosticsFor(program) {
  return ts.getPreEmitDiagnostics(program);
}

function formatDiagnostic(diagnostic) {
  const file = diagnostic.file ? toRel(diagnostic.file.fileName) : '<no-file>';
  const line = diagnostic.file ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1 : 0;
  return `${file}(${line}) TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`;
}

const callers = readCallerInventory();
for (const file of [apiTypesPath, positiveFixture, negativeFixture]) if (!existsSync(file)) fail(`missing required contract source: ${toRel(file)}`);

const positiveConfig = readJsonConfig(configPath);
const negativeConfig = readJsonConfig(invalidConfigPath);
validateOptions(positiveConfig.options, 'positive config');
validateOptions(negativeConfig.options, 'negative config');
if (positiveConfig.fileNames.some((file) => resolve(file) === negativeFixture)) fail('positive config includes negative fixture');
if (negativeConfig.fileNames.some((file) => resolve(file) === positiveFixture)) fail('negative config includes positive fixture');

let positiveFailed = false;
for (const [label, parsed, fixture] of [['positive', positiveConfig, positiveFixture], ['negative', negativeConfig, negativeFixture]]) {
  // The positive program owns complete caller coverage. Negative contract
  // examples need only the shared Window.api declaration and fixture; adding
  // every application root would repeat the expensive positive diagnostics.
  const roots = label === 'positive' ? [...parsed.fileNames, ...callers] : parsed.fileNames;
  const program = ts.createProgram(roots, parsed.options);
  requireProgramSources(program, label === 'positive' ? [...callers, apiTypesPath, fixture] : [apiTypesPath, fixture], label);
  const diagnostics = diagnosticsFor(program);
  if (label === 'positive') {
    const callerRoots = callers.map((file) => resolve(file));
    const rootsWithErrors = new Set(diagnostics.filter((diagnostic) => diagnostic.file).map((diagnostic) => resolve(diagnostic.file.fileName)));
    const cleanCallerRootPaths = callerRoots.filter((file) => !rootsWithErrors.has(file));
    const cleanCallerRoots = cleanCallerRootPaths.length;
    const actualProgramSources = program.getSourceFiles();
    const callerSet = new Set(callerRoots);
    const importedLocalJs = actualProgramSources.filter((source) => {
      const normalized = resolve(source.fileName).replace(/\\/g, '/');
      return normalized.startsWith(`${repoRoot.replace(/\\/g, '/')}/src/`) && /\.jsx?$/i.test(normalized) && !callerSet.has(resolve(source.fileName));
    });
    const checkedImported = importedLocalJs.filter((source) => ts.isCheckJsEnabledForFile(source, parsed.options));
    const uncheckedImported = importedLocalJs.filter((source) => !ts.isCheckJsEnabledForFile(source, parsed.options));
    const byCode = new Map();
    const diagnosticRecords = diagnostics.map((diagnostic) => {
      byCode.set(diagnostic.code, (byCode.get(diagnostic.code) ?? 0) + 1);
      const start = diagnostic.start ?? null;
      const location = diagnostic.file && start !== null
        ? diagnostic.file.getLineAndCharacterOfPosition(start)
        : null;
      return {
        recordType: 'diagnostic',
        path: diagnostic.file ? toRel(diagnostic.file.fileName) : null,
        line: location ? location.line + 1 : null,
        column: location ? location.character + 1 : null,
        start,
        length: diagnostic.length ?? null,
        code: diagnostic.code,
        category: ts.DiagnosticCategory[diagnostic.category]?.toLowerCase() ?? String(diagnostic.category),
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      };
    });
    if (diagnosticRecords.length !== diagnostics.length) fail('renderer diagnostic sidecar count mismatch');
    const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    const diagnosticsPath = resolve(evidenceDirectory, `L02-renderer-ipc-diagnostics-${timestamp}.jsonl`);
    const diagnosticMetadata = {
      recordType: 'metadata',
      profile: 'L02-renderer-ipc-positive',
      typescriptVersion: ts.version,
      configPath: toRel(configPath),
      configSha256: createHash('sha256').update(readFileSync(configPath)).digest('hex'),
      callerInventoryPath: toRel(inventoryPath),
      callerInventorySha256: createHash('sha256').update(readFileSync(inventoryPath)).digest('hex'),
      inventory: {
        callerRoots: callerRoots.length,
        actualProgramSourceFiles: actualProgramSources.length,
        importedLocalJavaScriptOutsideCallerRoots: importedLocalJs.length,
        importedLocalJavaScriptChecked: checkedImported.length,
        importedLocalJavaScriptUncheckedAndNotCounted: uncheckedImported.length,
        callerRootsWithDiagnostics: callerRoots.length - cleanCallerRoots,
        callerRootsWithoutDiagnostics: cleanCallerRoots,
      },
      diagnosticCount: diagnostics.length,
      countsByCode: Object.fromEntries([...byCode].map(([code, count]) => [`TS${code}`, count])),
    };
    mkdirSync(evidenceDirectory, { recursive: true });
    const diagnosticLines = [diagnosticMetadata, ...diagnosticRecords].map((record) => JSON.stringify(record));
    if (diagnosticLines.length - 1 !== diagnostics.length) fail('renderer diagnostic sidecar length does not match reported diagnostic count');
    writeFileSync(diagnosticsPath, `${diagnosticLines.join('\n')}\n`);
    console.log(`[typecheck-renderer-ipc] complete diagnostic sidecar: ${toRel(diagnosticsPath)} (${diagnosticRecords.length} records)`);
    console.log(`[typecheck-renderer-ipc] caller roots with zero diagnostics: ${cleanCallerRoots}/${callerRoots.length}`);
    if (cleanCallerRootPaths.length) {
      console.log(`[typecheck-renderer-ipc] clean caller roots: ${cleanCallerRootPaths.map(toRel).join(', ')}`);
    }
    if (diagnostics.length) {
      const byFile = new Map();
      const byCode = new Map();
      for (const diagnostic of diagnostics) {
        const file = diagnostic.file ? toRel(diagnostic.file.fileName) : '<no-file>';
        const fileEntry = byFile.get(file) ?? { count: 0, samples: [] };
        fileEntry.count += 1;
        if (fileEntry.samples.length < 3) fileEntry.samples.push(formatDiagnostic(diagnostic));
        byFile.set(file, fileEntry);
        byCode.set(diagnostic.code, (byCode.get(diagnostic.code) ?? 0) + 1);
      }
      console.error(`[typecheck-renderer-ipc] diagnostic codes: ${[...byCode].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([code, count]) => `TS${code}=${count}`).join(', ')}`);
      for (const [file, entry] of [...byFile].sort((a, b) => b[1].count - a[1].count).slice(0, 60)) {
        console.error(`[typecheck-renderer-ipc] ${file}: ${entry.count}`);
        for (const sample of entry.samples) console.error(`  ${sample}`);
      }
      console.error(`[typecheck-renderer-ipc] positive desktop IPC program has ${diagnostics.length} diagnostics; continuing to the negative contract fixture`);
      positiveFailed = true;
    }
    if (!diagnostics.length) console.log('[typecheck-renderer-ipc] positive: 0 diagnostics');
  } else {
    const fixtureDiagnostics = diagnostics.filter((d) => d.file && resolve(d.file.fileName) === resolve(negativeFixture));
    const unrelated = diagnostics.filter((d) => !d.file || resolve(d.file.fileName) !== resolve(negativeFixture));
    if (unrelated.length) {
      for (const diagnostic of unrelated.slice(0, 50)) console.error(`[typecheck-renderer-ipc] unrelated: ${formatDiagnostic(diagnostic)}`);
      fail(`negative program has ${unrelated.length} non-fixture diagnostic(s)`);
    }
    const content = readFileSync(negativeFixture, 'utf8');
    const requiredMisuses = [
      "api.bookings.updatePayment('booking-1', 10, 'cash')",
      "api.inventory.adjustStock('item-1', '-1'",
      "api.restaurantAccountingV2.invoke('unregisteredMutation')",
      'const numericHardwareResult: HardwareSettingsResult = 42',
      "const stringHardwareResult: HardwareSettingsResult = 'not a settings object'",
      'const unvalidatedQueueRow: string = syncDetailsResult.pending[0]',
      'const unvalidatedBookingId: string = syncStatusResult.financialPendingBookingIds[0]',
      'const incompleteOfflineModeResult: OfflineModeResult = { enabled: true }',
      "const malformedShellResult: ShellOpenExternalResult = { success: true, error: 'unexpected' }",
      'const unvalidatedScannerError: string = barcodeScannerResult.error',
      'const invalidProgressCounter: string = progress.bytesPerSecond',
      'process.version',
      'Buffer.from',
      'ipcRenderer',
      'const badVersion: number = api.app.getVersion()',
    ];
    for (const misuse of requiredMisuses) if (!content.includes(misuse)) fail(`negative fixture missing intended misuse: ${misuse}`);
    const unusedExpectations = fixtureDiagnostics.filter((d) => d.code === 2578);
    if (unusedExpectations.length) {
      for (const diagnostic of unusedExpectations) console.error(`[typecheck-renderer-ipc] disappeared rejection: ${formatDiagnostic(diagnostic)}`);
      fail(`${unusedExpectations.length} @ts-expect-error assertion(s) became unused`);
    }
    const unsuppressed = fixtureDiagnostics.filter((d) => d.code !== 2322);
    if (unsuppressed.length) {
      for (const diagnostic of unsuppressed) console.error(`[typecheck-renderer-ipc] unexpected fixture diagnostic: ${formatDiagnostic(diagnostic)}`);
      fail(`${unsuppressed.length} unexpected negative-fixture diagnostic(s)`);
    }
    const badVersionLine = content.split(/\r?\n/).findIndex((line) => line.includes('const badVersion: number = api.app.getVersion()')) + 1;
    if (fixtureDiagnostics.length !== 1 || fixtureDiagnostics[0]?.code !== 2322 || fixtureDiagnostics[0]?.file?.getLineAndCharacterOfPosition(fixtureDiagnostics[0].start ?? 0).line + 1 !== badVersionLine) {
      for (const diagnostic of fixtureDiagnostics) console.error(`[typecheck-renderer-ipc] fixture diagnostic: ${formatDiagnostic(diagnostic)}`);
      fail('negative program did not retain exactly the intended TS2322 badVersion rejection and compile-only @ts-expect-error checks');
    }
    console.log(`[typecheck-renderer-ipc] negative: TS2322 badVersion line ${badVersionLine}; updater/API, Node and Electron misuse expectations remain active`);
  }
}

if (positiveFailed) process.exitCode = 1;

