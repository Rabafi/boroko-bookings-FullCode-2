# Supabase whole-project recovery foundation

Last reviewed: 2026-08-27

The existing [daily database backup](SUPABASE_FREE_BACKUPS.md) protects the
application database with an encrypted archive. It intentionally does not
claim to preserve Supabase Auth, managed Storage schema, deployed Edge
Function state, or project secrets. This document describes the additional,
token-independent bundle foundation for those boundaries.

## What is implemented

Run `scripts/supabase-whole-project-recovery.mjs` to create one encrypted
`.tar.gz.tbbackup` package. It accepts only:

- `SUPABASE_BACKUP_DB_URL`: the protected Postgres connection URL;
- `BACKUP_ENCRYPTION_PUBLIC_KEY_B64`: the existing backup RSA public key; and
- optional non-secret `SUPABASE_PROJECT_REF` / GitHub metadata.

The script invokes the pinned Supabase CLI `2.96.0` and captures the following
files before encrypting them with `scripts/backup-crypto.mjs`:

| File | Purpose |
| --- | --- |
| `roles.sql` | PostgreSQL roles, matching the existing database backup contract. |
| `schema.sql` | Application schema. |
| `auth-schema.sql` | Explicit `auth` schema definition. |
| `auth-data.sql` | Explicit `auth` schema data, including Auth users and related records. Treat as highly sensitive. |
| `auth-storage-schema.sql` | Explicit managed `storage` schema definition. The name identifies this as the Auth/Storage platform-schema capture; it is not a second application-data dump. |
| `data.sql` | Application data and Storage metadata included by the existing CLI data contract. |
| `migration-history.sql` | Explicit `supabase_migrations` data, which the CLI's default data dump excludes. |
| `project-function-inventory.json` | Non-secret repository source/configuration inventory: paths, sizes, SHA-256 values, config key names, and the explicit “remote not queried” status. It never copies config or function values. |
| `metadata.json` | Bundle identity, CLI version, contents, exclusions, and restore order. |
| `SHA256SUMS` | SHA-256 checksums for every other file. |

The archive is written in memory from the temporary dump files and then
encrypted. Temporary plaintext is removed in a `finally` block. The output
directory should be a protected temporary directory in CI or an encrypted
recovery volume locally.

The existing `scripts/verify-supabase-backup.mjs verify` command can verify the
encrypted result. Its manifest check now validates every `SHA256SUMS` entry,
including the Auth, Storage-schema, migration-history, and inventory files;
verification still decrypts only to a temporary location and removes plaintext
by default.

## Supabase CLI 2.96 capability audit

The pinned CLI supports `supabase db dump --schema <name>`, including an
explicit `--schema auth` or `--schema storage` dump. Its default schema dump
excludes managed schemas such as `auth` and `storage`; its default data dump
also excludes `auth` and the `supabase_migrations` history table. The explicit
commands in the script close those known gaps:

```text
supabase@2.96.0 db dump --db-url <protected URL> --schema auth --file auth-schema.sql
supabase@2.96.0 db dump --db-url <protected URL> --schema auth --data-only --use-copy --file auth-data.sql
supabase@2.96.0 db dump --db-url <protected URL> --schema storage --file auth-storage-schema.sql
supabase@2.96.0 db dump --db-url <protected URL> --schema supabase_migrations --data-only --use-copy --file migration-history.sql
```

`supabase functions list`, `supabase functions download`, `supabase config
push`, `supabase secrets list`, and `supabase projects api-keys` are Management
API/configuration operations. They require a separate Supabase access token
or can expose secret-adjacent state, so this foundation does not call them.
The repository inventory is therefore deliberately honest: it records local
function source/configuration and states that remote deployment metadata was
not queried. A future protected inventory job may add sanitized remote
function names, versions, timestamps, and config identifiers, but must never
put an access token or secret value in this archive.

## GitHub Actions integration

The current `.github/workflows/supabase-backup.yml` now includes isolated build,
GitHub artifact, and Cloudflare R2 upload/retention steps for this second
encrypted artifact. The existing database and Storage steps remain separate.
The integration is repository-local only until a controlled run has confirmed
the new artifact and its dedicated R2 prefix:

```yaml
- name: Build encrypted whole-project recovery bundle
  env:
    SUPABASE_BACKUP_DB_URL: ${{ secrets.SUPABASE_BACKUP_DB_URL }}
    BACKUP_ENCRYPTION_PUBLIC_KEY_B64: ${{ secrets.BACKUP_ENCRYPTION_PUBLIC_KEY_B64 }}
    SUPABASE_PROJECT_REF: ${{ vars.SUPABASE_PROJECT_REF }}
    SUPABASE_RECOVERY_OUTPUT_DIR: ${{ runner.temp }}/supabase-whole-project-output
  run: node scripts/supabase-whole-project-recovery.mjs --output "${{ runner.temp }}/supabase-whole-project-output"

- name: Retain encrypted whole-project recovery artifact
  uses: actions/upload-artifact@v4
  with:
    name: supabase-whole-project-${{ github.run_id }}
    path: ${{ runner.temp }}/supabase-whole-project-output/*.tbbackup
    if-no-files-found: error
    retention-days: 7
    compression-level: 0

- name: Upload encrypted whole-project recovery bundle to Cloudflare R2
  env:
    CLOUDFLARE_R2_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_R2_ACCOUNT_ID }}
    CLOUDFLARE_R2_BUCKET: ${{ secrets.CLOUDFLARE_R2_BUCKET }}
    CLOUDFLARE_R2_ACCESS_KEY_ID: ${{ secrets.CLOUDFLARE_R2_ACCESS_KEY_ID }}
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: ${{ secrets.CLOUDFLARE_R2_SECRET_ACCESS_KEY }}
    BACKUP_R2_PREFIX: tsa-bonno/supabase/whole-project/
  run: node scripts/r2-backup.mjs "${{ steps.recovery_bundle.outputs.encrypted_path }}"
```

The build step does not need `SUPABASE_ACCESS_TOKEN`, R2 credentials, a private
key, or a passphrase. The R2 step receives only the existing bucket-scoped R2
credentials and uses `tsa-bonno/supabase/whole-project/`, separate from the
database and Storage prefixes. Do not upload the temporary directory or any
`.sql` file. No live workflow run, R2 upload, or restore is claimed by this
repository change.

## Restore ordering and boundaries

This package is recovery evidence and a disposable-project input, not a live
project replacement. Before a rehearsal, create a new Supabase project and
let its platform-managed Auth and Storage services initialize. Then use the
official Supabase restore procedure and the package's `restore_order` metadata:

1. `roles.sql`, subject to the target project's role restrictions.
2. `auth-schema.sql` and `auth-storage-schema.sql`, only where the target
   procedure permits explicit managed-schema restoration.
3. `schema.sql` for the application schema.
4. `auth-data.sql`, before application data that references `auth.users`.
5. `data.sql` for application rows and Storage metadata.
6. `migration-history.sql` last, as migration-parity evidence. Do not mark a
   migration applied solely because this file exists; first apply and verify
   the repository migrations using the target project's supported workflow.

Managed Supabase schemas and extensions can differ between projects and plan
tiers. If the official restore workflow rejects an Auth/Storage DDL statement,
stop and use the supported project migration path or Supabase support. Never
run these files over the live project, and never call a failed or ambiguous
restore “verified”. Storage object bytes remain a separate Storage backup
contract and are not created by this script.

## Protected recreate/rotate checklist

Supabase does not provide a safe export of secret values through this backup
contract. Record the following in a separately protected password-manager or
key-management workflow, never in Git, GitHub artifacts, the recovery archive,
issues, or chat:

- Recreate or rotate Supabase project API keys and service-role credentials;
  update only server-side consumers and verify RLS boundaries.
- Recreate Edge Function secrets with `supabase secrets set` or the protected
  deployment system. The CLI can manage names but must not be treated as a
  secret-value export mechanism.
- Recreate database credentials and connection URLs for the recovered project.
- Rotate SMTP, OAuth, SMS, payment-provider, webhook-signing, and external API
  credentials; verify callback URLs and provider allow-lists.
- Recreate or rotate JWT signing material only through Supabase's supported
  project controls. Preserve the old material only as long as the provider's
  recovery procedure requires.
- Rotate GitHub Actions and Cloudflare R2 credentials if the recovery process
  or runner may have exposed them. Keep the old encrypted-backup private key
  and passphrase until all archives encrypted with it have expired or been
  deliberately re-encrypted.
- Redeploy repository-held Edge Function source only after reviewing the
  non-secret inventory and required runtime configuration. The two function
  names currently present in source are inventory evidence, not proof of what
  is deployed; missing deployed source must be recovered into version control
  before it is redeployed.
- Complete disposable-project Auth sign-in, password reset, MFA, function,
  Storage object, RLS, and audit smoke tests before considering the recovery
  usable.

The bundle's exclusions are intentional: Storage object bytes, Edge Function
secret values, project API keys, Management API tokens, GitHub/R2/database
credentials, private recovery keys/passphrases, and external-provider secrets
are not exported.
