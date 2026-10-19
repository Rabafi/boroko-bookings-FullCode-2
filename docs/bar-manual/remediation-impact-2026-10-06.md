# Bar manual impact assessment — 2026-10-06

## Decision

**Manual update required.** AUD-01 changes how a replay conflict remains visible for manager review. AUD-09 changes the Bar mesh warning when two tills reuse an operation identity with different contents. Both can alter an operator’s safe recovery choice and are visible in the Bar System Health screen.

## Customer-facing scope

- **Manual:** add a recovery procedure after the current System Health and support section. Tell the cashier to stop and notify the manager, retain the failed financial item, and never repeat or clear the affected action.
- **Quick-start:** add a short urgent-recovery page with the manager route and support guidance.
- **Navigation and visible controls:** Manage > System Health > Sync & queue, Failed operations, Other tills on this network, Network note, App issues, and Send problem to support were checked against the Bar component and isolated fixture.
- **Screenshots:** S27 and S28 use fictional fixture data. The raw captures are preserved beside numbered annotated derivatives. The guide shows both the failed operation and the Network note.
- **Package behavior:** the existing fixed-ID Bar guide interface and approved-resource package configuration were not changed. The newly revised pair is not copied into the application package until its content and visual approval is recorded and its release manifest is updated.

## Findings not requiring additional Bar guide text

- AUD-02 through AUD-06 change Hotel folio operations and do not change Bar controls or Bar procedures.
- AUD-07 and AUD-08 change desktop financial reconciliation and report persistence. The Bar-specific System Health route does not expose those controls, so no Bar procedure changed.
- AUD-10 changes lodging and public booking creation; the Bar does not create lodging bookings.
- AUD-11 changes root product dependencies; no new Bar setup or operator control was introduced. The separate Legacy POS support-platform decision is tracked in dependency and release evidence.

## Candidate and verification

The two candidate PDFs are in docs/bar-manual/build/remediation-candidate-2026-10-06-v1/pdf/. They were rendered and visually reviewed at the last prior and appended pages: manual pages 55–56 and quick-start pages 4–5. The existing text on all shared pages matches the current PDFs exactly; the candidate adds one final page to each document. Candidate hashes and image evidence are in the adjacent REVIEW.md and candidate-manifest.json.

The approved document-manifest.json has deliberately not been changed. Its recorded checksums do not match either the current output/pdf pair or the current packaged pair. npm run test:bar-guides must be green against the reviewed approved pair before rebuilding resources. Ordinary Bar-user open/save verification with networking disabled remains a package acceptance step after approval and packaging.

## Approval and packaging gate

**Awaiting customer-content and visual approval.** The reviewer should inspect the candidate manual page 56, quick-start page 5, S27, S28, and the candidate manifest. Once approved, update the canonical PDFs and official manifest together, re-run test:bar-guides, build the hospitality-pos directory package, compare resource hashes, and perform the ordinary authenticated Bar open/save/cancel offline smoke test. The candidate itself is not approved or packaged.