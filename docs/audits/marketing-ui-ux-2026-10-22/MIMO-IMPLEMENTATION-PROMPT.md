# Implementation prompt for Mimo

Copy the prompt below into Mimo while working in this repository.

---

Implement the complete Tsa Bonno marketing website remediation and storytelling redesign described below. Do the work in the existing repository; do not stop at an audit, plan, mockup or a list of suggestions. Produce a working, visually verified result and a concise implementation report. Resolve routine design decisions yourself within these requirements.

## Repository and required reading

Workspace: `C:\Users\Botswapelo Studios\Documents\Work\Tsa Bonno HospitalityOS`.

Read the applicable `AGENTS.md`, `PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, and current `package.json` before editing. Follow relevant skills available in your environment. Treat historical audits as evidence to verify, not authority over the user's requirements or later implementation.

Read these task artifacts under `docs/audits/marketing-ui-ux-2026-10-22/`:

1. `SIMPLIFIED-COMBINED-REPORT.md` — combined priorities and corrected disputed findings.
2. `ECOSYSTEM-STORY-AND-DESIGN.md` — the user's current positioning, product order, suggested copy and actual app-shell colours.
3. `visual-review/VISUAL-REVIEW.md` — confirmed visual problems and example screenshots.
4. `AUDIT.md` — detailed source-backed findings and recovery requirements.
5. `browser-evidence.json`, `followup-evidence.json`, `visual-review/visual-evidence.json`, `visual-review/asset-metadata.json`, and the relevant screenshot files — reproduction evidence, not an assertion about today's live deployment.

The original two supplied model reports can be consulted if needed at:

- `C:\Users\Botswapelo Studios\.codex\attachments\8749a844-dcc1-49f1-9021-55c5371f8dea\Pasted text.txt`
- `C:\Users\Botswapelo Studios\.codex\attachments\639f9bbb-e8f6-462c-ad9b-9c10ef28aff0\Pasted text.txt`

These attachments contain some incorrect or unverified assertions. Use the corrections in the combined report and verify remaining findings against current source. Do not blindly implement every external-audit suggestion.

Inspect `git status` and current changes first. This checkout has substantial unrelated uncommitted work across the apps, marketing site, migrations and documentation. Preserve it. Do not reset, clean, discard, overwrite whole files from an old revision, or alter unrelated changes. Keep the audit evidence. Re-inventory the site; the audit snapshot contained 27 HTML pages.

## The user's required product direction

The landing page must sell **the Tsa Bonno HospitalityOS ecosystem first**, then present the products in this order:

1. **Tsa Bonno LodgingOS** — flagship and first detailed story.
2. **Tsa Bonno Restaurant & Bar POS** — second; distinct Restaurant and Bar paths within this product family.
3. **Tsa Bonno HotelOS — Coming soon** — last, visible and persuasive, temporarily unavailable for trial/download/purchase/activation.

Apply this order consistently to product introductions, relevant navigation, cards and pricing. Supporting Manager and guest-facing pages should reinforce the ecosystem story.

We need a persuasive sales journey: a buyer recognises their daily problem, sees the actual product solve it, understands the business benefit, sees the right package, and can confidently start. Make mobile oversight, web experiences, accounting where applicable, and reporting prominent reasons to choose Tsa Bonno. Do not bury them beneath a long repetitive feature list.

Use the story brief as a concrete starting point. Suggested hero:

**Run the day. Know the business. Stay in control.**

Show real desktop, Manager phone and guest web proof in a coherent composition. A prominent **1-month free trial** and **Start your free month** action must be visible early and repeated at meaningful decision points. Primary trial actions must open an explicit product choice or retain an already-selected product; never silently route every customer to Lodge. Preserve the chooser and primary action on phones.

No credit card wording must match the actual available flows. Keep the once-per-property 30-day policy, real capacity limits and post-trial package costs clear. Do not advertise unlimited usage. Do not include HotelOS in available-now trials.

Use outcome-led stories: the enquiry/booking, arrival or order, staff work, guest service, cash/stock control, owner oversight and reports. Show concrete product proof and captions. Use real testimonials or measurable results only if verified and authorised. Do not invent competitor comparisons, customer counts, savings, certification, integrations or release readiness.

The ecosystem contains separate applications and commercial boundaries. Do not imply one purchase includes all products or that all separate businesses automatically share accounts/data.

## Product colours must come from the actual shells

Use a shared typography, spacing, navigation, accessibility and component system, with product-specific palettes:

- **LodgingOS:** forest #174c3a; rail #0f3d2c to #0c2d23; warm paper #f4efe7. See `src/renderer/src/index.css` and `components/Layout.jsx`.
- **Restaurant & Bar POS:** coral #c95635, dark plum #2f222a to #211920, warm cream surfaces. See `src/renderer/src/styles/hospitality-pos.css`. Bar should feel like a profile of this app, not an unrelated black/green brand.
- **HotelOS:** copper #b8734a, charcoal/brown #1a1512 to #241c17, paper #f0ebe4. See `components/hotel/hotelTheme.css`.

Use these palettes across product-page heroes, actions, proof frames and detail sections. Keep the ecosystem page coherent while each product is recognisable. Adapt colour roles for readable contrast rather than copying inaccessible colour/text combinations. Do not reuse the Lodge green template for every product.

## HotelOS: temporarily disabled, still strongly marketed

Keep its product page and navigation. Add a consistent **Coming soon** state to the Home card, Hotel page, pricing, download/confirmation flows, metadata and marketing brochure where applicable.

Sell the future hotel experience with genuine HotelOS screens: arrivals/departures, guest folios and balances, room readiness/housekeeping, rates/corporate business, and night audit. Explain the value for the hotel shift. Distinguish core, optional and future capabilities.

Replace available-now trial/download/purchase actions with **Register interest** or **Request a demo**. Use a functioning interest enquiry with clear success/failure and no fake immediate-access promise. The page must not look abandoned or merely greyed out.

Enforce the Coming soon state in the shared marketing action handler as well as in visible links: a query parameter such as `?product=hotel`, a generic modal, direct download page, old card or thank-you fallback must not reopen a Hotel installer/trial flow. Do not change desktop licensing or existing customer entitlements to implement a marketing availability state. This is a website gate, not a replacement for server authorization.

Repair/retain Hotel quotation code as future launch preparation, but do not expose a current purchase/activation path. Avoid a Hotel builder dead end: either offer an explicitly non-binding interest/demo handoff carrying selections, or make its planning/Coming soon status and next step clear. No misleading paid quotation or trial eligibility promise.

## Repair all applicable audit findings

### Buying paths and truthful outcomes

- Fix checked-in CSP incompatibilities. Externalise inline application logic or use tightly scoped hashes/nonces as appropriate. Do not globally enable unsafe inline scripts/eval to silence failures. Review both customer forms and the existing admin page's script execution.
- Permit only needed release/API origins or provide an appropriate same-origin path. Test the actual hosting-policy-equivalent preview, including fresh cache. Keep Lodge and POS release feeds isolated. Hotel remains Coming soon.
- Distinguish loading, available release, unavailable asset, lookup error and early access. Do not hardcode a repository version as proof of a published installer.
- Check HTTP success and result shape before reporting persisted leads. A resolved HTTP 500 must not produce success analytics, welcome messaging or a success claim. Handle timeout, retry and duplicate click states safely. Avoid creating duplicate external side effects on retries; inspect existing server support before changing contracts.
- Do not claim a file was downloaded merely because a link was clicked. Offer an explicit product-correct download/retry action when ready.
- Preserve product, operating profile, package, add-on choices and source through forms, confirmation and relevant emails. Consume existing plan links correctly. Do not silently pick the wrong product or lose a package choice.
- Correct contact copy: it must describe the implemented form, its outcome and genuine email/WhatsApp recovery. Avoid a surprise mailto navigation as the sole failure treatment.
- Remove email addresses from thank-you URLs; do not replace them with other personal data in a URL. Minimise what the confirmation page needs.
- Repair broken anchors, including the Restaurant trial link. Provide useful non-JavaScript destinations/fallbacks for critical navigation and actions.

### Visual quality and layouts

- Fix Lodge/Hotel hero screenshots retaining height=993 at narrow widths. Preserve intrinsic image ratios and make the first-screen content/action usable at laptop and phone sizes.
- Recompose the Home connected-suite cards: consistent widths/preview areas, coherent heading/action alignment and a deliberate portrait treatment for Manager proof. Do not stretch portrait images to fill landscape cards.
- Replace or reframe the brochure Manager proof crop, which currently discards most of the phone screenshot. Apply suitable image fitting to other UI proof.
- Use readable workflow crops and accessible enlargement, not tiny whole-app screenshots. Replace the Lodge screenshot used as Hotel proof with real HotelOS imagery. Update outdated POS proof/navigation language.
- Check actual raw image dimensions and currentSrc, correct sizes/srcset for full-width backgrounds, and use screenshot-appropriate encoding. Do not solve blur by enlarging small rasters or artificial sharpening. Preserve source assets; regenerate derivatives through the appropriate maintained process.
- Unify the Bar header with the responsive site system. Fix hamburger selectors/markup, stacking, touch targets, skip links and close behavior. Do not assume nth-of-type fixes the selector if the screen-reader label is also a span.
- Align cards without unnecessary empty space. Coordinate sticky/floating controls, consent and WhatsApp so they do not hide important content.
- Shorten repeated sections and improve information hierarchy. Keep useful detail accessible through well-labelled sections or progressive disclosure. Do not hide the product chooser on mobile.

### Accessibility, privacy and consistency

- Complete modal/menu/lightbox semantics, focus movement/containment/restoration, Escape handling and background interaction management. A non-modal cookie notice should not claim modal semantics.
- Repair verified label associations, heading order, active navigation, footer drift, contrast and adequate touch targets. Ensure FAQ content is not clipped by a fixed open height.
- Provide meaningful non-JavaScript navigation/content fallbacks. Respect reduced-motion preferences in JavaScript effects as well as CSS. Remove decorative effects that damage reading, motion comfort or performance.
- Gate optional custom analytics on the saved consent state. Keep consent handling consistent for Accept, Decline, reload and changes, and separate necessary enquiry processing from optional analytics. Do not turn tracking on simply to make an analytics test pass.
- Keep titles, descriptions, social metadata, canonical URLs, sitemap, redirects, brochure and 404 recovery aligned with the final product story, domain and Hotel state.
- Review avoidable image/scroll work, obsolete styles and duplicate components after functional repair. Refactor only where relevant; do not turn this into an unrelated repository cleanup.

### Product-claim accuracy

Cross-check final copy against actual app routes, capabilities, shared commercial catalogue and latest project state. Preserve correct prices, package limits, Bar add-on dependencies and provider/manual-tender distinctions.

- Lodge Starter/Standard/Pro are different capability levels; Pro is not unlimited.
- Restaurant Service/Control/Growth differ; accounting and growth tools must carry their real commercial/activation boundary.
- Bar Base is P4,500/year; its optional Accounting & Workforce bundle requires Stock & Purchasing Pro. Do not promise full accounting/payroll in Base.
- Manager PWA has authorised product-aware viewing and selected operational actions with a limited device-local queue; it is not globally read-only or an unrestricted mobile POS.
- Direct booking and guest portal are not interchangeable names. Keep relevant product/package and Coming soon distinctions.
- Explain which offline operations are supported and what requires connectivity, approval or conflict review. Do not promise universal no-data-loss/no-double-booking behavior. Local Bar is a separately gated, partial/unqualified mode; Legacy is a separate implementation/release.
- Scope platform/hardware support. Verify automation dispatch before promising automatically delivered owner digests/notifications. Avoid inconsistent payment-method counts.

Do not adopt disproved findings: Pool cash-only handling exists in current POS code; `/api/quote-download` is mapped in the Netlify function; an anonymous Supabase key and public admin login alone do not establish a data leak. Preserve server-authoritative quotes and token-controlled PDF retrieval. Review actual authorization before changing admin exposure, and do not casually remove a business tool or weaken access controls.

## Scope and engineering guardrails

Primary implementation scope: `marketing-site/`, its image/brochure generation where necessary, focused tests, and related documentation. Do not rewrite app financial behavior, licensing, schema or authority modes to make marketing claims true. Correct the marketing instead. Escalate a genuinely necessary cross-surface contract change with evidence; do not improvise client-side financial writes or production schema changes.

Use existing authoritative RPCs and server validation for commercial submissions. Client estimates are informational. Enforce appropriate validation, duplicate/retry handling and safe recovery for changed forms. A disabled button is not authorization.

Record a Bar manual-impact assessment under repository rules. If no operator feature/workflow/guide applicability changes, explain why no manual update is required. If guides really are affected, follow `docs/bar-manual/maintenance.md` and the approved manifest/packaging/offline-access requirements. Do not silently overwrite unrelated deferred Bar documentation work. Distinguish the marketing brochure from the approved Bar operator PDFs.

Do not deploy, publish, push, create releases, change DNS/mailboxes, mutate production data or real customer accounts, or submit real marketing leads/emails/analytics while testing. Use isolated mocks/fixtures. Do not expose credentials or introduce service-role keys into browser code. Preserve unrelated user work. Do not commit unless separately requested.

## Verification — required before declaring completion

Run current real scripts from package.json. At minimum, run `npm run test:marketing-site` and `npm run test:public-domains`; run affected commercial checks if catalogue/contract expectations change. Update tests to the user's authorised Coming soon/product-order behavior while preserving substantive coverage. Do not delete assertions merely to obtain a green result.

Add focused behavioral/browser regression coverage for the changed buying paths and availability handling. If a new browser test command is needed, define the actual script/harness and document it rather than pretending it already exists.

Test at least:

1. Product order and visible chooser on desktop/phone; shared product context survives every step.
2. Lodge, Restaurant and Bar normal trial/download selection; missing asset, API error, HTTP 500, timeout, retry and duplicate clicks.
3. Hotel Coming soon on every entry point, including `?product=hotel`, old CTA paths, direct download/thank-you URLs and interest/demo submission.
4. CSP applied exactly as the hosting configuration; essential scripts and intended API calls function without a permissive bypass.
5. Interest/lead confirmation, no personal email in URLs, no false file-download claim, and analytics respecting consent.
6. Modal/menu/lightbox keyboard operation, focus, Escape, touch targets and readable contrast.
7. Navigation, anchors, local assets, no-JavaScript fallbacks, pricing/limits and relevant metadata.

Perform fresh visual QA at approximately 360/390px phone, 768px tablet and 1440px desktop, plus high-DPI and 200% zoom checks for affected components. Wait for images/fonts and settle animations. Inspect screenshots yourself, including heroes, connected-suite cards, product cards, pricing and brochure; do not rely solely on DOM measurements or passing string tests. Verify proportional images, readable proof, deliberate crops, adequate raw source resolution, coherent card sizing and overlays that do not hide important content.

Use or adapt the audit capture scripts safely. They intercept external traffic; preserve that isolation. If the marketing brochure/PDF changes, regenerate it and inspect rendered output. Run other app builds only if their source/build inputs are affected. Report environmental blockers and unrun checks honestly; do not call live deployment verified from local files.

## Deliverables

- Implemented marketing website with persuasive ecosystem-first story, correct product order, app-shell palettes, prominent one-month trial, functioning product-aware journeys and consistent Hotel Coming soon state.
- Corrected images/cards with fresh before/after screenshot evidence.
- Focused regression coverage and exact test results, including unresolved limitations.
- Updated marketing brochure/metadata/navigation as applicable, plus the manual-impact decision.
- A concise `IMPLEMENTATION-REPORT.md` beside this prompt mapping the audit findings and user requirements to changes, tests and evidence. Mark any item unresolved with a specific reason; do not silently omit work. Update PROJECT_STATE.md if release assumptions or material active risks change.

Work through implementation and verification to a concrete result. Do not ask the user to choose minor typography, spacing or copy variants. If an external action truly needs approval, complete the safe local implementation and make the final approval request specific and reviewable.
