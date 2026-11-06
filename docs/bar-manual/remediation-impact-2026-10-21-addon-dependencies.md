# Bar manual impact — 2026-10-21 Bar add-on dependencies and prices

Status: Required for the next customer guide candidate. No PDF, manifest, screenshot set or packaged guide was rebuilt or approved by this record.

## Customer impact

Accounting & Workforce can no longer be selected on its own. It requires Stock & Purchasing Pro, and the Subscription screens now explain the requirement, select the requirement with it, and block removing Purchasing while Accounting remains selected. The authoritative server quote, activation and Command Central assignment paths enforce the same rule.

Annual Bar add-on prices are now:

- Stock & Purchasing Pro — P2,500/year
- Accounting & Workforce — P3,500/year (requires Stock & Purchasing Pro)
- Growth & Multi-Outlet — P2,000/year

The two required add-ons cost P6,000/year combined. Bar POS Base remains P4,500/year. A customer who already holds Stock & Purchasing Pro adds Accounting for P3,500/year; the requirement is not charged twice.

Existing Accounting-only commercial records are not silently revoked by this change. A later deliberate package change or activation must include Stock & Purchasing Pro. Any historical quote that selected Accounting without Purchasing is rejected at activation with guidance to issue a replacement quote.

## Customer instructions for the next guide candidate

In Subscription, choose Accounting & Workforce only together with Stock & Purchasing Pro. The add-on card shows the combined price and selects Purchasing automatically. To remove Purchasing, first remove Accounting & Workforce. If an older quote is rejected because it predates this rule, ask Tsa Bonno for a replacement quote before paying or activating it.

## Affected guide records

- Manual: Part G — Optional packages in `docs/bar-manual/manuscript.md` now states the dependency and annual prices. Incorporate this wording in the next reviewed candidate.
- Quick Start: no task-text change required. Cashier selling, payment and closing steps are unchanged; refresh printed page references only if the next manual rebuild changes pagination.
- Screenshots: no new customer screen capture was produced or approved. Existing Subscription screenshots must not be used to illustrate an Accounting-only selection.
- Evidence: focused tests in `tests/bar-addon-bundles.test.mjs`, `tests/bar-base-product.test.mjs` and `tests/marketing-site-contract.test.mjs`; server enforcement is in `supabase/migrations/20261021090000_bar_addon_dependencies_and_prices.sql`.
- Customer website: `marketing-site/bar-pos.html` and `marketing-site/packages.html` now show the new prices and dependency.

## Remaining release work

Incorporate the new wording into the next reviewed manual candidate, produce any required Subscription screenshot with the dependency visible, rebuild and review the PDFs and pagination, update coverage/screenshot records, obtain human approval, and verify the approved pair in the packaged app through ordinary authenticated offline Help & guides. Do not promote the current candidate pair or change the manifest before those gates pass.
