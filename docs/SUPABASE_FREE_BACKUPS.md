# Supabase Free-Tier Cloud Backups

Last reviewed: 2026-08-06

This repository contains an opt-in GitHub Actions workflow that creates an encrypted logical backup of the linked production Supabase database without using disk space on an operator computer.

The workflow is `.github/workflows/supabase-backup.yml`. It runs at 02:30 Africa/Gaborone each day after it reaches the repository's default branch, and it can also be started manually from GitHub Actions.

## What the workflow protects

Each run creates the three files prescribed by Supabase's CLI backup procedure:

- `roles.sql`
- `schema.sql`
- `data.sql`

It also records a creation manifest and SHA-256 checksums, builds one compressed archive, encrypts that archive with AES-256-GCM, wraps the data key with a 3072-bit RSA public key, and deletes plaintext backup material from the runner.

The encrypted result is:

- uploaded to the configured Google Drive folder;
- retained as an encrypted GitHub Actions artifact for seven days as a short fallback;
- retained in Drive as daily copies for 14 days and then one copy per ISO week through 90 days.

Expired Drive copies are moved to Google Drive trash rather than permanently deleted by the workflow.

This database backup does **not** contain the binary objects stored by Supabase Storage. It preserves Storage database metadata only. Room images, identity documents, proof files, and other Storage objects need a separate export policy. Edge Functions remain protected by the repository, but deployed function configuration and platform settings must be recorded separately.

## One-time setup

Do not paste any password, refresh token, private key, or database URL into an issue, commit, chat, or documentation file.

### 1. Generate the encryption keys

From the repository root, run:

```powershell
node .\scripts\backup-crypto.mjs generate `
  --public-key .\.backup-keys\supabase-backup-public.pem `
  --private-key .\.backup-keys\supabase-backup-private.pem
```

The command asks for a passphrase and writes an encrypted private key. The `.backup-keys` directory is ignored by Git.

Copy `supabase-backup-private.pem` to two safe locations that are separate from the Google account receiving the backups, such as an offline encrypted USB/SSD and a reputable password manager attachment. Record the passphrase in the password manager. If both the private key and passphrase are lost, the backups cannot be recovered.

Convert only the public key to Base64 for GitHub:

```powershell
[Convert]::ToBase64String(
  [IO.File]::ReadAllBytes('.\.backup-keys\supabase-backup-public.pem')
)
```

Save the resulting value as the GitHub Actions secret `BACKUP_ENCRYPTION_PUBLIC_KEY_B64`.

### 2. Create the Google OAuth application

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project dedicated to Tsa Bonno backups.
3. Enable **Google Drive API**.
4. Configure the OAuth consent/branding screen for the Google account that will own the backups.
5. Create an OAuth client with application type **Desktop app**.
6. Copy its client ID and client secret.

Do not leave an External OAuth application in **Testing** for this scheduled workflow. Google limits refresh tokens for External/Testing applications to seven days. Publish the app before relying on the schedule. This workflow requests only the `drive.file` scope and creates its own backup folder.

Authorize the backup utility without typing the client secret into the PowerShell command history:

```powershell
$env:GOOGLE_DRIVE_CLIENT_ID = Read-Host 'Google OAuth client ID'
$googleSecret = Read-Host 'Google OAuth client secret' -AsSecureString
$env:GOOGLE_DRIVE_CLIENT_SECRET = [System.Net.NetworkCredential]::new('', $googleSecret).Password
try {
  node .\scripts\google-drive-oauth.mjs
} finally {
  Remove-Item Env:GOOGLE_DRIVE_CLIENT_ID -ErrorAction SilentlyContinue
  Remove-Item Env:GOOGLE_DRIVE_CLIENT_SECRET -ErrorAction SilentlyContinue
  $googleSecret = $null
}
```

Open the URL printed by the script, sign in to the intended Google account, and approve access. The utility creates **Tsa Bonno Supabase Backups** in My Drive and prints:

- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_FOLDER_ID`

Treat the refresh token like a password.

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

Open the GitHub repository, then **Settings → Secrets and variables → Actions → New repository secret**. Create all six secrets:

| Secret | Value |
|---|---|
| `SUPABASE_BACKUP_DB_URL` | Production Session Pooler connection string |
| `BACKUP_ENCRYPTION_PUBLIC_KEY_B64` | Base64 public encryption key |
| `GOOGLE_DRIVE_CLIENT_ID` | Google Desktop OAuth client ID |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Google Desktop OAuth client secret |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | Token printed by the OAuth helper |
| `GOOGLE_DRIVE_FOLDER_ID` | Folder ID printed by the OAuth helper |

Limit repository administration and workflow-edit permission. A person able to change a workflow on the default branch can cause GitHub Actions to use repository secrets.

### 5. Perform the first controlled run

1. Open **GitHub → Actions → Daily Supabase Backup**.
2. Choose **Run workflow**.
3. Confirm all steps pass.
4. Open Google Drive and confirm that a non-empty `.tbbackup` file appears.
5. Download that encrypted file and perform the decryption rehearsal below.

Do not call the backup operational until the first decryption rehearsal succeeds.

## Decryption rehearsal

Download one `.tbbackup` file. From the repository root, run:

```powershell
node .\scripts\backup-crypto.mjs decrypt `
  --input 'D:\Recovery\tsa-bonno-supabase-example.tar.gz.tbbackup' `
  --output 'D:\Recovery\tsa-bonno-supabase-example.tar.gz' `
  --private-key 'D:\Keys\supabase-backup-private.pem'
```

The utility asks for the private-key passphrase and fails closed if the file was altered, truncated, encrypted for a different key, or decrypted with the wrong passphrase.

Extract the resulting archive and verify that it contains non-empty `roles.sql`, `schema.sql`, `data.sql`, `metadata.json`, and `SHA256SUMS` files. Use Supabase's current official restore procedure only against a newly created disposable project for the first full restore rehearsal. Never test restoration over the live production project.

## Failure and recovery

- GitHub reports a failed scheduled workflow through Actions notifications. Review failures the same day.
- An `invalid_grant` Google error normally means the refresh token expired or was revoked. Run the OAuth helper again and replace `GOOGLE_DRIVE_REFRESH_TOKEN`.
- A Supabase authentication failure requires replacing `SUPABASE_BACKUP_DB_URL`; do not create a second uncontrolled database password merely to silence an ambiguous failure.
- If Drive upload fails after encryption, the encrypted GitHub artifact remains available for seven days.
- Rotating the encryption key does not re-encrypt older backups. Retain every private key needed for backups still inside the retention period.

References:

- [Supabase CLI backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Google OAuth offline access](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OAuth token expiration](https://developers.google.com/identity/protocols/oauth2)
- [Google Drive API file creation](https://developers.google.com/workspace/drive/api/guides/create-file)
