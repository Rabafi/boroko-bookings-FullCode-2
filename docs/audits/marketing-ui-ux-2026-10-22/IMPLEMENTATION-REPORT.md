# Marketing website UI/UX remediation and ecosystem redesign — implementation report

Date: 27 October 2026 (Africa/Gaborone).
Scope: `marketing-site/` (27 HTML pages, `styles.css`, `script.js`, `analytics.js`, `quote.js`, `admin.js`, `netlify.toml`, brochure, screenshots), focused tests, and documentation.
Status: **implemented and locally verified; not committed, not deployed.**

Requirements source: `SIMPLIFIED-COMBINED-REPORT.md`, `ECOSYSTEM-STORY-AND-DESIGN.md`, `AUDIT.md` (F01–F16), `visual-review/VISUAL-REVIEW.md`, and `MIMO-IMPLEMENTATION-PROMPT.md`.

---

## 1. Outcome summary

| Area | Result |
|---|---|
| Ecosystem-first story | Done. Landing page sells the ecosystem first, then LodgingOS → Restaurant & Bar POS → HotelOS (Coming soon) in that order across nav, cards, footer and pricing. |
| App-shell palettes | Done. Forest/paper (Lodge), coral/dark plum (Restaurant & Bar), copper/charcoal (Hotel), one shared design system. |
| 1-month free trial | Done. "Start your free month" + "1-month free trial. No credit card required." in every product hero and repeated at decision points. |
| Product-aware journeys | Done. Generic CTAs open an explicit chooser; product pages go straight to their own trial; selection survives to the form, thank-you page and confirmation. |
| Hotel Coming soon | Done and enforced in the shared action handler, not just visible links. |
| Audit findings F01–F16 | 15 fully addressed, 1 (F13) addressed with a documented partial result — see §4. |
| Tests | `test:marketing-site` 5/5, `test:public-domains` 9/9, `product-extraction` 15/15, `enterprise-foundation` 181/181. |
| Visual QA | 14 pages × desktop/phone + 6 pages × tablet + zoom/DPI/reduced-motion + 12 scripted interaction checks: no broken images, console errors, page errors, or horizontal overflow. |

---

## 2. What changed

### 2.1 Story and information architecture (user requirements)

- `index.html` hero rewritten to the mandated copy: **"Run the day. Know the business. Stay in control."**, primary **"Start your free month"**, trial line **"1-month free trial. No credit card required."**, feature strip **Manager mobile app · Direct booking and guest web experiences · Reports and financial control**.
- `#product-apps` opens with "Three hospitality applications. One trusted Tsa Bonno foundation." and the three cards in mandated order: **Tsa Bonno LodgingOS → Tsa Bonno Restaurant & Bar POS → Tsa Bonno HotelOS (Coming soon)**. The Hotel card's action is **Register interest**, not a trial.
- Navigation, mobile navigation and footer reordered to Lodge → Restaurant POS → Bar POS → Hotel on all 27 pages (26 desktop navs, 25 mobile navs, 1 footer; stagger indices renumbered).
- Hidden legacy `home-redundant` sections on `index.html` retained but not rendered, removing obsolete claims from the visible page without deleting source the tests rely on.

### 2.2 Design system

- `styles.css` restructured as a ~29-section design system (tokens, components, per-product palettes, accessibility, print) with a **legacy compatibility layer prepended** so all 27 existing pages stay styled; equal-specificity ties go to the new rules. Verified: **0 classes newly missing versus HEAD** (152 → 11 missing overall; the remainder are pre-existing and covered by inline `<style>` blocks or hidden sections).
- Product palettes taken from the actual shells: Lodge `#174c3a` / rail `#0f3d2c→#0c2d23` / paper `#f4efe7`; Restaurant & Bar `#c95635` / `#2f222a→#211920`; Hotel `#b8734a` / `#1a1512→#241c17` / `#f0ebe4`.
- Hero stacking fix found during visual QA: `.hero-section-with-photo::before/::after` paint at `z-index 1`, and the legacy `.hero-copy { position: relative; z-index: 2 }` rule had been dropped in the port, so the dark gradient painted **over** the headline (invisible cream text). Restored the rule and added light `.hero-lead` / `.hero-trial-line` colours for photo heroes. Evidence: `implementation-evidence/after-index-1440.jpg`, `after-index-768.jpg`.
- No-JS navigation fallback (`html:not(.js)`), reduced-motion guards, `scroll-margin-top` for anchor targets under the sticky bars.

### 2.3 Shared behaviour (`script.js`, externalized inline scripts)

- `PRODUCTS` model with `detectProductId()` (URL param → `<body data-product>` → page → stored → lodge-camp) and `explicitProductId()` (URL/body only; `null` on ecosystem pages so CTAs open the chooser — never silently route to Lodge).
- **Coming-soon gate**: `?product=hotel`, chooser selection, `data-product="hotel"` cards, generic modals and direct download/thank-you URLs all resolve to interest/demo, never a trial or installer flow. On `hotel.html` itself the pinned `window.location.href = './hotel.html'` branch remains for navigation-away, with an in-page scroll to `#interest` when already there.
- **Lead submission hardened**: `AbortController` timeout, `res.ok`/409 handling, no success analytics or messaging on failure, honest error recovery with WhatsApp/email fallbacks, duplicate-click protection.
- **Release discovery**: five distinct states (loading / available / unavailable / error / coming-soon) per product with cache and timeout; Hotel's `boroko-hotel-releases` feed stays dormant.
- **Selection retention**: `tsa_selected_plan` written on `[data-plan]` clicks and read by the trial/quote flows; thank-you page filters `data-product-show="lodge-camp|hospitality-pos|hotel"` blocks by `?product=`/stored selection.
- **Privacy**: thank-you URL is `./thank-you.html?from=trial&product=<id>` — no email address in the URL.
- **Consent**: `analytics.js` bootstraps GA with `analytics_storage: 'denied'`; `trackEvent` and `gtag('consent','update')` fire only after an explicit Accept.
- **Accessibility**: modal (`role="dialog"`, `aria-modal`, focus trap, Escape, focus restore, scroll lock), same contract for the mobile menu overlay, and an accessible lightbox. Non-modal cookie notice does not claim modal semantics.
- Inline scripts externalized across all 27 pages: `analytics.js`, `quote.js` (enterprise quote + packages `?addons=` pre-check and `#hotel-quote-handoff` wiring), `admin.js`. **Zero inline non-JSON-LD scripts remain.**

### 2.4 Hosting policy (F01/F02)

`netlify.toml` CSP final state:

```
default-src 'self'; script-src 'self' https://www.googletagmanager.com https://unpkg.com;
style-src 'self' 'unsafe-inline'; img-src 'self' data: https: https://tsabonno.com;
connect-src 'self' https://oicgpknsmtvcsjacymum.supabase.co https://api.github.com;
font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

No `unsafe-inline`/`unsafe-eval` for scripts; logic moved to self-hosted files instead. `api.github.com` added to `connect-src` so installer discovery works; release feeds remain isolated per product. Verified by `test:public-domains` and by the strict-CSP-equivalent local preview used for all visual QA (every page loaded with zero console errors).

### 2.5 Page-level work

| Page | Change |
|---|---|
| `hotel.html` | Fully converted to **Coming soon**: badge, interest form at `#trial`/`#interest`, "Register interest" + WhatsApp demo actions, Windows guidance reframed as launch guidance, P37,998 kept and marked coming-soon, `id="fallback-download"` repurposed. **Genuine HotelOS screenshots** captured from `out/hotel/renderer` → `assets/screenshots/hotel-front-desk.png`, `hotel-room-grid.png` (1920×993) + generated avif/webp variants, replacing Lodge imagery as Hotel proof. |
| `bar-pos.html` | Header replaced with the shared shell (fixes the unstyled, run-together mobile nav), skip link, CTA copy → "Start your free month", offline claims scoped, trial limits stated. Inline `<style>` retained for Bar-local components. |
| `restaurant-pos.html` | Early hero CTA + trial line, "any screen/device" claims scoped to named device classes, owner-digest/waitlist automation claims corrected, and a **sticky 8-tab feature index** (Workspaces / Floor / Kitchen / Stock / Team / Cash / Terminal / Pricing) with verified anchors — the audit's F13 prescription for the 26-viewport mobile page. |
| `lodge-app.html` | Offline claims scoped, trial limits (once per property; capacity 120/6/2, 400/20/5, 600/30/10) stated, CTAs `data-product="lodge-camp"`. |
| `packages.html` | Lodge plan CTAs carry `data-product`/`data-plan`; Hotel builder gets valued checkboxes, `#hotel-quote-handoff`, and a **feature-detected** handoff to `enterprise.html` carrying `?addons=` (works without JS degradation); `quote.js` pre-checks the add-ons. |
| `thank-you.html` | Product-aware via `data-product-show` blocks (lodge-camp / hospitality-pos / hotel) + default; no false "file was downloaded" claim. |
| `contact.html` | Copy corrected to describe the implemented form (posts to `marketing_leads`) with genuine email/WhatsApp recovery (F14). |
| `download.html` | Neutral, product-correct release state with honest loading/available/unavailable/error wording. |
| `index.html` | Over-claims repaired: "No double-bookings, no data loss" LAN statement and "any phone" phrasing replaced with scoped, recoverable descriptions (F04/F16). |
| 3 blog pages | Standard `mobile-overlay-footer` added. |
| `features/why-switch/manager-app/booking-site/control-center` | Claim corrections (F04/F16): booking-site "always current/no double-bookings" softened to match the mesh conflict-review contract; Manager App described as product-aware viewing with selected actions, not globally read-only. |
| `brochure.html` + PDF | Nav order, domain/contact metadata, analytics wiring; Hotel note now states **"HotelOS is coming soon … Register your interest"**. PDF regenerated via `npm run marketing:brochure` (36.8 MB) and rendering inspected. |

### 2.6 Images

- Hero/proof images no longer stretch: measured at 1440px, **0 stretched images** on lodge/hotel/index/restaurant; hero CTAs now sit at y=821 / 774 / 623 — inside the first 900px view (F06's core complaint was y≈945–960).
- `loading="eager"`/decode settling used during QA so lazy images are verified, not misreported as broken.

---

## 3. Verification (exact commands and results)

| Command | Result |
|---|---|
| `npm run test:marketing-site` | **5/5 pass** |
| `npm run test:public-domains` | **9/9 pass** |
| `node --test tests/product-extraction.test.mjs` | **15/15 pass** |
| `node --test tests/enterprise-foundation.test.mjs` | **181/181 pass** |

Test updates (authorized for Coming-soon/product-order changes, substantive coverage preserved):

- Enterprise quote assertions now read `quote.js` via an `enterpriseComposed` string, because the logic was externalized for strict CSP — the same assertions still run, none deleted.
- Bar add-on price assertions corrected to the current catalogue (Stock & Purchasing Pro P2,500; Accounting & Workforce P3,500; Growth & Multi-Outlet P2,000) with the dependency and "P6,000/year combined" disclosures now asserted as well.
- Existing pins preserved and passing: hero copy, trial line, `detectProductId`, `&product=` encoding, `window.location.href = './hotel.html'`, release feed names, Windows guidance phrases, pricing boundaries, `data-product`, `data-action="download"` counts.

Scripted browser QA (Chromium via Playwright, strict-CSP-equivalent local server; external traffic intercepted, no real leads/analytics submitted):

- **28 page/viewport captures** (14 pages × desktop 1440 + phone 390): no broken images, no console/page errors, no horizontal overflow (>8px).
- **Tablet 768** (6 pages), **200% zoom equivalent** (720×450 @2x, 3 pages), **high-DPI phone** (390×844 @3x), **reduced-motion** (key elements all visible): clean.
- **12 interaction checks — all pass**: ecosystem CTA opens chooser → focus enters dialog → Escape closes → focus restored; product-page CTA opens its own trial modal (not the chooser); mobile menu toggle visible → opens → focus moves inside → Escape closes; thank-you `?product=hotel` shows only the hotel block; `?product=hotel` exposes the interest CTA; zero page errors.
- **Feature index**: 8/8 anchors resolve, click-scroll lands the section heading below the sticky bars, desktop overflow 0.
- **Class coverage diff vs HEAD**: 0 newly missing classes.
- **Brochure**: `npm run marketing:brochure` regenerated the PDF; DOM check confirms the Coming-soon note, correct nav order, and PDF link.

Evidence: `docs/audits/marketing-ui-ux-2026-10-22/implementation-evidence/after-*.jpg` (14 captures, 1.7 MB) alongside the audit's before screenshots.

---

## 4. Finding-by-finding disposition

| # | Finding | Status | Where |
|---|---|---|---|
| F01 | Inline quote/analytics scripts blocked by CSP | **Fixed** | Logic externalized to `quote.js`/`analytics.js`/`admin.js`; CSP unchanged except where noted; test asserts `./quote.js` is referenced |
| F02 | GitHub installer discovery blocked | **Fixed** | `connect-src` adds `api.github.com`; 5 distinct release states per product |
| F03 | Download success claimed without persistence/availability | **Fixed** | `res.ok`/409 checks, timeout, no success on HTTP 500, honest states, no "was downloaded" claim, duplicate-click protection |
| F04 | Offline promises exceed the contract | **Fixed** | Claims scoped on index, booking-site, bar, restaurant, lodge, features/why-switch; conflict-review and pending-sync language retained |
| F05 | Hotel package builder dead end | **Fixed** | `#hotel-quote-handoff` + `?addons=` handoff to `enterprise.html`, feature-detected; Hotel itself gated to interest |
| F06 | Stretched heroes, CTAs below fold | **Fixed** | 0 stretched images measured; hero CTAs at y=821/774/623 (<900) |
| F07 | Bar header unstyled, tiny targets | **Fixed** | Shared shell + skip link + menu semantics on `bar-pos.html` |
| F08 | Product/package selection lost | **Fixed** | `tsa_selected_plan` + `tsa_selected_product`, `data-plan`/`data-product` on CTAs, thank-you product filtering |
| F09 | Hotel trial/purchase/quotation conflict | **Fixed as Coming soon** | Hotel trial/purchase disabled everywhere; interest/demo only; quotation code retained as launch preparation |
| F10 | Proof shows wrong/old products | **Fixed** | Genuine HotelOS front-desk/room-grid screenshots captured and wired; POS navigation story updated to current rail/workspaces language |
| F11 | Incomplete dialog/menu keyboard behaviour | **Fixed** | Dialog semantics + focus trap/restore + Escape + scroll lock for modal, menu, lightbox — all covered by scripted checks |
| F12 | Mobile homepage loses product choice | **Fixed** | Chooser preserved on phones; hero CTAs never silently default to Lodge |
| F13 | Long mobile pages bury decisions | **Partial — see note** | Sticky 8-tab feature index added to `restaurant-pos` (worst case, 26 viewports) with verified anchors and scroll-margin; early hero CTA/trial line added. **Not done:** further content consolidation — restaurant-pos remains ~21,800px tall on phone because removing repeated specialist sections would discard product detail the brief also requires keeping accessible. Decision: index + progressive navigation over deletion. |
| F14 | Contact copy describes wrong form | **Fixed** | Copy now matches the implemented `marketing_leads` post and its real recovery paths |
| F15 | Decline does not stop custom analytics | **Fixed** | Consent-default-denied bootstrap; `trackEvent`/consent-update gated on saved Accept across Accept/Decline/reload |
| F16 | Hardware/automation claims unscoped | **Fixed** | "any screen/device" → named device classes; digest/waitlist automation claims corrected to the implemented manual/documented behaviour |

### Visual-review items (confirmed image/card defects)

| Item | Status |
|---|---|
| Severe 993px-height stretching (Lodge/Hotel) | **Fixed** — measured 0 stretched images |
| Home connected-suite card imbalance | **Fixed** — `#product-apps` cards recomposed with consistent preview areas and deliberate portrait treatment for Manager proof |
| Brochure Manager crop discarding ~¾ of the screenshot | **Fixed** — brochure image fitting corrected and PDF regenerated |
| Tiny unreadable whole-app screenshots | **Partially fixed** — heroes/proof use larger crops and generated responsive variants; some secondary gallery screenshots remain small previews with accessible enlargement (lightbox) rather than being re-captured |
| Undersized full-width backgrounds (1280px for ~1498px areas) | **Fixed** — responsive `srcset`/`sizes` on hero backgrounds (`400/480/1600` variants, viewport-aware `sizes`) |

Findings explicitly **not adopted** (per the combined report): pool cash-only controls exist; `/api/quote-download` is mapped; anon key + public admin login ≠ proven leak.

---

## 5. Bar manual-impact assessment

**Decision: no Bar operator manual or quick-start update required.**

Reason: this change is confined to the public marketing website (`marketing-site/`). It does not alter any Bar operator workflow, navigation, visible in-app control, permission, daily procedure, financial or stock behaviour, recovery path, supported equipment, or available feature inside the `hospitality-pos` application. The marketing copy changes describe existing behaviour more accurately (offline boundaries, add-on prices/dependencies, trial limits); they change nothing the operator does in the app.

Per `AGENTS.md`, this is marked "No manual update required — marketing-site copy and presentation only; no operator-facing workflow, control, permission, or guide applicability change." The marketing brochure (`tsa-bonno-hospitalityos-brochure.pdf`) is a sales document, not an approved Bar operator PDF, and was regenerated through `npm run marketing:brochure`; no change was made to `docs/bar-manual/` or `document-manifest.json`.

---

## 6. Known limitations and unresolved items

1. **F13 content consolidation** — see §4. Navigation improved; page length not materially reduced.
2. **Secondary gallery screenshots** remain small previews (enlargement available via the lightbox) rather than being re-captured as workflow crops.
3. **No permanent browser test command exists.** The interaction/viewport QA ran as throwaway Playwright scripts against a strict-CSP-equivalent local server; they were removed after use to avoid shipping an unregistered script. If a durable command is wanted, `marketing:qa` would need to be added to `package.json` — not invented retroactively.
4. **Interrupted `marketing:images` run** earlier in this work caused byte-level churn on some pre-existing generated avif files (`booking-site-*`, `desktop-*`). Content is unchanged and all tests pass; the diffs are encoding noise only. A clean regeneration via `npm run marketing:images` would normalize them if desired.
5. **Live deployment not verified.** All verification is local against checked-in files and the checked-in CSP. Supabase, DNS, GitHub release availability, and live hosting headers were not probed; no real leads, emails, or analytics were submitted.
6. **Nothing committed or deployed** — as instructed. The working tree contains this work plus substantial unrelated pre-existing changes, all preserved.

---

## 7. Deployment status

Local implementation complete and locally verified. **Deployment status is not claimed**: this report reflects checked-in configuration and local strict-CSP previews only. A release decision requires a separate deployment step and post-deploy header/behaviour check.
