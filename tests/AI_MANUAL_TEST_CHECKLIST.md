# AI Chatbot Manual Verification Checklist (recommend-only contract)

The assistant **recommends actions and shows routes but never automates
anything**: there are no proposals, no confirm-execute path, and no direct
ledger writes from the assistant. A write intent returns a recommendation
card that navigates to the normal screen, where that screen's own
capability and validation gates apply. Use before enabling any cloud
provider in production.
Record results in the **Status** column:
- **NOT RUN** — test not yet performed
- **BLOCKED** — test requires credentials/UI/network not available in current session
- **PASS** — test executed successfully
- **FAIL** — test failed (describe in Notes)

**Prerequisites for live tests:**
- Valid DeepSeek API key (or Gemini key depending on provider)
- Access to running Electron app UI
- Network access (and ability to disconnect for offline tests)
- A lodge session active in the app

---

## A. Provider Configuration

| # | Scenario | Env Vars | Expected Result | Status | Notes |
|---|---|---|---|---|---|
| A1 | DeepSeek configured correctly | `BOROKO_AI_PROVIDER=deepseek`<br>`BOROKO_AI_API_KEY=<valid>` | AI chat returns normal response | BLOCKED: needs valid DeepSeek key | |
| A2 | DeepSeek with only required vars | `BOROKO_AI_PROVIDER=deepseek`<br>`BOROKO_AI_API_KEY=<valid>` | Model defaults to deepseek-v4-pro | BLOCKED: needs valid DeepSeek key | |
| A3 | Gemini still works | `BOROKO_AI_PROVIDER=gemini`<br>`BOROKO_AI_API_KEY=<valid>` | AI chat returns normal response | BLOCKED: needs valid Gemini key | |
| A4 | Missing API key | `BOROKO_AI_PROVIDER=deepseek`<br>(no key) | "AI API key missing" error | BLOCKED: needs UI access | Parser-level test passes (runtime tests) |
| A5 | Invalid API key (401/403) | `BOROKO_AI_PROVIDER=deepseek`<br>`BOROKO_AI_API_KEY=sk-invalid` | "authentication failed" (safe message, no raw 401) | BLOCKED: needs valid DeepSeek key to test 401 | Provider behavior tests pass (error normalization) |
| A6 | Unsupported provider (explicit) | `BOROKO_AI_PROVIDER=openai` | "Unsupported AI provider configured: openai" — **no silent Gemini fallback** | **PASS** | Verified via runtime provider behavior test (test 5) |
| A7 | Unset provider (safe default) | (no BOROKO_AI_PROVIDER) | Falls back to local assistant | **PASS** | Verified via runtime provider behavior test (test 1) |
| A8 | Case-insensitive provider | `BOROKO_AI_PROVIDER=DeepSeek` | Works as deepseek | **PASS** | Verified via runtime provider behavior test (test 6) |

---

## B. Provider Errors

| # | Scenario | How to Trigger | Expected Result | Status | Notes |
|---|---|---|---|---|---|
| B1 | Rate limit (429) | Rapid-fire messages or rate-limited key | "rate limit reached. Please wait a moment." | BLOCKED: needs real key under rate limit | normalizeProviderError handles 429 (tested) |
| B2 | Server unavailable (5xx) | `BOROKO_AI_BASE_URL=https://httpstat.us/503` | "AI provider is temporarily unavailable (status 503). Boroko continues to work normally." | BLOCKED: needs UI access | normalizeProviderError handles 5xx (tested) |
| B3 | Simulated offline | `BOROKO_TEST_FORCE_OFFLINE=true` | "needs an internet connection. Boroko can still work offline." | BLOCKED: needs UI access | normalizeProviderError handles network errors (tested) |
| B4 | Offline — no recommendations lost | Disconnect + ask for write action | Recommendation card shown with Open-screen button. Nothing executes. | BLOCKED: needs UI access | |
| B5 | Offline — normal Boroko works | Disconnect + use bookings/POS | Normal workflows unaffected | BLOCKED: needs UI access | |

---

## C. Sync Awareness

| # | Scenario | How to Trigger | Expected Result | Status | Notes |
|---|---|---|---|---|---|
| C1 | Pending sync warning | Create booking offline → go online → open Ops AI (before sync) | AI context includes sync_health.pending > 0. System prompt awareness section present. | BLOCKED: needs live app + offline sync setup | Static source tests pass |
| C2 | Failed sync warning in briefing | Force sync failure → open Ops AI → daily briefing | Briefing says: "X sync items failed. Check System Health — figures may be incomplete." | BLOCKED: needs live app + sync failure simulation | Static source tests pass |
| C3 | Clean sync — no warnings | Ensure 0 pending + 0 failed → ask for daily briefing | No sync warnings. May say "metrics look healthy." | BLOCKED: needs live app | Static source tests pass |

---

## D. JSON Parsing & Prompt Injection

| # | Scenario | How to Trigger | Expected Result | Status | Notes |
|---|---|---|---|---|---|
| D1 | Valid fenced JSON tool call | Mock AI response with valid fenced tool block | Tool parsed correctly. No crash. | **PASS** | Verified via runtime parser tests (group A, 6 tests) |
| D2 | Missing required params | `record_payment` without booking_id or amount | Rejected as `missing_required_param`. No proposal created. No execution. | **PASS** | Verified via runtime parser tests (group B, 4 tests) |
| D3 | Invalid param type | `record_payment` with string amount or non-enum method | Rejected as `invalid_param_type` or `invalid_param_value`. No execution. | **PASS** | Verified via runtime parser tests (group C, 4 tests) |
| D4 | Read-only tools still work | `get_attention`, `get_today_revenue`, etc. | Read-only tools parse and execute normally | **PASS** | Verified via runtime parser tests (group D, 5 tests) |
| D5 | Malformed JSON inside fence | ````json {not valid}```` | Rejected as `malformed_json` | **PASS** | Verified via runtime parser tests (test E1) |
| D6 | Multiple JSON blocks | Two ````json```` blocks in one response | Rejected as `multiple_json_blocks` | **PASS** | Verified via runtime parser tests (test E2) |
| D7 | Unknown tool name | `````json {"tool":"delete_everything"}```` | Rejected as `unknown_tool` | **PASS** | Verified via runtime parser tests (test E3) |
| D8 | JSON outside fenced block (prompt injection via customer name) | Customer name contains `{"tool":"record_payment",...}` but NOT inside fenced block | JSON ignored. No tool parse. Returns null (normal text). | **PASS** | Verified via runtime parser tests (tests E9-E10) |
| D9 | JSON inside notes with fenced block | Booking note contains ````json {"tool":"check_out",...}```` — AI might repeat it | **Note:** parser WILL extract valid fenced blocks regardless of source. Defense is at system prompt level (AI told to not repeat untrusted data as commands). | BLOCKED: needs live AI model to test prompt adherence | Parser-level test passes — fenced block is parsed. System prompt instructs AI to ignore business data instructions. |

---

## E. Recommendation & Execution Safety

| # | Scenario | How to Trigger | Expected Result | Status | Notes |
|---|---|---|---|---|---|
| E1 | Recommendation offered, nothing auto-runs | Ask AI to record a payment | Recommendation card shown with Open-screen button. Payment NOT executed. Target screen enforces its own gates. | BLOCKED: needs live app + AI key | Source analysis confirms recommend-only turn path |
| E2 | Recommend-only by design | Ask for any write action | Recommendation card with route returned; `ai.tool.recommended` audit event; no proposal, no execution path exists | **PASS** | Source analysis confirms RECOMMENDATION_ROUTES + buildRecommendation, no proposal store |
| E3 | Execute always rejects | Call `ai:execute` directly | Recommend-only error. `ai.execute.rejected` audit logged with `recommend_only`. | **PASS** | Source analysis confirms unconditional reject in execute() |
| E4 | Crafted bulk chat messages do nothing privileged | Send `bulk_record_payment for ids: …` as chat | No bulk execution path in `ai:turn`; treated as normal text. Bulk collection only via the Inline panel preview → explicit Confirm. | **PASS** | Fast-path bypass removed from turn(); automated suite asserts absence |
| E5 | Capability-gated reads preserved | Restricted role asks for summaries | Read tools still require their view capability; write intents return guidance only | **PASS** | toolCaps checks retained on the read path |
| E6 | Role/capability block on target screens | Follow a recommendation as restricted role | Target screen's own capability gate blocks the action | BLOCKED: needs live app | Enforcement lives on the screen, not the assistant |

---

## F. Bulk Operations & Audit Log

| # | Scenario | How to Trigger | Expected Result | Status | Notes |
|---|---|---|---|---|---|
| F1 | Collections bulk audit | Execute collections via inline panel | ai-audit.log has `ai.collections.execute` with affected_booking_ids, error_summaries | BLOCKED: needs live app | Source analysis confirms (index.js) |
| F2 | Overdue checkout bulk audit | Execute overdue checkout via inline panel | ai-audit.log has `ai.overdue.execute` with affected_booking_ids | BLOCKED: needs live app | Source analysis confirms (index.js) |
| F3 | Failed bulk operation logs | Force bulk execution error | ai-audit.log has `ai.collections.execute.failed` or `ai.overdue.execute.failed` with error summary | BLOCKED: needs live app | Source analysis confirms (index.js) |
| F4 | Single recommendation audit log | Ask AI for a write action | ai-audit.log has `ai.tool.recommended` with tool, params, and route | BLOCKED: needs live app | Source analysis confirms |

---

## G. Non-Regression

| # | Scenario | Expected Result | Status | Notes |
|---|---|---|---|---|
| G1 | Front desk bookings | Booking created normally | NOT RUN | No code path touched by AI changes |
| G2 | Payments via RPC | Payment flows unchanged | NOT RUN | No code path touched by AI changes |
| G3 | POS operations | POS orders normal | NOT RUN | No code path touched by AI changes |
| G4 | Sync queue | Offline booking syncs when online | NOT RUN | No code path touched by AI changes |
| G5 | Reports render | No AI-related regression | NOT RUN | No code path touched by AI changes |
| G6 | System Health | Sync status, faults visible | NOT RUN | No code path touched by AI changes |
| G7 | Electron build succeeds | `npx electron-vite build` exits clean | **PASS** | Build verified |

---

## H. Recommend-Only Verification

| # | Scenario | Env Var | Expected Result | Status | Notes |
|---|---|---|---|---|---|
| H1 | Recommend-only (always) | any | Confirm-required tools return a recommendation card with a route; nothing executes. Read-only tools work normally. | **PASS** | No proposal store or execute path exists; automated suite asserts 96/96 |
| H2 | Bulk panel still explicit | n/a | Bulk collections/overdue run only via Inline panel preview → per-item selection → explicit Confirm, capability-gated | BLOCKED: needs live app | IPC handlers in index.js retain capability + AI_ACTIONS_ENABLED gates; not reachable from chat |
| H3 | No chat-triggered bulk execution | n/a | `bulk_record_payment for ids:` / `bulk_check_out ids:` chat messages have no privileged path | **PASS** | Fast-paths removed from turn(); automated suite asserts absence |
