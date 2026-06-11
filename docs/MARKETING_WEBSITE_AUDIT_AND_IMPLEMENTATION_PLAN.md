# Boroko Bookings Marketing Website Audit and Implementation Plan

Date: 2026-06-11

Scope:
- Marketing website information architecture, persuasion flow, and UI.
- Feature inventory across the desktop app, Manager PWA, and guest booking site.
- Implementation guidance for a separate model. This document does not implement changes.

## Executive Verdict

The marketing website has a strong product, credible positioning, and many useful pages, but the first impression is not yet arranged to sell the highest-value idea quickly enough.

The current homepage mostly says: "one system for bookings, rooms, billing, staff, stock, and online reservations." That is true, but it is a broad feature list. A buying lodge owner is more likely to act when the first screen names the business pain and the money outcome:

- Stop losing bookings, payments, stock, and owner visibility in notebooks, spreadsheets, and WhatsApp.
- Run the lodge even when the internet is down.
- Keep more revenue with direct online bookings.
- See the business from the owner's phone.
- Control front desk, POS, inventory, reports, staff, and audit in one financial-grade system.

The site is visually polished, but some polish currently reduces persuasion. The animated typing headline can show an incomplete headline for several seconds. The hero screenshot is softened/faded during the first moment. The cookie banner and WhatsApp widget compete with the primary CTA. The homepage has strong proof lower down, but the top section does not make the strongest buying reasons impossible to miss.

Priority recommendation:
Rebuild the homepage flow around a "pain -> control -> proof -> package fit -> trial" sequence, and move the ecosystem's strongest differentiators into the first two screens.

## Current Above-The-Fold Audit

Observed homepage hero:
- Eyebrow: "Built by Batswana for Batswana lodges"
- H1 source: "One system to run bookings, rooms, billing, staff, stock, and online reservations."
- Animated visible state can temporarily show partial text such as "One system for your lodge." or even incomplete typed fragments.
- Lead: "Boroko Bookings gives small and growing lodges a practical, beautiful operations platform..."
- CTAs: "Start free 1-month trial", "Explore packages", "Chat on WhatsApp"
- Visual: laptop dashboard, floating tags for check-ins, occupancy, online reservations, low stock.

What works:
- The local Botswana positioning is strong and emotionally relevant.
- The visual product screenshot creates immediate credibility.
- The free trial reduces risk.
- The page quickly mentions reception, owners, online reservations, and growth.

What weakens conversion:
- The H1 is too generic. "One system..." is common SaaS language. It does not name the urgent business loss.
- The first 5 seconds are sometimes sacrificed to the typing animation. A prospect should never have to wait for the value proposition.
- The hero has three CTAs of similar visual weight. The buyer's next action should be obvious.
- "Explore packages" appears before the visitor fully understands why the package matters.
- "Chat on WhatsApp" is useful, but in the hero it competes with the free trial.
- The strongest product differences, such as offline-first operations, LAN sync, direct-booking margin, manager mobile visibility, night audit, POS-to-room folio, and role-based financial control, are present but not emotionally packaged in the first screen.
- There is no immediate "before vs after" contrast above the fold.

Recommended first-screen message:

H1 option:
"Run your lodge without losing bookings, money, or stock."

Supporting copy:
"Boroko Bookings connects front desk, rooms, invoices, POS, inventory, reports, manager mobile oversight, and direct online bookings. It keeps working offline, syncs when internet returns, and gives owners a clearer view of the business."

Hero proof chips:
- Works offline at front desk
- Direct booking page, no commission
- Manager app on phone
- POS and inventory linked to lodge operations

Primary CTA:
"Start free 1-month trial"

Secondary CTA:
"See how Boroko works"

Tertiary contact:
Move WhatsApp into the nav/header utility or a smaller sticky contact widget.

## Psychological Persuasion Audit

Use these ethically. The goal is clarity, trust, and action, not manipulation.

### 1. Problem Recognition

Current state:
The site says what Boroko does, but it does not start hard enough with what the buyer is already worried about.

Buyer thoughts likely include:
- "My staff might double-book a room."
- "Payments and balances are not clear."
- "The owner cannot see what happened today."
- "Stock disappears."
- "The internet goes down."
- "We pay commissions or lose direct enquiries."
- "The lodge has grown beyond notebooks."

Implementation:
Add a first post-hero section titled:
"What Boroko fixes first"

Cards:
- Double-bookings and room confusion
- Missed payments and unclear balances
- Stock and supplies disappearing quietly
- Owners waiting for manual updates
- Online enquiries not connected to front desk

Each card should name the old pain and the Boroko outcome.

### 2. Loss Aversion

Buyers are often more motivated by avoiding loss than by gaining abstract efficiency.

Current state:
"Operate smoothly" is positive but soft.

Implementation:
Use specific loss language:
- "Stop revenue leaking between rooms, POS, and unpaid balances."
- "Do not let internet problems stop reception."
- "Know which rooms, payments, refunds, and stock items need attention before they become expensive."
- "Keep direct bookings in your own system instead of paying commission on every stay."

Avoid overclaiming. Keep claims grounded in product features.

### 3. Clarity and Cognitive Fluency

Current state:
The homepage has many sections and many product areas. Good material, but there is repeated phrasing and broad feature clusters.

Implementation:
Arrange the story in this order:
1. Business outcome hero.
2. Pain-to-control section.
3. Three-surface ecosystem: Desktop, Manager PWA, Guest Booking Site.
4. Revenue/control proof: direct bookings, POS, inventory, night audit, reports.
5. Trust and safety: offline-first, LAN sync, role permissions, audit trail, financial-grade backend.
6. Packages.
7. Trial/contact.

### 4. Social Proof and Trust

Current state:
There are no formal testimonials. The site says "Strong trust signals even before formal testimonials," which sounds internal and should not be visible as customer-facing copy.

Implementation:
Replace meta-copy with actual trust substitutes:
- "Built for Botswana lodges"
- "Designed for owner-managed properties"
- "Free 1-month trial with your real rooms and staff"
- "Works offline when internet is unreliable"
- "Financial controls built into the workflow"
- Screenshots of real product surfaces
- Optional: founder/local support note

Later, add:
- 2-3 pilot lodge quotes
- "Used by X lodges" only when true
- Short implementation story/case study

### 5. Commitment Ladder

Current state:
The website asks for free trial, packages, WhatsApp, download, contact, and demo in different places. That is okay, but the hierarchy is muddy.

Recommended ladder:
1. Primary: Start free 1-month trial
2. Secondary: Book WhatsApp demo
3. Exploration: See packages / view features
4. Later: Download desktop app

Do not lead with raw download unless the business process is truly self-serve. If onboarding matters, the CTA should be "Start trial" or "Book setup conversation."

## Information Architecture Audit

Current pages:
- Home
- Features
- Packages
- Why Switch
- Blog
- Contact
- Brochure
- Download
- Booking Site
- Manager App

Key issue:
The two strongest selling pages, `booking-site.html` and `manager-app.html`, are not in the primary navigation. They are major Pro differentiators and should be discoverable without digging.

Recommended nav:
- Product
- Booking Site
- Manager App
- Packages
- Why Switch
- Contact

Alternative compact nav:
- Product
- Direct Bookings
- Manager App
- Pricing
- Contact

Move Blog lower unless content marketing is active. If the blog is thin, it should not occupy top nav space.

Recommended homepage sections:
1. Hero: outcome + screenshot + primary trial CTA.
2. Pain section: "What breaks when a lodge outgrows notebooks."
3. Ecosystem section: Desktop app, Manager app, Booking site.
4. Revenue control section: payments, invoices, POS, stock, refunds, night audit.
5. Offline and safety section: offline mode, LAN sync, role permissions, audit logs.
6. Direct bookings section: branded booking page, no commission, live availability, WhatsApp, SEO.
7. Role-based stories: receptionist, owner, manager, housekeeping, bar/kitchen.
8. Packages.
9. FAQ.
10. Trial CTA.

## UI Audit

### Hero

Problems:
- The typing animation hides the H1 at first load.
- The H1 has a `min-height`, creating a large vertical gap when text is short during animation.
- The laptop screenshot can look faded in the first impression.
- The hero feels visually spacious, but the conversion content competes with animation and decorative tags.
- Cookie banner covers the bottom of the viewport and can obscure hero highlights.

Implementation:
- Remove typing effect from the H1. Use a static H1.
- If animation is desired, animate a small subline or proof chip, not the main promise.
- Make the laptop screenshot sharper and higher contrast on first paint.
- Keep no more than two hero CTAs.
- Delay WhatsApp tooltip or make it less visually dominant until after scroll.
- Make cookie banner compact, with less height and no conflict with primary CTAs.

### Visual Style

Strengths:
- Warm, local, polished hospitality feel.
- Good use of screenshots.
- Consistent brand colors.

Problems:
- The palette is heavily cream/green/brown-orange. It feels premium but can become one-note across long pages.
- Rounded cards and pill elements are everywhere, which makes important items less visually distinct.
- Some pages use inline SVG icons instead of the cleaner icon system already used in apps.
- Feature cards often have equal weight even when some are much more commercially persuasive.

Implementation:
- Add stronger hierarchy: hero proof strip, high-value cards, then secondary feature lists.
- Use screenshots as proof, not just decoration.
- Avoid too many equal cards in a row. Break long grids into "must know" and "also included."
- Standardize icons if editing the static site.
- Reduce decorative cursor, scramble, particles, and glitch effects. They add novelty but not trust.

### Mobile

Risk:
The homepage has many CTAs, sticky widgets, and bottom cookie UI. On phone, this can feel crowded.

Implementation:
- First mobile viewport should show: brand, H1, 1-2 line lead, primary CTA, and one proof chip.
- Move extra CTAs below the first fold.
- Keep WhatsApp available but not as a giant competing element.
- Make package comparison horizontally scrollable only when clearly indicated.

### Forms and CTA Flow

Current:
- Contact/demo forms exist.
- Download modal collects details and starts the installer download.
- Homepage trial CTA triggers download modal through `data-action="download"`.

Concern:
"Start free 1-month trial" leading directly to a Windows installer may surprise users if they expected a guided trial/demo.

Implementation:
- Rename download CTA if it downloads: "Download trial app".
- Or change flow so "Start free trial" opens an onboarding lead form first: lodge name, rooms, package interest, WhatsApp.
- After submission, offer "Download desktop app" as the next step.
- Add a short reassurance line: "We help you set up rooms, users, and your first workflow."

## Ecosystem Feature Inventory Missing or Under-Sold on the Marketing Homepage

These are real or strongly indicated by the codebase and should be surfaced more clearly.

### Desktop App

Core operations:
- Dashboard overview.
- Bookings.
- Quotations.
- Invoices.
- Room Board.
- Planning calendar.
- Guests.
- Rooms.
- Housekeeping.
- Maintenance.

Finance and control:
- Payments and refunds.
- Server-authoritative receipts/invoices.
- Night Audit.
- Reports.
- Expenses.
- Outstanding balances.
- Invoice delivery history.
- Refund retained fees.
- Financial safety messaging around pending sync.

Commercial operations:
- POS.
- POS receipts.
- POS void approval.
- POS outlet scoping.
- Inventory.
- Room supplies.
- Stock adjustment.
- Stocktake.
- Bar/kitchen sales.
- Room folio/booking charges.

Management and admin:
- Staff roles.
- Granular permissions.
- Data import/export.
- Settings.
- Subscription access and usage limits.
- System health.
- Backup policy/health.
- Licensing/admin workbench.

Advanced differentiators:
- Built-in Ops AI assistant.
- Fraud/anomaly investigation prompts.
- Offline operation.
- Sync status and failed sync handling.
- Multi-desk LAN/P2P mesh sync.
- Advisory locks/conflict detection.
- Saved offline sessions.
- Conference/event bookings.
- Day-use/pool/facility bookings.
- Maintenance cost reporting.

### Manager PWA

Current features:
- Installable PWA.
- Dashboard.
- Rooms.
- Bookings list/calendar.
- Money view.
- Alerts.
- Reports.
- Quotations.
- Invoices.
- Expenses.
- Night audit.
- Guests.
- Staff.
- Conference.
- Day Use.
- Inventory.
- Inbox/control.
- Push notifications.
- Offline queue and cached data.
- Front-desk request threads.
- Notification inbox.
- Light/dark mode.
- Access restrictions by plan/role.

Strong selling angle:
"Owners can see the truth of the lodge without giving mobile users power to casually change financial records."

This is more powerful than "manager app on phone." It communicates control and safety.

### Guest Booking Site

Current features:
- Public lodge profile by slug.
- Branded lodge name, logo, hero image, tagline.
- Availability search by dates.
- Room cards with photos, rates, occupancy, amenities.
- Sort by recommended, price, or guest capacity.
- Booking request form.
- Guest validation.
- Session persistence if page refreshes.
- Offline awareness.
- WhatsApp/call/email links.
- Policies: check-in, checkout, cancellation, payment terms, house rules.
- SEO meta and schema.
- Google Calendar link on success.
- Confirmation email queue/retry.
- Analytics for search, room selection, and booking request.
- Online requests appear for front desk review.
- Rejected/blocked online booking demand can be surfaced in manager alerts.

Strong selling angle:
"Your lodge gets a branded direct-booking page connected to live room availability, so guests can request stays without commission and front desk can review requests inside Boroko."

## Recommended Homepage Rewrite Structure

### Hero

H1:
"Run your lodge without losing bookings, money, or stock."

Lead:
"Boroko Bookings connects front desk, rooms, invoices, POS, inventory, reports, manager mobile oversight, and direct online bookings. It works offline, syncs safely, and gives owners a clear view of the business."

Proof chips:
- Offline front desk
- Manager app
- Direct booking page
- POS + inventory

CTA:
- Primary: Start free 1-month trial
- Secondary: See product tour

Visual:
Use a crisp desktop dashboard screenshot with smaller overlays:
- "Outstanding balances visible"
- "Online requests waiting"
- "Low stock warning"

### Section 2: "What Boroko fixes"

Cards:
- Booking confusion -> live room board and planning.
- Payment uncertainty -> invoices, deposits, balances, receipts.
- Owner blindness -> reports, alerts, Manager app.
- Stock leakage -> POS, inventory, room supplies.
- Internet downtime -> offline work and sync.
- Direct booking gap -> branded booking site.

### Section 3: "Three connected surfaces"

Desktop App:
"Reception and operations run here."

Manager App:
"Owners see, ask, and follow up from phone."

Booking Site:
"Guests search and request direct stays."

Add one screenshot each.

### Section 4: "Financial and operational control"

Use stronger claims:
- Payments, invoices, balances, refunds.
- Night audit and end-of-day close.
- Staff roles and permissions.
- POS outlet controls and stock movement.
- Reports for occupancy, revenue, expenses, outstanding balances.

### Section 5: "Built for local realities"

Include:
- Built by Batswana for Batswana lodges.
- Works offline.
- LAN sync for multiple desks.
- WhatsApp-friendly guest communication.
- Small lodge to growing property package ladder.

### Section 6: "Direct bookings"

Lead with money:
"One direct booking can protect more margin than a month of software costs."

Do not claim exact ROI unless supported. Use conditional examples:
"If a third-party platform takes 15% on a P2,000 booking, that is P300 you could keep when guests book direct."

Show:
- Branded URL.
- Photo galleries.
- Live availability.
- Guest request form.
- WhatsApp.
- Policies.
- SEO.

### Section 7: Packages

Keep three plans but make benefits more buyer-centered:

Starter:
"Stop manual booking chaos."

Standard:
"Give owners control of money, staff, reports, and daily close."

Pro:
"Add direct bookings, POS, inventory, manager app, and full commercial control."

### Final CTA

"Start your free 1-month trial with your real lodge setup."

Support copy:
"Tell us your rooms, users, and whether you need POS, inventory, or direct bookings. We will help you choose the right package."

## Page-Specific Recommendations

### Home

Highest priority page. Rework flow and first screen.

Add:
- Static outcome-led H1.
- Stronger pain section.
- Three-surface ecosystem section.
- Direct-booking margin section.
- Financial trust/safety section.
- Better links to Manager App and Booking Site pages.

Remove or reduce:
- H1 typing loop.
- Glitch/scramble/cursor effects.
- Equal-weight CTAs in hero.
- Internal-sounding "trust signals before formal testimonials" copy.

### Features

The features page is strong but reads like an internal capabilities inventory.

Reorganize around buyer jobs:
- Reception control.
- Owner visibility.
- Money and audit.
- Guest direct bookings.
- Bar/kitchen and stock.
- Offline and multi-desk safety.
- AI and anomaly detection.

Add "who cares" under each:
- Reception cares because...
- Owner cares because...
- Manager cares because...

### Packages

This is one of the stronger pages.

Improve:
- Add a simple "Which package is right for me?" interactive-style decision block.
- Add "most common fit" examples:
  - 6-room lodge: Starter
  - 12-20 room lodge with owner oversight: Standard
  - Lodge with bar/kitchen or online growth: Pro
- Make Pro feel premium because of revenue growth and control, not just more features.

### Why Switch

Good emotional premise, but it can be sharper.

Add:
- Before/after table.
- "Symptoms you have outgrown manual admin."
- Migration reassurance: imports, setup, staff training, trial.
- Risk reversal: free month, choose package after seeing workflow.

### Manager App Page

Strong content. Bring it into nav and cross-link from homepage.

Sharper message:
"Visibility without unsafe mobile financial editing."

Add:
- Owner scenarios: away from lodge, night check, staff follow-up, urgent maintenance.
- Screenshots in a tighter product tour.

### Booking Site Page

Strong content. Bring it into nav and cross-link from homepage.

Sharper message:
"Keep more guest revenue by accepting direct booking requests."

Add:
- Simple commission example.
- Guest journey screenshot above the fold.
- "Requests are reviewed by front desk before becoming operational bookings" as a trust/control point.

### Contact

Ensure the contact/trial form asks for:
- Lodge name.
- Number of rooms.
- Has bar/kitchen? yes/no.
- Wants direct online bookings? yes/no.
- Current pain: bookings, payments, stock, reports, staff, online reservations.
- Preferred contact: WhatsApp/phone/email.

## Implementation Plan for Another Model

### Phase 1: Conversion-Critical Homepage Changes

1. Replace hero H1 and lead with outcome-led copy.
2. Remove the H1 typing animation or restrict animation to non-critical proof text.
3. Reduce hero CTAs to primary and secondary.
4. Make WhatsApp less competitive in first viewport.
5. Add proof chips under lead.
6. Make the product screenshot crisp and visible immediately.
7. Add a "What Boroko fixes" section directly after hero.
8. Add a "Desktop + Manager App + Booking Site" section with screenshots.

Acceptance criteria:
- The visitor understands the product outcome within 5 seconds.
- The H1 is fully readable immediately on page load.
- The first viewport has one obvious action.
- Manager App and Booking Site are visible within the first two sections.

### Phase 2: Navigation and Page Discoverability

1. Add Booking Site and Manager App to top nav or under Product.
2. Consider removing Blog from top nav until it has strong content.
3. Add homepage cards linking to booking-site.html and manager-app.html.
4. Add footer links for the same.

Acceptance criteria:
- A visitor can discover the Pro differentiators from the nav.
- The homepage clearly explains the three-product ecosystem.

### Phase 3: Messaging Upgrade Across Pages

1. Rewrite feature headings to be benefit-led.
2. Add before/after blocks to Why Switch.
3. Add package decision guidance.
4. Add migration/trial reassurance.
5. Remove internal/meta wording from public copy.

Acceptance criteria:
- Every major section answers "Why should I care?"
- Package differences are understandable without reading every bullet.

### Phase 4: UI Simplification and Trust Polish

1. Reduce decorative effects: custom cursor, scramble text, glitch hover, particles.
2. Keep scroll reveals subtle.
3. Compact cookie banner.
4. Make mobile hero first viewport less crowded.
5. Use consistent icon style.
6. Ensure screenshots are sharp and not overlaid by low-contrast effects.

Acceptance criteria:
- Site feels trustworthy, not gimmicky.
- Mobile first viewport clearly shows promise and CTA.
- Important UI is not covered by banners/widgets.

### Phase 5: Lead Capture and Trial Flow

1. Decide whether "Start free trial" means "download now" or "request onboarding."
2. If onboarding: change CTA flow to lead form, then offer download.
3. If direct download: rename CTA to "Download free trial app."
4. Add lead fields that help sales qualify package fit.
5. Track CTA source: hero, packages, booking-site page, manager-app page.

Acceptance criteria:
- Users are not surprised by a download modal.
- Sales gets enough context to respond intelligently.
- Analytics can show which value proposition drives leads.

## High-Priority Copy Blocks

Use or adapt these.

Hero:
"Run your lodge without losing bookings, money, or stock."

Lead:
"Boroko Bookings connects front desk, rooms, invoices, POS, inventory, reports, manager mobile oversight, and direct online bookings. It keeps working offline, syncs safely, and gives owners a clear view of the business."

Pain section:
"If bookings live in one book, payments in another, stock in someone's memory, and owner updates in WhatsApp, the lodge is already leaking control."

Direct booking:
"Give guests a branded page to search rooms, see photos, check policies, and send booking requests directly to your lodge. No commission. No middleman. Front desk reviews the request inside Boroko."

Manager app:
"Owners and managers can see occupancy, money, alerts, stock pressure, bookings, and front-desk replies from a phone, without turning mobile into an unsafe financial editing tool."

Offline:
"Internet down should not mean reception stops. Boroko lets teams keep working and syncs changes when the connection returns."

Packages:
- Starter: "Stop manual booking chaos."
- Standard: "Add owner control, reports, staff, expenses, and night audit."
- Pro: "Add direct bookings, manager mobile oversight, POS, inventory, and full commercial control."

## Final Priority Order

1. Fix the hero: static, outcome-led, one clear CTA.
2. Move strongest differentiators higher: offline, direct bookings, Manager app, POS/inventory, reports/audit.
3. Add Booking Site and Manager App to nav/discovery.
4. Reframe features as business outcomes, not module lists.
5. Simplify animations and competing overlays.
6. Clarify trial/download flow.
7. Add stronger trust and migration reassurance.
8. Add social proof when available.

