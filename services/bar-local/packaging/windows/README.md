# Tsa Bonno local Bar: Windows packaging

Operator documentation for installing, backing up, enrolling and switching over a
single-host local Bar authority. This is not the customer manual.

## Status

This packaging is source-complete but **not qualified**. It has been syntax-checked
and the service wrapper has been compiled, but no physical Windows service,
PostgreSQL 17, TLS, firewall, scheduled backup, restore, streaming standby or
switchover has been executed in this repository. Do not commission a customer site
until the release gates below have been run on the target hardware.

The local Bar authority is the only authority in this mode. There is no hosted
fallback, no automatic failover and no consensus. Do not start the Bar application
service on a standby or redirect clients until a switchover has been verified.

## Prerequisites

- Windows Server or Windows 10/11, elevated PowerShell 5.1 or newer.
- PostgreSQL 17 x64 installed with `postgres.exe`, `initdb.exe`, `pg_ctl.exe`,
  `psql.exe`, `pg_dump.exe`, `pg_isready.exe` and `pg_basebackup.exe` in `-PgBin`.
- Node.js 20 LTS or newer, x64, at a stable path.
- A built `services/bar-local` tree. From the repository root:

  ```powershell
  npm --prefix packages/bar-contracts run build
  npm --prefix services/bar-local run build
  ```

- Separate directories for the application, service data, PostgreSQL data and
  backups. None may be the same directory.
- TLS certificate and private key when the HTTP endpoint binds a non-loopback
  address. The certificate must be valid for the hostname clients use.
- For a standby: a separate host, the same PostgreSQL major version, private
  network access and a reviewed firewall rule for the PostgreSQL port.
- A backup key that is stored separately from the encrypted backups. Losing the
  key makes the backup chain unrecoverable.

## Install a primary

Do not run this against a populated PostgreSQL data directory. Use an absent or
empty `-PgDataDir`. The installer creates the cluster with UTF-8 encoding, data
checksums and SCRAM authentication.

```powershell
$password = Read-Host -AsSecureString 'PostgreSQL bootstrap password (leave empty to generate)'
$params = @{
    InstallDir   = 'D:\Apps\TsaBonno\BarLocal'
    DataDir      = 'D:\TsaBonno\BarLocal'
    PgBin        = 'C:\Program Files\PostgreSQL\17\bin'
    PgDataDir    = 'D:\TsaBonno\PgData\BarLocal'
    DbPort       = 55432
    HttpHost     = '10.0.0.20'
    HttpPort     = 8787
    TlsCertFile  = 'C:\Certs\bar-local.crt'
    TlsKeyFile   = 'C:\Certs\bar-local.key'
    BackupDir    = 'E:\BarBackups'
    AllowedOrigins = 'https://bar.example.local'
    InitDb       = $true
}
# Omit -BootstrapPassword to generate and store one under DataDir\secrets.
.\install-server.ps1 @params
```

Notes:

- `DbPort` must not be 5432. The service and pairing clients use the HTTP port, not
  PostgreSQL.
- `DbListenAddresses` defaults to `localhost`. PostgreSQL is not exposed to the LAN
  by default. Pass a reviewed address list only when replication requires it.
- `AllowedCidrs` defaults to private ranges, but private-LAN PostgreSQL access is
  enabled only when PostgreSQL TLS is available. If no TLS is supplied, the
  installer clears `AllowedCidrs` and keeps PostgreSQL loopback-only.
- The HTTP firewall rule is created only for a non-loopback bind and only for the
  Private profile and local subnet. Open the PostgreSQL port manually only for the
  standby host.
- The setup secret is written to `DataDir\setup-secret.txt`. The installer reports
  the path, never the secret value. Give it to the owner through the approved
  commissioning process.
- The bootstrap password is stored in
  `DataDir\secrets\postgres-bootstrap.txt`, readable by administrators only. The
  replication password is stored in
  `DataDir\secrets\replication-password.txt`, also administrators only.
- The service runs as `NT AUTHORITY\LocalService` by default. A dedicated account
  requires a password:

  ```powershell
  $servicePassword = Read-Host -AsSecureString 'Service account password'
  .\install-server.ps1 @params -ServiceAccount 'DOMAIN\svc-bar-local' -ServiceAccountPassword $servicePassword
  ```

  The account needs the "Log on as a service" right; the script grants it.
  Prefer the built-in service accounts. A dedicated account password is passed to
  the Windows service manager during installation and is not written to logs, but
  avoid shared or audited process-argument capture on the install host. Both
  `-ServiceAccount` and `-PgServiceAccount` must resolve on the host before the
  installer changes ACLs; service-scoped virtual accounts are not qualified here.

Useful staged-install switches: `-SkipServiceStart`, `-SkipBackupTask`,
`-SkipFirewall`, `-Upgrade`.

### Installed files and permissions

- Application: `-InstallDir` (read/execute for the service account).
- Service environment: `%ProgramData%\Tsa Bonno\BarLocal\service.env`
  (read for the service account, full control for administrators).
- Logs: `%ProgramData%\Tsa Bonno\BarLocal\logs`.
- Service data: `-DataDir` (read/traverse for the service account, with modify on
  `DataDir\temp` only). Secret files are protected individually.
- Backups: `-BackupDir` (modify for the service and backup task account).
- PostgreSQL data: `-PgDataDir` (full control for the PostgreSQL service account
  only, plus administrators and SYSTEM).

Path arguments must be dedicated directories, not drive or UNC share roots, the
Windows directory, or the protected operating-system/profile roots. Service,
data, PostgreSQL and backup paths must not be nested inside one another where a
copy, uninstall or retention operation could reach the wrong files.

Do not hand-edit `service.env` or secret files. Re-run the reviewed installer for
configuration changes and use a reviewed credential-rotation procedure.

## Upgrade

Offline package validation and staged application use the service-side
`bar-operations.mjs check-update` and `apply-update` commands. Before running
either command, configure `BAR_LOCAL_UPDATE_TRUST_KEY_ID` and
`BAR_LOCAL_UPDATE_TRUST_PUBLIC_KEY_FILE` in the trusted operator environment;
the latter points to the release authority's pinned Ed25519 public key in PEM
format. The private signing key must stay with the release authority and must
never be copied to the Bar host. If either setting is absent, malformed, or
does not match the package signature, validation and application fail closed.

The manifest signature is Ed25519 over the 32-byte SHA-256 digest of its
canonical JSON payload with `signature.value` replaced by an empty string.
Object keys are sorted recursively before hashing. This avoids signing a
manifest that contains its own signature. The package's raw manifest checksum
is still recorded separately for package identity. Keep using the explicit
checkpoint requirement and the reviewed maintenance procedure; this does not
enable automatic downloads or install from the till UI.

1. Create a fresh encrypted backup and verify its manifest.
2. Run the installer with the same paths and `-Upgrade`.
3. The installer validates the provision marker, applied migration checksums and
   data directory binding before changing roles or migrations.
4. It refuses a downgrade, a checksum mismatch, a different data directory, a test
   database or a schema without a readable `schema_migrations` table.

## Backup and restore

The scheduled task `BarLocalBackup` runs a full encrypted backup every hour,
daily at 02:00 local time, and at startup, using `run-backup.ps1`. It reads
`service.env` at run time and never stores a password or key in the task
arguments. Hourly full backups provide local recovery points only; they are not
WAL archiving, point-in-time recovery, or an independent off-host copy. Set up
and verify a separate off-host copy before relying on this host for recovery.

Manual run:

```powershell
.\run-backup.ps1 `
    -InstallDir 'D:\Apps\TsaBonno\BarLocal' `
    -DataDir 'D:\TsaBonno\BarLocal' `
    -RetentionHourly 24 -RetentionDaily 7 -RetentionWeekly 4
```

Retention defaults are 24 hourly, 7 daily and 4 weekly. Backups are encrypted. Copy
the encrypted packages off the host, but never copy the key file with them.

The task runs as the Bar service account. A non-built-in account without a stored
password runs with S4U, which has no network credentials; use a local backup
destination or a destination that account can reach. The destination must be a
local or mounted path because the installer applies NTFS permissions to it.

Restore is a separate, destructive-adjacent operation. Use the existing
`scripts/bar-operations.mjs verify-restore` against a **new empty test database**
only. Do not restore over the live `bar_local` database. The command requires
`BAR_LOCAL_TEST_DB=1`, an explicit `--authorized-by`, a `--reason`, a matching
`--confirm-database` and an empty target. See the service operations documentation
for the full restore contract.

## Enrol a standby

The standby must be a separate host in normal operation. `pg_basebackup -R` copies
the primary's `postgresql.conf`, including its port, so a standby on the same host
will conflict with the primary port. Keep the standby's PostgreSQL service
running, but never start the Bar application service there before promotion.

Prerequisites on the standby host:

- PostgreSQL 17 binaries installed.
- An empty or absent standby data directory.
- The primary's `bar_local_replicator` role and replication password.
- A protected copy of the primary bootstrap password for standby verification, or
  a temporary protected file supplied with `-StandbyAdminPasswordFile`.
- Network access to the primary PostgreSQL port.
- TLS certificate/key paths that exist on the standby. The copied configuration may
  still point at the primary's paths; correct them before relying on a restart.
- The standby's own firewall rule, restricted to the primary/management hosts.

A standby host does not need the primary `service.env`. If the file is absent,
pass `-PgBin`, `-ReplicationPasswordFile`, `-StandbyAdminPasswordFile` and, when
needed, `-NodePath` explicitly.

Run on the standby host, elevated:

```powershell
.\enroll-standby.ps1 `
    -PrimaryHost '10.0.0.20' `
    -PrimaryPort 55432 `
    -StandbyDataDir 'D:\TsaBonno\PgData\Standby' `
    -PgBin 'C:\Program Files\PostgreSQL\17\bin' `
    -InstallDir 'D:\Apps\TsaBonno\BarLocal' `
    -Confirm
```

If the primary is on a private address, also pass `-AllowPrivatePrimary`. The
script:

1. Calls the existing `scripts/bar-replication.mjs enroll` with the protected
   replication password.
2. Verifies `pg_is_in_recovery()` and a streaming WAL receiver.
3. Writes a protected `replication.pgpass` and adds its `passfile` to
   `primary_conninfo`, so streaming survives a restart without a password in
   `postgresql.auto.conf`.
4. Optionally registers the standby PostgreSQL Windows service with
   `-RegisterPgService -PgServiceName BarLocalPostgreSQLStandby`.

If `-RegisterPgService` is omitted, PostgreSQL is started by `pg_ctl` and will not
start automatically after reboot. The script never installs or starts the Bar
application service on the standby and never edits `service.env`.

A standby is not a writable authority. It is not visible to clients until a
reviewed switchover is complete.

Standby enrolment copies the PostgreSQL cluster only. It does not copy the Bar
application, `service.env`, the setup secret, the backup key or TLS files to the
standby host. Before relying on a switchover, stage a stopped Bar service and the
matching protected application configuration on the standby under a separate
reviewed procedure. The database promotion alone is not a complete application
failover.

## Manual switchover

Switchover is manual and fail-closed. It is **not** automatic failover. The
existing contract fences the old primary through PostgreSQL SQL by setting
`default_transaction_read_only=on`, terminates Bar service sessions on that
database, verifies no service writers remain, and only then promotes the standby.
If the old primary cannot be fenced, promotion is refused.

Both administrative URLs must be loopback because the service refuses remote
administrative targets. Run the command on a host that has local tunnels or
proxies to both clusters if they are on different machines. If the management host
has no `service.env`, pass `-NodePath`, `-PrimaryAdminPasswordFile` and
`-StandbyAdminPasswordFile` explicitly; both files must be protected copies of the
bootstrap password.

Preflight without changing anything:

```powershell
.\switchover.ps1 `
    -PrimaryPort 55432 `
    -StandbyPort 55432 `
    -PrimaryAdminPort 15432 `
    -StandbyAdminPort 25432 `
    -InstallDir 'D:\Apps\TsaBonno\BarLocal' `
    -DryRun
```

The preflight requires a writable primary, a standby in recovery, a streaming WAL
receiver and at least one caught-up standby. It prints LSN and lag evidence.

Perform the switchover:

```powershell
.\switchover.ps1 `
    -PrimaryPort 55432 `
    -StandbyPort 55432 `
    -PrimaryAdminPort 15432 `
    -StandbyAdminPort 25432 `
    -InstallDir 'D:\Apps\TsaBonno\BarLocal' `
    -ConfirmText SWITCHOVER `
    -Reason 'Planned maintenance on primary host' `
    -StopLocalBarService
```

`-StopLocalBarService` stops only the named service on the machine running the
switchover command. It does not reach a remote old primary.

After a successful promotion:

1. Keep the old primary stopped or read-only. Do not start the Bar service there.
2. Start the Bar service on the promoted host only after confirming local TLS,
   PostgreSQL, firewall and staged `service.env`/secret paths.
3. Repoint Bar clients and Manager PWA/desktop configuration to the promoted host.
4. Rebuild the old primary as a standby under a separate reviewed procedure before
   treating it as redundancy.

The switchover script never rewrites `service.env` or client configuration, and it
does not remove the old primary's data. If the report says `fence_failed`, no
promotion was attempted: do not redirect clients. If it says
`fenced_no_promotion`, the old primary is read-only but the standby was not
promoted: do not redirect clients; recover under a reviewed procedure.

## Operate the services

```powershell
Get-Service BarLocalService, BarLocalPostgreSQL
Start-Service BarLocalService
Stop-Service BarLocalService
```

Logs:

- `%ProgramData%\Tsa Bonno\BarLocal\logs\service.log`
- `%ProgramData%\Tsa Bonno\BarLocal\logs\stdout.log`
- `%ProgramData%\Tsa Bonno\BarLocal\logs\stderr.log`
- `%ProgramData%\Tsa Bonno\BarLocal\logs\backup.log`
- Windows Application event log source `BarLocalService`, when registration
  succeeded.

Useful diagnostics:

```powershell
& 'C:\Program Files\PostgreSQL\17\bin\pg_isready.exe' -h 127.0.0.1 -p 55432
Get-NetTCPConnection -LocalPort 8787, 55432 -ErrorAction SilentlyContinue
Get-WinEvent -LogName Application -MaxEvents 50 |
    Where-Object ProviderName -eq 'BarLocalService'
```

## Uninstall

`uninstall-service.ps1` removes the Bar service and optionally the backup task. It
preserves data, PostgreSQL and backups by default.

```powershell
.\uninstall-service.ps1 `
    -InstallDir 'D:\Apps\TsaBonno\BarLocal' `
    -DataDir 'D:\TsaBonno\BarLocal' `
    -RemoveBackupTask
```

`-RemoveInstall` removes the application directory. `-PurgeData` removes service
data and logs and requires a separate confirmation; it never deletes the PostgreSQL
data directory or backup destination. Stop and remove the PostgreSQL service
separately under a reviewed procedure.

## Release gates

The following must be executed and evidenced on the target hardware before customer
commissioning. They are not covered by source checks:

- Install, start, stop, restart and reboot of the Bar Windows service under the
  chosen account, including logon rights, file ACLs and event log source.
- PostgreSQL 17 `initdb`, SCRAM authentication, service registration, restart and
  `pg_hba`/`postgresql.conf` validation with the service running.
- HTTP TLS certificate/key loading and client trust; PostgreSQL TLS for any
  private-LAN connection.
- Firewall behaviour for HTTP and for the standby PostgreSQL port.
- Scheduled backup execution, encrypted package creation, manifest verification,
  retention, off-host copying and a full restore into an empty test database.
- `pg_basebackup` enrollment, restart-safe passfile streaming, catch-up, fencing,
  promotion and post-promotion client repoint.
- Credential rotation, setup-secret handover and recovery from a lost or expired
  certificate.
- Least-privilege review of the service account, backup task and secret ACLs.

## Customer documentation impact

This packaging changes the operator-facing Bar installation, backup, standby and
switchover workflow. Before release, update the approved Bar manual, quick-start,
relevant screenshots and documentation evidence, and verify that the approved
guides are packaged with the `hospitality-pos` application and can be opened and
saved offline by ordinary authenticated Bar users. Keep internal signing,
deployment, Accounting activation mechanics and unrelated product guidance out of
customer PDFs.
