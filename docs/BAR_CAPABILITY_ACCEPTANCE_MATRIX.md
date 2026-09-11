# Bar Capability Acceptance Matrix

Date: 2026-09-07 (second pass). Tested via `bar-commercial-overrides-wp1`,
`bar-commercial-tenant-binding`, `bar-finance-route`,
`bar-finance-tab-access`, the rendered browser suite (F1–F4, A1–A5), and the
309/309 Bar gate. Server authorization remains the final authority; UI
enablement never grants access. Tenant identity is required wherever the
caller knows the active lodge; lodge-less snapshots are rejected pending the
trusted adapter or refresh.

## Commercial packages (hospitality-pos)

Base `bar_pos`: counter sales, tabs, receipts, products/packs, basic stock,
cash-up, shifts, basic reports. Add-ons: `bar_stock_purchasing_pro`
(recipes/purchasing/lots/variance), `bar_accounting_workforce`
(`restaurant_accounting`, workforce, payroll, tips_payouts, expenses),
`bar_growth_multi_outlet` (customer_accounts, loyalty, vouchers, promos,
multi-outlet, advanced_reports). Force-on overrides package inclusion only;
never role, tenant, outlet, expiry/suspension, or server readiness. Force-off
defeats inclusion across nav, route walls, IPC, and domain checks.

## Route / tab matrix (Bar mode)

| Route/tab | Commercial feature | Capability | Outlet scope | Online | Notes |
|---|---|---|---|---|---|
| `/hpos/pos` (Sell) | pos (base) | pos.view; actions pos.manage/void/discount | validated outlet filter; cashiers outlet-scoped | counter offline-eligible; tabs online-only | voucher/tip tenders need `vouchers`/`tips_payouts` (Terminal + `pos.js` + main triple-enforced) |
| `/hpos/checks` (Open tabs) | tabs (base) | pos.view / pos.manage | outlet + owner (assigned waiter or verified Till operator) | online-only mutations | split/transfer use durable recovery envelopes + idempotent RPCs |
| `/hpos/menu` (Products) | pos (base); recipes gated | pos.menu_manage; recipes need Stock Pro | outlet | setup/catalog online | server RPC is final authority on save |
| `/hpos/stock` | inventory (base); advanced via `inventory_advanced` | inventory.view/manage | outlet/location | counts labeled provisional when offline | blank rejected; explicit zero valid |
| `/hpos/cash` (Cash & close) | pos/cash_up (base, no Accounting needed) | pos.cashup | shift/outlet, business date | online authoritative; offline provisional labeled | null/blank/non-finite evidence → Unavailable, approval blocked |
| `/hpos/reports` | reports (base) | pos.reports | outlet | complete reads or Unavailable | never zero-filled |
| `/hpos/expenses` | expenses (Accounting & Workforce) | expenses.view / .manage | outlet/date | online authoritative | standalone Bar page; not a Finance bypass |
| `/restaurant/finance-close` (+overview/cashups/sales/settlements/customer-funds/expenses/tips/daily-close/owner-review) | route needs `restaurant_accounting`; tabs need reports/pos/expenses/staff respectively | per-tab read caps enforced in standalone Bar via the shared decision contract (`overview/sales/settlements/daily-close/owner-review`: reports.view; `cashups`: pos.cashup; `customer-funds`: pos.manage; `expenses`: expenses.view; `tips`: staff.view); denied `?tab=` renders an explicit denial, never the child; missing capability context fails closed | outlet query preserved across tabs, URL fallback sanitized | online | route access ≠ Accounting readiness; unpaid tabs render a gate, never mount data; base `/hpos/cash` unaffected |
| `/restaurant/accounting-setup` (activation workflow) | `restaurant_accounting` route wall | page reads on accounting.read; prepare/approve/activate/suspend require accounting.manage (action-level) | tenant server-checked per call | online | readiness → maker/checker cutover (prepare ≠ approve actor) → explicit approval → activate; uncertain responses resolve by read-back; suspend preserves history |
| `/restaurant/chart-of-accounts`, `/general-ledger`, `/accounts-payable`, `/bank-reconciliation`, `/tax-returns`, `/budgets`, `/balance-sheet` | `restaurant_accounting` | accounting.read (+ap_pay/bank_approve/tax_file/close/export/payroll_export/payroll_manage per action; see `ACCOUNTING_RPC_AUTHORIZATION_MATRIX.md` for all 95 operations) | tenant/outlet server-checked | online | activation gated by server readiness; see runbook |
| `/restaurant/payroll`, `/restaurant/team-workspace` | payroll / workforce_management | accounting.payroll_view / staff.view | tenant server-checked | online | private fields; activation blocked |
| Floor/kitchen/tables/reservations/production | no Bar exception (recipes only via Stock Pro) | — | — | — | stay blocked in Bar mode with every add-on |

## IPC / RPC enforcement

- `pos:openTableSession` accepts tables-or-tabs; floor IPCs stay tables-only.
- `pos:splitBillEvenly` / `pos:transferTabWaiter` require pos.manage, live
  connection, version/ownership/shift checks, stable keys; results carry
  `code`/`sqlState`/`outcome` end to end.
- Voucher/tip: Terminal preview, `pos.js` domain, and main IPC all enforce
  against the same entitlement object (override-aware, lodge-bound).
- Tender recording is recording, not acquiring/settlement; references
  optional ≤120 chars.
