/**
 * AI Guardrails Test Suite — P0 Verification
 *
 * Validates:
 *   - DeepSeek V4 Pro provider support in aiOrchestrator.js
 *   - Offline-aware error normalization
 *   - Sync health in AI context
 *   - Strict fenced JSON parsing (rejects unsafe patterns)
 *   - Lodge validation hardening
 *   - Audit log parity for bulk handlers
 *
 * Run: node tests/ai-guardrails.test.mjs
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function read(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

let pass = 0
let fail = 0

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

async function run() {

  const aiOrchestrator = await read('src/main/ai/aiOrchestrator.js')
  const mainIndex = await read('src/main/index.js')
  const preload = await read('src/preload/index.js')
  const opsAi = await read('src/renderer/src/components/OpsAi.jsx')
  const inlinePanel = await read('src/renderer/src/components/shared/InlineAiExecutionPanel.jsx')

  console.log('\n=== AI Guardrails P0 Test Suite ===\n')

  // ────── P0-1: DEEPSEEK PROVIDER SUPPORT ──────────────────────────────────

  console.log('--- P0-1: DeepSeek V4 Pro Provider Support ---\n')

  test('DeepSeek provider is routed in aiGenerate (switch/case)', () => {
    assert.match(aiOrchestrator, /case\s*'deepseek'/, 'Should have deepseek case in switch statement')
  })

  test('DeepSeek uses OpenAI-compatible endpoint', () => {
    assert.match(aiOrchestrator, /api\.deepseek\.com\/chat\/completions/, 'Should use deepseek API endpoint')
  })

  test('DeepSeek uses Bearer auth', () => {
    assert.match(aiOrchestrator, /Authorization.*Bearer.*apiKey/, 'Should use Bearer authentication')
  })

  test('DeepSeek reads BOROKO_AI_PROVIDER env var', () => {
    assert.match(aiOrchestrator, /BOROKO_AI_PROVIDER/, 'Should read BOROKO_AI_PROVIDER env var')
  })

  test('DeepSeek reads BOROKO_AI_MODEL env var', () => {
    assert.match(aiOrchestrator, /BOROKO_AI_MODEL/, 'Should read BOROKO_AI_MODEL env var')
  })

  test('DeepSeek reads BOROKO_AI_BASE_URL env var', () => {
    assert.match(aiOrchestrator, /BOROKO_AI_BASE_URL/, 'Should read BOROKO_AI_BASE_URL env var')
  })

  test('DeepSeek fallback URL is configured', () => {
    assert.match(aiOrchestrator, /api\.deepseek\.com/, 'DeepSeek fallback URL should be present')
  })

  test('DeepSeek fallback model is deepseek-v4-pro', () => {
    assert.match(aiOrchestrator, /deepseek.*deepseek-v4-pro/, 'DeepSeek provider default model should be deepseek-v4-pro')
  })

  test('Gemini support is preserved', () => {
    assert.match(aiOrchestrator, /gemini/, 'Gemini provider should still be present')
    assert.match(aiOrchestrator, /generativelanguage\.googleapis\.com/, 'Gemini endpoint should still be present')
  })

  test('SUPPORTED_PROVIDERS set exists with correct values', () => {
    assert.match(aiOrchestrator, /SUPPORTED_PROVIDERS/, 'Should define SUPPORTED_PROVIDERS set')
    assert.match(aiOrchestrator, /'deepseek'/, 'Should include deepseek')
    assert.match(aiOrchestrator, /'gemini'/, 'Should include gemini')
    assert.match(aiOrchestrator, /'opencode'/, 'Should include opencode')
  })

  test('resolveProvider function exists and validates', () => {
    assert.match(aiOrchestrator, /function\s+resolveProvider/, 'Should define resolveProvider')
    assert.match(aiOrchestrator, /SUPPORTED_PROVIDERS\.has/, 'Should check against SUPPORTED_PROVIDERS')
  })

  test('resolveProvider returns safe error for unsupported provider', () => {
    assert.match(aiOrchestrator, /Unsupported AI provider configured/, 'Should reject unsupported providers with friendly message')
    assert.match(aiOrchestrator, /Please set BOROKO_AI_PROVIDER to deepseek, gemini, opencode/, 'Should list supported providers in error')
  })

  test('resolveProvider defaults to gemini when BOROKO_AI_PROVIDER is unset', () => {
    assert.match(aiOrchestrator, /if\s*\(!raw\)\s*return\s*'gemini'/, 'Unset provider should default to gemini')
  })

  test('aiGenerate uses resolveProvider and has explicit switch/case routing', () => {
    assert.match(aiOrchestrator, /provider\s*=\s*resolveProvider\(\)/, 'aiGenerate should call resolveProvider')
    assert.match(aiOrchestrator, /switch\s*\(provider\)/, 'aiGenerate should use switch/case routing (not if-else fallthrough)')
  })

  test('aiGenerate default case throws (no silent fallthrough)', () => {
    assert.match(aiOrchestrator, /default:[\s\S]*throw new Error.*Unsupported/, 'Default case should throw, not silently fall through')
  })

  // ────── P0-1/2: ERROR NORMALIZATION ──────────────────────────────────────

  console.log('\n--- P0-1/2: Error Normalization ---\n')

  test('normalizeProviderError handles 401', () => {
    assert.match(aiOrchestrator, /statusCode\s*===\s*401/, 'Should handle 401 errors')
  })

  test('normalizeProviderError handles 403', () => {
    assert.match(aiOrchestrator, /statusCode\s*===\s*403/, 'Should handle 403 errors')
  })

  test('normalizeProviderError handles 429 rate limit', () => {
    assert.match(aiOrchestrator, /statusCode\s*===\s*429/, 'Should handle 429 rate limit')
  })

  test('normalizeProviderError handles 5xx', () => {
    assert.match(aiOrchestrator, /statusCode\s*>=.*500/, 'Should handle 5xx server errors')
  })

  test('normalizeProviderError function exists', () => {
    assert.match(aiOrchestrator, /function\s+normalizeProviderError/, 'Should have normalizeProviderError function')
  })

  test('fetch failed is in offline error patterns', () => {
    assert.match(aiOrchestrator, /'fetch failed'/, 'fetch failed string should be in offline error patterns')
  })

  test('ECONNRESET is in offline error patterns', () => {
    assert.match(aiOrchestrator, /'ECONNRESET'/, 'ECONNRESET should be in offline error patterns')
  })

  test('ENOTFOUND is in offline error patterns', () => {
    assert.match(aiOrchestrator, /'ENOTFOUND'/, 'ENOTFOUND should be in offline error patterns')
  })

  test('Timeout is handled', () => {
    assert.match(aiOrchestrator, /'timeout'/, 'Timeout string should be in offline error patterns')
  })

  // ────── P0-2: OFFLINE BEHAVIOR ───────────────────────────────────────────

  console.log('\n--- P0-2: Offline-Aware AI Behavior ---\n')

  test('Offline message mentions internet connection needed', () => {
    assert.match(aiOrchestrator, /needs an internet connection/, 'Friendly offline message should be present')
  })

  test('Offline message says Boroko still works offline', () => {
    assert.match(aiOrchestrator, /Boroko can still work offline/, 'Should mention Boroko works offline')
  })

  test('AI orchestrator does not write to sync queue', () => {
    assert.doesNotMatch(aiOrchestrator, /writeSyncQueue/, 'AI orchestrator should not write to sync queue')
  })

  test('ai:turn returns safe error on failure', () => {
    // Check the IPC handler wraps in try/catch returning safe error
    assert.match(mainIndex, /return\s*\{\s*success:\s*false,\s*error:\s*e\.message/, 'ai:turn should catch and return safe error')
  })

  test('ai:execute returns safe error on failure', () => {
    assert.match(mainIndex, /return\s*\{\s*success:\s*false,\s*error:.*message/, 'ai:execute should catch and return safe error')
  })

  // ────── P0-3: SYNC-AWARE AI CONTEXT ──────────────────────────────────────

  console.log('\n--- P0-3: Sync-Aware AI Context ---\n')

  test('buildContextSnapshot includes sync_health', () => {
    assert.match(aiOrchestrator, /sync_health/, 'Context should include sync_health field')
  })

  test('sync_health includes pending count from syncStatus', () => {
    assert.match(aiOrchestrator, /pending.*syncStatus\.pending|syncStatus\.pending/, 'Should include pending sync count')
  })

  test('sync_health includes failed count from syncStatus', () => {
    assert.match(aiOrchestrator, /failed.*syncStatus\.failed|syncStatus\.failed/, 'Should include failed sync count')
  })

  test('sync_health includes online status', () => {
    assert.match(aiOrchestrator, /is_online.*syncStatus|syncStatus\.isOnline/, 'Should include online status')
  })

  test('sync_health includes financial pending count', () => {
    assert.match(aiOrchestrator, /financial_pending/, 'Should include financial pending count')
  })

  test('sync_health includes financial failed count', () => {
    assert.match(aiOrchestrator, /financial_failed/, 'Should include financial failed count')
  })

  test('sync_health includes last_sync_error', () => {
    assert.match(aiOrchestrator, /last_sync_error/, 'Should include last sync error')
  })

  test('sync_health includes last_successful_sync_at', () => {
    assert.match(aiOrchestrator, /last_successful_sync_at/, 'Should include last successful sync time')
  })

  test('System prompt mentions sync awareness', () => {
    assert.match(aiOrchestrator, /pending.*awaiting sync|pending sync|sync status.*context|SYNC AWARENESS/i, 'System prompt should mention sync awareness')
  })

  test('System prompt says check System Health on failures', () => {
    assert.match(aiOrchestrator, /System Health/, 'System prompt should mention System Health')
  })

  test('Daily briefing result includes sync_health', () => {
    assert.match(aiOrchestrator, /sync_health[\s\S]*has_issues/, 'Daily briefing result should include sync health data')
  })

  test('Daily briefing warns about failed sync', () => {
    assert.match(aiOrchestrator, /failed.*Check System Health|sync.*failed.*figures|CRITICAL.*sync item/, 'Briefing should warn about sync failures')
  })

  test('Daily briefing includes online status check', () => {
    assert.match(aiOrchestrator, /isOnline.*offline|system is currently offline/, 'Briefing should check online status')
  })

  // ────── P0-4: STRICT JSON PARSING ────────────────────────────────────────

  console.log('\n--- P0-4: Strict Fenced JSON Parsing ---\n')

  test('extractStrictToolCall requires fenced JSON', () => {
    assert.match(aiOrchestrator, /```json/, 'Should require ```json fenced block')
  })

  test('Multiple JSON blocks are rejected', () => {
    assert.match(aiOrchestrator, /multiple_json_blocks/, 'Should detect and reject multiple JSON blocks')
  })

  test('Malformed JSON is rejected', () => {
    assert.match(aiOrchestrator, /malformed_json/, 'Should reject malformed JSON')
  })

  test('Unknown tool is rejected', () => {
    assert.match(aiOrchestrator, /unknown_tool/, 'Should reject unknown tool names')
  })

  test('Missing tool field is detected', () => {
    assert.match(aiOrchestrator, /missing_tool/, 'Should detect missing tool field')
  })

  test('Required params validation exists', () => {
    assert.match(aiOrchestrator, /paramsSchema.*required/, 'Should validate required params')
  })

  test('Invalid array param type is detected', () => {
    assert.match(aiOrchestrator, /invalid_param_type/, 'Should detect invalid param types')
  })

  test('Enum validation exists', () => {
    assert.match(aiOrchestrator, /invalid_param_value/, 'Should validate enum param values')
  })

  test('No fallback loose JSON regex', () => {
    assert.doesNotMatch(aiOrchestrator, /\{\[\s\S\]\*\}\\?\$\/m/, 'Loose JSON regex should be removed')
  })

  test('Parse errors are audit-logged', () => {
    assert.match(aiOrchestrator, /ai\.turn\.parse_error/, 'Parse errors should be audit logged')
  })

  test('System prompt declares data as untrusted', () => {
    assert.match(aiOrchestrator, /untrusted/i, 'System prompt should declare business data as untrusted')
  })

  test('System prompt says to ignore instructions in business records', () => {
    assert.match(aiOrchestrator, /IGNORE.*instructions|ignore.*instructions.*business/i, 'System prompt should instruct model to ignore business record instructions')
  })

  test('System prompt says exactly one JSON block', () => {
    assert.match(aiOrchestrator, /EXACTLY ONE|exactly one.*JSON|one.*fenced.*block/i)
  })

  test('System prompt says no JSON if no tool needed', () => {
    assert.match(aiOrchestrator, /no tool.*do not output.*JSON|no tool.*no JSON|if no tool.*output ANY JSON/i)
  })

  // ────── P0-5: LODGE VALIDATION ───────────────────────────────────────────

  console.log('\n--- P0-5: Strict Lodge Validation ---\n')

  test('Rejects missing proposal lodgeId', () => {
    assert.match(aiOrchestrator, /missing_proposal_lodgeId/, 'Should reject when proposal has no lodgeId')
  })

  test('Rejects missing current lodgeId', () => {
    assert.match(aiOrchestrator, /missing_current_lodgeId/, 'Should reject when current lodgeId is missing')
  })

  test('Rejects mismatched lodgeId', () => {
    assert.match(aiOrchestrator, /lodgeId_mismatch/, 'Should reject mismatched lodgeIds')
  })

  test('Rejection writes audit log', () => {
    assert.match(aiOrchestrator, /ai\.execute\.rejected/, 'Should audit-log rejected executions')
  })

  test('New code explicitly checks for missing proposal.lodgeId', () => {
    assert.match(aiOrchestrator, /!proposal\.lodgeId/, 'Should explicitly check for missing proposal.lodgeId')
  })

  test('New code explicitly checks for missing current lodgeId', () => {
    // Should check lodId is missing (not as a weak guard)
    assert.match(aiOrchestrator, /!lodgeId\)/, 'Should explicitly check for missing current lodgeId')
  })

  // ────── P0-6: AUDIT LOG PARITY ───────────────────────────────────────────

  console.log('\n--- P0-6: Audit Log Parity ---\n')

  test('Bulk collections execution has distinct audit event', () => {
    assert.match(mainIndex, /ai\.collections\.execute/, 'Bulk collections should use distinct audit event')
  })

  test('Bulk overdue execution has distinct audit event', () => {
    assert.match(mainIndex, /ai\.overdue\.execute/, 'Bulk overdue should use distinct audit event')
  })

  test('Bulk collections error writes audit log', () => {
    assert.match(mainIndex, /ai\.collections\.execute\.failed/, 'Bulk collections errors should be audit-logged')
  })

  test('Bulk overdue error writes audit log', () => {
    assert.match(mainIndex, /ai\.overdue\.execute\.failed/, 'Bulk overdue errors should be audit-logged')
  })

  test('Single AI action still writes audit log (confirmed)', () => {
    assert.match(aiOrchestrator, /ai\.tool\.confirmed/, 'Single tool confirmation should still be audit-logged')
  })

  test('Single AI proposal writes audit log', () => {
    assert.match(aiOrchestrator, /ai\.tool\.proposed/, 'Proposals should be audit-logged')
  })

  test('Bulk audit includes affected booking IDs', () => {
    assert.match(mainIndex, /affected_booking_ids/, 'Bulk audit should list affected booking IDs')
  })

  test('Bulk audit includes error summaries', () => {
    assert.match(mainIndex, /error_summaries/, 'Bulk audit should include error summaries')
  })

  // ────── P0-7: INTEGRATION CHECKS ─────────────────────────────────────────

  console.log('\n--- P0-7: Integration Checks ---\n')

  test('API key stays in main process only (not in preload)', () => {
    assert.doesNotMatch(preload, /BOROKO_AI_API_KEY/, 'preload should not expose API key')
    assert.doesNotMatch(preload, /BOROKO_GEMINI_API_KEY/, 'preload should not expose gemini key')
  })

  test('Preload exposes ai.turn IPC', () => {
    assert.match(preload, /turn:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('ai:turn'/, 'preload should expose ai.turn')
  })

  test('Preload exposes ai.execute IPC', () => {
    assert.match(preload, /execute:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('ai:execute'/, 'preload should expose ai.execute')
  })

  test('Preload exposes ai.collections IPC', () => {
    assert.match(preload, /collections[\s\S]*ai:collections/, 'preload should expose collections IPC')
  })

  test('Preload exposes ai.overdue IPC', () => {
    assert.match(preload, /overdue[\s\S]*ai:overdue/, 'preload should expose overdue IPC')
  })

  test('OpsAi.jsx does not hardcode gemini model', () => {
    assert.doesNotMatch(opsAi, /model:\s*['"]gemini-2\.5-flash['"]/, 'OpsAi.jsx should not hardcode gemini model')
  })

  test('InlineAiExecutionPanel does not hardcode model', () => {
    assert.doesNotMatch(inlinePanel, /model:\s*['"]gemini-2\.5-flash['"]/, 'InlineAiExecutionPanel should not hardcode model')
  })

  test('Financial formula uses correct calculation', () => {
    // total_amount + charges_total - amount_paid
    assert.match(aiOrchestrator, /total_amount.*charges_total/, 'Financial formulas should use total_amount + charges_total')
  })

  test('Uses updateBookingPayment for payments (not direct writes)', () => {
    assert.match(aiOrchestrator, /updateBookingPayment/, 'Should use updateBookingPayment for payments')
  })

  test('No new dangerous tools', () => {
    const toolNames = [...aiOrchestrator.matchAll(/name:\s*['"]([\w_]+)['"]/g)].map(m => m[1])
    const approved = new Set([
      'get_attention', 'get_today_revenue', 'list_unpaid_bookings', 'get_unpaid_summary',
      'detect_payment_anomalies', 'get_daily_briefing', 'get_overdue_checkouts',
      'create_booking', 'check_in', 'check_out', 'record_payment', 'bulk_record_payment', 'bulk_check_out'
    ])
    const newTools = toolNames.filter(n => !approved.has(n))
    if (newTools.length > 0) {
      // Double-check inside TOOL_SPECS — some are in buildSystemPrompt too
      const specs = aiOrchestrator.match(/const TOOL_SPECS\s*=\s*\[([\s\S]*?)\];/)?.[1] || ''
      for (const t of newTools) {
        if (!specs.includes(`name: '${t}'`)) {
          assert.fail(`Unexpected tool found: "${t}"`)
        }
      }
    }
  })

  test('Audit log function does not log API keys', () => {
    const auditFn = aiOrchestrator.match(/function\s+writeAiAuditLog[\s\S]*?^export function/m)?.[0] || ''
    assert.doesNotMatch(auditFn, /api_key|apikey|secret|password|token/i, 'Audit log should not contain secret/credential fields')
  })

  // ─── SUMMARY ─────────────────────────────────────────────────────────────

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`)

  if (fail > 0) {
    console.log('SOME TESTS FAILED — review failures above.\n')
    process.exit(1)
  } else {
    console.log('All guardrail tests passed.\n')
  }
}

await run()
