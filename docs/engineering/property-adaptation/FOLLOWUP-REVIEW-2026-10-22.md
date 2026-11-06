# LodgingOS correction — independent follow-up review

Date: 2026-10-22 (Africa/Gaborone). Verdict: **CHANGES REQUIRED**.

## Previously reported corrections

Source inspection confirms the lead child now accepts the original bare operation key, later children require the room-suffixed key, and the customer check uses `guest_email`. Staff grouping keeps anon-key custom-session transport while retaining its in-body authorization. The transition runner now inspects the actual classification trigger, supplies current expectations, preserves timestamp text, exercises different source types, and uses savepoints. Public SQL helpers clear/restore session and request context; transition fixtures use UUIDs and completed setup. Populated-group preservation and a required quotation entrypoint are present.

These corrections do not establish live SQL acceptance. This follow-up found two remaining implementation areas with concrete local reproductions.

## F1 — P1: the driver can bypass both endpoint pinning and mandatory TLS

Location: `tests/helpers/luna-disposable-database.mjs:46` (URL validation) and `:68` (Client construction).

The helper validates `new URL(connectionString).hostname` and URL username, then passes the original raw connection string to `new Client({ connectionString, ssl: { rejectUnauthorized: true } })`.

The installed `pg` implementation reparses that string and merges its parsed values over the explicit configuration. Its installed `pg-connection-string` parser accepts query-string `host`, `user`, `port`, and SSL overrides. Thus the validated URL authority and explicit SSL object are not necessarily the effective settings used for the connection.

An independent local probe invoked the real target validator and constructed the actual installed `pg.Client` without calling `connect()`. Using dummy credentials and the approved project's URL authority, it observed:

| URL query | Target validator | Effective pg configuration |
|---|---|---|
| none | Accepted | Approved direct host; `rejectUnauthorized: true` |
| `sslmode=disable` | Accepted | `ssl: false` |
| `sslmode=no-verify` | Accepted | `rejectUnauthorized: false` |
| `host=127.0.0.1&sslmode=disable` | Accepted | Host is `127.0.0.1`, SSL disabled |
| `user=another-project` | Accepted | Effective user is `another-project` |

No network connections were opened. Checking a database marker after connecting cannot enforce which host receives the initial connection/credentials, and does not restore TLS verification.

Correction: validate the effective driver configuration, or reject conflicting connection query options and construct the client from explicitly validated host/user/password/database/port fields rather than an overriding raw connection string. Ensure required certificate and hostname validation cannot be disabled by URL options. Preserve legitimate trusted CA configuration if needed. Test the actual resulting `pg.Client.connectionParameters`, not merely that the helper source contains `rejectUnauthorized: true`.

Evidence: `evidence/independent-2026-10-22/connection-config-probe.mjs` and `.json`.

## F2 — P1: the required transition verifier still crashes before finishing

Location: `scripts/verify-property-transitions-disposable.mjs:304`.

The domain-layer check imports its helper with:

```js
await import(pathToFileURL(new URL('../tests/helpers/domain-test-setup.mjs', import.meta.url)).href)
```

`pathToFileURL` requires a filesystem path string. The supplied value is already a URL object. An independent reproduction using the installed Node runtime threw `TypeError`, code `ERR_INVALID_ARG_TYPE`. The referenced helper file exists; the conversion itself fails. With valid database access the required acceptance therefore still aborts before completing the domain and later transition checks.

Correction: import the existing URL directly, for example `import(new URL('../tests/helpers/domain-test-setup.mjs', import.meta.url).href)`, and remove the unnecessary conversion/import. Add a database-independent behavioral test that actually resolves and imports the helper through the runner's selected path. Then execute the complete required runner on the verified disposable target.

Evidence: `evidence/independent-2026-10-22/transition-runner-import-probe.mjs` and `.json`.

## Fresh independent verification

- Re-ran the submitted focused Node command: **39 tests, 38 passed, one genuine live quotation SQL skip**.
- Re-ran `npm run test:property-transition-db`: **exit 2**, missing explicit database configuration.
- Re-ran `npm run test:public-booking-db`: **exit 2**, missing explicit database configuration.
- Re-ran `npm run test:campsite-quotation-db`: **exit 2**, blocked required database configuration, not a passing skipped acceptance.
- The real-driver configuration probe reproduced F1 without network access; the Node URL-conversion probe reproduced F2 without database access.

The focused suite's TLS test currently checks source text only, so its passing result does not contradict the effective driver configurations above. Existing configuration rejection tests likewise do not exercise URL query overrides.

No new live SQL acceptance, migration application, database mutation, production deployment, or Electron walkthrough was performed in this follow-up. Builds/typechecks from the prior independent review were not repeated: this follow-up concerns SQL acceptance/tooling changes rather than application renderer implementation.

No application implementation was edited. Only review artifacts and the engineering state note were written. Bar manual impact: no manual update required for this review.
