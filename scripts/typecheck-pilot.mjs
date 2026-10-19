/**
 * Pilot typecheck self-check runner (B01, required by PLAN §18.5).
 *
 * Uses the pinned local TypeScript compiler API (no npx fallback).
 * - Positive config must be diagnostic-free.
 * - Negative fixtures must fail for the *intended* diagnostics only
 *   (file + line + category + code), never for a missing import or config error.
 * - Exits nonzero when an expected rejection disappears or fixtures are excluded.
 * - Never imports or executes negative fixtures at runtime.
 */
import { createRequire } from 'node:module';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import {
  assertPilotOptions,
  assertJsChecked,
  isStdLibFile,
} from './typecheck-pilot-checks.mjs';

const require = createRequire(import.meta.url);
let ts;
try {
  ts = require('typescript');
} catch (err) {
  console.error(`[typecheck-pilot] FAIL: cannot load pinned local 'typescript' dependency: ${err?.message ?? err}`);
  process.exit(2);
}
// Genuine pinned-compiler library directory (…/node_modules/typescript/lib).
let tsLibDir;
try {
  tsLibDir = dirname(require.resolve('typescript'));
} catch (err) {
  console.error(`[typecheck-pilot] FAIL: cannot resolve pinned local 'typescript' library directory: ${err?.message ?? err}`);
  process.exit(2);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const toRepoRel = (p) => relative(repoRoot, p).split(sep).join('/');

const POSITIVE_CONFIG = resolve(repoRoot, 'tsconfig.typecheck-pilot.json');
const PRODUCT_SOURCE = resolve(repoRoot, 'packages/product-config/index.js');
const VALID_FIXTURE = resolve(repoRoot, 'tests/typecheck/product-config/valid.ts');
const NEGATIVES = [
  {
    name: 'invalid-product-id',
    config: resolve(repoRoot, 'tests/typecheck/product-config/tsconfig.invalid-product-id.json'),
    fixture: resolve(repoRoot, 'tests/typecheck/product-config/invalid-product-id.ts'),
    kind: 'invalid-id',
  },
  {
    name: 'readonly-products',
    config: resolve(repoRoot, 'tests/typecheck/product-config/tsconfig.readonly-products.json'),
    fixture: resolve(repoRoot, 'tests/typecheck/product-config/readonly-products.ts'),
    kind: 'readonly',
  },
];

function fail(message) {
  console.error(`[typecheck-pilot] FAIL: ${message}`);
  process.exit(1);
}

function parseConfig(configPath) {
  if (!existsSync(configPath)) fail(`missing config file: ${toRepoRel(configPath)}`);
  const readResult = ts.readConfigFile(configPath, (p) => readFileSync(p, 'utf8'));
  if (readResult.error) {
    fail(`config parse error in ${toRepoRel(configPath)}: ${ts.flattenDiagnosticMessageText(readResult.error.messageText, ' ')}`);
  }
  const basePath = dirname(configPath);
  const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, basePath);
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    fail(`config parse error in ${toRepoRel(configPath)}: ${ts.flattenDiagnosticMessageText(first.messageText, ' ')}`);
  }
  return parsed;
}

function checkPilotOptions(options, label) {
  try {
    assertPilotOptions(options, ts, label);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

function checkProductionChecked(program, options, label) {
  const sourceFile = program.getSourceFile(PRODUCT_SOURCE);
  if (!sourceFile) fail(`${label}: production source file not in program: ${toRepoRel(PRODUCT_SOURCE)}`);
  try {
    assertJsChecked(sourceFile, options, ts, label);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

function checkProgramInventory(program, requiredAbsPaths, label) {
  const files = program.getSourceFiles().map((f) => f.fileName);
  const rels = files.map(toRepoRel).sort();
  console.log(`[typecheck-pilot] ${label} program files (${files.length}):`);
  for (const r of rels) console.log(`  - ${r}`);
  for (const req of requiredAbsPaths) {
    const found = files.some((f) => resolve(f) === req);
    if (!found) fail(`${label}: required file missing from program: ${toRepoRel(req)}`);
  }
  // Reject unexpected maintained application files. Only the pilot source,
  // its fixture, and compiler standard libs may appear.
  const allowed = new Set(requiredAbsPaths.map((p) => resolve(p)));
  const bad = [];
  for (const f of files) {
    const abs = resolve(f);
    if (allowed.has(abs)) continue;
    if (isStdLibFile(f, tsLibDir)) continue;
    bad.push(toRepoRel(f));
  }
  if (bad.length > 0) {
    fail(`${label}: unexpected maintained/app files in program (broad include?): ${bad.join(', ')}`);
  }
  return files;
}

function summarize(d) {
  const file = d.file ? toRepoRel(d.file.fileName) : '<no-file>';
  const line = d.file ? d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1 : 0;
  return `${file}(${line}): code TS${d.code} category=${d.category === ts.DiagnosticCategory.Error ? 'error' : d.category}`;
}

function fixtureLineOf(content, needle, occurrence = 1) {
  const lines = content.split(/\r?\n/);
  let seen = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(needle)) {
      seen += 1;
      if (seen === occurrence) return i + 1;
    }
  }
  return -1;
}

// ---- positive config ----
for (const p of [PRODUCT_SOURCE, VALID_FIXTURE, POSITIVE_CONFIG]) {
  if (!existsSync(p)) fail(`missing required pilot file: ${toRepoRel(p)}`);
}
const positive = parseConfig(POSITIVE_CONFIG);
checkPilotOptions(positive.options, 'positive config');
// Explicit files make a missing fixture an error: require both entries present.
const positiveFiles = new Set(positive.fileNames.map((f) => resolve(f)));
if (!positiveFiles.has(resolve(PRODUCT_SOURCE))) fail('positive config does not list packages/product-config/index.js');
if (!positiveFiles.has(resolve(VALID_FIXTURE))) fail('positive config does not list tests/typecheck/product-config/valid.ts');
if (positive.fileNames.some((f) => f.endsWith('invalid-product-id.ts') || f.endsWith('readonly-products.ts'))) {
  fail('positive config must not include negative fixtures');
}
const positiveProgram = ts.createProgram(positive.fileNames, positive.options);
checkProgramInventory(positiveProgram, [PRODUCT_SOURCE, VALID_FIXTURE], 'positive');
checkProductionChecked(positiveProgram, positive.options, 'positive');
const positiveDiags = ts.getPreEmitDiagnostics(positiveProgram);
if (positiveDiags.length !== 0) {
  for (const d of positiveDiags) console.error(`[typecheck-pilot] unexpected positive diagnostic: ${summarize(d)}`);
  fail(`positive config has ${positiveDiags.length} diagnostic(s), want 0`);
}
console.log('[typecheck-pilot] positive: 0 diagnostics (pass)');

// ---- negative configs ----
let checked = 1; // positive
for (const neg of NEGATIVES) {
  if (!existsSync(neg.config)) fail(`missing negative config: ${toRepoRel(neg.config)}`);
  if (!existsSync(neg.fixture)) fail(`missing negative fixture: ${toRepoRel(neg.fixture)}`);
  const parsed = parseConfig(neg.config);
  checkPilotOptions(parsed.options, `negative config ${neg.name}`);
  const names = new Set(parsed.fileNames.map((f) => resolve(f)));
  if (!names.has(resolve(PRODUCT_SOURCE))) fail(`negative config ${neg.name} excludes the production source`);
  if (!names.has(resolve(neg.fixture))) fail(`negative config ${neg.name} excludes its fixture ${toRepoRel(neg.fixture)}`);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  checkProgramInventory(program, [PRODUCT_SOURCE, neg.fixture], `negative:${neg.name}`);
  checkProductionChecked(program, parsed.options, `negative:${neg.name}`);
  const diags = ts.getPreEmitDiagnostics(program);
  // Production source must stay diagnostic-free inside negative programs.
  const sourceDiags = diags.filter((d) => d.file && resolve(d.file.fileName) === resolve(PRODUCT_SOURCE));
  if (sourceDiags.length !== 0) {
    for (const d of sourceDiags) console.error(`[typecheck-pilot] production-source diagnostic in ${neg.name}: ${summarize(d)}`);
    fail(`negative ${neg.name}: production source has ${sourceDiags.length} diagnostic(s), want 0`);
  }
  const fixtureDiags = diags.filter((d) => d.file && resolve(d.file.fileName) === resolve(neg.fixture));
  const otherDiags = diags.filter((d) => !d.file || (resolve(d.file.fileName) !== resolve(neg.fixture) && resolve(d.file.fileName) !== resolve(PRODUCT_SOURCE)));
  if (otherDiags.length !== 0) {
    for (const d of otherDiags) console.error(`[typecheck-pilot] unrelated diagnostic in ${neg.name}: ${summarize(d)}`);
    fail(`negative ${neg.name}: ${otherDiags.length} unrelated diagnostic(s) (missing import/config/ambient?)`);
  }
  const content = readFileSync(neg.fixture, 'utf8');

  if (neg.kind === 'invalid-id') {
    // Two intended assignments, normally TS2322 each.
    const line1 = fixtureLineOf(content, 'invalidDefinitionId', 1);
    // The declaration line contains both the name and the bad literal; locate via literal occurrence.
    const badLines = [];
    content.split(/\r?\n/).forEach((ln, idx) => {
      if (ln.includes('"unsupported-product"')) badLines.push(idx + 1);
    });
    if (badLines.length !== 2) fail(`negative ${neg.name}: fixture should contain exactly 2 bad literals, found ${badLines.length}`);
    if (fixtureDiags.length !== 2) {
      for (const d of fixtureDiags) console.error(`[typecheck-pilot] fixture diagnostic: ${summarize(d)}`);
      fail(`negative ${neg.name}: want exactly 2 fixture diagnostics, found ${fixtureDiags.length} (rejection disappeared?)`);
    }
    const gotLines = fixtureDiags.map((d) => d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1).sort((a, b) => a - b);
    const wantLines = [...badLines].sort((a, b) => a - b);
    void line1;
    if (gotLines.join(',') !== wantLines.join(',')) {
      fail(`negative ${neg.name}: diagnostic lines [${gotLines.join(',')}] != intended [${wantLines.join(',')}]`);
    }
    for (const d of fixtureDiags) {
      if (d.category !== ts.DiagnosticCategory.Error) fail(`negative ${neg.name}: diagnostic is not an error: ${summarize(d)}`);
      if (d.code !== 2322) fail(`negative ${neg.name}: diagnostic code TS${d.code} != TS2322: ${summarize(d)}`);
    }
    console.log(`[typecheck-pilot] negative:${neg.name}: 2x TS2322 on lines ${wantLines.join(',')} (pass)`);
  } else if (neg.kind === 'readonly') {
    const lineAssign = fixtureLineOf(content, 'PRODUCTS.hotel.id =');
    const linePush = fixtureLineOf(content, 'PRODUCT_IDS.push');
    if (lineAssign < 0 || linePush < 0) fail(`negative ${neg.name}: cannot locate intended readonly-misuse lines`);
    if (fixtureDiags.length !== 2) {
      for (const d of fixtureDiags) console.error(`[typecheck-pilot] fixture diagnostic: ${summarize(d)}`);
      fail(`negative ${neg.name}: want exactly 2 fixture diagnostics, found ${fixtureDiags.length} (rejection disappeared?)`);
    }
    const byLine = new Map(fixtureDiags.map((d) => [d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1, d]));
    const dAssign = byLine.get(lineAssign);
    const dPush = byLine.get(linePush);
    if (!dAssign) fail(`negative ${neg.name}: missing readonly-assignment diagnostic on line ${lineAssign}`);
    if (!dPush) fail(`negative ${neg.name}: missing push-method diagnostic on line ${linePush}`);
    if (dAssign.category !== ts.DiagnosticCategory.Error || dAssign.code !== 2540) {
      fail(`negative ${neg.name}: line ${lineAssign} diagnostic TS${dAssign.code} != TS2540: ${summarize(dAssign)}`);
    }
    if (dPush.category !== ts.DiagnosticCategory.Error || dPush.code !== 2339) {
      fail(`negative ${neg.name}: line ${linePush} diagnostic TS${dPush.code} != TS2339: ${summarize(dPush)}`);
    }
    console.log(`[typecheck-pilot] negative:${neg.name}: TS2540 line ${lineAssign} + TS2339 line ${linePush} (pass)`);
  } else {
    fail(`unknown negative kind: ${neg.kind}`);
  }
  checked += 1;
}

console.log(`[typecheck-pilot] OK: ${checked}/3 configs matched (1 positive + 2 negative).`);
