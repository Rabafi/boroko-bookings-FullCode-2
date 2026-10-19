/**
 * Guard-regression checks for the B01 typecheck pilot (review R1).
 *
 * Verifies that the shared guards in ./typecheck-pilot-checks.mjs reject each
 * weakened configuration for its INTENDED reason — not just any failure — so
 * "OK 3/3" can never conceal a weakened checker or an unchecked production
 * file. All cases are in-memory (parsed real config + mutated copies); no
 * production files, fixtures, or configs are modified and nothing is executed.
 *
 * Run: npm run test:typecheck:pilot-guards
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  assertPilotOptions,
  assertJsChecked,
  isStdLibFile,
  STRICT_SUBOPTIONS,
} from './typecheck-pilot-checks.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

if (ts.version !== '5.9.3') {
  console.error(`[typecheck-guards] FAIL: pinned compiler is ${ts.version}, want 5.9.3`);
  process.exit(1);
}
let tsLibDir;
try {
  tsLibDir = dirname(require.resolve('typescript'));
} catch (err) {
  console.error(`[typecheck-guards] FAIL: cannot resolve pinned 'typescript' lib dir: ${err?.message ?? err}`);
  process.exit(1);
}

function loadBaselineOptions() {
  const configPath = resolve(repoRoot, 'tsconfig.typecheck-pilot.json');
  const readResult = ts.readConfigFile(configPath, (p) => readFileSync(p, 'utf8'));
  if (readResult.error) {
    throw new Error(`cannot read pilot config: ${ts.flattenDiagnosticMessageText(readResult.error.messageText, ' ')}`);
  }
  const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, repoRoot);
  if (parsed.errors.length > 0) {
    throw new Error(`cannot parse pilot config: ${ts.flattenDiagnosticMessageText(parsed.errors[0].messageText, ' ')}`);
  }
  return parsed.options;
}

let passed = 0;
function expectPass(name, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`[typecheck-guards] FAIL ${name}: expected pass, threw: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`[typecheck-guards] PASS ${name}: accepted`);
}

function expectThrow(name, fn, want) {
  let message = null;
  try {
    fn();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  if (message === null) {
    console.error(`[typecheck-guards] FAIL ${name}: expected guard rejection containing "${want}", but no error was thrown`);
    process.exit(1);
  }
  if (!message.includes(want)) {
    console.error(`[typecheck-guards] FAIL ${name}: rejection did not name the intended guard (want "${want}"): ${message}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`[typecheck-guards] PASS ${name}: rejected (${message})`);
}

const baseline = loadBaselineOptions();

// Baseline must still pass.
expectPass('baseline-options', () => assertPilotOptions(baseline, ts, 'baseline'));

// Weakened environments must be rejected for the intended reason.
expectThrow('added-dom-lib', () => {
  assertPilotOptions({ ...baseline, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] }, ts, 'case');
}, 'lib=');

expectThrow('omitted-types', () => {
  const mutated = { ...baseline };
  delete mutated.types;
  assertPilotOptions(mutated, ts, 'case');
}, 'types is missing');

expectThrow('nonempty-types', () => {
  assertPilotOptions({ ...baseline, types: ['node'] }, ts, 'case');
}, 'types=');

expectThrow('wrong-target', () => {
  assertPilotOptions({ ...baseline, target: ts.ScriptTarget.ES2020 }, ts, 'case');
}, 'target=');

expectThrow('wrong-module', () => {
  assertPilotOptions({ ...baseline, module: ts.ModuleKind.CommonJS }, ts, 'case');
}, 'module=');

expectThrow('wrong-moduleResolution', () => {
  assertPilotOptions({ ...baseline, moduleResolution: ts.ModuleResolutionKind.Classic }, ts, 'case');
}, 'moduleResolution=');

// Reviewer's exact probe: strict:true retained, sub-options explicitly off.
expectThrow('strict-suboptions-disabled-pair', () => {
  assertPilotOptions({ ...baseline, strict: true, noImplicitAny: false, strictNullChecks: false }, ts, 'case');
}, 'noImplicitAny=');

// Every listed strict sub-option must be enforced individually.
for (const name of STRICT_SUBOPTIONS) {
  expectThrow(`strict-suboption-${name}`, () => {
    assertPilotOptions({ ...baseline, [name]: false }, ts, 'case');
  }, `${name}=`);
}

// Production-JS checking: real source text passes; absent/disabled directives fail.
const productText = readFileSync(resolve(repoRoot, 'packages/product-config/index.js'), 'utf8');
const realSource = ts.createSourceFile('index.js', productText, ts.ScriptTarget.ES2022, true);
expectPass('js-checked-real-source', () => assertJsChecked(realSource, baseline, ts, 'case'));

const noDirective = ts.createSourceFile(
  'index.js',
  'export const PRODUCTS = Object.freeze({ hotel: Object.freeze({ id: "hotel" }) });\n',
  ts.ScriptTarget.ES2022,
  true,
);
expectThrow('js-check-absent-directive', () => assertJsChecked(noDirective, baseline, ts, 'case'), 'not checked');

const disabled = ts.createSourceFile(
  'index.js',
  '// @ts-nocheck\nexport const PRODUCTS = Object.freeze({ hotel: Object.freeze({ id: "hotel" }) });\n',
  ts.ScriptTarget.ES2022,
  true,
);
expectThrow('js-check-disabled-directive', () => assertJsChecked(disabled, baseline, ts, 'case'), 'not checked');

// Standard-library provenance: only real pinned-lib lib.*.d.ts files qualify.
const realLib = `${tsLibDir}/lib.es2022.d.ts`.replace(/\\/g, '/');
if (!isStdLibFile(realLib, tsLibDir)) {
  console.error('[typecheck-guards] FAIL stdlib-provenance-real: genuine lib file not recognized');
  process.exit(1);
}
passed += 1;
console.log('[typecheck-guards] PASS stdlib-provenance-real: accepted');
for (const [name, fake] of [
  ['stdlib-provenance-fake-path', 'C:/evil/typescript/lib/lib.es2022.d.ts'],
  ['stdlib-provenance-nonlib-dts', `${tsLibDir}/typescript.d.ts`.replace(/\\/g, '/')],
]) {
  if (isStdLibFile(fake, tsLibDir)) {
    console.error(`[typecheck-guards] FAIL ${name}: impostor recognized as stdlib: ${fake}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`[typecheck-guards] PASS ${name}: rejected (${fake})`);
}

console.log(`[typecheck-guards] OK: ${passed} guard cases behaved as intended.`);
