/**
 * Shared guard assertions for the B01 typecheck pilot.
 *
 * Imported by scripts/typecheck-pilot.mjs (which turns throws into FAIL exits)
 * and scripts/typecheck-pilot-guards.mjs (which asserts each guard throws for
 * the intended reason). Throwing — never process.exit — keeps the functions
 * testable in memory without spawning processes.
 *
 * All functions are pure with respect to the filesystem: they inspect caller
 * supplied compiler options / source files only.
 */

/** Exact production lib entry after config parsing (config text is "ES2022"). */
export const EXPECTED_LIB_BASENAME = 'lib.es2022.d.ts';

/**
 * Strict sub-options that pinned TypeScript 5.9.3 enables by default under
 * strict:true. The parser leaves them `undefined` (meaning: strict default
 * applies); an explicit `false` weakens checking while textual strict:true
 * remains, so each must be rejected when `=== false`.
 */
export const STRICT_SUBOPTIONS = [
  'noImplicitAny',
  'noImplicitThis',
  'strictNullChecks',
  'strictFunctionTypes',
  'strictBindCallApply',
  'strictPropertyInitialization',
  'strictBuiltinIteratorReturn',
  'alwaysStrict',
  'useUnknownInCatchVariables',
];

/**
 * Validate effective pilot options. Throws an Error naming every mismatch.
 * `ts` is the pinned compiler module (for enum comparison, never a fallback).
 */
export function assertPilotOptions(options, ts, label) {
  const problems = [];
  if (options.strict !== true) problems.push(`strict=${options.strict} (want true)`);
  if (options.allowJs !== true) problems.push(`allowJs=${options.allowJs} (want true)`);
  // Global checkJs stays off; the JS pilot opts in via its own @ts-check.
  if (options.checkJs !== false) problems.push(`checkJs=${options.checkJs} (want false)`);
  if (options.noEmit !== true) problems.push(`noEmit=${options.noEmit} (want true)`);
  // Exact environment: target/module/resolution are compared as effective enums.
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
  const libOk =
    Array.isArray(lib) &&
    lib.length === 1 &&
    String(lib[0]).toLowerCase().endsWith(EXPECTED_LIB_BASENAME);
  if (!libOk) problems.push(`lib=${JSON.stringify(lib)} (want exactly ["${EXPECTED_LIB_BASENAME}"])`);
  // types must be EXPLICITLY []. An omitted property parses to undefined and
  // would admit ambient @types; `?? []` must never be used here.
  if (!Array.isArray(options.types)) {
    problems.push('types is missing (want explicit [])');
  } else if (options.types.length !== 0) {
    problems.push(`types=${JSON.stringify(options.types)} (want [])`);
  }
  // Effective strictness: reject any explicitly disabled sub-option.
  for (const name of STRICT_SUBOPTIONS) {
    if (options[name] === false) problems.push(`${name}=false (strict default disabled)`);
  }
  if (options.skipLibCheck !== false) problems.push(`skipLibCheck=${options.skipLibCheck} (want false)`);
  if (options.forceConsistentCasingInFileNames !== true) {
    problems.push(`forceConsistentCasingInFileNames=${options.forceConsistentCasingInFileNames} (want true)`);
  }
  if (problems.length > 0) {
    throw new Error(`${label}: unexpected effective options: ${problems.join('; ')}`);
  }
}

/**
 * True only for genuine pinned-compiler standard libraries: the file must sit
 * under the resolved pinned TypeScript lib directory AND carry a valid
 * compiler-library filename (lib.*.d.ts). A path merely containing
 * "typescript/lib" is not sufficient.
 */
export function isStdLibFile(fileName, tsLibDir) {
  const normalized = String(fileName).replace(/\\/g, '/');
  const dir = String(tsLibDir).replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized.toLowerCase().startsWith(`${dir.toLowerCase()}/`)) return false;
  const base = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase();
  return base.startsWith('lib.') && base.endsWith('.d.ts');
}

/**
 * Confirm the production JS SourceFile is actually checked in this program.
 * Requires the compiler-reported state (isCheckJsEnabledForFile) AND the
 * file's own active directive (checkJsDirective.enabled), so a removed or
 * @ts-nocheck-disabled directive fails even though TS consumers could still
 * infer the module's exports. Throws otherwise.
 */
export function assertJsChecked(sourceFile, options, ts, label) {
  const directiveEnabled = sourceFile.checkJsDirective?.enabled;
  let apiEnabled = false;
  try {
    apiEnabled = ts.isCheckJsEnabledForFile(sourceFile, options) === true;
  } catch {
    apiEnabled = false;
  }
  if (apiEnabled !== true || directiveEnabled !== true) {
    throw new Error(
      `${label}: production JS is not checked (isCheckJsEnabledForFile=${apiEnabled}, checkJsDirective.enabled=${directiveEnabled}; want an active @ts-check directive)`,
    );
  }
}
