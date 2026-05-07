/**
 * AI Provider Behavioral Tests
 *
 * Tests the runtime behavior of provider selection, model defaults,
 * and error normalization — using child processes with different
 * environment variable configurations.
 *
 * Run: node tests/ai-provider-behavior.test.mjs
 */

import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

let pass = 0
let fail = 0

function runNode(code, envVars = {}) {
  const env = { ...process.env, ...envVars }
  try {
    const result = execFileSync(process.execPath, ['-e', code], {
      env,
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return { stdout: result.trim(), stderr: '', exitCode: 0 }
  } catch (e) {
    return { stdout: (e.stdout || '').trim(), stderr: (e.stderr || '').trim(), exitCode: e.status || 1 }
  }
}

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  PASS: ${name}`)
  } catch (e) {
    fail++
    console.log(`  FAIL: ${name} — ${e.message}`)
  }
}

// We test the provider resolution logic by evaluating the relevant config
// code in isolation. This simulates what happens at module load time.

const PROVIDER_RESOLVE_CODE = `
const SUPPORTED_PROVIDERS = new Set(['deepseek', 'gemini', 'opencode', 'zen']);

function resolveProvider() {
  const raw = process.env.BOROKO_AI_PROVIDER;
  if (!raw) return 'gemini';
  const normalized = raw.trim().toLowerCase();
  if (!SUPPORTED_PROVIDERS.has(normalized)) {
    throw new Error('Unsupported AI provider configured: ' + raw.trim() + '. Please set BOROKO_AI_PROVIDER to deepseek, gemini, opencode, or another supported provider.');
  }
  return normalized;
}

const PROVIDER_DEFAULT_MODELS = {
  gemini: 'gemini-2.5-flash',
  opencode: 'opencode-zen',
  zen: 'opencode-zen',
  deepseek: 'deepseek-v4-pro'
};

function getProviderModel(provider, requestedModel) {
  if (requestedModel) return requestedModel;
  if (process.env.BOROKO_AI_MODEL) return process.env.BOROKO_AI_MODEL;
  return PROVIDER_DEFAULT_MODELS[provider] || 'gemini-2.5-flash';
}

try {
  const provider = resolveProvider();
  const model = getProviderModel(provider, null);
  console.log(JSON.stringify({ provider, model }));
} catch (e) {
  console.log(JSON.stringify({ error: e.message }));
}
`

const ERROR_NORM_CODE = `
function normalizeProviderError(err, statusCode) {
  if (err && /fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|AbortError/i.test(err.message || err)) {
    return 'The AI assistant needs an internet connection. Boroko can still work offline, but AI chat is unavailable until you reconnect.';
  }
  if (statusCode) {
    if (statusCode === 401 || statusCode === 403) {
      return 'AI provider authentication failed. Please check the API key configuration in the app environment.';
    }
    if (statusCode === 429) {
      return 'AI provider rate limit reached. Please wait a moment and try again.';
    }
    if (statusCode >= 500 && statusCode < 600) {
      return 'The AI provider is temporarily unavailable (status ' + statusCode + '). Boroko continues to work normally — please try again later.';
    }
  }
  return 'AI request failed. Please check your connection and try again.';
}

console.log(JSON.stringify({
  offline: normalizeProviderError(new Error('fetch failed'), null),
  auth401: normalizeProviderError(new Error('unauthorized'), 401),
  auth403: normalizeProviderError(new Error('forbidden'), 403),
  rate429: normalizeProviderError(new Error('too many'), 429),
  server503: normalizeProviderError(new Error('bad gateway'), 503),
  generic: normalizeProviderError(new Error('unknown'), null)
}));
`

console.log('\n=== AI Provider Behavioral Tests ===\n')
console.log('--- Provider Resolution ---\n')

// 1. Unset provider → defaults to gemini
test('Unset BOROKO_AI_PROVIDER defaults to gemini', () => {
  const result = runNode(PROVIDER_RESOLVE_CODE, {})
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.provider, 'gemini')
  assert.equal(parsed.model, 'gemini-2.5-flash')
  assert.equal(result.exitCode, 0)
})

// 2. deepseek → deepseek-v4-pro
test('BOROKO_AI_PROVIDER=deepseek resolves to deepseek-v4-pro', () => {
  const result = runNode(PROVIDER_RESOLVE_CODE, { BOROKO_AI_PROVIDER: 'deepseek' })
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.provider, 'deepseek')
  assert.equal(parsed.model, 'deepseek-v4-pro')
  assert.equal(result.exitCode, 0)
})

// 3. gemini → gemini-2.5-flash
test('BOROKO_AI_PROVIDER=gemini resolves to gemini-2.5-flash', () => {
  const result = runNode(PROVIDER_RESOLVE_CODE, { BOROKO_AI_PROVIDER: 'gemini' })
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.provider, 'gemini')
  assert.equal(parsed.model, 'gemini-2.5-flash')
  assert.equal(result.exitCode, 0)
})

// 4. opencode → opencode-zen
test('BOROKO_AI_PROVIDER=opencode resolves to opencode-zen', () => {
  const result = runNode(PROVIDER_RESOLVE_CODE, { BOROKO_AI_PROVIDER: 'opencode' })
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.provider, 'opencode')
  assert.equal(parsed.model, 'opencode-zen')
  assert.equal(result.exitCode, 0)
})

// 5. Unsupported → error (no fallback)
test('BOROKO_AI_PROVIDER=openai is rejected (no silent fallback)', () => {
  const result = runNode(PROVIDER_RESOLVE_CODE, { BOROKO_AI_PROVIDER: 'openai' })
  const parsed = JSON.parse(result.stdout)
  assert.ok(parsed.error, 'Should have error field')
  assert.match(parsed.error, /Unsupported AI provider configured/)
  assert.match(parsed.error, /openai/)
  assert.doesNotMatch(parsed.error, /api\.key/i, 'Error should not mention api keys')
})

// 6. Case-insensitive DeepSeek
test('BOROKO_AI_PROVIDER=DeepSeek (mixed case) resolves correctly', () => {
  const result = runNode(PROVIDER_RESOLVE_CODE, { BOROKO_AI_PROVIDER: 'DeepSeek' })
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.provider, 'deepseek')
  assert.equal(parsed.model, 'deepseek-v4-pro')
  assert.equal(result.exitCode, 0)
})

// 7. BOROKO_AI_MODEL override works
test('BOROKO_AI_MODEL override takes precedence', () => {
  const result = runNode(PROVIDER_RESOLVE_CODE, {
    BOROKO_AI_PROVIDER: 'deepseek',
    BOROKO_AI_MODEL: 'deepseek-v4-pro-experimental'
  })
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.provider, 'deepseek')
  assert.equal(parsed.model, 'deepseek-v4-pro-experimental')
  assert.equal(result.exitCode, 0)
})

// 8. Whitespace in provider name is trimmed
test('BOROKO_AI_PROVIDER with whitespace is trimmed', () => {
  const result = runNode(PROVIDER_RESOLVE_CODE, { BOROKO_AI_PROVIDER: '  deepseek  ' })
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.provider, 'deepseek')
  assert.equal(result.exitCode, 0)
})

// 9. Unsupported provider error doesn't expose internals
test('Unsupported provider error is safe (no stack, no keys)', () => {
  const result = runNode(PROVIDER_RESOLVE_CODE, { BOROKO_AI_PROVIDER: 'openai' })
  const parsed = JSON.parse(result.stdout)
  assert.doesNotMatch(parsed.error, /BOROKO_AI_API_KEY/i, 'Should not mention API key env var')
  assert.doesNotMatch(parsed.error, /\bat\s/, 'Should not include stack trace')
  assert.doesNotMatch(parsed.error, /throw/, 'Should not include throw keyword')
})

// ─── Error Normalization ──────────────────────────────────────────────────

console.log('\n--- Error Normalization ---\n')

test('fetch failed → offline message', () => {
  const result = runNode(ERROR_NORM_CODE, {})
  const parsed = JSON.parse(result.stdout)
  assert.match(parsed.offline, /internet connection/)
  assert.match(parsed.offline, /Boroko can still work offline/)
})

test('401 → auth failure message', () => {
  const result = runNode(ERROR_NORM_CODE, {})
  const parsed = JSON.parse(result.stdout)
  assert.match(parsed.auth401, /authentication failed/)
  assert.doesNotMatch(parsed.auth401, /unauthorized/i, 'Should not leak raw status text')
})

test('403 → auth failure message', () => {
  const result = runNode(ERROR_NORM_CODE, {})
  const parsed = JSON.parse(result.stdout)
  assert.match(parsed.auth403, /authentication failed/)
})

test('429 → rate limit message', () => {
  const result = runNode(ERROR_NORM_CODE, {})
  const parsed = JSON.parse(result.stdout)
  assert.match(parsed.rate429, /rate limit/)
})

test('503 → server unavailable message', () => {
  const result = runNode(ERROR_NORM_CODE, {})
  const parsed = JSON.parse(result.stdout)
  assert.match(parsed.server503, /temporarily unavailable/)
  assert.match(parsed.server503, /503/)
})

test('generic error → safe fallback (no raw leak)', () => {
  const result = runNode(ERROR_NORM_CODE, {})
  const parsed = JSON.parse(result.stdout)
  assert.match(parsed.generic, /AI request failed/)
  assert.doesNotMatch(parsed.generic, /unknown/i, 'Should not leak raw error text')
})

// ─── SUMMARY ─────────────────────────────────────────────────────────────

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`)
if (fail > 0) {
  console.log('SOME TESTS FAILED — review failures above.\n')
  process.exit(1)
} else {
  console.log('All provider behavioral tests passed.\n')
}
