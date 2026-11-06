# Legacy company sign-in verification

20 October 2026. Source candidate; no release, customer cutover, hosted migration or live business test.

- `npm test` in `legacy-pos`: existing Legacy regression checks plus the registered company-login tests. Focused coverage exercises the actual login IPC handler, membership enumeration, foreign selection refusal, original-company cache migration, preservation of foreign financial rows, and password-gated offline selection/expiry.
- `npm run build` in `legacy-pos`: actual Electron main/preload/renderer production build, targeting the existing Legacy Node/Chromium contract.
- Strict `tsc --allowJs --checkJs --strict --noEmit` check of the new checked-JavaScript company selection module: passes.
- `npm run test:login-ui` in `legacy-pos`: passes in the actual Electron 22 runtime. It renders the real Login component with fictional membership APIs, asserts neutral branding and online/offline company selection, and verifies the chosen company reaches the login callback. It does not authenticate a live customer account or prove Windows 7 hardware support.
- Screenshots `legacy-login-neutral.png` and `legacy-company-choice.png` were captured and visually checked. Fictional companies only; no customer credentials or records.
- Provider launch command: `npm run legacy:open` from either package. The launcher resolves its own workspace paths, uses Legacy's installed Electron binary and built entry, clears inherited product/dev renderer overrides, and uses the company-login preview profile independently of older windows. Its detached child uses file-backed stdout/stderr so the terminal can close. Stdio-specific guards handle EPIPE/destroyed streams while preserving genuine failures; dedicated tests cover both cases.

See `../MANUAL_IMPACT-company-login.md` for guide applicability and the remaining documentation/release gate. Existing modern Bar PDF approval/package issues are not accepted or repaired by this Legacy change.
