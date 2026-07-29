# Tsa Bonno HospitalityOS: New Windows PC Migration and Setup

Last verified on the old PC: 2026-07-16

This document is both a human checklist and an execution brief for an AI assistant on the new PC. The objective is to preserve all current source work, restore only the credentials and local data that are genuinely required, install missing tools and dependencies, and prove that the repository works before any deployment or database mutation.

## Read this first

Copying the project folder can preserve the work, but copying it alone is not a complete migration. This repository also depends on:

- Git history and the current uncommitted working tree;
- ignored `.env` credential/configuration files;
- a user-scoped `SUPABASE_SERVICE_ROLE_KEY` on the current admin machine;
- GitHub, Netlify, Vercel, and sometimes Supabase CLI authentication;
- Node.js/npm and separately locked dependency trees;
- Playwright Chromium for browser tests and marketing capture;
- optional Windows packaging, native-build, Docker, and code-signing tools;
- optional Electron AppData containing local profiles, backups, sessions, caches, and offline queues.

Never send secret values through chat, commit them to Git, or print them in a setup report. On a managed work PC, confirm company policy before transferring customer data, service-role access, personal deployment tokens, or signing certificates.

## Current verified old-PC snapshot

Use this only as a comparison point; re-check it on the actual migration day.

- Repository: `https://github.com/Rabafi/boroko-bookings-FullCode-2.git`
- Branch: `codex/tsa-bonno-enterprise-foundation`
- Upstream: `origin/codex/tsa-bonno-enterprise-foundation`
- Committed branch state: `0` ahead and `0` behind the upstream.
- Working tree: **not clean**. Including this new guide, it had 769 status entries: 433 modified, 23 deleted, and 313 untracked. A fresh GitHub clone today would therefore omit a large amount of current work.
- Repository size: about 7.2 GB. About 1.8 GB is `node_modules`, about 3.1 GB is `dist`, and about 0.9 GB is `.git`.
- Windows: x64.
- PowerShell: 7.6.3.
- Node.js: 24.16.0 x64.
- npm: 11.13.0.
- Git: 2.54.0.windows.1.
- GitHub CLI: 2.93.0.
- Project-local Supabase CLI: 2.96.0.
- Global Netlify CLI: 26.1.0.
- Python: 3.13.13, optional for the main JavaScript workflows.
- Playwright: 1.59.1 with Chromium installed.
- Git LFS is installed, but this repository currently has no `.gitattributes` and no LFS-tracked files. LFS is not a setup requirement unless that changes.
- The safely inspected desktop queue files contained zero queued items on 2026-07-16. Re-check System Health and every actively used app on migration day.

## Part 1: Checklist on the old PC

### 1. Confirm permission and choose the migration method

Preferred method:

1. Review all current changes.
2. Commit every intended source change in logical commits.
3. Push the branch to GitHub.
4. Make a separate encrypted cold copy as insurance.
5. Clone from GitHub on the new PC.

Fallback method if the working tree cannot be committed in time:

1. Close all editors, terminals, dev servers, Electron apps, and file watchers.
2. Copy the **entire** `Boroko Bookings` folder, including hidden `.git`, ignored `.env` files, modified files, deleted-file state, and untracked files.
3. Use a new, empty destination folder on an encrypted external drive.
4. Do not treat a Git bundle, patch, stash, or GitHub clone as a substitute for this cold copy: they may omit ignored or untracked work.

The preferred method is safer and easier to verify. Because the current working tree is very large and dirty, do not blindly run `git add -A`; have an AI or developer first distinguish intended source/assets from generated output and unrelated files.

### 2. Freeze and preserve the source

From the repository root:

```powershell
git rev-parse --show-toplevel
git branch --show-current
git status --short --branch
git fetch origin
git rev-list --left-right --count "@{u}...HEAD"
```

Before relying on GitHub, the last command should show `0  0`, and `git status --short` should either be empty or every remaining entry must be explicitly accounted for in the cold copy.

For a full external-drive copy, replace `E:` with the real encrypted drive. This deliberately does not delete anything from the destination:

```powershell
$source = 'C:\Users\26772\Desktop\Boroko Bookings'
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$destination = "E:\PC-Migration\$stamp\Boroko Bookings"
New-Item -ItemType Directory -Path $destination -Force | Out-Null
robocopy $source $destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:2 /XJ
if ($LASTEXITCODE -ge 8) { throw "Robocopy failed with exit code $LASTEXITCODE" }
```

Then save a plain-text migration record so the new PC can compare exact Git state without exposing secrets:

```powershell
$record = Split-Path -Parent $destination
git rev-parse HEAD | Set-Content -LiteralPath (Join-Path $record 'git-head.txt')
git branch --show-current | Set-Content -LiteralPath (Join-Path $record 'git-branch.txt')
git status --porcelain=v1 | Set-Content -LiteralPath (Join-Path $record 'git-status.txt')
git remote -v | Set-Content -LiteralPath (Join-Path $record 'git-remotes.txt')
```

Run both blocks in the same PowerShell session so `$destination` is defined. The record contains filenames and repository URLs, so keep it with the encrypted backup.

This full copy is currently about 7.2 GB. If space is tight, commit and push first, then omit only reproducible directories such as `node_modules`, `dist`, `out`, `test-results`, and temporary caches. Never omit `.git`, source folders, migrations, untracked assets, or ignored environment files unless they are backed up separately.

Optional secondary history backup, after choosing a destination outside the repository:

```powershell
git bundle create 'E:\PC-Migration\boroko-all-refs.bundle' --all
git bundle verify 'E:\PC-Migration\boroko-all-refs.bundle'
```

The bundle contains committed refs only. It does not preserve the dirty working tree or ignored secrets.

### 3. Protect ignored configuration and credentials

The following ignored files currently exist and must be recreated or transferred through an encrypted drive/password manager if their function is still required:

- `.env`
- `.env.local`
- `.env.db`
- `.env.release`
- `manager-pwa/.env`
- `manager-pwa/.env.local`
- `booking-site/.env`
- `legacy-pos/.env`
- `legacy-pos/.env.release`

Relevant variable **names** currently in use include:

- Supabase/public app configuration: `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`, `VITE_SUPABASE_ANON_KEY`, `VITE_AUTH_REDIRECT_URL`.
- Database migration access: `SUPABASE_DB_PASSWORD`.
- Admin-only server access: `SUPABASE_SERVICE_ROLE_KEY` as a Windows user environment variable, not in distributed client `.env` files.
- Releases: `GH_TOKEN`, `MAIN_APP_GH_TOKEN`, `LEGACY_POS_GH_TOKEN`.
- Booking site: `VITE_CONFIRMATION_EMAIL_FUNCTION_URL`, `VITE_ANALYTICS_ENDPOINT`, `VITE_ROBOTS_META`.
- Local AI: `MAIN_VITE_BOROKO_GEMINI_API_KEY`.
- Vercel: `VERCEL_OIDC_TOKEN`, which may be short-lived and should normally be recreated by re-authentication instead of copied.

Actions:

- Save the ignored environment files in an encrypted location, separate from the normal source backup if possible.
- Record which variables are intentionally absent.
- Revoke or rotate tokens that should not move to the work PC.
- Prefer fresh `gh`, Netlify, Vercel, and Supabase authentication on the new PC over copying CLI credential stores.
- Do not put `SUPABASE_SERVICE_ROLE_KEY` on the new PC unless it is an approved Command Central/admin machine. Lodge/customer client machines must never have it.
- If a real Windows code-signing certificate exists, transfer it only through an approved secure process. Preserve its password separately. Never generate a self-signed certificate and call a production release signed.

### 4. Deal with local Electron application data safely

Do **not** copy `%APPDATA%` wholesale by default. These folders can contain cached business/customer information, trusted sessions, device identity, profiles, backups, and offline financial operations. Copying them can also clone one device identity onto two PCs.

Before leaving the old PC:

1. Open every app actually used on this PC.
2. Connect it to the internet.
3. Open System Health/sync status.
4. Confirm pending and failed queues are zero, or export/preserve them deliberately.
5. Create/export the app's supported backup or local-operations support bundle where required.
6. Sign out if the old PC will leave your control.
7. Do not wipe the old PC until the new PC has passed the final verification and all required data is confirmed.

Known user-data identities include:

- Installed LodgingOS compatibility data: `%APPDATA%\boroko-bookings`.
- HotelOS: `%APPDATA%\boroko-hotel`.
- Restaurant & Bar POS: `%APPDATA%\boroko-hospitality-pos` when created.
- Legacy POS: `%APPDATA%\boroko-pos-legacy`.
- Development desks such as `%APPDATA%\Tsa Bonno LodgingOS Dev Desk`, `%APPDATA%\Tsa Bonno HotelOS Dev Desk`, and `%APPDATA%\Tsa Bonno Restaurant & Bar POS Dev Desk`.
- Older `Boroko ... Dev Desk` folders may exist for compatibility/testing.

If all queues are empty, the safest new-PC setup is normally a fresh login and fresh cache. Restore exact AppData only when local-only work/backups must be preserved, after explicit review. Close the app on both PCs during the copy, and never operate both machines concurrently from duplicated local state.

### 5. Save access and recovery information

Confirm that you can independently sign in to:

- the GitHub account and repositories;
- the Supabase organization/project and its MFA/recovery method;
- Netlify sites/team;
- Vercel project/team if still used;
- the email account that receives password resets and deployment notices;
- the password manager or encrypted storage containing environment values;
- any Windows code-signing provider/certificate portal.

Do not rely on browser sessions from the old PC. Save MFA recovery codes securely.

## Part 2: Instructions for the AI assistant on the new PC

### Mission and boundaries

You are setting up an existing financial-grade Windows/Electron repository. Work from the actual repository root. First read, in full:

1. `AGENTS.md`
2. `PROJECT_STATE.md`
3. `docs/ARCHITECTURE.md`
4. This file

Also read `docs/SHIP_READY_RUNBOOK.md` before any future release. Historical audit files are evidence, not instructions.

During setup:

- Inspect before installing; do not reinstall tools that already satisfy the requirement.
- Ask for approval before an installation that needs administrator rights or changes corporate-managed software.
- Never print, upload, or paste secret values. Report only whether required variables/files are present.
- Preserve the existing dirty working tree. Do not discard, stash, reset, clean, commit, or reformat it unless explicitly asked.
- Use `npm ci`, not `npm install`, for the locked dependency trees. If `npm ci` reports a package/lock mismatch, stop and diagnose; do not silently rewrite a lockfile.
- Do not run `npm run db:push`, deployments, releases, version bumps, Git pushes, or code-signing as a setup test. These change external state.
- Do not restore old AppData or service-role credentials without explicit approval.

### Step A: Locate and validate the source

If the clean branch was pushed, clone it into a local non-OneDrive development path, for example:

```powershell
New-Item -ItemType Directory -Path "$env:USERPROFILE\source" -Force | Out-Null
Set-Location "$env:USERPROFILE\source"
git clone https://github.com/Rabafi/boroko-bookings-FullCode-2.git 'Boroko Bookings'
Set-Location '.\Boroko Bookings'
git switch codex/tsa-bonno-enterprise-foundation
```

If a cold folder copy was supplied, open that folder directly and do not clone over it.

Validate:

```powershell
git rev-parse --show-toplevel
git remote -v
git branch --show-current
git status --short --branch
git fsck --no-progress
```

Compare the branch, last commit, and status with the old-PC migration record. If current work is missing, stop before installing or editing and recover the cold copy.

### Step B: Check required machine tools

Required for normal development:

- Windows x64.
- PowerShell 7 recommended.
- Git.
- Node.js 24.x x64. The verified old-PC version is 24.16.0; use the same version if dependency behavior differs.
- npm supplied with Node; the verified version is 11.13.0.
- GitHub CLI for repository/release work.

Required only for particular workflows:

- Playwright Chromium for E2E tests, marketing screenshots, and brochure generation.
- Netlify CLI for Netlify linking/deployment.
- Vercel CLI for the current `pwa:deploy` workflow if it remains active.
- Docker Desktop for local Supabase services; it is not required for ordinary install/build and was not running on the old PC during this inventory.
- Python and Visual Studio 2022 C++ Build Tools only if a native npm dependency cannot use its prebuilt binary or a Python utility is explicitly required.
- A real Authenticode certificate only for signed production Windows releases.

Run this non-secret diagnostic:

```powershell
$commands = 'git','node','npm','npx','gh','docker','python','winget'
foreach ($command in $commands) {
  $found = Get-Command $command -ErrorAction SilentlyContinue
  if ($found) { "$command`tFOUND`t$($found.Source)" } else { "$command`tMISSING" }
}
git --version
node --version
node -p "process.platform + ' ' + process.arch"
npm --version
if (Get-Command gh -ErrorAction SilentlyContinue) { gh --version | Select-Object -First 1 }
```

On an approved unmanaged Windows PC, missing base tools can be installed with `winget`:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id GitHub.cli -e
winget install --id Microsoft.PowerShell -e
```

Close and reopen the terminal after installs. If the LTS installer does not provide Node 24.x, install the verified 24.16.0 x64 version through an approved Node version manager or the official Node installer.

Only if native dependency installation fails because compilation tools are missing:

```powershell
winget install --id Python.Python.3.13 -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Docker is optional and large; install it only when local Supabase/Docker work is requested:

```powershell
winget install --id Docker.DockerDesktop -e
```

### Step C: Restore repository configuration without exposing it

Use the tracked examples to validate the ignored files:

- `.env.example`
- `.env.db.example`
- `.env.release.example`
- `manager-pwa/.env.example`
- `booking-site/.env.example`
- `legacy-pos/.env.example`

Restore the approved ignored `.env` files from encrypted storage or recreate them from the examples. Do not echo their contents. A safe presence-only check is:

```powershell
$files = @(
  '.env', '.env.local', '.env.db', '.env.release',
  'manager-pwa/.env', 'manager-pwa/.env.local',
  'booking-site/.env',
  'legacy-pos/.env', 'legacy-pos/.env.release'
)
foreach ($file in $files) { "$file`t$(Test-Path -LiteralPath $file)" }
```

Set Git identity if missing:

```powershell
git config user.name
git config user.email
# Only if blank, ask the user for the correct identity before setting it.
```

Authenticate interactively as needed:

```powershell
gh auth login
gh auth status
```

For Netlify/Vercel/Supabase, install or authenticate only when that workflow is needed. Prefer fresh links rather than copying CLI credential stores:

```powershell
npx netlify-cli login
npx vercel login
npx supabase login
```

Run `netlify link`, `vercel link`, or `supabase link` only from the correct surface/project and only after confirming the intended remote target. Do not guess a project or site.

The root `npm run db:push` wrapper uses the project-local Supabase CLI and `.env.db`; a global Supabase CLI is not required. It must not be run merely to prove setup.

### Step D: Install all repository dependency trees

From the repository root, run these sequentially:

```powershell
npm ci
npm run manager:install
npm run booking:install
npm run legacy-pos:install
npx playwright install chromium
```

Why four npm installs are required:

- root `package-lock.json` covers the desktop app plus `apps/*` and `packages/*` workspaces;
- `manager-pwa/package-lock.json` is separate;
- `booking-site/package-lock.json` is separate;
- `legacy-pos/package-lock.json` is separate.

Do not reuse copied `node_modules` as proof of setup. `npm ci` must rebuild the dependency trees for the new PC. The root postinstall runs `electron-builder install-app-deps`.

If Playwright is not needed immediately, its Chromium download may be deferred, but `npm run test:e2e`, marketing capture, and brochure generation will not be complete until it is installed.

### Step E: Run non-mutating verification

First confirm installs did not unexpectedly alter source or lockfiles:

```powershell
git status --short --branch
npm ls --depth=0
npm --prefix manager-pwa ls --depth=0
npm --prefix booking-site ls --depth=0
npm --prefix legacy-pos ls --depth=0
```

Then run the focused setup gates:

```powershell
npm run products:list
npm run workspace:check
npm test
npm run test:products
npm run build
npm run manager:build
npm run booking:test
npm run booking:build
npm run legacy-pos:test
npm run legacy-pos:build
```

If time and hardware permit, run the broader local release checks from `docs/SHIP_READY_RUNBOOK.md`. A local green build does not prove Supabase migrations, Netlify/Vercel publication, GitHub releases, payment providers, or live customer behavior.

For an interactive smoke test, launch only one product at a time and keep its terminal visible:

```powershell
npm run dev:lodging
# Or: npm run dev:hotel
# Or: npm run dev:restaurant-bar
```

Verify that the expected product opens, the login screen renders, and no startup error is logged. Stop the app cleanly before launching another product.

### Step F: Restore optional local state only if approved

Prefer a fresh application login. If an approved old-PC support bundle or AppData backup must be restored:

1. Verify both old and new apps are closed.
2. Confirm the app/product identity exactly.
3. Keep an untouched backup of the new folder.
4. Restore only the reviewed data.
5. Do not restore a service-role credential to a normal client machine.
6. Do not run the old and new PC concurrently with cloned device/session/queue state.
7. Launch online, inspect System Health, and verify pending/failed queues before doing operational work.

### Step G: Final handoff report

Report to the user without secret values:

- repository path, branch, upstream, last commit, and whether the working tree matches the migration record;
- installed tool versions and architecture;
- which ignored configuration files are present or intentionally absent;
- whether GitHub/Netlify/Vercel/Supabase access was authenticated, without tokens;
- results of each dependency installation and verification command;
- whether Playwright Chromium is installed;
- whether any native build tools were actually necessary;
- whether local AppData was restored or a fresh login was used;
- every remaining blocker, especially corporate permissions, missing credentials, failed native builds, or remote-target uncertainty.

Do not declare the migration complete until the source is proven complete, dependencies install from lockfiles, the relevant builds pass, and the user confirms access to the services they actually need.

## Part 3: Final human sign-off before wiping the old PC

- [ ] Intended source changes are committed and pushed, or the full dirty working tree is verified on the new PC.
- [ ] A second encrypted backup exists and opens successfully.
- [ ] `.git` history and untracked assets are present.
- [ ] Required ignored `.env` files were securely restored or recreated.
- [ ] Unneeded tokens were revoked; moved tokens were rotated where appropriate.
- [ ] The new PC can access GitHub and the required deployment/database accounts.
- [ ] Root, Manager PWA, booking-site, and Legacy POS dependencies installed with `npm ci`.
- [ ] Playwright Chromium is installed if browser/marketing tests are needed.
- [ ] Product workspace checks, focused tests, and relevant builds pass.
- [ ] The correct Electron product launches and reaches login.
- [ ] System Health shows no unexplained pending or failed operations.
- [ ] Any required local backups were restored without duplicating active device state.
- [ ] The work PC is approved to hold the selected customer data and privileged credentials.
- [ ] The old PC remains available until at least one real work session succeeds on the new PC.
- [ ] Only after all of the above: sign out, revoke old sessions if appropriate, and securely wipe/return the old PC.
