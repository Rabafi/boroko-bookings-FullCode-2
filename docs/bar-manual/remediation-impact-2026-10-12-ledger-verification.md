# Bar manual impact — 2026-10-12 ledger verification

Status: Required; software verification passed on the approved disposable project. This record does not approve or promote a customer guide.

## Customer impact

The General ledger now recognizes the actual server replay flag and displays the existing message: “This POS order was already posted; no duplicate journal was created.” The same original order UUID remains the source identity. The change does not alter journal creation, financial permissions or retry semantics.

The Trial balance previously treated the absence of totals in the paged journal response as zero. It now obtains authoritative totals separately from the journal page. Missing or malformed totals produce an unavailable state instead of a confirmed zero. Older filter/session responses cannot replace the current read. Totals are cumulative through the To date; journal paging and the From filter are separate from that balance. These are totals of posted journals, not certification of all eligible business-source coverage.

## Customer instructions for the next guide candidate

In General ledger, set the journal dates and choose Refresh. Trial balance shows balances from posted journals through the To date. Its totals do not depend on the number of journal pages currently loaded. The From date and Account selection filter the listed journals; Trial balance covers all posted accounts through the To date.

If Trial balance says it could not be verified, reconnect and choose Refresh. Do not treat an unavailable balance as zero or use it as a confirmed closing balance. Resolve any incomplete source or report warnings before relying on a certified export.

To check one existing POS order, use its exact order UUID in Post one POS order. Find its entry in Posted journals. If the screen says it was already posted, the original journal was reused. Check that same order and journal if an outcome is unclear; do not create another sale or use another order UUID to repair a posting.

## Affected guide records

- Manual: General ledger / Trial balance / Posted journals / Post one POS order. Candidate v10 already contains the same-order retry instruction in content/manual-source.md, step 5 of the General ledger task. The new unavailable-balance and cumulative-date wording above must be incorporated in the next reviewed candidate.
- Quick Start: no task text change required; cashier opening, selling, payment and closing steps are unchanged. Refresh printed manual page references if the next manual rebuild changes pagination.
- Screenshots: genuine disposable sale receipt (attempt7), posted journal and replay notice with corrected totals (attempt11, verified and visually inspected). Earlier attempt10 shows the replay notice but also the old false zero trial balance; do not use it as an approved guide screenshot.
- Evidence: independent-review directory under docs/audits/2026-10-08/accounting-independent-review/evidence/. New browser scenarios cover raw/enveloped replay results, missing totals and stale filter responses. Focused Accounting regressions cover invalid totals and the existing authorization boundaries.

## Remaining release work

Incorporate the new customer wording and final verified captures into the next candidate, produce annotated derivatives, rebuild and review the PDFs and pagination, update coverage/screenshot records, obtain the required human approvals, and verify the approved pair in the packaged app through ordinary cashier offline Help & guides. Preserve candidate v10 and its historical hashes. Existing V8R2-03 / V10-SCOPE-01 / human usability, official checksum, package parity and offline-menu gates are not closed by this software repair. No manifest, canonical PDF or customer package is promoted by this record.
## 2026-10-12 — candidate v11 exact-pair review and maintained behavior result

BAR-DOC-082 now incorporates the verified attempt11 replay/Trial balance guidance. The final unapproved candidate pair is Manual (84 pages, SHA-256 E8EEA0C2295DEC9AF57621E6AECFEC18CF7E90DB7E8CF0CA2B4F1527EBBCA145) and Quick Start (5 pages, SHA-256 58917A6F0AFAF2518DB12F24CF6A460EE6F3BC562F1047B260F075ADE092BA0B). Exact structural and page-count evidence is in docs/bar-manual/build/remediation-candidate-2026-10-12-v11/evidence/pdf-verification-v11-final.json. Internal visual review of all pages is in evidence/visual-review-20261012.md. The first v11 cover's revision-10 label was corrected before this final pair was rebuilt.

The maintained npm run test:bar-guide-behavior result is 38 total, 34 passed, 4 failed, 0 skipped, exit 1. The failures are: a simulated journal recovery test stopped because its mock account list was empty; two scratch-document assertions saw a six-page Quick Start where that separate draft expects five; and a modifier component fixture observed NaN for one price and omitted a second option. Exact details are in evidence/test-bar-guide-behavior-20261012-result.md. This is a failed mocked/component-and-PDF gate, not real operator acceptance.

Approval remains open. V8R2-03, V10-SCOPE-01, V9-02 owner/cashier/bartender usability, four behavior failures, official manifest approval, package parity, released-binary applicability, and ordinary cashier visible offline open/save for both approved PDFs remain open. No official guide, manifest, package or installer was changed; no candidate was approved or promoted. Universal ledger source coverage remains unknown and fail-closed.


## 2026-10-12 candidate v11 incorporation and regression follow-up

Candidate v11 BAR-DOC-082 incorporates the cumulative-through-To-date Trial balance wording, unavailable-is-not-zero recovery guidance, same-original-order retry instruction and explicit unknown-source-coverage warning. The coverage row identifies Manual p. 58; screenshot rows include attempt 7 receipt and attempt 11 journal/replay/Trial balance captures and hashes. The later test-only repairs add no customer workflow or screenshot, so those registers and the exact 84/5-page v11 PDFs remain unchanged.

The maintained Bar behavior gate now passes 39/39 (0 failed, 0 skipped, exit 0). This is mocked renderer/component and scratch-PDF evidence. Candidate v11 remains unapproved. Owner scope/usability, official checksum approval, package parity, released-binary applicability and ordinary cashier offline Help & guides open/save remain open.
