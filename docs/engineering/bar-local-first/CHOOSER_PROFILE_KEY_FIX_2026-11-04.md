# Saved Bar profile-key selection fix

The independent reviewer reproduced `SETUP_RECOVERY_REQUIRED` in the running Restaurant parent while the same protected Bar records decrypted and validated in the saved child profile's own Electron secure-storage context. Parent decryption cannot establish whether a child's record is corrupt. No credential change or database reset is appropriate.

`selectLocalBarWorkspace` now accepts an explicit saved `recovery` entry as a request to open that existing child profile, alongside ready/draft entries. A recovery entry requires an existing saved setup/authority/provisioning record; missing entries still refuse. Selection writes only the parent's workspace choice and grants no session or capabilities. Child startup still decrypts and validates its protected authority in its own secure-storage context. Invalid child authority still throws and cannot fall back to cloud. Keys, credentials and journals are not copied or weakened.

Cloud Login also exposes a separate saved-local-Bar button and identifies that its current sign-in belongs to the selected cloud business. It never forwards entered credentials to a different authority. The normal chooser retains the saved entry without guessing by email or matching draft names.

Verification:

- Distinct authenticated AES profile-key simulations plus existing chooser tests: **15/15 passed**. They cover parent decryption failure, explicit child selection without rewriting protected bytes, valid child mode with no authenticated session, and malformed child refusal. They model the profile-key boundary; they are not Windows safeStorage tests.
- Original Login rendered Chromium test with ready Restaurant, stale draft and saved local Bar: **1/1 passed**, one explicit switch, zero cloud sign-in or new-registration calls.
- Renderer typecheck passed after the Login change.

Actual fixed main process rebuild/relaunch and Rabafi login remain pending, to be coordinated with the user's currently running app. This source change did not restart it or mutate customer records. Customer PDF/screenshot changes remain pending and non-blocking by user direction. No push or hosted change occurred.
