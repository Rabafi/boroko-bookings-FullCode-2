# Marketing website UI/UX and product-truth audit

Date: 22 October 2026 (Africa/Gaborone). Target: current, uncommitted working tree. This is an audit, not an implementation or deployment approval.

## Verdict

The site has a useful visual foundation and substantially correct package prices, but it is not ready to be relied on as a consistent three-product sales funnel. The main problems are broken conversion behavior, promises broader than the implemented/qualified product, and inconsistent product presentation. Restyling alone would leave the most serious problems intact.

I interpret the three apps as **LodgingOS, HotelOS, and Hospitality POS**. Restaurant and Bar are operating profiles of Hospitality POS, not a fourth packaged app. Manager PWA, public booking, Legacy POS, shared entitlements, and local Bar were checked where marketing claims depend on them.

**Subsequent user direction:** present HotelOS as **Coming soon**, keeping its feature page visible and persuasive while temporarily disabling trial/download/purchase/activation actions. Use Register interest or Request a demo. Earlier Hotel conversion findings below describe the inspected checkout and future launch preparation; they do not recommend making HotelOS available now. This report update does not change the website itself. See SIMPLIFIED-COMBINED-REPORT.md for the current launch direction.

## Evidence and limits

- Inspected all 27 marketing HTML pages for local asset/link-file existence; no missing local referenced files were found. Reviewed shared CSS/JavaScript, Netlify policy, the commercial catalogue and current quote migration, product identity/routes, Hotel shell, POS shell, booking/mesh behavior, and relevant Manager/public-booking source.
- Ran 22 local page/viewport checks: 11 customer pages at 1440×900 and 390×900 in headless Microsoft Edge. Captured 12 initial viewport screenshots and additional targeted measurements. All 22 document widths fitted their viewports; this is not a complete component overflow or WCAG certification.
- The local HTTP preview applied the exact Content Security Policy from marketing-site/netlify.toml. External requests were intercepted: no real leads, emails, analytics records, orders, payments, or database mutations were submitted. A separate mocked HTTP 500 test bypassed CSP only to isolate the lead-handler behavior.
- Initial browser image failure lists include images that had not yet lazy-loaded and an empty lightbox image. They must not be interpreted as missing assets. Static file checks found no missing image/link files. The final scroll pass loaded all Restaurant and Packages images; remaining unloaded Home images belong to deliberately hidden sections. Those hidden sections are not treated as broken reveal animations or missing assets.
- The public domain could not be opened by the web tool. Live hosting headers, DNS, GitHub release availability, authenticated app behavior, installed hardware, and deployed Supabase contracts were not verified. Browser defects below are reproduced against this checkout and its checked-in hosting configuration.
- Checks passed: npm run test:marketing-site (5 named tests plus top-level contract assertions); npm.cmd run test:public-domains (9 tests). These checks do not cover the failing browser behaviors.

Source hashes: [inspected file snapshot](source-snapshot.json).

Evidence: [initial browser log](browser-evidence.json), [targeted measurements](followup-evidence.json), [all-page static checks](static-evidence.json), [browser runner](capture-browser-evidence.mjs), [targeted runner](capture-followup.mjs).

Priority: P1 = broken buying path or material unsupported promise; P2 = substantial usability, accessibility, or expectation problem. Evidence is distinguished from design judgment below.

## Findings

### F01 · P1 · Hotel quotation logic is blocked by the site's security policy

**Reproduced at both widths.** Selecting Online Payment Gateway on enterprise.html leaves the summary at “No add-ons selected yet.” Edge reports that the inline application script is blocked. The same blocked script owns form submission, pricing, success/error states, and quote retrieval. Without its handler, the form has no functioning authoritative quote submission path.

Source: marketing-site/netlify.toml:12; marketing-site/enterprise.html:362, :554, :566, :618. The script-src permits self and named external origins but supplies neither a nonce/hash for this inline code nor another permitted execution mechanism.

**Fix:** move application logic into a self-hosted external file, preserve the authoritative quote RPC, and test the deployed-header-equivalent page end to end. Do not weaken the policy globally to repair one form. Apply the same review to the blocked inline analytics initialization.

### F02 · P1 · All three installer discovery requests are blocked

**Reproduced.** connect-src omits api.github.com, while script.js fetches that host to locate each product's installer. Hotel is therefore labelled “preparing for release” in a fresh browser even when the test supplied a valid release response; LodgingOS falls back to hard-coded v1.5.5. This is a configuration defect, not evidence that the real Hotel release does or does not exist. Ordinary links to GitHub remain usable; the automatic discovery path fails.

Source: marketing-site/netlify.toml:12; marketing-site/script.js:8–29, :53–89.

**Fix:** allow only the required release API origin or use a controlled same-origin release endpoint. Represent loading, available, early access, and lookup failure separately. Keep feeds product-specific and verify fresh-cache behavior for every product.

### F03 · P1 · Download success is claimed without a successful lead save or available installer

**Source and mocked-browser confirmation.** The modal's lead POST enters its success continuation on any HTTP response; it never checks res.ok. A mocked HTTP 500 still emitted download_started and attempted the download. DOWNLOAD_AVAILABLE affects status text but is not a submission guard. A missing product asset can therefore lead to a generic GitHub release page while the flow announces an automatic download. thank-you.html says the installer “was downloaded,” which a website cannot establish from a clicked link.

Source: marketing-site/script.js:51, :78–89, :515–563; marketing-site/thank-you.html:6, :99. Welcome-email submission also precedes confirmed lead persistence.

**Fix:** verify lead response, provide bounded timeouts/retry and explicit recovery, and give early-access registration its own outcome. Make the actual download an explicit user action after readiness is known; show the correct product, version, and retry link. Say “Download requested” until there is a meaningful confirmation. Prevent repeat clicks while release lookup is pending. Keep lead analytics tied to confirmed persistence.

### F04 · P1 · Offline promises exceed the actual cross-app contract

**Verified source contradiction.** Visible booking-site copy promises “No double-bookings” and “always current” availability. Home source also retains a “No double-bookings, no data loss” LAN statement inside a hidden section; that retained statement is not currently visible and is not counted as an active homepage UX defect. The mesh code explicitly handles two offline desks booking the same room and flags one for manual review. Bar says “Fully offline. No internet needed,” “Set it up in 5 minutes,” and implies online sync plus live phone oversight without explaining connectivity. Restaurant calls the whole system offline-ready, but waitlist creation, owner digest generation, gift cards, tip payouts, and lot management contain online guards in cloud mode.

Source: marketing-site/booking-site.html:258; marketing-site/index.html:379, :442–447 (hidden retained copy); marketing-site/bar-pos.html:82, :90, :315; marketing-site/restaurant-pos.html:706; src/main/domains/mesh/meshConflict.js:223–245; src/main/domains/pos.js:8556, :8702, :9348–9356.

The dedicated local Bar service is a distinct, partial authority mode. Current architecture and project state explicitly withhold installed Windows lifecycle, complete routing, failover/restore, multi-till/hardware qualification, and general commissioning. Its existence does not validate an unrestricted offline promise or hosted/mobile ingestion. Legacy has its own queue and lifecycle and cannot be treated as proof of Modern parity.

**Fix:** publish an operation-level boundary: core offline capture, provisional/pending records, online approvals and advanced actions, conflict review, and internet requirements for remote oversight. Market local Bar only to the maturity level supported by qualification evidence. Replace guarantees with concrete behavior and a recovery explanation.

### F05 · P1 · The Hotel package builder has no path to a quotation

**Verified navigation dead end.** packages.html offers an interactive Hotel estimate, but no button submits or carries those selections to enterprise.html. Its Hotel link goes to hotel.html#trial; Hotel's package CTA returns to packages.html#hotel-packages. Static inspection found no HTML anchor to ./enterprise.html anywhere among the 27 marketing pages. The quote page exists but is absent from the visible buying path.

Source: marketing-site/packages.html:251–259; marketing-site/hotel.html:25–26. script.js:958–982 only updates local totals.

**Fix:** add a visible “Request this Hotel quotation” handoff carrying selected add-ons and product identity. Recalculate all submitted amounts server-side; the browser estimate must remain labelled as an estimate. Expose quotation access in the Hotel product journey and preserve selections on recovery.

### F06 · P2 · Product images are stretched and push primary CTAs below the first desktop view

**Measured.** Both LodgingOS and Hotel hero images have natural dimensions 1920×993 but render at 473.25×993 at 1440px. Correct proportional height would be about 245px. The hero becomes 1,393px tall; the first CTA starts around y=945 for Lodge and y=960 for Hotel in a 900px viewport (the initial animated frame varies slightly). This explains the large visual void, distorted proof, and hidden first-screen CTA.

Source: marketing-site/styles.css:2972–2979; marketing-site/lodge-app.html:39; marketing-site/hotel.html:22. Evidence: [Hotel desktop](hotel-1440.png), followup-evidence.json heroes.

**Fix:** retain intrinsic aspect ratio with height:auto or a correctly specified aspect-ratio/object-fit treatment. Recheck the hero's content alignment and visible CTA at common laptop widths and browser zoom levels.

### F07 · P2 · Bar navigation is visually broken and has smaller touch targets

**Reproduced visually.** The Bar page uses site-header/header-inner/header-nav, while the shared site stylesheet has no rules for these classes and the page's own CSS does not supply them. On a phone, links run together as “LodgeHotelRestaurant POSBar POSPackagesContact”; it has no common menu toggle. Several measured link boxes are only 21px high. Bar is also the only HTML page without the common skip link. Its installer-recovery note uses the shared dark green ink on a near-black background and is visibly difficult to read.

Source: marketing-site/bar-pos.html:65–73; marketing-site/styles.css. Evidence: [Bar phone](bar-pos-390.png).

**Fix:** use the shared responsive header, menu semantics, spacing, adequate touch targets, and skip link. Retain Bar's brand styling through tokens rather than a separate unstyled header implementation.

### F08 · P2 · Package/product selection is lost during conversion

**Verified.** Lodge package links append ?plan=Starter/Standard/Pro, but script.js reads only product from the URL and never consumes plan. Generic contact/download pages default to LodgingOS and use lodge terminology. thank-you.html receives product in its URL for feed selection but its setup headings and instructions remain Lodge-specific. Bar registration records only hospitality-pos, losing the distinction between Restaurant and Bar intent.

Source: marketing-site/packages.html:187, :205, :222; marketing-site/script.js:32–49, :236–248, :526–540, :558; marketing-site/contact.html:155–186; marketing-site/thank-you.html:99–145.

**Fix:** carry product, operating profile, package, selected add-ons, and campaign source through one consistent lead/quote context. Show that context in form labels, confirmation, email, and setup guidance. Validate selections server-side when they become commercial requests.

### F09 · P2 · Hotel trial, initial purchase, and quotation expectations conflict

**Source inconsistency; not a claim that Hotel signup cannot offer a trial.** Hotel offers a one-month free trial. The shared pricing helper defaults trial eligibility to Starter/Standard/Pro; Hotel Core maps to Enterprise. The Hotel quote UI separately declares eligibility from a customer dropdown, but sends no corresponding trial field in its authoritative p_selection. Its legacy summary starts annual/setup at null, so it can replace the visible P37,998 context with “To be confirmed.” The latest checked-in calculate_commercial_quote starts total_due_now with the package price.

Source: marketing-site/hotel.html:22–26; marketing-site/enterprise.html:373–442, :536–540, :601–617; src/shared/commercialPackages.js:119–122, :247–249; src/shared/commercialEntitlements.js Hotel Core; supabase/migrations/20261021090000_bar_addon_dependencies_and_prices.sql:163.

**Fix:** agree one server-backed trial/quotation policy and distinguish trial access from money due under a paid quotation. Explain initial purchase and recurring add-ons together. Do not let a local dropdown imply authoritative entitlement or silently waive/activate charges. Verify the deployed contract before making a release claim.

### F10 · P2 · Marketing proof does not show the distinct current products

**Image and source comparison.** Hotel describes a distinct copper console but displays a green “LODGE MANAGER / SAFARI SANDS LODGE” room-board screenshot. Actual HotelLayout imports hotelTheme.css and uses hotel-specific navigation. Home promises a persistent POS bottom dock; current HposLayout renders a primary rail, and HposDock explicitly calls itself a compatibility export. Restaurant's seven-workspace story also hides the more specific current Sell/Open checks/operations structure.

Source: marketing-site/hotel.html:22–23; assets/screenshots/desktop-room-grid.png; src/renderer/src/components/hotel/HotelLayout.jsx:18–28; marketing-site/index.html:294; src/renderer/src/components/hospitality-pos/HposLayout.jsx:693–700; HposDock.jsx:1; src/shared/barModeProfile.js:91–118.

**Fix:** capture the actual current Hotel front desk/folio/close and Restaurant/Bar terminal/manage flows with safe demo data. Caption product, role, package, and relevant mode. Label illustrations/mockups as illustrative. Use enlarge controls that also work with keyboard. Do not rename a Lodge screenshot via alt text.

### F11 · P2 · Dialog and mobile-menu keyboard behavior is incomplete

**Reproduced.** Opening the download modal leaves focus on the triggering link. The modal itself has no role=dialog or aria-modal, no focus containment/restoration, and no Escape close handler. Escape also leaves the Hotel mobile menu open. The initial broad “any dialog” probe matched another element; the scoped follow-up correctly records role:null, ariaModal:null, focusInside:false for .download-modal.

Source: marketing-site/script.js:110–126, :457–510, :568–570. Evidence: browser-evidence.json modal-escape/mobile-escape; followup-evidence.json dialog.

**Fix:** make the overlay an accessible named dialog, move focus in, trap it while open, restore focus on close, provide Escape and a visible close action, and prevent background interaction/scroll. Apply the same keyboard contract to navigation and image enlargement. Test at zoom and with keyboard alone.

### F12 · P2 · Mobile homepage removes the product-choice CTA

**Verified source and screenshot.** Home introduces three applications but its strongest message remains “starting with your lodge.” On mobile CSS hides secondary hero buttons, which removes “Choose your application” and leaves a generic “Start free trial” that defaults to Lodge. Restaurant, Bar, and Hotel prospects must discover another route after the primary conversion prompt.

Source: marketing-site/index.html:201–210; marketing-site/styles.css:2852–2854; script.js:32–39. Evidence: [Home phone](index-390.png).

**Fix:** make product choice part of the primary journey: Lodge & Camp, Hotel, Restaurant & Bar, then profile where appropriate. Preserve a visible chooser on phones. A flagship Lodge emphasis can remain, provided it does not silently choose the wrong product for other customers.

### F13 · P2 · Long mobile pages bury decisions beneath repeated features

**Measured, with a design judgment.** At 390×900, Restaurant is 20,932px tall (about 23 viewport heights), Packages 15,989px, and Manager 13,419px. Restaurant repeats terminal, cash, team, offline, stock and close benefits. Packages combines four commercial paths and then returns to Lodge-only sales advice. Sticky/floating contact and consent elements also compete for the same lower phone area.

Source: marketing-site/restaurant-pos.html; marketing-site/packages.html; marketing-site/styles.css:1998, :2183, :2896–2907. Evidence: browser-evidence.json page heights, restaurant-pos-390.png.

**Fix:** present fit, current product proof, package boundary/price, requirements, and next action early. Use a short workspace/feature index and progressive detail for specialist functions. Default package navigation to the selected product. Consolidate repeated claims and coordinate floating elements so they do not cover important content.

### F14 · P2 · Contact instructions describe a different form than the one implemented

**Verified source.** Contact repeatedly says the form opens an email app and needs no backend. The .demo-form handler actually posts to marketing_leads, displays an immediate trial-download success state, and uses email only after failure. Contact remains Lodge/package oriented despite serving all three apps.

Source: marketing-site/contact.html:108, :149–151, :194, :213; marketing-site/script.js:211–286.

**Fix:** define whether this action is a sales enquiry, trial registration, or quotation request; make title, CTA, transport, success state, and recovery consistent. Keep a visible email/WhatsApp alternative and explain when it is needed. Use business-type-aware questions.

### F15 · P2 · Declining analytics does not stop the site's custom analytics

**Verified source; a trust/UX finding, not a legal assessment.** Accept/Decline controls update Google consent and local storage, but trackEvent unconditionally posts to analytics_events. The simulated first-use modal emitted analytics before any consent choice. Blocked inline initialization further separates actual tracking from the banner's apparent state.

Source: marketing-site/script.js:399–440, :489, :536, :551.

**Fix:** define which events are optional analytics, gate them on the same saved consent state, and describe necessary operational submissions separately. Verify Accept, Decline, reload, and preference change. Remove buyer-facing claims that do not match the chosen behavior.

### F16 · P2 · Hardware/platform and automation claims need precise scope

**Partly source-backed, partly unsubstantiated.** POS says it works on “any screen” and “tablets” and uses a browser-like pos.yourbar.co.bw visual, while the packaged sales product is Electron and the advertised installer is Windows 10+ x64. Manager mobile is a separate, restricted browser surface; it is not general mobile selling. “Owner digest sent automatically” is broader than the traced Generate Digest button/RPC. Waitlist automatic notification also needs an identified dispatch/delivery path before it is promised. A status flag is not evidence of a delivered notification.

Source: marketing-site/restaurant-pos.html:348, :713, :763, :872; apps/hospitality-pos/package.json; src/shared/productIdentity.js; manager-pwa/src/lib/productShell.js:39–46; src/renderer/src/components/restaurant/RestaurantOwnerDigest.jsx:11–17, :37–53; src/main/domains/pos.js:8556–8559.

**Fix:** distinguish Windows terminal/tablet, prep/customer display, Manager phone browser, and Legacy compatibility. Publish tested equipment/configuration rather than universal compatibility. Identify and verify scheduling/dispatch for automated messages, or describe the implemented manual action. Preserve provider-confirmed/manual tender distinctions already present in the Bar copy.

## Comparison against actual app code

“Source-backed” below means UI/routes and contracts exist in this checkout; it does not certify deployment or end-to-end behavior.

| App / surface | Source-backed product behavior | Marketing implication |
|---|---|---|
| LodgingOS | Separate product definition/build wrapper; bookings/rooms/guest/invoice workflows; offline RPC operations and conflict review; Starter/Standard/Pro entitlement ladder | Keep the lodging story and package ladder, but remove absolute offline guarantees and preserve selected tier |
| LodgingOS packages | P8,999 / P12,999 / P18,999 annually; Starter basic reports/staff/deposits; Standard full reports/staff/prepayments; Pro POS/inventory/booking/mobile | Prices and major boundaries mostly agree with commercialEntitlements.js; keep benefits visibly tied to tiers |
| HotelOS | Separate HotelLayout/HotelHome and route boundary; hotel front desk, folios, room workflow, rates, housekeeping, night audit and corporate components; Hotel Core P37,998 initial purchase | Product differentiation is real in source and deserves its own proof; repair quote access, trial wording, and purchase/recurring disclosure |
| Hospitality POS — Restaurant | Current terminal/primary rail plus floor, kitchen, menu, stock, cash, controls, reports and management workflows; Service/Control/Growth catalogue | Rewrite the navigation story around current screens; distinguish service features from stock/control and growth features |
| Hospitality POS — Bar | bar_only is a profile, P4,500 annual Base; pack stock, tabs, cash control, staff and mobile oversight; paid add-ons with dependencies | Base/add-on prices largely align. Repair navigation and offline qualification; clarify recipes are excluded from Base, but available through the relevant add-on |
| Bar add-ons | Stock & Purchasing Pro P2,500; Accounting & Workforce P3,500 requiring Stock & Purchasing Pro; Growth & Multi-Outlet P2,000 | Existing P6,000 combined dependency disclosure is good and should remain; do not imply automatic activation |
| Manager PWA | Server-derived product shell; accommodation, Hotel and POS routes; selected operational mutations and device-local queue, with financial restrictions | Preserve nuanced wording. It is not globally read-only or an unrestricted POS terminal; show Hotel/Bar-specific mobile proof rather than Lodge-only screenshots |
| Public booking | Separate guest-facing browser app and server-enforced booking contracts; online availability/request flows | Keep direct-booking value, but avoid unconditional “always current/no double-bookings” claims and verify the current release blockers before promising seamless deployment |
| Legacy/local Bar | Separate Legacy cache/queue/release; local PostgreSQL authority remains a separately gated, partial mode | Do not transfer compatibility, hardware, offline or commissioning claims between these modes without evidence |

Principal app evidence: packages/product-config/index.js; src/shared/productIdentity.js; src/shared/commercialEntitlements.js; src/renderer/src/App.jsx:218–299, :2224–2315; src/renderer/src/components/hotel/HotelLayout.jsx; src/renderer/src/components/hospitality-pos/HposLayout.jsx; src/shared/barModeProfile.js; src/main/domains/bookings.js; src/main/domains/pos.js; manager-pwa/src/lib/productShell.js; manager-pwa/src/lib/api.js:1072–1128; docs/ARCHITECTURE.md; PROJECT_STATE.md.

## Recommended execution order and acceptance criteria

1. **Repair buying paths:** F01–F03 and F05. Test each product with fresh cache, blocked/unavailable release API, absent asset, lead HTTP 500, network timeout, retry, and success. Confirm correct product/profile/package survives every handoff. No success state should depend merely on a resolved fetch.
2. **Correct claims:** F04, F09, F16. Publish a concise capability/connection/platform matrix using current code and qualification evidence. Recheck deployed Supabase/installer state separately.
3. **Repair presentation and access:** F06–F08, F10–F12. Preserve image ratio, use real current screenshots, share the header, restore product choice, and implement complete dialog/menu keyboard behavior. Check 360/390/768/1440px and zoom.
4. **Shorten and align journeys:** F13–F15. Product-specific pricing and forms, fewer repeated sections, clear contact outcome, honest consent behavior, and coordinated phone overlays. Test with representative lodge, hotel, restaurant, and bar buyers before attributing conversion improvements.

Do not use the existing passing string-contract tests as release acceptance. Add focused browser regressions for the actual hosted-header configuration, quote handoff, context retention, and failure/recovery paths.

## Manual impact and changes made

Audit artifacts only. No website/application behavior, customer PDFs, quick-start guides, approved-document manifest, package files, production data, or deployment state were changed. **No manual update required for this audit** because it adds no customer workflow. Any subsequent Bar copy/workflow remediation must record its own manual-impact assessment and complete applicable documentation/package checks before release.
