# Manager PWA UI/UX Final Implementation Plan

> **Status: historical design plan from 2026-06-20.** Some navigation, inbox, notification, freshness, dashboard, guest, reporting, and API work has since moved into the repository, while other ideas may be stale. Use this as design intent only; inspect [../PROJECT_STATE.md](../PROJECT_STATE.md), current `manager-pwa/` code, and current diffs before doing more work.

## Purpose

This plan consolidates:

- the current Boroko Manager PWA code and visual audit;
- four external reviews from DeepSeek, North Mini Code, Mimo 2.5, and Nemotron 3 Ultra;
- Boroko's existing financial, offline, read-receipt, notification, and navigation contracts.

The objective is to make the PWA faster to understand under operational pressure and make Inbox feel as simple as Messenger, without weakening financial integrity or removing useful manager access.

## Final Product Decisions

### Keep

- The six bottom navigation destinations:
  - Home
  - Bookings
  - Rooms
  - Money
  - Inbox
  - Menu
- The manager PWA as predominantly read-only and request-oriented.
- Existing Supabase RPCs for support messages and server-authoritative read receipts.
- Existing offline operation queue and exact support RPC replay.
- Existing routes and deep links.
- Light and dark modes.
- Data freshness, offline, loading, and error visibility.
- Server-authoritative POS and financial reporting.

### Change

- Make Home begin with urgent work, not six equally weighted KPIs.
- Make Inbox chats-only.
- Rename and visually separate operational Notifications from Inbox.
- Replace Inbox's squeezed split panel with conversation list and full-screen thread views.
- Make Money and Alerts substantially more compact.
- Use one consistent label: `Menu`.
- Refresh visible operational screens more consistently and honestly describe freshness.

### Do Not Implement in This Batch

- Do not reduce the bottom navigation to four tabs. Bookings and Rooms are core manager destinations.
- Do not mix lodge alerts into the chat conversation list.
- Do not delete or locally hide support threads through swipe gestures.
- Do not add typing indicators until both PWA and desktop implement the same presence contract.
- Do not claim `delivered` unless the backend records delivery.
- Do not add message forwarding, reactions, calls, attachments, or long-press menus.
- Do not add a global cross-table search in the first implementation batch.
- Do not add charts, guest lifetime value, or new reporting calculations in this task.
- Do not batch-send all alert follow-ups. That could create noisy or duplicate front-desk tickets.
- Do not add financial calculations, mutations, fields, or RPC changes for visual convenience.
- Do not add a Supabase Realtime migration without first verifying the linked project's publication and RLS configuration.
- Do not deploy, commit, push, or modify unrelated files unless separately requested.

## Required Implementation Order

Complete and verify each phase before beginning the next.

---

## Phase 1 — Inbox and Notifications Separation

### 1.1 Create one shared Inbox data source

Create a small Inbox provider or hook used by both the shell and `Control.jsx`.

It must:

- load `getSupportRequests(lodgeId, 50)`;
- retain only `Front Desk Request` conversations;
- sort by the latest real message timestamp;
- expose:
  - `conversations`;
  - `loading`;
  - `error`;
  - `unreadCount`, calculated from `manager_has_unread`;
  - `refresh`;
  - a way to update a conversation after sending or marking it read;
- refresh when:
  - the app becomes visible;
  - the browser comes online;
  - the offline queue changes;
  - a supported realtime event arrives;
- keep polling as a fallback.

Do not use the local notification store as the authoritative chat unread count. Chat unread state is server-authoritative.

### 1.2 Make Inbox chats-only

Refactor `manager-pwa/src/pages/Control.jsx`.

Mobile and the normal narrow PWA shell must show one screen at a time:

#### Conversation list

- Header: `Inbox`.
- Search field.
- `New chat` icon/button.
- Conversation rows containing:
  - circular avatar/initials;
  - conversation topic;
  - latest sender and message preview;
  - relative or compact timestamp;
  - unread dot or small unread badge;
  - visually stronger title/preview when unread.
- Search locally across:
  - title;
  - message body;
  - sender name.
- Empty state with one clear `Start a chat` action.

Do not render the selected thread beside or below the list.

#### Thread view

- Full PWA width.
- Back button returning to the conversation list.
- Compact topic title and status.
- Scrollable message history.
- Manager messages aligned right.
- Front-desk messages aligned left.
- Sticky, keyboard-safe reply composer at the bottom.
- Auto-growing composer with a maximum of three lines.
- Send icon inside the composer.
- Placeholder: `Reply to front desk...`.
- Automatically scroll to the newest message when opening a thread or receiving a new message, unless the user is deliberately reading older messages.

#### New chat

- Open a lightweight compose view, not a technical form.
- The manager writes the first message and sends it.
- Continue silently deriving the support-ticket title from the first meaningful line.
- Remove explanatory copy such as “The inbox title is created from your first line.”
- Preserve `createSupportTicket(...)` and its existing queued/offline behavior.

### 1.3 Message state rules

Use only states supported by real evidence:

- `Waiting for connection` for a queued offline support message.
- `Sent` once the RPC has persisted the message.
- `Read` when `front_desk_read_message_id` covers that manager message.

Do not display `Delivered`.

Read determination must use message order, IDs, and the existing server receipt. An older manager message is read when the front-desk cursor points to that message or a later manager message in the same thread.

Opening a thread with a new desk message must continue calling:

```js
markSupportRequestRead(lodgeId, ticketId, 'manager', latestDeskMessageId)
```

Server read cursors must remain monotonic and authoritative.

### 1.4 Preserve offline messaging

Do not change the support operation contract:

- new thread: `support/create`;
- reply: `support/message`;
- replay through the same Supabase RPC;
- no raw insert into `support_tickets` or `support_ticket_messages`.

When a reply is queued, show it in the active thread as a pending local bubble when practical. Derive pending replies from the existing device queue so they survive component remounts. Do not pretend an offline-created new conversation has a server thread ID before synchronization.

### 1.5 Separate Notifications from Inbox

Refactor the visual notification UI in `App.jsx`:

- remove the floating bell positioned above the bottom navigation;
- remove every notification surface titled `Inbox`;
- add a compact bell to the global app header;
- the bell opens a sheet titled `Notifications`;
- the sheet contains operational notifications, not chat threads;
- front-desk replies must be opened through Inbox and counted by Inbox's server unread count;
- a front-desk reply may still trigger a toast and push notification, but it must not create a second place where the conversation is read;
- the Inbox bottom-nav badge shows unread chat conversations/messages;
- the Notifications bell badge shows unread non-chat notifications.

Retain:

- push notifications;
- deduplication and seen-version protections;
- swipe-to-clear for non-chat notifications, if it remains stable;
- links from operational notifications to the relevant screen.

### 1.6 Realtime is conditional

Before adding `supabase.channel()`:

1. Inspect migration history and the linked Supabase project.
2. Confirm `support_ticket_messages` and any required read-receipt table are in the Realtime publication.
3. Confirm authenticated PWA sessions can receive only their lodge's rows.
4. Confirm the subscription works after reconnecting.

If confirmed:

- subscribe by lodge;
- refresh the affected conversation rather than duplicating message-normalization logic;
- subscribe to receipt changes if needed for `Read`;
- keep polling as fallback.

If not confirmed:

- do not add a guessed migration in this UI task;
- use visible-page polling of approximately 30 seconds plus visibility, online, and queue events;
- report the missing Realtime configuration separately.

Typing indicators are explicitly deferred.

### Phase 1 Acceptance Criteria

- There is only one user-facing surface called Inbox.
- Inbox contains chats, not operational alerts.
- Notifications are clearly labelled Notifications.
- At 320px and 390px widths, list and thread are never shown simultaneously.
- A thread opens in one tap and returns with a clear back button.
- The reply composer remains visible and is no taller than three lines.
- Unread state survives reload and uses server `manager_has_unread`.
- Read state uses `front_desk_read_message_id`; it is not guessed.
- Offline replies still replay through `add_lodge_support_ticket_message`.
- Existing stale-notification deduplication remains intact.

---

## Phase 2 — Glanceable Home

Refactor `manager-pwa/src/pages/Dashboard.jsx`.

### 2.1 Order

The content order must be:

1. compact page header and freshness;
2. `Needs attention`;
3. compact operational summary;
4. quick links;
5. optional collapsed activity section;
6. mobile boundary notice.

### 2.2 Needs attention

- Rename to `Needs attention` or `Needs you now`.
- Show no more than three items initially.
- Sort by operational severity:
  1. overdue checkout;
  2. urgent maintenance;
  3. pending online booking;
  4. outstanding guest balance;
  5. low stock;
  6. front-desk reply.
- Keep `See all`.
- When clear, show a compact positive state, not a large empty card.

### 2.3 KPI summary

Replace six large equal-weight cards with four compact metrics.

Use existing server-authoritative values only. Recommended metrics:

- Occupancy;
- Arrivals today;
- Departures today;
- Outstanding balance or another existing server-provided money value.

Do not introduce a client-computed “collected today” number. Use it only if an existing authoritative RPC already returns it.

Online booking requests and alert count belong in `Needs attention`, not as equal-weight summary cards.

### 2.4 Remove duplicate messaging

Remove the full `Message front desk` textarea/card from Home. Inbox is the messaging destination.

A compact Inbox quick link with unread count is sufficient.

### 2.5 Activity

- Collapse `Today timeline` by default or remove it when it contains no meaningful activity.
- Do not allow it to displace urgent work from the first viewport.

### 2.6 Refresh

- Refresh Home when the app returns to the foreground.
- Add a modest visible-page fallback interval.
- Manual refresh must force a fresh read rather than returning a still-valid one-minute cache entry.
- Preserve cache fallback for offline operation.

### Phase 2 Acceptance Criteria

- On a 390×844 viewport, at least the first urgent items and compact KPI summary are discoverable without a long scroll.
- `Needs attention` appears in source and visual order before KPI cards.
- Home no longer contains a message textarea.
- Financial values still come from existing authoritative reads.
- Loading, offline cache, and error states remain visible.

---

## Phase 3 — Compact Alerts and Money

### 3.1 Alerts

Refactor `manager-pwa/src/pages/Alerts.jsx`.

- Keep filter chips and counts.
- Replace large repeated alert cards with compact rows.
- Each row shows:
  - severity icon;
  - title;
  - concise subtitle;
  - status/severity badge;
  - small `Ask front desk` action icon.
- The action must have an accessible label and clear feedback.
- Do not hide all urgent details behind collapsed category headers.
- Sort visible `All` results by severity and time.
- Keep current request templates and support RPC behavior.
- Do not add `Send all follow-ups`.

Goal: show several actionable alerts in one phone viewport without button fatigue.

### 3.2 Money

Refactor `manager-pwa/src/pages/Money.jsx`.

Order:

1. compact header and freshness;
2. four server-authoritative shift metrics in a 2×2 grid:
   - gross collected;
   - refunds today;
   - expenses today;
   - outstanding;
3. top outstanding balances, maximum three rows;
4. compact links to:
   - Invoices;
   - Expenses;
   - Quotations;
   - Night Audit;
5. mobile boundary notice.

Remove from the main vertical page:

- full recent refund list;
- full expense-category list;
- duplicate open-invoice list;
- permanent front-desk request textarea and three full-width request buttons.

Keep those details available through their dedicated pages or existing sheets.

For top balances:

- use server-provided `balance_due`;
- provide a small contextual follow-up action;
- open a small note/confirmation sheet only after the manager chooses follow-up;
- send through the existing front-desk request flow.

Do not recalculate payment status or financial truth in the frontend.

### Phase 3 Acceptance Criteria

- Alerts shows at least three normal rows in a typical phone viewport.
- Repeated full-width follow-up buttons are gone.
- Money's first viewport contains the four main financial metrics.
- Money no longer duplicates full invoice, refund, expense, and request sections.
- Dedicated finance pages and deep links continue to work.

---

## Phase 4 — Shell, Menu, and Freshness Consistency

### 4.1 Compact app header

Reduce the global header height.

It should contain:

- compact Boroko identity;
- lodge name or manager context;
- Notifications bell.

Move:

- theme control;
- sign out;

into Menu or a small Preferences section. Do not repeat a large `Manager Mobile App` title above every page.

### 4.2 Menu

Keep the bottom label and page title as `Menu`.

Group entries:

#### Operations

- Alerts
- POS Sales
- Conference
- Day Use
- Inventory

#### Finance and reporting

- Reports
- Quotations
- Invoices
- Expenses
- Financial Audit

#### People and property

- Guests
- Staff
- Rooms & Maintenance

#### Preferences

- Appearance
- Sign out

Continue capability and feature gating. Do not remove routes.

### 4.3 Data freshness language

Update `DataFreshness` so it does not call cached or manually refreshed data `Live`.

Suggested states:

- `Updating…`
- `Live` only while a verified realtime subscription is healthy;
- `Updated <time>`;
- `Offline • cached <time>`;
- `Update failed • showing <time>`.

### 4.4 Shared refresh behavior

Create a small reusable hook only if it reduces duplication.

Primary screens should refresh:

- on first open;
- on returning to the foreground;
- after reconnecting;
- after relevant queued work is flushed;
- on a modest visible-page interval appropriate to the data.

Do not create aggressive polling across every page.

Custom pull-to-refresh is optional and must not interfere with normal scrolling or native browser refresh. It is not required for completion.

### Phase 4 Acceptance Criteria

- Header consumes materially less vertical space.
- Theme and sign-out remain discoverable in Menu.
- `Menu`, `More`, and `More tools` are no longer mixed as page names.
- No screen claims cached data is live.
- Existing six-tab 320px navigation regression remains satisfied.

---

## Deferred Follow-Up Work

Only consider after Phases 1–4 are stable:

- global guest/booking/invoice/room search;
- Realtime presence and typing indicators across both desktop and PWA;
- custom pull-to-refresh;
- thread archive semantics backed by the database.

---

## Verification Findings — Mandatory Corrections Before New Features

The first implementation pass builds and passes the existing regression tests, but verification found plan-contract gaps that must be corrected before the redesign is accepted.

### C1. Place the Inbox provider above every Inbox consumer

Current issue:

- `AuthenticatedShell` calls `useInbox()` before rendering its own `<InboxProvider>`.
- The shell therefore reads the context default and the bottom navigation Inbox badge remains `0`.

Required correction:

- Mount `<InboxProvider>` above `AuthenticatedShell`, after authentication and where the authenticated user is available.
- `AuthenticatedShell`, `Dashboard`, `Control`, and `BottomNav` must consume the same provider instance.
- Add a focused test proving a conversation with `manager_has_unread: true` produces a non-zero Inbox badge.

### C2. Do not swallow Inbox load failures

Current issue:

- `InboxContext` calls `getSupportRequests(...).catch(() => [])`.
- This converts a real server/read failure into a successful empty Inbox, so the provider's `error` path never runs.

Required correction:

- Let `getSupportRequests` throw.
- Preserve the previous conversation list when refreshing fails.
- Expose the error to Inbox without presenting a false `No chats yet` state.
- Add a regression test for failed refresh with existing cached/in-memory conversations.

### C3. Fix server read-receipt rendering

Current issue:

- `Control.jsx` compares message UUID strings using `localeCompare`.
- UUID lexical order does not prove message chronology.
- It also reads `manager_read_message_id` for manager-sent bubbles, but the opposite side's cursor is `front_desk_read_message_id`.

Required correction:

- For manager-sent messages, use `front_desk_read_message_id`.
- Find that message's index in the normalized chronological thread.
- A manager message is `Read` only when its chronological index is less than or equal to the front-desk read cursor's index.
- If the cursor is absent or not found, show `Sent`.
- Never infer order from UUID value.
- Add tests covering:
  - cursor exactly on the message;
  - cursor on a later manager message;
  - cursor before the message;
  - cursor missing;
  - non-sequential UUIDs.

### C4. Fully separate front-desk chats from Notifications

Current issue:

- `NotificationCenter` still calls `upsertFrontDeskNotification`.
- `listPwaNotifications()` is displayed without excluding `frontDeskRequest`.
- Opening a front-desk notification still displays a duplicate request-thread detail and marks chat read outside Inbox.

Required correction:

- Keep front-desk reply toast and push alert behavior.
- Do not persist or display front-desk replies as operational Notification cards.
- Filter or remove existing `frontDeskRequest` local notification entries during migration.
- Tapping a front-desk toast/push must navigate to `/control` and, where possible, the specific thread.
- Only Inbox opens and acknowledges the conversation.
- Notifications badge and sheet must count/display non-chat notifications only.
- Add regression coverage proving the same desk reply cannot appear in both Inbox and Notifications.

### C5. Render real queued support messages

Current issue:

- `ChatBubble` supports `message.metadata.queued`, but no queued operations are converted into visible pending bubbles.
- After an offline reply, the manager receives only a toast; the thread does not show `Waiting for connection`.

Required correction:

- Derive pending `support/message` operations from the existing lodge-scoped offline queue.
- Merge them into the matching active thread without duplicating a message after successful synchronization.
- Preserve queue operation IDs as stable pending bubble keys.
- For offline `support/create`, show an explicit pending-new-conversation state without inventing a server ticket ID.
- Add tests for remount persistence, successful flush replacement, and failed flush retention.

### C6. Force genuinely fresh manual and foreground reads

Current issue:

- Dashboard refresh continues calling cache-enabled APIs without a `forceFresh` path.
- A manual refresh can return a valid one-minute cache entry instead of contacting the server.

Required correction:

- Add an optional `forceFresh` argument to the relevant read API where safe.
- Manual refresh, foreground refresh, and reconnect refresh must use it.
- Normal short-interval renders may continue using bounded cache behavior.
- Preserve offline cache fallback and honest freshness labels.

### C7. Correct refresh listeners and cleanup

Current issue:

- Money registers `window.addEventListener('online', () => load(true))` without retaining and removing the same function.
- Dashboard refresh effects use unstable `load` closures and omit dependencies.

Required correction:

- Use stable `useCallback` refresh functions.
- Register named/stable handlers and remove those exact handlers.
- Avoid duplicate polling between Inbox provider and Inbox page.
- New code should introduce no avoidable hook-dependency warnings.

### C8. Finish the requested focused verification

Current issue:

- Existing static tests pass, but no new focused UX regression file or authenticated mocked browser coverage was added.
- The required 320×568 and 390×844 list/thread visual checks are not evidenced.

Required correction:

- Add focused regression tests for the changed contracts.
- Add mocked authenticated PWA browser tests for:
  - conversation list;
  - thread and back navigation;
  - unread badge;
  - Notifications separation;
  - queued reply;
  - light and dark mode;
  - 320×568 and 390×844 viewports.
- Record results in the final implementation report.

The redesign must not be marked complete until C1–C8 are fixed and verified.

---

## Next Fixes Plan — Reports, Guest Intelligence, and Notification Feedback

Begin this work only after C1–C8 pass. These are now approved follow-up features, not part of the incomplete correction pass.

### Phase 5 — Visual Reports

#### Objective

Make Reports faster to interpret without turning the PWA into a dense analytics dashboard.

#### Required charts

Add a compact `Visual summary` near the top of `Reports.jsx` containing:

1. occupancy trend for the existing server-provided reporting period;
2. collections/revenue trend using authoritative payment data already returned by the reporting RPC;
3. revenue mix or operating mix using existing server-provided categories;
4. optional expense trend only when the current RPC provides reliable period data.

#### Rules

- Prefer lightweight SVG/CSS charts or an already-installed chart dependency.
- Do not add a large chart library without demonstrating the bundle impact and need.
- Charts must be derived only from server-authoritative reporting values.
- Do not reconstruct financial truth from bookings in the browser.
- Do not silently interpolate missing dates or treat missing data as zero unless the RPC contract explicitly defines that behavior.
- Every chart must include:
  - an accessible title;
  - text summary;
  - labelled values or accessible descriptions;
  - clear empty/offline/error state;
  - dark and light mode support.
- Keep the existing numeric summary visible; charts supplement numbers rather than replace them.
- Avoid misleading axes, truncated scales, decorative 3D charts, or excessive animation.

#### Backend verification

Before editing UI:

- inspect `get_reports_snapshot`;
- identify exactly which time-series arrays and category breakdowns are server-produced;
- verify the linked live RPC shape;
- if required chart data does not exist, design one read-only manager reporting RPC or extend the existing read-only RPC in a migration;
- any new calculation must be database-side and regression-tested.

#### Acceptance criteria

- A manager can identify occupancy direction and money direction in a few seconds.
- Chart and displayed totals reconcile with the same RPC response.
- No financial mutation path is introduced.
- Reports remains usable at 320px.

### Phase 6 — Guest Lifetime Intelligence

#### Objective

Make Guests useful for repeat-guest recognition and manager decision support.

#### Guest summary fields

For each guest, provide server-authoritative:

- total number of non-cancelled stays;
- completed-stay count;
- last stay date;
- next stay date, when applicable;
- total accommodation value;
- total payments received;
- current outstanding balance;
- average completed-stay value;
- optional POS/charge total only when reliably linked to the guest or booking;
- first stay date;
- basic status such as New, Returning, Frequent, or Outstanding Balance.

#### Financial definitions

- `total payments received` must come from payment ledger truth, not `amount_paid` summed from booking rows.
- `outstanding balance` must use the same authoritative invoice/booking financial model used elsewhere.
- Cancelled bookings must not inflate stay counts or guest value.
- Refunds and retained fees must follow existing reporting definitions.
- Unlinked POS sales must not be attributed to a guest.
- Clearly distinguish:
  - booking/accommodation value;
  - cash actually received;
  - outstanding balance.

#### Technical approach

- Do not fetch every guest and then issue one query per guest.
- Create or reuse a paginated/read-only guest-summary RPC.
- Keep guest detail/history drill-down separate from the compact list.
- Search and filters should operate server-side when the guest list is large.
- Preserve RLS/lodge isolation and manager read-only capability checks.

#### UI

Guest list rows should show:

- guest name and contact identifier;
- `Returning`/`Frequent` badge where applicable;
- stays count;
- last stay;
- outstanding warning when present.

Guest detail should show compact cards for:

- stays;
- accommodation value;
- payments received;
- outstanding;

followed by chronological booking history.

#### Acceptance criteria

- Guest totals reconcile with ledger/reporting data for sampled guests.
- No N+1 query pattern.
- No frontend-derived payment status.
- Cancelled/refunded stays are represented correctly.
- Large values and empty histories render cleanly on mobile.

### Phase 7 — Notification Sound and Vibration Preferences

#### Objective

Provide noticeable but controlled feedback for genuinely new urgent alerts and Inbox replies.

#### Preferences

Add settings under Menu → Preferences:

- `Notification sound` on/off;
- `Vibration` on/off;
- optional `Urgent alerts only` mode;
- optional `Front desk replies` toggle if it does not duplicate the existing notification-category setting.

Defaults must be conservative:

- do not play sound until browser notification permission and/or a user interaction allows it;
- vibration defaults off unless the installed PWA/platform convention and explicit user choice support it.

Store device-level presentation preferences locally. Do not treat them as business data.

#### Trigger rules

Sound/vibration may occur only for:

- a genuinely new unread front-desk message version;
- a genuinely new urgent operational alert;
- optionally an important push notification opened while the app is foregrounded.

Do not trigger for:

- initial historical data load;
- refreshes that return the same version;
- read items;
- status-only row updates without a new relevant event;
- messages sent by the current manager;
- every polling cycle.

Reuse the existing notification versioning and deduplication safeguards.

#### Sound

- Use one short, subtle local sound asset.
- Do not fetch sound from a third party.
- Respect autoplay restrictions.
- Catch playback failures silently and preserve visual notification behavior.
- Add an in-settings `Test sound` control that requires direct user interaction.

#### Vibration

- Use `navigator.vibrate` only when supported and enabled.
- Use short patterns, for example:
  - normal reply: one brief pulse;
  - urgent alert: two brief pulses.
- Do not repeatedly vibrate for the same notification version.
- Respect reduced-motion/accessibility expectations and platform limitations.

#### Push/service worker behavior

- Verify what vibration/sound options are supported by the current browser and service worker notification implementation.
- Keep foreground and background deduplication aligned.
- Do not produce both a foreground toast sound and duplicate service-worker sound for the same event.

#### Acceptance criteria

- No sound or vibration occurs on initial historical load.
- Each new event version triggers at most once per device.
- Disabling either preference takes effect immediately.
- Unsupported platforms degrade silently.
- Inbox stale-notification regression remains fixed.
- Settings survive reload on that device.

## Files Expected to Change

Likely:

- `manager-pwa/src/App.jsx`
- `manager-pwa/src/components/BottomNav.jsx`
- `manager-pwa/src/components/DataFreshness.jsx`
- `manager-pwa/src/pages/Control.jsx`
- `manager-pwa/src/pages/Dashboard.jsx`
- `manager-pwa/src/pages/Alerts.jsx`
- `manager-pwa/src/pages/Money.jsx`
- `manager-pwa/src/pages/More.jsx`
- `manager-pwa/src/index.css`
- `manager-pwa/src/lib/api.js`
- one new Inbox context/hook/component folder if justified
- focused regression tests under `tests/`
- focused PWA browser tests under `Playwright tests/pwa/`

Possibly, only after live verification:

- no schema change is expected;
- a Realtime migration must not be created speculatively.

Do not touch the currently unrelated legacy POS worktree changes.

## Verification Requirements

Run after each phase:

```powershell
npm run manager:lint
npm run manager:build
node --test tests/inbox-read-receipts-regression.test.mjs
node --test tests/pwa-burger-menu-regression.test.mjs
node --test tests/pwa-pos-reporting-regression.test.mjs
npm test
```

Add focused regression coverage for:

- Inbox and Notifications naming separation;
- server-authoritative Inbox unread count;
- conversation list → thread → back flow;
- read receipt rendering from the front-desk cursor;
- queued message rendering;
- Dashboard section order;
- absence of Dashboard message composer;
- compact Alerts actions;
- Money section order and removed duplication;
- Menu grouping and label consistency.

Add authenticated mocked PWA browser coverage using controlled fixtures rather than production writes.

Test viewports:

- 320×568;
- 390×844;
- a wider desktop browser.

Visually verify:

- light and dark mode;
- long conversation titles;
- long messages;
- zero, one, and many chats;
- unread and read chats;
- online and offline queued replies;
- empty and busy lodge dashboards;
- 10+ alerts;
- large Botswana pula values;
- bottom navigation safe-area spacing;
- keyboard/composer visibility on mobile.

## Definition of Done

The task is complete only when:

- Inbox behaves as a simple list-to-thread messenger;
- Notifications are separate and correctly named;
- server read and unread state remains correct across devices;
- Home puts urgent work first;
- Alerts and Money are materially shorter and easier to scan;
- the six-tab navigation remains intact;
- all financial and support writes still use their existing RPC contracts;
- offline replay still uses the exact original operations;
- all required builds and focused tests pass;
- unrelated legacy POS files remain untouched;
- the final report lists every changed file, test result, and any deferred Realtime limitation.

---

# Strict Copy-Paste Prompt for the Implementing AI

You are implementing a focused Manager PWA UI/UX redesign in:

`C:\Users\26772\Desktop\Boroko Bookings`

Read these files completely before editing:

1. `AGENTS.md`
2. `docs/MANAGER_PWA_UX_IMPLEMENTATION_PLAN.md`
3. `manager-pwa/src/App.jsx`
4. `manager-pwa/src/pages/Control.jsx`
5. `manager-pwa/src/pages/Dashboard.jsx`
6. `manager-pwa/src/pages/Alerts.jsx`
7. `manager-pwa/src/pages/Money.jsx`
8. `manager-pwa/src/pages/More.jsx`
9. `manager-pwa/src/components/BottomNav.jsx`
10. `manager-pwa/src/components/DataFreshness.jsx`
11. `manager-pwa/src/lib/api.js`
12. `manager-pwa/src/lib/runtime.js`
13. `manager-pwa/src/lib/frontDeskNotifications.js`
14. `shared/supportThreads.js`
15. `supabase/migrations/20260605094757_support_ticket_message_threads.sql`
16. `supabase/migrations/20260618205000_support_inbox_server_read_receipts.sql`
17. `tests/inbox-read-receipts-regression.test.mjs`
18. `tests/pwa-burger-menu-regression.test.mjs`
19. `tests/pwa-pos-reporting-regression.test.mjs`

The worktree already contains unrelated legacy POS changes. Preserve them exactly. Do not edit, revert, stage, format, or include those files.

Implement the plan in four phases and verify each phase before continuing:

1. Inbox and Notifications separation.
2. Glanceable Home.
3. Compact Alerts and Money.
4. Compact shell, grouped Menu, and honest freshness states.

Non-negotiable constraints:

- Keep the six bottom navigation destinations: Home, Bookings, Rooms, Money, Inbox, Menu.
- Keep all current routes and deep links.
- Inbox must contain chats only.
- Operational alerts must be labelled Notifications, never Inbox.
- Remove the floating notification bell; place a compact Notifications bell in the app header.
- On narrow screens, Inbox must show either the conversation list or the thread, never both.
- Use existing support RPCs. Do not insert directly into support tables.
- Preserve `support/create` and `support/message` offline queue operations.
- Use `manager_has_unread` and server read receipts as authoritative.
- Show only `Waiting for connection`, `Sent`, and genuinely proven `Read` message states.
- Do not show `Delivered`.
- Do not implement typing indicators.
- Do not implement swipe-to-delete/archive for chats.
- Do not merge operational alerts into the chat list.
- Do not reduce navigation to four tabs.
- Do not add global search, charts, guest analytics, attachments, reactions, forwarding, or unrelated polish.
- Do not add or alter financial logic.
- Do not calculate `payment_status` in the frontend.
- Do not update `amount_paid`.
- Do not add a Supabase migration merely to make Realtime work.
- Verify linked Realtime publication and RLS before using it. If unavailable, use visibility/online events plus approximately 30-second visible polling and report the limitation.
- Do not deploy, commit, push, or publish.
- Do not mass-format the repository.
- Do not change unrelated desktop, booking-site, marketing-site, or legacy POS behavior.

Implementation expectations:

- Prefer small components or a focused Inbox context when they reduce duplication.
- Do not rewrite working APIs for stylistic reasons.
- Preserve light/dark mode and 320px support.
- Preserve push notification and stale-notification deduplication protections.
- The Inbox nav badge must represent server unread chat state.
- The Notifications bell badge must represent non-chat notifications.
- Manual refresh must force a fresh read.
- Cached data must not be labelled `Live`.
- Use accessible labels for icon-only controls.
- Add focused regression tests for every changed contract.

Required verification:

```powershell
npm run manager:lint
npm run manager:build
node --test tests/inbox-read-receipts-regression.test.mjs
node --test tests/pwa-burger-menu-regression.test.mjs
node --test tests/pwa-pos-reporting-regression.test.mjs
npm test
```

Also add and run focused tests for the new UX contracts, and test mocked authenticated PWA flows at 320×568 and 390×844.

Before finishing:

- inspect `git diff`;
- confirm no unrelated legacy POS file changed because of this task;
- confirm no financial or schema logic changed;
- list changed files;
- report every command and whether it passed;
- report any Realtime limitation honestly;
- do not describe the task as complete if mobile list/thread navigation, offline replies, read receipts, light mode, dark mode, and 320px navigation were not verified.
