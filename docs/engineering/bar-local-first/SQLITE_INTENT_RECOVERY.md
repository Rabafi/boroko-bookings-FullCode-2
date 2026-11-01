# Modern local Bar saved-operation recovery

Date: 26 October 2026. Internal support guidance; implementation is not customer-ready.

The dedicated local PostgreSQL service owns sales, money, stock and audit truth. Modern SQLite stores this till's original operation envelopes and their recovery states. It is not a shared network database or a physical PostgreSQL replica. Legacy keeps its separate protected JSONL journal.

## Storage and migration

Files are under the Modern application's user-data `bar-local` directory: `authority.bin`, `device-credential.bin`, `intents.sqlite`, its available WAL/SHM sidecars, `intents.sqlite.initialized`, and any retained `intents.jsonl` archive. Protected authority profiles record `journal_storage: local_sqlite_v1`. Do not edit that pin or delete its marker to force migration again.

The original JSONL history is validated before a one-time import; complete original envelopes, IDs, revisions, hashes and protected credential frames are retained. A staging database is committed and checkpointed before publication. The archive is retained but is not updated afterwards and cannot be a fallback. Incomplete staging/initialization artifacts require review; do not treat them as a replacement journal.

## If trading is fenced

1. Stop submissions on the affected till. Preserve its original Windows account/profile and all original files. Do not create another transaction for a request with an uncertain outcome.
2. Confirm the expected local authority and original device identity. A missing profile, SQLite file, damaged frame, unsupported schema or unavailable OS protection must remain blocked; switching to cloud or re-pairing around unresolved work is unsafe.
3. For disk-full or competing-writer failures, repair capacity or close the competing instance first. A failed journal instance stays fenced. Restart/reopen through a controlled support process while preserving the original operation IDs; the ordinary unresolved-operation quit fence may require support intervention. A complete operator recovery/replacement UI remains pending.
4. Preserve a consistent stopped copy of the journal family for investigation. Do not copy an active SQLite file as if it were a valid backup, discard a WAL, combine files from different snapshots or restore a stale JSONL archive. Qualified online backup and replacement-host tooling remain release gates.
5. Recover encrypted work through the original Windows profile/OS secure storage. Portable new-PC credential recovery is not established by copying the SQLite file. Never print decrypted PINs, credentials or entire journal payloads into diagnostics.
6. Reconcile original operation IDs against the authoritative service. A committed receipt resolves that same operation; a pending or uncertain operation retains its original key. An older backup may omit newer operations, so check authoritative device/audit history before resuming. Reopening a consistent file is not proof that its backup is current.

## Executed checks and limits

`test:bar-local-storage` covers durable revisions, exclusive ownership, corruption, failed imports, credential protection and selected process deaths. `test:bar-local-electron` includes actual startup/setup/pairing integration and protected-profile no-fallback guards. The real HTTP/DB recovery fixture uses Modern SQLite plus the Legacy client. `test:bar-local-storage:electron` bundles the production module, exercises actual Electron/OS protection on the development PC and reopens the same protected operation in a separate main process.

These checks do not qualify customer installation, replacement/upgrade tooling, every Windows version, physical power loss, peripherals, two/six-device topology, automatic coordinator/failover or all acceptance cases. Customer guides and packaged-guide checks remain deferred release gates. Hosted Supabase ingestion remains disabled.
