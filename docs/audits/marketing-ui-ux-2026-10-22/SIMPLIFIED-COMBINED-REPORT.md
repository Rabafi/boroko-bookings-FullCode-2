# Marketing website — simplified combined audit

Original audit: 22 October 2026. Updated with visual review and Hotel launch direction on 23 October 2026 (Africa/Gaborone). Combines three model audits, with disputed findings checked against current source and the original local browser evidence.

## Overall assessment

The website represents a substantial real product, and its main package prices generally match the code. Its biggest weakness is the journey from browsing to choosing, registering, downloading, and getting a quotation. Some important paths fail; others lose the customer's chosen product or promise more than the current implementation has established.

**Recommendation: repair buying paths and product accuracy before a broad visual redesign.**

Code existing in the repository does not establish that it is deployed, included in a customer's package, qualified on their equipment, or working end to end.

## User-directed story and visual identity

The landing page must sell the **Tsa Bonno ecosystem first**, then introduce **LodgingOS → Restaurant & Bar POS → HotelOS Coming soon**, in that order. Lead with how the business works better, supported by real app proof and a prominent **1-month free trial** for available products.

Make the Manager mobile app, direct booking/guest web experiences, reporting and applicable accounting workflows major reasons to choose Tsa Bonno. Explain their product/package boundaries beside the benefit. Each product page must use its actual app-shell palette: **forest green for Lodge, coral and dark plum for Restaurant & Bar, copper and charcoal for Hotel**. Keep a shared design system while giving each product a persuasive operational story.

Suggested hero: **“Run the day. Know the business. Stay in control.”** Primary action: **“Start your free month”**, opening an explicit product choice. Hotel stays visible and persuasive, with an interest/demo action instead of an available-now trial.

See [the ecosystem story and design brief](ECOSYSTEM-STORY-AND-DESIGN.md) for concrete page order, suggested copy, colour references and acceptance criteria. This updates the report direction; website implementation has not started.

**Implementation handoff:** [ready-to-use prompt for Mimo](MIMO-IMPLEMENTATION-PROMPT.md), covering the combined audit, visual repairs, story, availability, testing and preservation of existing work.

## HotelOS launch direction — Coming soon

**HotelOS is to be presented as Coming soon, with trial, installer download, purchase and activation actions temporarily disabled.** Keep its product page and navigation visible. This is the requested website treatment, not a statement that the current website has already been changed.

The page should sell the hotel experience: an arrivals/departures board, guest folios and billing, room readiness and housekeeping, rates and corporate accounts, and night audit. Use authentic HotelOS screens and show how these workflows improve a hotel shift. Label launch status clearly, distinguish core capabilities from optional/future services, and offer **Register interest** or **Request a demo** instead of an available-now trial. Apply this status consistently to homepage cards, pricing, download flows, brochure and confirmation messages.

Hotel quotation/download defects below remain preparation work for a future launch. The immediate conversion goal for HotelOS is an honest interest/demo enquiry.

## 1. Fix first: customers must be able to enquire and download reliably

| Problem | What it means for a customer | Required outcome |
|---|---|---|
| The hosting security policy blocks Hotel quote logic and GitHub installer lookup | Quote selections do not update; current installer discovery fails | Quote and download flows work with the actual hosting policy |
| Download flow treats HTTP errors as success and does not require an available installer | A customer can see a success message without a saved lead or usable installer | Confirm persistence and availability; show honest failure, early-access and retry states |
| Hotel package calculator has no quotation handoff | A customer builds a package but cannot request it through that journey | A visible quotation action carries the selected add-ons to server-authoritative pricing |
| Product/package choices disappear between pages | Hotel, Restaurant and Bar customers encounter Lodge instructions; selected Lodge tiers are lost | Retain product, Bar/Restaurant profile, package and add-ons through form, email and confirmation |
| Contact copy describes email submission, but the form normally posts to the backend | Customers cannot tell what was sent or what happens next | One clear purpose and accurate confirmation for each form |

Also fix the Restaurant trial link pointing to a nonexistent section, and provide meaningful link destinations when JavaScript fails.

## 2. Fix next: make the mobile site usable and show the real apps

- **Unify navigation.** Bar's header is unstyled and its mobile links run together. Repair the shared hamburger animation and ensure menus can close reliably.
- **Correct image sizing.** Lodge and Hotel screenshots are stretched vertically. At the tested desktop size, this pushed the first trial button below the initial view.
- **Keep product choice visible on phones.** The mobile homepage hides “Choose your application” while its generic trial action defaults to Lodge.
- **Use current product screenshots.** Hotel advertises a copper Hotel console while showing a green Lodge screen. The POS navigation story also describes an older layout.
- **Finish accessibility.** Add dialog focus management and Escape handling; improve contrast, labels and touch targets; keep important content clear of floating overlays.
- **Shorten long pages.** The Restaurant page measured approximately 23 phone viewport heights. Put product fit, proof, price, requirements and next action before specialist detail.

### Fresh screenshot review: confirmed image/card problems

After the user's visual-review request, 12 pages were rendered at desktop and phone widths, with targeted close-ups of cards. The main confirmed defects are:

- **Severe stretching:** Lodge and Hotel landscape screenshots retain a 993px height even when only 304px wide on a phone.
- **Unbalanced cards:** Home's connected-suite row places a tall, narrow Manager phone card beside much shorter landscape cards.
- **Excessive cropping:** The brochure forces a tall Manager screenshot into a short landscape proof card, discarding about three quarters of its height.
- **Unreadable proof:** Several complete application screens are shrunk until interface text becomes soft and too small to assess. Use larger workflow crops, rather than simply enlarging or sharpening those previews.
- **Some undersized backgrounds:** Desktop photo selection can load a 1280px image for a roughly 1498px painted area. Correct responsive sizing and source selection.

Not every card is pixelated: the main product text cards and Restaurant atmosphere photo cards look substantially sharper. See the [visual review with screenshots](visual-review/VISUAL-REVIEW.md) for examples, measured causes and repair priorities. Website code has not been changed by this review.

## 3. Correct promises and privacy behavior

- Replace universal offline/no-data-loss guarantees with a short explanation of which actions work offline, which require internet or approval, and how pending work/conflicts are resolved. Local Bar remains a separately gated, unqualified mode.
- Clarify trial limits, Hotel trial versus paid quotation terms, and initial purchase versus recurring add-ons. “Full-featured trial, no limits” conflicts with the trial's Pro capacity limits.
- Describe supported payment methods and equipment by product/profile. Avoid inconsistent counts and “any tablet/screen” wording that could imply unrestricted mobile selling.
- Promise automated digests or notifications only where scheduling and delivery have been verified, rather than inferred from a button or database status.
- Stop putting customer email addresses in the thank-you URL. This unnecessarily places personal information in browser history and potentially other URL records; actual onward disclosure was not measured.
- Make analytics respect the saved consent choice. The custom analytics POST currently runs independently of Decline.

## What changes for each app

| Product | Keep | Improve |
|---|---|---|
| **LodgingOS** | Front-desk story and Starter/Standard/Pro pricing | Preserve tier choice, explain limits and offline boundaries, correct screenshot sizing |
| **Hospitality POS** | Real service, stock, cash and management capabilities; Bar Base/add-on pricing | Separate Restaurant and Bar journeys, repair Bar navigation, show current screens and supported operating modes |
| **HotelOS — Coming soon** | A compelling hotel workflow page, real Hotel screenshots and clear launch positioning | Temporarily disable trials/downloads/purchase/activation; collect interest or demo requests; prepare quotation flow for launch |

Manager mobile and public booking should support these journeys with explicit package, permission and connection boundaries. Manager mobile is neither globally read-only nor an unrestricted selling terminal.

## Findings excluded or qualified

- **“Pool cash-only controls are missing” is incorrect:** the current POS contains Pool-specific cash-only controls.
- **“The quote-download route does not exist” is incorrect:** the Netlify function explicitly maps `/api/quote-download`. This does not prove live deployment or successful PDF delivery.
- A public admin login page and Supabase anonymous key alone do **not** prove exposed customer data. Server authorization and RLS need separate verification before making that claim.
- The statement that no Google consent-update call exists is incorrect: an update exists for Accept. Decline/custom tracking behavior still needs correction.
- Some obsolete homepage claims are inside deliberately hidden sections. They are retained source cleanup, not currently visible homepage defects.
- Source-backed features must not be described as universally shipped or release-ready. Live installer versions, hosting and Supabase deployment remain unverified here.

## Recommended work order

1. Repair quote/download paths, failure handling and product selection retention.
2. Correct offline, trial, platform and automation wording; fix URL privacy and consent behavior.
3. Repair mobile navigation, image sizing, current screenshots and accessibility.
4. Simplify page content, then remove obsolete CSS/JavaScript and optimize performance.

Keep the existing product branding, clear package structure, local-market focus and source-aware unsigned-installer guidance.

## Verification and scope

The original audit checked 27 marketing HTML files and ran 22 local desktop/mobile page checks. Marketing contract tests passed 5/5; public-domain tests passed 9/9. Those passing tests do not cover the reproduced browser failures. This combined report adds targeted source checks, not a fresh production acceptance run.

See [the detailed audit](AUDIT.md), [browser evidence](browser-evidence.json), and [layout measurements](followup-evidence.json) for supporting detail. The two supplied model reports are inputs; disputed assertions were not adopted automatically.

Audit documents only; no website or application behavior changed. No Bar manual update is required for this report. Subsequent Bar-facing remediation needs its own manual-impact assessment.
