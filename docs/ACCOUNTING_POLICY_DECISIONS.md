# Bar and Accounting Policy Decisions

Version: `bar-accounting-financial-truth-v1`
Status: implementation policy for controlled enablement; lodge/accountant sign-off is required before activation.

These decisions are the contract used by the financial-truth migrations. A lodge must not activate the accounting rail with a different interpretation hidden in a spreadsheet or client setting.

| Area | v1 decision | Control/evidence |
|---|---|---|
| Currency and date | Lodge base currency is authoritative (BWP/Africa-Gaborone by default); AP foreign-currency bills are fail-closed until an approved FX configuration supplies converted base amounts. Business and pay dates use the lodge timezone. | Server dates, source `business_date`, report `as_of`, AP currency/base-currency validation. |
| Accounting basis | Accrual ledger. Revenue, inventory/COGS, AP, payroll liabilities and cash movements are separate postings. | Posted journal and source-posting manifest. |
| POS revenue | Revenue is mapped by active product/category mapping. Returns reverse the original sale allocation and retain the original source snapshot. | Typed POS tender/category mappings and order source ID. |
| Discounts, tax, tips | Discounts, output tax and tips are separate configured mappings. No client-supplied total or tax status is authoritative. | Server pricing result and journal lines. |
| Customer account | Account tender posts to AR/customer subledger, is credit-limit checked under row lock, and requires an active customer account. | Account ledger operation ID and balance-after. |
| Voucher | Voucher tender posts to a voucher liability ledger, locks the voucher row, and is atomic with the sale. | Voucher ledger operation ID and balance-after. |
| Stock and COGS | Stock movements and recipe depletion use a server cost snapshot. Purchases do not become period expense merely because they were paid. | Inventory movement, COGS journal, source linkage. |
| Direct expense vs AP | Direct expense is for a paid, evidenced operating cost. Supplier invoices use AP and must not be duplicated as a direct expense. | Supplier/invoice uniqueness, evidence reference, AP workflow. |
| Cash-up | The operator enters only a blind physical count. Expected tender totals are calculated from immutable shift/outlet events. | Shift cash-up RPC, tender control totals, review evidence. |
| Payroll | Payroll requires an expected-worker register, attendance disposition or attributable approved time input, effective-dated statutory configuration with official source/hash approval, approved calculation snapshot, immutable payment batch, separate liability settlement, bank evidence and close. | Worker exceptions, attendance register, source provenance, snapshot hash, batch/file hash, settlement journal and bank reference. |
| Bank reconciliation | Import identity, RFC-4180 rows, matched/unmatched detail, statement-derived closing balance, reviewer and packet hash are retained. Bank reconciliation does not itself close the accounting period. | Reconciliation packet and close controls. |
| Tax | Tax working papers are reproducible from configured tax accounts and an immutable source/journal manifest. They are not filing automation. | Configuration version, snapshot hash, review/approval/filing actors. |
| Period close | A financial period is closed only after source coverage, trial balance, bank, AP, payroll, tax and exception controls pass. Reopen requires an independent reasoned approval. | Close checklist linked to objective control results. |

Before activation, the responsible accountant must sign off the lodge chart mappings, tax configuration, payroll statutory configuration, inventory cost policy, direct-expense/AP policy and opening-balance evidence. A missing sign-off is a no-ship condition; the readiness RPC is not a substitute for professional or statutory approval.
