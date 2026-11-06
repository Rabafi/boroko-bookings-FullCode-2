# Tsa Bonno PropertyOS — implementation handoff

Plan revision: 1.0, 23 October 2026. Status: documented; application implementation NOT STARTED.

This is the entry point for implementing the separately packaged **Tsa Bonno PropertyOS** product, with Agency, Management and Facilities modules. It records the user's agreed direction and proposed engineering decisions. It is not permission to deploy, provision paid services or change existing hospitality product behaviour.

## Read in this order

1. Repository [AGENTS.md](../../../AGENTS.md), [PROJECT_STATE.md](../../../PROJECT_STATE.md), [architecture](../../ARCHITECTURE.md) and [release runbook](../../SHIP_READY_RUNBOOK.md).
2. [Original benchmark](../../research/propertyos-benchmark-2026-10-23.md): 16 main product families, 120 capability candidates, 30 smaller details and original source links.
3. [Product scope and commercial rules](01-PRODUCT.md).
4. [Architecture and repository integration](02-ARCHITECTURE.md).
5. [Data, commands and financial contracts](03-DATA-AND-CONTRACTS.md).
6. [Ordered work packages](04-IMPLEMENTATION.md) and [dependency register](05-DEPENDENCIES.md).
7. [UX and workflow acceptance](06-UX-AND-WORKFLOWS.md).
8. [Verification and release](07-VERIFICATION-AND-RELEASE.md).
9. [Decisions, risks and continuation](08-DECISIONS-AND-STATUS.md), [capability traceability](feature-matrix.csv) and [small-detail traceability](detail-matrix.csv).

## What is decided

- Name: Tsa Bonno PropertyOS, subject to brand/trademark checks before launch.
- A fourth desktop product built from the shared Electron workspace, with its own installer, product identity, local storage and release feed.
- One PropertyOS application containing three separately purchasable modules and combinations. No universal launcher or cross-product session switcher is part of this plan.
- TypeScript with strict checking for new product code, React UI, Electron desktop and PostgreSQL/Supabase authority.
- Shared property/contact/document/task infrastructure; distinct leases, sales, maintenance and financial contracts.
- Research coverage is retained even where a capability belongs to a later release.

## What is not decided

Exact prices, billing cadence, capacity metrics, launch geography, payment/bank/listing/signature providers, production database topology, initial authentication integration, platform support and final financial policy. These have bounded decision tasks in [the register](08-DECISIONS-AND-STATUS.md). They do not block mockups, typed contracts or a product skeleton; they do block dependent production commitments.

## First action for a future agent

Execute **W00 only** in [the implementation plan](04-IMPLEMENTATION.md), recording the current checkout, applicable instructions, source drift and baseline evidence. Then work on W01/W02 in dependency order. Do not jump directly to a large UI scaffold or migrate a linked database.

The checkout was heavily modified at inspection (168 tracked modified files on 23 October); this is historical evidence, not a current count. Preserve unrelated changes. A folder named `docs/engineering/property-adaptation/` already exists and concerns accommodation adaptation, not this new real-estate product. Do not resume its prompts or rename its work into PropertyOS.

## Working rules for a smaller model

1. Select one ready work package with completed prerequisites.
2. Read its cited contracts and relevant source. Confirm names still exist with `rg`.
3. Write the acceptance example and failure cases before editing.
4. Build one complete vertical slice: schema/RPC, permissions, typed bridge, UI, reports/replay where applicable, tests and operator guidance.
5. An empty screen, fixture UI or static source assertion is not evidence of a working business workflow.
6. Keep unknown/provider-dependent features unavailable with an honest explanation. Never invent payment confirmation, screening outcomes, signatures, ownership or legal compliance.
7. Run the package's focused checks, then required affected-product regression checks. Record commands and results.
8. Update the status and traceability rows with evidence; do not label a plan item implemented just because its files exist.
9. Stop only the dependent work if a real prerequisite is missing. Continue independent documentation/contracts/tests. Ask the user only for decisions that cannot safely be resolved from evidence.

## Evidence language

Use separate states: `planned`, `in_progress`, `source_complete`, `locally_verified`, `deployed`, `release_qualified`, `blocked`. A skipped required test is not a pass. A source build is not an installed/signed release. Never infer live schema from migration files.

Run `node docs/engineering/propertyos/validate-plan.mjs` to check document links, ID coverage and work-package dependency integrity. The validator verifies the plan's structure, not the application's implementation.

Manual impact: no Bar manual update required for this documentation-only plan. Future shared-shell changes must assess Bar impact separately.
