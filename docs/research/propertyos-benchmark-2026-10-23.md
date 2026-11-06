# PropertyOS competitive benchmark and product design brief

Research date: 23 October 2026 (Africa/Gaborone)

Status: research and proposed design, not an implementation commitment or release claim. PropertyOS is a working name.

## 1. Findings that should shape the product

Build one connected property product with Agency, Property Management and Facilities modules. Its advantage should be completing work across those departments while preserving one property history, clear accountability and correct money records.

The benchmark suggests six design priorities:

1. **One property, many relationships.** A property can be marketed, occupied, maintained and owned by several parties simultaneously. Listing status, occupancy, maintenance readiness and ownership must be separate concepts.
2. **Complete journeys.** Capture enquiry through transaction, tenancy through settlement, and service request through verified completion and billing.
3. **Money deserves its own design.** Collections, deposits, owner funds, management fees and contractor payments are different records and obligations.
4. **The mobile experience is part of the product.** Agents, inspectors and technicians work away from the desktop. Electron alone does not meet that requirement.
5. **Small controls create confidence.** Clear pending-payment states, missing-document prompts, key custody, next-action reminders and understandable recovery matter alongside major modules.
6. **Automation must know when to stop.** A reply, dispute, payment or changed instruction should interrupt inappropriate reminders and route work to a person.

These are our conclusions from the sources below, not claims that every competitor implements every detail.

## 2. Research method and limits

Reviewed official vendor product pages, help documentation, product tours and published packaging information across the 16 vendor/product families in the comparison table, with Propertybase documentation providing an additional lead-routing reference. The sample covers residential management, commercial management, agency CRM, rental payments, maintenance execution and enterprise facilities/workplace systems.

Evidence labels:

- **Documented:** an official source explicitly describes the capability. It is vendor-published evidence, not independent verification of quality.
- **Proposed:** our feature or workflow design, informed by the benchmark.
- **Validate:** requires a product demo, customer interview, local provider confirmation or jurisdiction-specific assessment.

No paid accounts, private demos or hands-on competitor trials were used. Feature availability can depend on plan, region, integrations and rollout. Lack of evidence is not evidence that a vendor lacks a feature. Marketing performance percentages, rankings and compliance assurances are not adopted as independently established facts. This research does not establish Botswana payment, screening, legal, listing-feed or e-signature availability.

## 3. Competitor benchmark

The final column is our interpretation of what to learn, rather than a vendor statement.

| Product | Documented benchmark | Design lesson for PropertyOS |
|---|---|---|
| Buildium | Leasing, operations, accounting, payments, resident/owner access and reporting appear in its platform and plan descriptions. [Features](https://www.buildium.com/Features/), [plan comparison](https://www.buildium.com/pricing/) | A rental module must operate as a complete business tool, including external participants. |
| AppFolio | Its accounting page describes owner portfolio accounting, bank matching, deposit handling and commercial expense reconciliation. [Accounting](https://www.appfolio.com/property-manager/accounting-reporting) | Portfolio totals need explainable underlying transactions and entity boundaries. |
| PropertyMe | Its feature catalogue connects communications, tasks, renewals, documents, jobs and property/client views. [Features](https://www.propertyme.com.au/features) | Put related work in context instead of scattering it across disconnected screens. |
| Yardi Breeze | Documents integrated accounting, batch receipts, owner reports, maintenance evidence and common-area expense recovery. [Features](https://www.yardibreeze.com/features/) | Simple daily operation and accounting depth can coexist. |
| DoorLoop | Its help centre distinguishes bank transaction importing/matching from reconciliation and documents a reconciliation wizard. [Matching versus reconciliation](https://support.doorloop.com/en/articles/6273146-bank-transactions-sync-vs-reconciliation), [wizard](https://support.doorloop.com/en/articles/6247012-bank-reconciliation-in-doorloop) | Explain financial states precisely; an imported transaction is not a reconciled account. |
| TenantCloud | Describes landlord, tenant, owner and service-provider portals, plus joint or split roommate rent. [Portals](https://support.tenantcloud.com/en/articles/12781485-account-portals-guide), [roommates](https://www.tenantcloud.com/roommates) | Model several people on one lease and design a purposeful experience for each participant. |
| Re-Leased | Describes commercial lease events, rent review structures, multiple ownership entities, operating-expense apportionment and portfolio reports. [Commercial management](https://www.re-leased.com/en-gb/commercial-property-software), [reporting](https://www.re-leased.com/product/property-management-reporting) | Commercial leasing requires more than residential rent with extra fields. |
| Reapit | Sales CRM connects applicants, properties, vendors, matching, progression and workflow checklists; property management and client accounting are connected offerings. [Sales CRM](https://www.reapit.com/platform/sales-crm), [property management](https://www.reapit.com/platform/property-management), [client accounts](https://www.reapit.com/platform/client-accounts) | Agency needs a serious transaction journey and relationship history. |
| Street.co.uk | Documents appointment reminders, buyer confirmation/cancellation, viewing feedback and client visibility. Its FAQ distinguishes offer visibility from authority to accept an offer. [Viewing workflow](https://street.co.uk/product/index/viewing-management), [FAQ](https://street.co.uk/faqs) | Self-service should remove coordination work while preserving explicit decision authority. |
| Prop Data | Documents regional listing distribution, valuations, lead routing, mandate feedback, commissions and transfer tracking. [Manage](https://www.propdata.net/manage-solution) | Southern African agency workflows and distribution partners deserve direct consideration. |
| PayProp | Describes rental collection, reconciliation, recipient payments, arrears communication and a branded tenant portal. [South African features](https://www.payprop.com/za/features) | Payment allocation, payout explanation and client communications are part of the operating workflow. |
| MRI Property Central | Describes integrated financials, credit control, facilities workflows and portfolio analysis for South African residential and commercial portfolios. [Product](https://www.mrisoftware.com/za/products/property-central/) | A connected operations/accounting/facilities proposition has established regional comparators. |
| WeconnectU / RedRabbit | Describes inspection evidence, offline inspection mode and creating maintenance tickets during inspections. [Mobile/inspection capabilities](https://www.weconnectu.co.za/totg), [inspection-to-maintenance discussion](https://www.weconnectu.co.za/news/the-smart-and-easy-approach-to-value-adding-maintenance-management) | An inspection should lead directly to corrective work with its evidence attached. |
| MaintainX | Help documentation covers cached offline work orders, mobile QR scanning, timers and meter-triggered maintenance. [Offline](https://help.getmaintainx.com/offline-mode), [mobile](https://help.getmaintainx.com/mobile-vs-web-overview), [meters](https://help.getmaintainx.com/about-meters) | Offline scope and sync behaviour need explicit product design. |
| Building Engines / Prism | Documents routed work orders, spending limits, billable services, preventive maintenance, vendor bids and insurance tracking. [Work orders](https://www.buildingengines.com/operations/work-orders/), [preventive maintenance](https://www.buildingengines.com/operations/preventive-maintenance/), [bids](https://www.buildingengines.com/operations/bid-management/), [insurance](https://www.buildingengines.com/operations/insurance/) | Facilities is a cost, service and asset-control discipline, beyond a repair list. |
| Planon | Describes space management, service contracts, mobile field services, workplace reservations, CAD/BIM connections and sensor-supported workplace insights. [Workplace services](https://planonsoftware.com/us/software/iwms/space-workplace-services-management/), [IWMS](https://planonsoftware.com/uk/software/iwms/) | Preserve an enterprise expansion path without making enterprise breadth the initial scope. |

The table contains 16 named product families; some have multiple related offerings. This is a deliberately varied comparison set, not a ranking of interchangeable products.

## 4. Proposed structure and module boundaries

| Layer | Included capabilities | Boundary |
|---|---|---|
| Shared core | Organisations, branches, property hierarchy, contacts, files, communication history, tasks, permissions, audit and basic reporting | Included with any purchased module. |
| Agency | Mandates, listings, prospects, matching, viewings, offers, transaction milestones and commission handling | Operates independently of rent collection. |
| Property Management | Leases, occupants, charges, collections, deposits, arrears, renewals, inspections, owner statements and routine repair handling | A manager can serve tenants without buying Facilities. |
| Facilities | Equipment/assets, preventive plans, service-level agreements, technician scheduling, contractor controls, parts and service contract costing | Operates for client sites even if no lease is managed. |
| Shared finance services | Posting, allocations, approvals, audit, reconciliation and financial reporting infrastructure | Available as needed by a purchased workflow; financial correctness is never an add-on. |
| External experiences | Tenant, owner, buyer/seller and contractor access | Narrowly scoped views into the same records, with explicit authority for each action. |

Routine repair requests belong in Property Management. Facilities adds depth: equipment histories, recurring maintenance, service contracts, workforce planning and technical cost analysis. There should be one underlying work-order model with capability extensions, not two competing ticket systems.

Module subscription, user permission, business profile and record state are separate gates. A company purchasing Facilities does not automatically give every employee approval authority. Selecting an Agency profile does not prevent a company activating rental operations later.

## 5. Proposed capability catalogue: 120 candidates

All entries in this section are **proposed PropertyOS requirements**, not assertions that every detail exists in the cited products. The evidence paragraphs identify the documented patterns that informed each group.

Priority definitions:

- **P0:** required before the relevant workflow is sold or handles live authoritative records. This is a release gate for that workflow, not an instruction to build every module at once.
- **P1:** operational depth for the next release after a complete first customer journey.
- **P2:** segment-specific or enterprise expansion after demand and dependencies are validated.

### A. Shared foundation — 20 candidates

Evidence pattern: Reapit describes unified client/property histories; MRI describes cross-portfolio operations; PropertyMe describes property/client views and tasks. [Reapit](https://www.reapit.com/platform/sales-crm), [MRI](https://www.mrisoftware.com/za/products/property-central/), [PropertyMe](https://www.propertyme.com.au/features)

| ID | Capability | Detail that defines the proposed implementation | Priority |
|---|---|---|---|
| C01 | Organisation and branch structure | Separate operating company, branch, owner entity and managed client. | P0 |
| C02 | Flexible property hierarchy | Standalone property or site/building/floor/unit/space, without mandatory empty levels. | P0 |
| C03 | Relationship-based contacts | One person can be owner, seller, tenant and buyer in different contexts. | P0 |
| C04 | Ownership history | Ownership shares and effective dates preserve historical reporting. | P0 |
| C05 | Management agreements | Scope, fees, authority limits, start/end dates and exit obligations. | P0 |
| C06 | Property overview | Show occupancy, agency activity, faults, documents and money with appropriate access. | P0 |
| C07 | Search | Find by unit, reference, address, phone, contact or document metadata. | P0 |
| C08 | Personal work queue | Assigned actions, deadlines, blockers and delegated cover. | P0 |
| C09 | Shared activity history | Business events, messages and decisions in time order, with visibility controls. | P0 |
| C10 | Documents | Versions, expiry dates, access scope, signature status and retention categories. | P0 |
| C11 | Communication records | Link conversations to the correct property, person, tenancy or deal. | P0 |
| C12 | Calendar | Appointments, inspections, contractor visits and critical dates in context. | P0 |
| C13 | Templates and checklists | Reusable procedures with required evidence and named responsibility. | P0 |
| C14 | Scoped permissions | Enforce organisation, branch, property, field and action access server-side. | P0 |
| C15 | Approval policies | Amount thresholds, delegated limits, independent reviewers and recorded reasons. | P0 |
| C16 | Audit and recovery | Preserve before/after changes and safe correction paths for important records. | P0 |
| C17 | Migration workspace | Preview mapping, detect duplicates and validate opening balances before activation. | P0 |
| C18 | Basic reporting/export | Export authorised records and documents with predictable identifiers. | P0 |
| C19 | Configurable fields/views | Typed custom fields and saved filters without changing core accounting rules. | P1 |
| C20 | Integration operations | Scoped APIs, webhooks, delivery logs, retries and duplicate-event protection. | P1 |

### B. Property Management — 20 candidates

Evidence pattern: Buildium and Yardi cover leasing/operations; Reapit describes renewals and tenancy tasks; TenantCloud documents several occupants sharing rent; PropertyMe describes digital inspections and their completion states. [Buildium](https://www.buildium.com/Features/), [Yardi](https://www.yardibreeze.com/features/), [Reapit tenancy workflows](https://www.reapit.com/platform/property-management), [roommates](https://www.tenantcloud.com/roommates), [inspections](https://www.propertyme.com.au/features/paperless-inspections)

| ID | Capability | Detail that defines the proposed implementation | Priority |
|---|---|---|---|
| P01 | Unit availability | Distinguish vacant, occupied, reserved, unavailable and awaiting repairs. | P0 |
| P02 | Applications | Configurable forms, document checklist, consent and review outcome. | P0 |
| P03 | Applicant checks | Track verified checks and references; enable external screening only where supported. | P1 |
| P04 | Lease drafting | Versioned terms, attachments, parties and approval before issue. | P0 |
| P05 | Signing workflow | Signer order, reminders, final document and evidence of completion. | P1 |
| P06 | Joint occupants | Co-tenants, guarantors and payer allocations without altering contractual liability accidentally. | P0 |
| P07 | Move-in checklist | Required funds, inspections, access handover and outstanding exceptions. | P0 |
| P08 | Rent schedule | Explicit periods, due dates, proration and effective-dated adjustments. | P0 |
| P09 | Recurring charges | Separate rent, utilities, parking and other authorised charges. | P0 |
| P10 | Arrears cases | Ageing, contact history, disputes and promised payment dates. | P0 |
| P11 | Renewals | Due-date queue, proposed terms, owner instruction and tenant response. | P0 |
| P12 | Rent reviews | Preview future increases and keep approval/notice evidence. | P1 |
| P13 | Inspections | Entry, routine and exit templates; room-level photos and comments. | P0 |
| P14 | Condition comparison | Compare dated inspection evidence without overwriting earlier findings. | P1 |
| P15 | Routine repairs | Requests, owner consent, contractor assignment and completion evidence. | P0 |
| P16 | Notice and termination | Track requested, approved and effective dates plus unresolved obligations. | P0 |
| P17 | Move-out settlement | Review arrears, proposed deductions, deposit allocation and disputed items. | P0 |
| P18 | Unit turnover | Coordinate cleaning, repairs, inspection and marketing readiness. | P1 |
| P19 | Commercial lease terms | Rent-free periods, stepped schedules, options and critical dates. | P2 |
| P20 | Shared operating charges | Configurable allocation pools, budgets, actuals and annual true-up. | P2 |

### C. Money and owner operations — 20 candidates

Evidence pattern: AppFolio documents portfolio accounting; Reapit covers receipts and payment runs; PayProp links collections to recipient payments; DoorLoop documents reconciliation completion; Re-Leased and Yardi cover commercial charges. [AppFolio](https://www.appfolio.com/property-manager/accounting-reporting), [Reapit client accounts](https://www.reapit.com/platform/client-accounts), [PayProp](https://www.payprop.com/za/features), [DoorLoop reconciliation](https://support.doorloop.com/en/articles/6247012-bank-reconciliation-in-doorloop), [Re-Leased reporting](https://www.re-leased.com/product/property-management-reporting)

| ID | Capability | Detail that defines the proposed implementation | Priority |
|---|---|---|---|
| M01 | Financial ledger | Balanced postings with source documents and controlled reversals. | P0 |
| M02 | Fund separation | Distinguish owner/client money, deposits and management-company earnings. | P0 |
| M03 | Charges and credits | Effective dates, reasons and linked adjustments rather than silent balance edits. | P0 |
| M04 | Receipt allocation | Allocate one payment across charges and retain unallocated amounts explicitly. | P0 |
| M05 | Settlement states | Distinguish submitted, pending, confirmed, failed and reversed payments. | P0 |
| M06 | Bank import | Deduplicate statement rows and preserve source-file provenance. | P0 |
| M07 | Matching and reconciliation | Show uncertain matches, unexplained differences and statement-period sign-off. | P0 |
| M08 | Deposit subledger | Track receipts, holdings, proposed deductions and approved refunds separately. | P0 |
| M09 | Fees | Agreement-based fees with calculation detail and effective dates. | P0 |
| M10 | Owner reserves | Explain held amounts, earmarked bills and genuinely distributable funds. | P0 |
| M11 | Owner statements | Reconcile opening funds, movements, fees, reserves and closing funds. | P0 |
| M12 | Payout proposals | Preview recipients and amounts; require approval and settlement reconciliation. | P0 |
| M13 | Beneficiary controls | Verify changes and separate beneficiary editing from payment approval. | P0 |
| M14 | Supplier bills | Detect likely duplicates and link invoice, job, approval and payment. | P0 |
| M15 | Collections arrangements | Track approved payment plans, partial receipts and broken promises. | P1 |
| M16 | Close controls | Period locks, controlled reopening and an audit of adjustments. | P0 |
| M17 | Financial reporting | Rent roll, ageing, liabilities, income/expense and cash movement reports. | P0 |
| M18 | Budget monitoring | Compare budget, committed spend and actual costs per property. | P1 |
| M19 | Accounting connectors | Define posting ownership, mapping, error queues and reconciliation. | P1 |
| M20 | Multi-currency | Separate transaction, settlement and reporting currency with rate provenance. | P2 |

Recording a payout and executing a bank payment are different capabilities. Bank/payment integrations require confirmed country coverage, provider agreements and reconciliation contracts. CSV/manual reconciliation must remain usable where a live feed is unavailable. Automated local bank execution is not assumed.

### D. Estate Agency — 20 candidates

Evidence pattern: Reapit covers matching and sales progression; Prop Data covers distribution, commissions and mandate reporting; Street documents viewing coordination and offer visibility; Propertybase help documents routing methods. [Reapit sales](https://www.reapit.com/platform/sales-crm), [Prop Data](https://www.propdata.net/manage-solution), [Street viewings](https://street.co.uk/product/index/viewing-management), [Street FAQ](https://street.co.uk/faqs), [Propertybase routing](https://help.propertybase.com/hc/en-us/articles/360003066252-How-to-Use-Lead-Routing)

| ID | Capability | Detail that defines the proposed implementation | Priority |
|---|---|---|---|
| A01 | Lead capture | Record source, listing, consent and first-response responsibility. | P0 |
| A02 | Lead routing | Assign by branch/area/team with duplicate checks and unclaimed-lead escalation. | P1 |
| A03 | Buyer/renter requirements | Budget, area, property needs and financing/readiness evidence. | P0 |
| A04 | Matching | Explain why a property matches and allow reviewed outreach. | P1 |
| A05 | Appraisals | Book valuation visits and retain comparables and assumptions. | P1 |
| A06 | Mandates | Seller authority, duration, fee agreement and expiry reminders. | P0 |
| A07 | Listing preparation | Structured facts, images, descriptions and approval before publication. | P0 |
| A08 | Listing validation | Missing-field prompts and separate internal versus public information. | P0 |
| A09 | Portal distribution | Channel-specific publication status, errors, amendments and withdrawal. | P1 |
| A10 | Viewing scheduling | Availability, agent/vendor confirmation, reminders and cancellation rules. | P0 |
| A11 | Viewing outcomes | Feedback, no-show reasons, next action and seller-visible summary. | P0 |
| A12 | Offer register | Amount, conditions, finance status, expiry and communication history. | P0 |
| A13 | Offer decisions | Record instructed decisions and counteroffers; never infer acceptance from a read receipt. | P0 |
| A14 | Transaction milestones | Documents, financing, inspections, conveyancer handoffs and transfer/completion tracking. | P0 |
| A15 | Linked transaction dependencies | Show dependent sales or other blockers where the target market requires them. | P2 |
| A16 | Commission calculation | Deal/agent/branch/referral splits with versioned fee rules and reversals. | P0 |
| A17 | Seller performance reports | Enquiries, viewings, feedback, offers and agreed next steps. | P1 |
| A18 | Prospect follow-up | Triggered follow-ups that stop after reply, withdrawal or changed consent. | P1 |
| A19 | Team conversion reporting | Lead-to-viewing, viewing-to-offer and transaction outcomes with consistent definitions. | P1 |
| A20 | Sale-to-management handover | Reuse authorised property data to create management onboarding after completion. | P1 |

A letting journey must be available to Property Management customers even without full sales Agency. Share the application/listing/appointment primitives; reserve sales mandates, offers, transaction progression and sales commissions for Agency depth.

### E. Facilities Management — 20 candidates

Evidence pattern: Prism documents work routing and spending limits, bids, insurance and preventive maintenance; MaintainX covers meters, inventory/purchasing packaging and field use; Planon covers service contracts and space operations. [Prism work orders](https://www.buildingengines.com/operations/work-orders/), [bids](https://www.buildingengines.com/operations/bid-management/), [insurance](https://www.buildingengines.com/operations/insurance/), [MaintainX meters](https://help.getmaintainx.com/about-meters), [MaintainX features by plan](https://www.getmaintainx.com/pricing), [Planon](https://planonsoftware.com/us/software/iwms/space-workplace-services-management/)

| ID | Capability | Detail that defines the proposed implementation | Priority |
|---|---|---|---|
| F01 | Site and asset register | Location, serial number, model, warranty, criticality and service history. | P0 |
| F02 | QR identification | Scan an asset/location to open its authorised history and report a fault. | P1 |
| F03 | Request intake | Capture location, symptoms, severity, access permission and evidence. | P0 |
| F04 | Work-order lifecycle | Requested, approved, assigned, underway, blocked, completed and verified states. | P0 |
| F05 | Service deadlines | Explicit response/resolution targets, pause reasons and escalation ownership. | P0 |
| F06 | Dispatch | Assign by skill, site access and schedule, with reassignment history. | P0 |
| F07 | Contractor records | Trade, service area, contacts, documents and authorised work scope. | P0 |
| F08 | Quote comparison | Common scope, itemised prices, exclusions and recorded selection reason. | P1 |
| F09 | Spend limits | Authorised ceiling and additional approval before committing an overrun. | P0 |
| F10 | Preventive plans | Calendar schedules, checklists and rules to avoid duplicate generated jobs. | P0 |
| F11 | Usage-triggered work | Runtime, distance or condition readings with validated trigger rules. | P1 |
| F12 | Technical procedures | Versioned steps, readings, evidence and required sign-off. | P0 |
| F13 | Offline field execution | Cached assignments, pending photos, durable updates and conflict recovery. | P1 |
| F14 | Time/material costing | Labour, travel, parts and subcontracting separated from billed amounts. | P1 |
| F15 | Parts inventory | Reservations, issues, returns, counts and reorder thresholds. | P1 |
| F16 | Procurement | Request, approved order, receipt and supplier-invoice matching. | P1 |
| F17 | Service contracts | Covered sites/assets, included tasks, exclusions, renewal dates and billing basis. | P0 |
| F18 | Defects and incidents | Evidence, corrective action, review and reopened/repeat-fault history. | P0 |
| F19 | Reliability and replacement | Downtime, repeated failures, repair cost and replacement planning. | P2 |
| F20 | Workplace/building extensions | Floor plans, space reservations, visitor workflows and utility/sensor integration. | P2 |

A Facilities-only customer needs client billing and service-cost reporting, without tenant rent or owner distribution requirements. The shared finance layer must support that independent operating model.

### F. External experience, intelligence and adoption — 20 candidates

Evidence pattern: TenantCloud documents role-specific portals; MaintainX describes offline constraints; AppFolio describes interruptible workflows and supervised AI; Re-Leased covers reports and scheduled distribution; DoorLoop and Yardi describe onboarding/support. [TenantCloud portals](https://support.tenantcloud.com/en/articles/12781485-account-portals-guide), [offline](https://help.getmaintainx.com/offline-mode), [AppFolio Flows](https://www.appfolio.com/product-demos/realm-x-flows), [Re-Leased reporting](https://www.re-leased.com/product/property-management-reporting), [DoorLoop](https://www.doorloop.com/features), [Yardi](https://www.yardibreeze.com/features/)

| ID | Capability | Detail that defines the proposed implementation | Priority |
|---|---|---|---|
| X01 | Tenant portal | Statements, documents, requests and clear payment status. | P0 |
| X02 | Owner portal | Property performance, statements, approvals and shared evidence. | P0 |
| X03 | Buyer/seller portal | Appointments, permitted feedback, required documents and transaction milestones. | P1 |
| X04 | Contractor interface | Assigned work, allowed tenant/access details, quotes, updates and invoices. | P0 |
| X05 | Mobile staff workspace | Fast field capture without exposing the full desktop interface. | P0 |
| X06 | Workflow templates | Renewals, move-ins, arrears, inspections and maintenance with named owners. | P1 |
| X07 | Automation supervision | Trigger history, pause/stop conditions, dry-run preview and failure inbox. | P1 |
| X08 | Communication preferences | Channel consent, delivery failures, quiet hours and emergency exceptions. | P0 |
| X09 | Operational dashboards | Actionable exceptions by role, branch and portfolio. | P0 |
| X10 | Report drill-through | Open the exact authorised records behind a number. | P0 |
| X11 | Scheduled reports | Recipient permissions rechecked at send time; logs of delivery and failures. | P1 |
| X12 | Portfolio performance | Income, costs, vacancy and maintenance trends with dated definitions. | P1 |
| X13 | Investor scenarios | Keep forecasts, assumptions and valuations separate from confirmed actuals. | P2 |
| X14 | AI drafting | Reviewable communications and summaries that cite the relevant record context. | P1 |
| X15 | Document extraction | Proposed lease/bill fields with source excerpts and human verification. | P2 |
| X16 | Maintenance assistance | Approved troubleshooting guidance and immediate escalation for hazardous issues. | P2 |
| X17 | AI action governance | Existing permissions, explicit approvals and an audit for consequential actions. | P0 if AI acts |
| X18 | Assisted onboarding | Sample data, role-based tours, import assistance and opening-balance sign-off. | P0 |
| X19 | Localisation | Currency/date/phone formats and country-specific configurable templates. | P0 |
| X20 | Continuity and exit | Tested recovery, permission-scoped exports and safe subscription downgrade. | P0 |

## 6. Thirty small details worth specifying explicitly

These are proposed acceptance details, not a claim of competitor parity. Directly documented inspirations include [PropertyMe key custody](https://www.propertyme.com.au/features/key-management), [inspection statuses](https://www.propertyme.com.au/features/paperless-inspections), [Street notification configuration](https://street.co.uk/faqs), [TenantCloud payment states](https://support.tenantcloud.com/en/articles/11930700-let-s-get-started), [MaintainX cache visibility](https://help.getmaintainx.com/offline-mode) and [AppFolio interruption logic](https://www.appfolio.com/product-demos/realm-x-flows).

| # | Small detail | Why it matters |
|---|---|---|
| 1 | Property/unit reference remains visible on every form and confirmation. | Reduces edits and payments against the wrong unit. |
| 2 | Warn about likely duplicate contacts and offer a reviewed merge. | Preserves relationship history without accidental duplicates. |
| 3 | Save a draft and return to the same step. | Real work is interrupted by calls and missing documents. |
| 4 | Restore list filters and scroll position after opening a record. | Makes portfolio processing much faster. |
| 5 | Show the next action and responsible person on every active case. | Prevents a pipeline full of forgotten work. |
| 6 | Identify exactly which document or approval blocks progress. | Replaces vague failure messages with recoverable steps. |
| 7 | Distinguish internal notes, client-visible messages and audit events. | Prevents accidental disclosure and confusing histories. |
| 8 | Preview recipient, attachments and personalisation before a bulk send. | Avoids embarrassing or harmful communication errors. |
| 9 | Show send failure separately from delivered or read. | A message being queued is not client acknowledgement. |
| 10 | Let branch/property preferences override company notification defaults. | Handles exceptions without disabling useful notices globally. |
| 11 | Suspend automated chasing when a payment or dispute changes the case. | Avoids contradictory or inappropriate reminders. |
| 12 | Viewing confirmation, cancellation and directions use minimal steps. | Reduces coordination calls and missed appointments. |
| 13 | Prompt for viewing feedback while the details are fresh. | Improves seller updates and follow-up quality. |
| 14 | Keep key checkout, holder, return deadline and overdue alert. | Prevents lost access and wasted site visits. |
| 15 | Separate key identifiers from publicly exposed addresses. | Makes custody records safer to handle. |
| 16 | Carry inspection photos into the repair request automatically. | Avoids describing and uploading the same defect again. |
| 17 | Show capture time, upload time and author separately on field evidence. | Helps explain delayed uploads; timestamps alone are not proof of authenticity. |
| 18 | Allow resuming a failed photo upload without duplicating the job. | Makes field use reliable on weak connectivity. |
| 19 | Display last sync time and count of unsent changes. | Gives staff an honest picture of what the office has received. |
| 20 | Explain conflicts and preserve both versions for review. | Prevents silent loss of inspection or maintenance evidence. |
| 21 | Add entry permission, pets and relevant access notes to the assigned job. | Prevents avoidable failed or unsafe visits; restrict sensitive details. |
| 22 | Show warranty and recent related repairs before approving another job. | Avoids duplicate spend and missed warranty claims. |
| 23 | Make blocked reasons explicit: parts, approval, access or contractor. | Separates avoidable delay from active work. |
| 24 | Acknowledge completed work separately from accepting its invoice. | Technical completion and payment approval are different decisions. |
| 25 | Show charge period, receipt allocation and remaining amount together. | Makes tenant balances understandable. |
| 26 | Explain why owner funds are held or unavailable for payout. | Reduces disputes about expected distributions. |
| 27 | Confirm bank-detail changes through an independent controlled process. | Protects the payment workflow from fraudulent redirection. |
| 28 | Preview bulk edits and require reasons for consequential changes. | Makes high-volume work reviewable. |
| 29 | Show a useful empty state with the next setup action. | Helps a new customer reach their first completed workflow. |
| 30 | Every error explains whether work failed, succeeded or may have succeeded. | Supports safe recovery without duplicate financial effects. |

## 7. The connected journeys that should define PropertyOS

### 7.1 Let and operate a property

Enquiry -> application -> review -> approved lease -> required funds -> entry inspection -> access handover -> recurring charges -> collections -> owner statement -> renewal or move-out.

Acceptance example: two co-tenants pay portions of one period's charge. One payment is pending. The tenant statement, arrears queue and owner payout proposal agree on the confirmed state. A later failed settlement reverses the proper effect without rewriting history.

### 7.2 Inspect, repair and account for the work

Inspection finding -> repair request with evidence -> quote -> approval -> contractor assignment -> work evidence -> verification -> supplier invoice -> cost allocation -> owner reporting.

Acceptance example: an inspection detects a leaking pump. The job retains the original photos, asset warranty and access instructions. An increased quote requires approval. Completion does not automatically approve the invoice or deduct a tenant deposit.

### 7.3 Sell and hand over to management

Mandate -> approved listing -> enquiry -> viewing -> feedback -> offer -> instructed decision -> transaction milestones -> completion -> commission -> optional management onboarding.

Acceptance example: the buyer becomes an owner contact after completion. The system reuses authorised property data, but creates a new management agreement and permissions rather than transferring the seller's private files wholesale.

### 7.4 Operate a facilities service business

Client/site agreement -> covered assets -> maintenance plan -> dispatch -> evidence and time/materials -> client acceptance -> contract/extra-work billing -> service report.

Acceptance example: a technician services a client building with no tenant records in PropertyOS. Included contract work and chargeable extras remain distinguishable, and the client sees only its sites.

## 8. Priorities and release sequence

Do not treat the 120 candidates as the first release. The proposed first buyer remains a residential manager doing lettings and routine repairs; validate this through interviews before fixing scope.

| Stage | Complete outcome | Important boundary |
|---|---|---|
| Foundation | Product identity, company/property/contact model, permissions, finance contracts and import validation. | Reuse inspected Electron infrastructure selectively; do not inherit hospitality semantics accidentally. |
| First sellable rental release | Onboard a property, let it, collect/allocate rent, manage deposits and repairs, produce explainable owner statements, renew or close a tenancy. | Include tenant/owner access and reconciliation; defer unsupported payment execution rather than simulate it. |
| Agency release | Win a mandate, market, coordinate viewings, record offers, progress a transaction and calculate commissions. | Confirm listing-feed access before promising publication integrations. |
| Facilities release | Operate assets and service contracts, recurring jobs, approvals and field execution for independent client sites. | A repair board alone does not qualify as the Facilities module. |
| Operational depth | Better offline field capture, automation, quote comparison, budgeting, connectors and richer analytics. | Some priorities move earlier if the first customer segment requires them. |
| Segment expansion | Commercial outgoings, complex ownership, investor scenarios, enterprise identity, space plans and sensors. | Add only against demonstrated demand and support capacity. |

### Highest-value early design investments

1. Clear property/party/agreement modelling.
2. Explainable money and dependable reconciliation.
3. A useful daily queue with responsibility and deadlines.
4. Inspection-to-repair continuity.
5. Owner statements that answer questions without a phone call.
6. Fast field capture with honest pending/sync states.
7. Reliable imports and onboarding.
8. Controlled reminders that stop when circumstances change.

This ordering is our product judgment, not a measured ranking of customer willingness to pay.

## 9. Packaging lessons from the market

The market uses several billing structures. Reapit describes user-based charging with scope-dependent pricing; its client accounting page also mentions properties. MaintainX separates paid working users from free requester accounts. PropertyMe publishes property-block plans. Buildium uses tiered plans and separately lists some transaction/service costs. [Reapit sales pricing FAQ](https://www.reapit.com/platform/sales-crm), [client accounting FAQ](https://www.reapit.com/platform/client-accounts), [MaintainX plans](https://www.getmaintainx.com/pricing), [PropertyMe plans](https://www.propertyme.com/pricing), [Buildium plans](https://www.buildium.com/pricing/)

Proposed PropertyOS model:

- Include the shared foundation with any module; avoid charging repeatedly for the same core.
- Price Agency around working agents/branches; Property Management around active managed units; Facilities around working technicians or managed sites/assets. Validate which metric customers find predictable before choosing.
- Apply a transparent bundle discount when modules are combined. These sources do not establish the correct discount percentage for our market.
- Include external participants needed to complete a workflow, with reasonable usage limits. Do not discourage tenant reporting or contractor updates through surprise seat charges.
- Disclose payment, messaging, signature and screening usage charges separately where applicable.
- Keep essential security, audit, data access/export, financial correctness and safe recovery in every relevant package.
- Downgrades must preserve access to historical records and prevent abandonment of unresolved financial work.

## 10. Differentiation hypotheses to test

These are opportunities to validate, not claims that competitors cannot do them.

| Hypothesis | Proposed product response | Validation needed |
|---|---|---|
| Customers lose time handing work between departments. | One history across agency, tenancy, inspection and repair. | Observe actual handoffs and measure repeated entry. |
| Owners struggle to understand net payouts. | Plain-language explanation linking receipts, fees, bills, reserves and funds available. | Review anonymised statements and common owner questions. |
| Field connectivity interrupts inspections and repairs. | Deliberate mobile/offline scope with resumable evidence uploads. | Visit representative sites and test real devices/network conditions. |
| Local providers matter more than a long global integration list. | Confirm a few valuable bank, payment, listing and communication connections first. | Provider APIs, contracts, country availability and support costs. |
| Customer setup is a larger barrier than missing advanced features. | Guided import, reconciliation of opening positions and practical training. | Trial an actual customer migration and record time-to-first-value. |
| Agencies need flexible access for contractors and clients. | Narrow external interfaces with minimal account friction. | Test invitation, identity and access recovery with real participants. |

## 11. Architecture implications for the existing ecosystem

The earlier repository inspection established shared Electron source compiled into separate `lodge-camp`, `hotel` and `hospitality-pos` products. This research proposes a fourth product following that packaging pattern; it does not assume a universal installed launcher already exists.

Local evidence:

- `packages/product-config/index.js`: three registered products.
- `scripts/product-app.mjs`: product-specific build/distribution selection.
- `src/shared/productIdentity.js`: product identity, application-data names, release repositories and allowed routes.
- `src/renderer/src/App.jsx`: product guards and separate layouts.
- `src/main/domains/authLogin.js`: compatibility checks against the current product.
- `docs/ARCHITECTURE.md`: renderer/preload/IPC/domain authority path and existing offline boundaries.

Candidate reuse: packaging mechanisms, UI primitives, IPC boundary patterns, diagnostics, authentication infrastructure and entitlement administration. Reuse requires focused review and tests, not assumed compatibility.

Design separately: property hierarchy, owner/manager/tenant identities, leases, mandates, deposits, client-fund accounting, commission recognition, maintenance contracts and financial scopes. Existing `lodge_id` tenancy and booking/payment meanings must not silently become property ownership or rent semantics.

A maintenance customer may manage someone else's site without owning it. One owner may use several management companies. External portals must reflect the active agreement and permissions; a matching email address does not authorise portfolio-wide access.

Electron is the staff desktop delivery mechanism. Plan companion browser/mobile experiences for field staff and external users. Their authoritative contracts must agree with desktop. The Bar-local authority exception does not automatically apply to PropertyOS.

## 12. Guardrails and release evidence

| Workflow | Required controls | Evidence before release |
|---|---|---|
| Rent posting/allocation | Atomic authoritative posting, stable idempotency, tenant/entity scope and explicit correction. | Concurrent and repeated requests produce one correct result; statements reconcile. |
| Lease activation | Valid parties, dates, approval and unit availability policy. | Two concurrent attempts cannot create an unauthorised conflicting occupancy. |
| Deposit settlement | Separate liability, evidence, authorised deductions, disputed-item handling and approved refund. | A proposed deduction cannot silently become revenue or trigger payment. |
| Owner payout | Cleared/available funds policy, reserves, recipient verification and independent approval. | Retries do not duplicate payment; unsettled and failed outcomes reconcile. |
| Sale/commission | Versioned fee rules, approval authority and completion/cancellation transitions. | Corrections and cancelled deals preserve history and reverse the correct effect. |
| Contractor spend | Scoped assignment, valid quote, ceiling and overrun approval. | A stale approval cannot authorise a changed amount or scope. |
| Field/offline updates | Durable operation identity, attachment recovery, scope and version/conflict checks. | Restart, reconnection and replay preserve evidence without duplicated effects. |
| Documents/portals | Least privilege, revocable scoped access and export/download audit where appropriate. | Old tenants, removed contractors and unrelated owners cannot access records. |
| Automations/AI | Consent, stop conditions, permissions, approval boundaries and execution logs. | Changed case state prevents stale reminders or unauthorised actions. |
| Imports | Preview, duplicate detection, balance validation and staged activation. | Failed imports do not leave a partially live financial portfolio. |

## 13. Measurement and next validation

Measure customer outcomes rather than number of screens:

- First response time and unanswered enquiries.
- Viewing confirmation/no-show rate and follow-up completion.
- Days from enquiry to completed tenancy or sale, with stage definitions.
- Vacant days and days a unit is blocked by unresolved work.
- Arrears by age, disputed amount and promised-payment outcome.
- Unallocated receipts and unreconciled differences.
- Time to generate and approve a correct owner statement/payout proposal.
- Repair response/resolution time, reopen rate and spend overruns.
- Planned-maintenance completion and repeat failures per asset.
- Import exceptions, time to first completed workflow and support burden.
- Unsent offline work, oldest pending operation and recovery success.

Ten demo/interview scenarios should drive the next specification:

1. One owner, several properties, mixed available and reserved funds.
2. Two co-tenants, partial payment and a failed settlement.
3. A commercial lease with a future review and shared operating costs.
4. A tenant disputes an exit-inspection deduction.
5. An agency receives the same buyer enquiry from two channels.
6. A viewing is cancelled after reminders have been queued.
7. A contractor requests more than the approved ceiling.
8. A technician records work and photos offline, then another user changes the job.
9. A facilities-only company invoices a client for work outside its service contract.
10. A customer imports an inconsistent rent roll and later disables a module.

Outstanding validation: customer segment and buying criteria; hands-on competitor demos; provider/country coverage; professional review of local contracts and fund-handling requirements; implementation effort; migration feasibility; and actual willingness to pay. Do not claim a market gap or select final pricing from feature research alone.

## 14. Research change impact

Research document only. No application code, database, deployment or subscription configuration changed. No manual update required: this brief introduces no customer-facing Bar behaviour and does not alter approved Bar guides.
