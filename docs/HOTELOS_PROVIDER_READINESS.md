# HotelOS Provider & Integration Readiness Matrix

As of: 2026-07-14  
Authority: live repository sources only. **Does not claim live merchant or carrier certification.**

Status vocabulary:

| Status | Meaning |
|---|---|
| **Ready (internal)** | Product contract + UI/domain/RPC path present for internal use |
| **Fail-closed stub** | Adapter exists but refuses live external side effects |
| **Config only** | Settings/credentials storage without full runtime path |
| **Partial** | Some runtime path exists with material gaps |
| **Not implemented** | No usable product path |
| **External cert open** | Code path may exist; live provider onboarding/cert not proved |

---

## 1. Payment providers

| Capability | Code surface | Status | Evidence |
|---|---|---|---|
| Provider config CRUD | `src/main/domains/payments.js` `getPaymentProviderConfig` / `savePaymentProviderConfig` | Partial | RPC config model present |
| Provider secrets | `getProviderSecrets` RPC | Config only | Server-side secrets RPC; not exposed to renderer by design |
| Webhook signature verify | `verifyWebhookSignature` | Ready (internal) | Domain + enterprise webhook security tests |
| Record webhook payment | `recordWebhookPayment` | Ready (internal) + **online_only** | Offline reject added; live merchant webhook unproved |
| Confirm payment from webhook | `confirmPaymentFromWebhook` | Ready (internal) + **online_only** | Same |
| Create booking/payment intent | `createBookingIntent` / `createPaymentIntent` | Partial | Public/booking engine path; provider live cert open |
| Abandoned session recovery | `abandonedPaymentRecovery.js` | Partial + **online_only** recover | Recovery marks session only; does not author `payment_status` |
| Live card/mobile-money capture | External gateway adapters | **External cert open** | No certified live merchant proof in PROJECT_STATE |

**Commercial:** `payment_gateway` remains requestable/premium in catalogue; do not claim production gateway readiness without merchant certification evidence.

---

## 2. Email

| Capability | Code surface | Status | Evidence |
|---|---|---|---|
| SMTP / nodemailer transport | `src/main/emailNotifications.js` | Partial / Ready (internal) when configured | Nodemailer + encrypted password storage in userData |
| Booking confirmation / invoice / quotation send | `src/main/index.js` email handlers | Partial | Wired for desktop automation when config present |
| Password reset email | `auth.js` `sendPasswordResetEmail` | Ready (internal) | Requires online Supabase Auth |
| Guest messaging email delivery | `guestMessaging.js` + SMTP | Partial | Channel readiness: email ready when SMTP configured; delivery rows demote unready “sent” to `not_configured`; trigger automation depth unproved |
| Edge `send-booking-confirmation` | Supabase Edge Function (PROJECT_STATE) | Deployed brand-wise | Live delivery SLA unproved here |

---

## 3. SMS

| Capability | Code surface | Status | Evidence |
|---|---|---|---|
| SMS channel option in UI | `GuestMessaging.jsx` CHANNELS includes `sms` | Foundation only | Channel label |
| SMS provider adapter (Twilio etc.) | `guestMessaging.js` readiness | **Not configured / not implemented** | Always `not_configured`; never marks sent without provider |
| Triggered SMS delivery | queue / delivery status | Foundation only | No SMS carrier send proved |

---

## 4. WhatsApp

| Capability | Code surface | Status | Evidence |
|---|---|---|---|
| WhatsApp channel option | `GuestMessaging.jsx` CHANNELS includes `whatsapp` | Foundation only | Channel label |
| Operator manual WhatsApp deep-link | Admin / Ops AI `wa.me` text helpers | Partial (manual) | Copy/open WhatsApp Web style helpers — not Business API |
| WhatsApp Business API provider | — | **Not implemented** | No Meta/WhatsApp Cloud API adapter |

---

## 5. OTA / Channel manager

| Capability | Code surface | Status | Evidence |
|---|---|---|---|
| Channel mappings/config UI + RPCs | `channelManager.js` | Foundation / Partial | Dashboard, mapping CRUD, internal sync queue RPCs |
| Live OTA provider adapter | `channelProviderAdapter.js` | **Fail-closed** for live providers | Live paths always `provider_connected: false`; never fakes OTA success |
| Manual export channel | `ManualExportProvider` | Ready (internal) | Real local export queue/artifacts under cache; **not** OTA delivery |
| Push availability / rates (live) | `pushAvailability` / `pushRates` | Fail-closed | Returns notConnected for non-manual |
| Fetch / acknowledge reservations (live) | `fetchReservations` / `acknowledgeReservation` | Fail-closed | Empty reservations + notConnected |
| Manual review until provider | Migration `20260706100000_channel_sync_manual_review_until_provider.sql` | Ready (internal policy) | Forces manual review path |

**Verdict:** Channel Manager is **not** live-OTA-complete. Manual local export is real work; no Booking.com/Expedia adapter certified.

---

## 6. Hotel domain modules (readiness snapshot)

| Domain module | File | Product path | Offline class (verified) | Completeness note |
|---|---|---|---|---|
| Front desk board | `hotel.js` + `HotelHome.jsx` | Ready (internal) | Cached reads / estimates | Partial — estimates not night-audit authoritative |
| Check-in / out workflow | `checkinWorkflow.js` | Ready (internal) | online_only mutations | Partial — online required for steps |
| Room moves | `roomMoves.js` | Ready (internal) | queueable with idempotency | Partial — operator smoke unproved |
| Folio ledger | `folioLedger.js` | Ready (internal) | **online_only** | Partial — dual legacy `folios.js` risk remains |
| Night audit | `nightAudit.js` | Ready (internal) | **online_only** | Partial — live close smoke unproved |
| Corporate billing | `corporateBilling.js` | Ready (internal) | **online_only** financial | Partial — multi-property debtor depth premium |
| Rate plans / calendar | `ratePlans.js`, `rateCalendar.js` | Partial | Mixed | Basic rates core; yield/revenue foundation |
| Housekeeping CC | `housekeepingCommandCenter.js` | Partial | online_required (no queue) | Assign/inspect RPC |
| Maintenance + OOO | `maintenance.js`, `maintenanceEnterprise.js` | Partial | tickets queueable; OOO online_only | OOO availability guarded |
| Guest CRM | `guestCRM.js` | Partial | Mixed | Premium guest experience depth open |
| Guest messaging | `guestMessaging.js` | Foundation | online_required | No SMS/WhatsApp transport |
| Guest portal | `guestPortal.js` + booking-site | Partial | online_required | Config + session; full self-service incomplete |
| Multi-property | `multiProperty.js` | Partial | online reads/mutations | Switch fails closed; dual-lodge smoke unproved |
| Group operations | `groupOperations.js` | Partial | online | Checkin/checkout/pickup/release RPCs wired (Phase 6–8) |
| Documents | `documentSystem.js` | Partial | publish online_only | Core operational docs; publish not queued |
| Booking engine | `bookingEngine.js` | Partial | intent online paths | Stable idempotency; estimate labels |
| Payments gateway | `payments.js` | Partial | confirm online_only | External cert open |
| Channel manager | `channelManager.js` + adapter | Partial | sync online_only | Fail-closed live + ManualExport local |

---

## 7. Multi-property checks (code-level)

| Check | Result | Evidence |
|---|---|---|
| Domain RPCs pass `p_group_id` / lodge scope | Partial | `multiProperty.js` uses group RPCs |
| Broken generic `rpc` wrapper on list groups | **Risk** | `getAllPropertyGroups` calls `state.supabase.rpc('rpc', { fn: 'get_all_property_groups', ... })` — non-standard and may fail at runtime |
| Cross-property financial isolation | Server-enforced intent | Lodge_id on financial RPCs elsewhere; multi-property shared credit not certified |
| Live second-lodge operator smoke | **Unproved** | PROJECT_STATE explicitly unproved |

---

## 8. What must not be claimed

- Live OTA bidirectional sync
- Certified card gateway production
- Automated SMS/WhatsApp delivery
- Full multi-property consolidated financial truth
- Packaged hotel-day operator smoke

Revisit this matrix when a real provider adapter, merchant cert, or multi-lodge smoke is completed and recorded in `PROJECT_STATE.md`.
