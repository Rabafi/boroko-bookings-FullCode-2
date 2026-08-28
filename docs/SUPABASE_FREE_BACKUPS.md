# Supabase Free-Tier Cloud Backups

Last reviewed: 2026-08-27

This repository contains an opt-in GitHub Actions workflow that creates encrypted logical backups of the linked production Supabase database and every object visible through the project's Supabase Storage S3 endpoint, without using disk space on an operator computer.

The workflow is `.github/workflows/supabase-backup.yml`. It runs at 02:30 Africa/Gaborone each day after it reaches the repository's default branch, and it can also be started manually from GitHub Actions.

## What the workflow protects

Each run creates the three files prescribed by Supabase's CLI backup procedure:

- `roles.sql`
- `schema.sql`
- `data.sql`

It also records a creation manifest and SHA-256 checksums, builds one compressed archive, encrypts that archive with AES-256-GCM, wraps the data key with a 3072-bit RSA public key, and deletes plaintext backup material from the runner.

The encrypted database result is:

- uploaded to the private Cloudflare R2 bucket under the managed `tsa-bonno/supabase/` prefix;
- retained as an encrypted GitHub Actions artifact for seven days as a short fallback;
- retained in R2 as all daily copies for 14 days, then one copy per ISO week through 90 days.

The database R2 retention helper deletes only positively identified managed `.tar.gz.tbbackup` objects. It never deletes the sole successful backup, lookalike objects, or objects outside the managed prefix. Do not add an R2 lifecycle rule that expires these objects: retention is deliberately bounded and auditable in the workflow, while the R2 token remains valid until it is explicitly rotated or revoked.

The Storage tranche dynamically lists every live bucket, follows every `ListObjectsV2` continuation token, HEADs every object, and downloads private as well as public object bytes with server-side S3 credentials. Each changed object is hashed and encrypted independently with the same AES-256-GCM/RSA-OAEP envelope. R2 object keys are deterministic, content-addressed SHA-256 identifiers under `tsa-bonno/supabase/storage/v1/blobs/`; bucket names, object paths, object metadata, and their relationship to each blob are kept in a separately encrypted manifest. A small public index contains only synthetic keys, sizes, checksums, timing, and reference data needed for incremental backup, verification, and safe retention. It contains no bucket names or object paths.

Storage does not expose an atomic whole-project snapshot. A run is certified only when a second complete bucket/object/HEAD inventory exactly matches the first after every encrypted blob has been uploaded and HEAD-verified in R2. The encrypted manifest and public index record both inventory windows and explicitly identify the snapshot as non-atomic. A mismatch fails the run before a certifying manifest/index is published. Changes after the second inventory remain an unavoidable coherence boundary and are handled by the next daily run.

Storage retention keeps daily snapshots for 14 days and one snapshot per ISO week through 90 days. Before any delete, it parses every managed public index, verifies every referenced encrypted manifest and every blob referenced by a retained snapshot, and builds the full retained reference set. A malformed index, an orphan/missing manifest, or a missing/corrupt retained blob stops retention before deletion. Only expired index/manifest pairs and blobs not referenced by any retained index are eligible for deletion. Do not add an R2 lifecycle policy under `tsa-bonno/supabase/storage/v1/`; it cannot understand the manifest reference graph.

The backup still does **not** export deployed Edge Function source/configuration, function-secret values, external-provider configuration, GitHub secrets, Supabase credentials, R2 credentials, the private recovery key, or its passphrase. Supabase S3 does not provide bucket access-model or upload-restriction configuration, so the authoritative `storage.buckets` rows and RLS policies in the database archive remain required during restore. Repository source is version-controlled separately, but the workflow does not export deployed function state or secrets.

The workflow also contains an isolated encrypted whole-project recovery bundle
step for Auth schema/data, managed Storage schema, migration history, and a
value-free repository function/config inventory. It uses the dedicated
`tsa-bonno/supabase/whole-project/` R2 prefix and does not call the Supabase
Management API. See [Supabase whole-project recovery foundation](SUPABASE_WHOLE_PROJECT_RECOVERY.md)
for its explicit restore order and protected recreate/rotate checklist. This
integration is repository-local and has not yet had a controlled live run or
restore rehearsal.

## One-time setup

Do not paste any password, API token, access key, private key, passphrase, or database URL into an issue, commit, chat, or documentation file.

### 1. Generate the encryption keys

From the repository root, run:

```powershell
node .\scripts\backup-crypto.mjs generate `
  --public-key .\.backup-keys\supabase-backup-public.pem `
  --private-key .\.backup-keys\supabase-backup-private.pem
```

The command asks for a passphrase and writes an encrypted private key. The `.backup-keys` directory is ignored by Git.

Copy `supabase-backup-private.pem` to two safe locations that are separate from both GitHub and the R2 bucket, such as an offline encrypted USB/SSD and a reputable password-manager attachment. Record the passphrase in the password manager. If both the private key and passphrase are lost, the backups cannot be recovered. Keep every private key needed by backups still inside the retention period after a key rotation.

Convert only the public key to Base64 for GitHub:

```powershell
[Convert]::ToBase64String(
  [IO.File]::ReadAllBytes('.\.backup-keys\supabase-backup-public.pem')
)
```

Save the resulting value as the GitHub Actions secret `BACKUP_ENCRYPTION_PUBLIC_KEY_B64`.

### 2. Create a private Cloudflare R2 destination

1. In the Cloudflare dashboard, open **R2 Object Storage** and create a bucket dedicated to these backups, for example `tsa-bonno-supabase-backups`.
2. Keep the bucket private. Do not enable public buckets, a public custom domain, or public object URLs.
3. Do not add a lifecycle expiry rule for the managed backup prefix. The workflow's 14-day daily / 90-day weekly policy is the single deletion policy and protects the sole successful copy.
4. Create an R2 API token/access key scoped to **Object Read & Write for this bucket only**. It does not need account administration, Workers, DNS, or other Cloudflare permissions.
5. For a GitHub-hosted runner, leave the token without an automatic expiry only when that is allowed by the organization's security policy. This avoids a silent scheduled-backup outage; the narrow bucket scope limits its blast radius. Rotate or revoke it immediately if exposure is suspected.
6. Do not use a fixed IP allowlist with GitHub-hosted runners: their public egress addresses are not stable. The bucket-scoped token, private bucket, protected default branch, and GitHub secret controls are the reliable boundaries. An IP restriction is appropriate only if the workflow is moved to a controlled self-hosted runner with documented static egress.

Record the Cloudflare account ID, bucket name, access key ID, and secret access key in the password manager. Never place their values in this file or in a command committed to the repository.

### 3. Obtain the Supabase backup connection string

In the production Supabase Dashboard:

1. Open **Connect**.
2. Select the **Session pooler** connection string.
3. Insert the production database password where the template shows `[YOUR-PASSWORD]`.
4. Save the complete value as GitHub secret `SUPABASE_BACKUP_DB_URL`.

The connection string normally resembles:

```text
postgresql://postgres.PROJECT_REF:PASSWORD@POOLER_HOST:5432/postgres
```

Never commit this value. If the database password contains reserved URL characters, use the correctly percent-encoded connection string from Supabase's connection tooling.

### 4. Create dedicated Supabase Storage S3 credentials

In the production Supabase Dashboard:

1. Open **Storage → Settings → S3 Connection** and enable the S3 protocol if it is not already enabled.
2. Generate a dedicated S3 access-key pair for this backup. Do not reuse application, database, service-role, or personal credentials.
3. Copy the exact direct-storage endpoint and region shown by Supabase. The endpoint normally resembles `https://PROJECT_REF.storage.supabase.co/storage/v1/s3`.
4. Store the endpoint, region, access key ID, and secret access key in the password manager until they have been entered in GitHub.

Supabase's generated S3 keys are server-only credentials. They provide full S3 access across every Storage bucket and bypass RLS; Supabase currently does not offer a read-only generated S3 key. That breadth is required to enumerate private buckets, but it is also the main credential risk. The workflow limits these credentials to one Storage-backup step and never accepts a service-role fallback. Protect default-branch workflow changes, restrict repository administration, rotate the key if exposed, and delete the key if this backup path is retired.

### 5. Add GitHub Actions secrets

Open the GitHub repository, then **Settings → Secrets and variables → Actions → New repository secret**. Create these ten repository secrets:

| Secret | Value |
|---|---|
| `SUPABASE_BACKUP_DB_URL` | Production Session Pooler connection string |
| `BACKUP_ENCRYPTION_PUBLIC_KEY_B64` | Base64 public encryption key |
| `CLOUDFLARE_R2_ACCOUNT_ID` | Cloudflare account ID for the R2 bucket |
| `CLOUDFLARE_R2_BUCKET` | Private R2 bucket name |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | R2 bucket-scoped access key ID |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | R2 bucket-scoped secret access key |
| `SUPABASE_STORAGE_S3_ENDPOINT` | Direct Supabase Storage S3 endpoint |
| `SUPABASE_STORAGE_S3_REGION` | Region shown in Supabase S3 settings |
| `SUPABASE_STORAGE_S3_ACCESS_KEY_ID` | Dedicated generated Storage S3 access key ID |
| `SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY` | Dedicated generated Storage S3 secret access key |

The database preflight and Storage step report missing names without printing values. The four Supabase Storage S3 values are exposed only to the certifying Storage step. R2 credentials are exposed only to R2 operations, and the private recovery key/passphrase are never placed in GitHub. A person able to change a workflow on the default branch can cause GitHub Actions to use repository secrets.

### 6. Perform the first controlled run

1. Open **GitHub → Actions → Daily Supabase Backup**.
2. Choose **Run workflow**.
3. Confirm the SQL dump, encryption, encrypted artifact uploads, database R2 upload, certified Storage backup, whole-project recovery bundle, all retention passes, and cleanup steps pass.
4. In the private R2 bucket, confirm a non-empty `.tar.gz.tbbackup` object appears under each of `tsa-bonno/supabase/`, `tsa-bonno/supabase/storage/v1/`, and `tsa-bonno/supabase/whole-project/` as applicable.
5. Confirm the encrypted GitHub artifacts are present and have the seven-day retention shown by Actions.
6. Confirm one public Storage index and one encrypted Storage manifest appear under `tsa-bonno/supabase/storage/v1/`, and that all blob names are 64-character synthetic hashes rather than source paths.
7. Download the database and whole-project R2 objects to a protected recovery workstation and complete the database/whole-project verification and rehearsal below.

Do not call the backup operational until the first database verification and a representative Storage manifest/blob verification succeed. A first successful upload is not yet full disaster-recovery evidence; complete a disposable-project restore rehearsal as described below.

## Verification and decryption rehearsal

The verifier checks the encrypted envelope, decrypts only into a unique temporary path, rejects unsafe or malformed tar input, verifies required files and recorded SHA-256 values, and removes plaintext by default. The rehearsal writes only a secret-redacted validation report; it does not restore or write a database.

Set the passphrase interactively, run both checks, and clear it from the process environment immediately afterward:

```powershell
$env:TSA_BONNO_BACKUP_KEY_PASSPHRASE = Read-Host 'Private-key passphrase'
try {
  node .\scripts\verify-supabase-backup.mjs verify `
    --input 'D:\Recovery\tsa-bonno-supabase-example.tar.gz.tbbackup' `
    --private-key 'D:\Keys\supabase-backup-private.pem'

  node .\scripts\verify-supabase-backup.mjs rehearse `
    --input 'D:\Recovery\tsa-bonno-supabase-example.tar.gz.tbbackup' `
    --private-key 'D:\Keys\supabase-backup-private.pem' `
    --report 'D:\Recovery\supabase-backup-rehearsal-report.json'
} finally {
  Remove-Item Env:TSA_BONNO_BACKUP_KEY_PASSPHRASE -ErrorAction SilentlyContinue
}
```

Use a newly created disposable Supabase project for the first full restore rehearsal and follow Supabase's current official restore procedure. Never test restoration over the live production project. If a plaintext archive is deliberately created for an official disposable restore, keep it on encrypted local storage and remove it immediately after the rehearsal.

### Storage restore rehearsal

Storage restore is intentionally a manual, disposable-project procedure until an independently tested restore tool exists:

1. Download one public index, its referenced encrypted manifest, and every referenced encrypted blob from the private R2 bucket.
2. Verify every encrypted file's size and SHA-256 against the public index before decryption.
3. Decrypt the manifest with the owner-held private key. For each manifest row, decrypt its synthetic blob to a unique temporary file and verify the plaintext size and SHA-256 before use.
4. Restore the matching database archive to a newly created disposable Supabase project first so `storage.buckets`, RLS policies, and bucket restrictions can be reconciled. Do not assume S3 `ListBuckets` captured public/private status, MIME restrictions, or file-size limits.
5. Generate temporary S3 credentials for the disposable project and upload each verified plaintext object to the exact manifest bucket/key with its recorded S3-visible content metadata. Resolve any restored `storage.objects` metadata conflict using Supabase's current official migration guidance; never experiment against production.
6. Compare bucket count, object count, each object size/hash/metadata, and private-object access behavior with the encrypted manifest. Record the rehearsal date, snapshot ID, findings, and cleanup evidence without copying object paths or customer data into the report.
7. Revoke the disposable S3 credentials, delete plaintext, and delete the disposable project after evidence is retained.

This snapshot preserves only the current bytes visible during the certified window. Supabase Storage S3 does not support object versioning, so overwritten or deleted historical object versions cannot be recovered unless an earlier retained snapshot still references their encrypted blob.

## Failure and recovery

- GitHub reports a failed scheduled workflow through Actions notifications. Review failures the same day; the workflow also writes a safe run summary and deduplicated failure/overdue issue.
- An R2 `403`, signature, or listing error normally means the account ID, bucket name, access key, token scope, or secret key is wrong or was rotated. Correct the repository secret or rotate the bucket-scoped R2 token; never broaden it to account administration.
- If R2 upload or retention fails after encryption, the encrypted GitHub artifact remains available for seven days. Verify that copy before retrying.
- A Supabase authentication failure requires replacing `SUPABASE_BACKUP_DB_URL`; do not create a second uncontrolled database password merely to silence an ambiguous failure.
- A Supabase Storage S3 `403` or signature failure requires checking the exact direct endpoint, project region, access key, and secret from Storage S3 settings. Do not substitute a service-role key. Rotate the dedicated S3 pair if exposure is suspected.
- The initial Storage copy downloads every object and consumes Supabase egress; later runs reuse unchanged verified R2 blobs. On Free tier, check the current Storage and egress quotas before the first controlled run. A large first export can exhaust monthly egress and make the workflow fail until quota or plan capacity is available.
- A source-inventory mismatch means objects or metadata changed during the non-atomic backup window. No certifying manifest/index was published; let the next run retry or run it manually during a quieter period.
- If Storage retention reports malformed/missing index, manifest, or retained blob state, it has deleted nothing. Preserve the bucket, inspect the exact synthetic keys, and repair or recover the reference graph before retrying; do not manually delete guessed orphan blobs.
- If a run reports that the uploaded object is not yet visible in the R2 listing, retention is skipped and the run fails closed. Confirm the object in the private bucket before retrying.
- The database retention helper only deletes exact managed database backup names under `tsa-bonno/supabase/`. Storage retention is independently restricted to the versioned `tsa-bonno/supabase/storage/v1/` graph. Neither path deletes unrelated bucket contents.
- Rotating the encryption key does not re-encrypt older backups. Retain every private key needed for backups still inside the retention period.
- If the private key or passphrase may have been exposed, revoke/rotate the R2 token as appropriate, generate a new encryption pair, update only the public-key secret, and retain the old private key until old backups are expired or deliberately re-encrypted.

References:

- [Supabase CLI backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase Storage S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication)
- [Supabase Storage S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility)
- [Cloudflare R2 S3-compatible API](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/)
