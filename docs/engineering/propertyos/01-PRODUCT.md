# Product scope and commercial rules

Authority: [handoff](README.md). Requirements derive from [the benchmark](../../research/propertyos-benchmark-2026-10-23.md); candidate IDs are preserved in [the matrix](feature-matrix.csv).

## Product promise

Help property businesses win instructions, operate tenancies and deliver building services through one accountable history. One property can have an active lease, a sales listing and maintenance at the same time. Never collapse those independent lifecycles into one generic status.

## Customers and profiles

| Profile | Primary work | First screen |
|---|---|---|
| Residential manager | Let units, collect rent, maintain them and account to owners | Arrears, vacancies, approvals and critical dates |
| Estate agency | Win mandates, market, arrange viewings and progress deals | New leads, viewings, offers and overdue next actions |
| Commercial manager | Leases, reviews, operating charges and building operations | Critical dates, charge exceptions and lease performance |
| Facilities provider | Operate client sites under service agreements | Dispatch, overdue service targets and preventive work |
| Mixed business | Several of the above | Role-specific overview and workspace switcher |

Profiles change defaults, wording and navigation order. They do not grant permissions, change purchased modules or permanently exclude later workflows. Property classifications (house, apartment, office, industrial unit, land, mixed-use) describe records, not product licences.

Initial segment hypothesis: residential managers providing lettings and routine repairs. Confirm in W00/D01; no market size or willingness-to-pay claim is established.

## Modules and standalone completeness

| Purchase | Required independent journey | Must not require another commercial module |
|---|---|---|
| Management | Property onboarding -> application -> lease -> charges/receipts -> maintenance -> owner statement -> renewal or settlement | Ordinary letting, routine repairs, deposits and owner accounting |
| Agency | Mandate -> listing -> lead/viewing -> offer -> transaction -> commission | Sales administration and client documents |
| Facilities | Client/site agreement -> assets/plan -> job -> verified completion -> cost/client billing | Sites without leases, tenants or owner distribution |

Shared services are reused technically, not sold repeatedly. Basic listing/applicant/appointment primitives serve rental letting without full Agency. Basic repair requests serve Management without full Facilities. Advanced equipment, recurring service and contractor execution form Facilities depth.

The shared core includes scoped identity, property/contact records, documents, daily tasks, permissions, approvals, audit, basic reports/export and safe recovery. Financial posting services are included wherever a purchased workflow needs them.

## Commercial configuration

Stable proposed keys: product `property-os`; modules `agency`, `management`, `facilities`. Bundle keys represent combinations, not duplicate access grants. Treat these as reserved planning identifiers until W01 checks for collisions.

Required combinations: each single module, each of the three pairs and all three: seven active configurations. Zero modules is setup/read-only entitlement recovery, never accidental full access. Entitlements are product- and organisation-bound, versioned and server-authoritative.

Pricing is **not approved**. The earlier numerical points were explanatory examples, not prices. D05 resolves currency, cadence, setup charges, unit/user/site metrics, included allowances, overages, trials, discounts, proration, refunds and taxes. Existing commercial code currently includes annual/initial/one-time models; monthly billing cannot be assumed to exist.

Quote arithmetic must use one versioned server catalogue: base lines + module lines + explicit bundle discount + provider usage + applicable tax = payable amount. UI estimates are labelled. Store accepted quote/catalogue snapshots; do not recompute past invoices from today's catalogue. Discount eligibility, module dependencies and capacity rules are enforced server-side.

Do not paywall essential audit, baseline security, correction history, financial correctness or export of the customer's authorised records. External participants needed to complete a workflow should not face unexpected paid staff seats. Rate/storage limits may be documented.

On downgrade: stop new out-of-entitlement work; preserve authorised historical reading/export and controlled resolution of outstanding obligations. Revoked access for a removed user still takes precedence. Never delete records or silently discard offline work because a module expires. Settlement exceptions must be explicit server policies, not a broad bypass.

## Surface scope

- Desktop: internal staff; Electron packaging and native file/report operations.
- Companion web/mobile: selected field tasks and client portals. Choose separate app build or strict product entry during W12; do not add real-estate screens to Manager PWA by default.
- Public property pages: approved listings and rate-limited enquiry endpoints only.
- Privileged administration: product subscription/support management integrated with Command Central through explicit scoped contracts.
- Legacy POS, hospitality booking site and local Bar service: no PropertyOS business callers. Shared changes require regression evaluation, not automatic feature propagation.

## Full benchmark disposition

All C01–C20, P01–P20, M01–M20, A01–A20, F01–F20 and X01–X20 remain required design candidates. Priority in the original research is per-workflow: a P0 financial control cannot be postponed after exposing the financial feature, but it need not force every module into the first release.

The matrix assigns each candidate a work package, prerequisites, release gate and test family. The 30 detail rows have separate tracking. Scope changes require a dated rationale and replacement acceptance, not deletion of a benchmark ID.

## Delivery stages

| Gate | Outcome | Exclusions that remain honest |
|---|---|---|
| G0 Foundation | Isolated product, authenticated scoped shell, domain/finance contracts and test infrastructure | No live financial operation claimed |
| G1 Management pilot | Complete residential management plus basic portals, import, owner accounting and routine repair handling | Unsupported bank execution, advanced commercial leases and sales remain unavailable |
| G2 Agency pilot | Complete sales journey with controlled commissions | Unsupported listing portals and dependency chains disabled |
| G3 Facilities pilot | Service contracts, assets, preventive jobs and independent client billing | Advanced parts, sensors and space planning may follow |
| G4 Operational depth | Reliable offline field work, automations, procurement, reporting and selected integrations | Only supported/qualified providers advertised |
| G5 Specialist/enterprise | Commercial recoveries, complex ownership/reporting, investor scenarios, enterprise integrations | Segment policies and support capacity are mandatory |

Every gate also depends on W23 release qualification for the product/surfaces being shipped. A later specialist feature cannot ship merely because its earlier module has passed its pilot.

## Product quality targets

Before a pilot, test a provisional reference portfolio of 1,000 units, 20 staff, 100,000 ledger lines, 10,000 tasks and representative document volume. These are test targets, not advertised limits. D12 converts measurements into supported minimum hardware and performance budgets. Test 360px mobile width, keyboard operation, readable focus/error states, large data pagination and slow-network upload recovery.

Track first response, vacancy days, unresolved arrears, unreconciled differences, owner statement preparation, repair turnaround, reopened jobs and time-to-first-completed-workflow. Document denominators and date basis; never equate cash received with earned income.

## Explicit non-goals

No rewrite of the existing three products; no repurposing bookings as leases; no fake payments; no universal product launcher; no automatic sharing of private data across management companies; no local-Bar authority reuse; no speculative compliance certification; no requirement to build AI before reliable core workflows.
