# Supabase Free-Tier Cloud Backups

Last reviewed: 2026-08-27

This repository contains an opt-in GitHub Actions workflow that creates an encrypted logical backup of the linked production Supabase database without using disk space on an operator computer.

The workflow is `.github/workflows/supabase-backup.yml`. It runs at 02:30 Africa/Gaborone each day after it reaches the repository's default branch, and it can also be started manually from GitHub Actions.

## What the workflow protects

Each run creates the three files prescribed by Supabase's CLI backup procedure:

- `roles.sql`
- `schema.sql`
- `data.sql`

It also records a creation manifest and SHA-256 checksums, builds one compressed archive, encrypts that archive with AES-256-GCM, wraps the data key with a 3072-bit RSA public key, and deletes plaintext backup material from the runner.

The encrypted result is:

- uploaded to the private Cloudflare R2 bucket under the managed `tsa-bonno/supabase/` prefix;
- retained as an encrypted GitHub Actions artifact for seven days as a short fallback;
- retained in R2 as all daily copies for 14 days, then one copy per ISO week through 90 days.

The R2 retention helper deletes only positively identified managed `.tar.gz.tbbackup` objects. It never deletes the sole successful backup, lookalike objects, or objects outside the managed prefix. Do not add an R2 lifecycle rule that expires these objects: retention is deliberately bounded and auditable in the workflow, while the R2 token remains valid until it is explicitly rotated or revoked.

This database backup does **not** contain the binary objects stored by Supabase Storage. It preserves Storage database metadata only. Room images, identity documents, proof files, and other Storage objects need a separate encrypted export policy. The database archive also does not include deployed Edge Function source/configuration, function-secret values, external-provider configuration, GitHub secrets, Supabase credentials, R2 credentials, the private recovery key, or its passphrase. Repository source is version-controlled separately, but the workflow does not export deployed function state or secrets.

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

### 4. Add GitHub Actions secrets

Open the GitHub repository, then **Settings → Secrets and variables → Actions → New repository secret**. Create exactly these six repository secrets:

| Secret | Value |
|---|---|
| `SUPABASE_BACKUP_DB_URL` | Production Session Pooler connection string |
| `BACKUP_ENCRYPTION_PUBLIC_KEY_B64` | Base64 public encryption key |
| `CLOUDFLARE_R2_ACCOUNT_ID` | Cloudflare account ID for the R2 bucket |
| `CLOUDFLARE_R2_BUCKET` | Private R2 bucket name |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | R2 bucket-scoped access key ID |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | R2 bucket-scoped secret access key |

The workflow preflight reports all missing names together without printing values. The database and public key are exposed only to the dump/encryption step; R2 credentials are exposed only to the upload/retention step. Limit repository administration and workflow-edit permission. A person able to change a workflow on the default branch can cause GitHub Actions to use repository secrets.

### 5. Perform the first controlled run

1. Open **GitHub → Actions → Daily Supabase Backup**.
2. Choose **Run workflow**.
3. Confirm the SQL dump, encryption, encrypted artifact upload, R2 upload, retention, and cleanup steps pass.
4. In the private R2 bucket, confirm a non-empty `.tar.gz.tbbackup` object appears under `tsa-bonno/supabase/`.
5. Confirm the encrypted GitHub artifact is present and has the seven-day retention shown by Actions.
6. Download the R2 object to a protected recovery workstation and complete the verification/rehearsal below.

Do not call the backup operational until the first verification and decryption rehearsal succeeds. The first successful run is not evidence that Storage objects, deployed Edge Functions, or secrets are backed up; those exclusions remain deliberate.

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

## Failure and recovery

- GitHub reports a failed scheduled workflow through Actions notifications. Review failures the same day; the workflow also writes a safe run summary and deduplicated failure/overdue issue.
- An R2 `403`, signature, or listing error normally means the account ID, bucket name, access key, token scope, or secret key is wrong or was rotated. Correct the repository secret or rotate the bucket-scoped R2 token; never broaden it to account administration.
- If R2 upload or retention fails after encryption, the encrypted GitHub artifact remains available for seven days. Verify that copy before retrying.
- A Supabase authentication failure requires replacing `SUPABASE_BACKUP_DB_URL`; do not create a second uncontrolled database password merely to silence an ambiguous failure.
- If a run reports that the uploaded object is not yet visible in the R2 listing, retention is skipped and the run fails closed. Confirm the object in the private bucket before retrying.
- The retention helper only deletes exact managed backup names under `tsa-bonno/supabase/`, uses `If-Match` when an object ETag is available, and retains the newest object if it would otherwise delete the last managed copy. It does not delete Storage blobs or unrelated bucket contents.
- Rotating the encryption key does not re-encrypt older backups. Retain every private key needed for backups still inside the retention period.
- If the private key or passphrase may have been exposed, revoke/rotate the R2 token as appropriate, generate a new encryption pair, update only the public-key secret, and retain the old private key until old backups are expired or deliberately re-encrypted.

References:

- [Supabase CLI backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Cloudflare R2 S3-compatible API](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/)
