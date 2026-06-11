## Fixes Applied

### 1. Missing lodge information on booking site
- **LodgePage** now displays a **"Policies & Information"** section that shows:
  - Check-in & Check-out times (`booking_check_in_from` / `booking_check_out_until`)
  - Cancellation Policy
  - Payment Terms
  - House Rules / Guest Notes
- **FaqSection** now uses the lodge's custom FAQ (`booking_faq`) if available, otherwise falls back to generic FAQs

### 2. Image upload size enforcement (performance)
Added minimum dimension validation across the desktop app:
- **Logo** (Settings + Setup): minimum `128x128` px
- **Hero image** (Settings): minimum `800x400` px
- **Room photos** (Rooms): minimum `400x300` px
- **ID photos** (Guests): minimum `200x200` px

If an image is too small, the user sees a clear alert and the upload is rejected.

---

## Next step for you

**Clear browser cache / sessionStorage** on the booking site. Lodge data is cached for 10 minutes, so the old cached response may still be hiding the new fields. The easiest way is to open the booking site in an incognito/private window, or open DevTools → Application → Session Storage → delete the `lodge-shell:*` entries.

If you already filled in these fields in the desktop app Settings, they should appear immediately after the cache is cleared.