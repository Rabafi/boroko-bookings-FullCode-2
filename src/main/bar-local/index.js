// @ts-check

/**
 * Modern Electron Bar-local client adapter.
 *
 * This module is the only public entry point for the main process. It is
 * deliberately self-contained: it has no renderer access, no raw SQL/RPC
 * passthrough, no Supabase client and no dependency on the application
 * `database.js` facade.
 *
 * Authority is always explicit. A committed `cloud` configuration never
 * creates a local client and is never silently replaced by `bar_local`; a
 * committed `bar_local` configuration never falls back to Supabase. Every
 * financial command is journalled with a stable operation id before dispatch
 * and is replayed with that same id until the local service returns an
 * authoritative receipt or a terminal refusal.
 */

import {
  AUTHORITY_MODES,
  BarLocalAdapterError,
  createAuthorityRouter,
  createIdentityMapping
} from './authority.js'
import { openIntentJournal } from './intents.js'
import {
  BarLocalClient,
  createHttpTransport,
  createMemoryDeviceCredentialStore
} from './client.js'

export * from './authority.js'
export * from './intents.js'
export * from './catalogue.js'
export * from './client.js'

export const MODERN_BAR_LOCAL_ADAPTER_VERSION = 1

/**
 * @typedef {Object} ModernBarLocalAdapterOptions
 * @property {import('./authority.js').AuthorityConfig} [authority]
 * @property {import('./authority.js').AuthorityConfig} [authority_config]
 * @property {ReturnType<typeof createAuthorityRouter>} [router]
 * @property {ReturnType<typeof openIntentJournal>} [journal]
 * @property {{ filePath?: string, fsync?: boolean, clock?: () => Date, protection?: {encrypt(text: string): string, decrypt(text: string): string} }} [journal_options]
 * @property {import('./authority.js').IdentityMappingConfig} [identity]
 * @property {ReturnType<typeof createMemoryDeviceCredentialStore>} [device_store]
 * @property {ReturnType<typeof createMemoryDeviceCredentialStore>} [deviceStore]
 * @property {{ device_id: string, device_token: string, label?: string|null }} [device_credential]
 * @property {ReturnType<typeof createHttpTransport>} [transport]
 * @property {{ info?: (record: Record<string, unknown>) => void, warn?: (record: Record<string, unknown>) => void, error?: (record: Record<string, unknown>) => void }|null} [logger]
 * @property {() => Date} [clock]
 * @property {number} [request_timeout_ms]
 * @property {number} [connect_timeout_ms]
 */

/**
 * Composes the authority router, durable intent journal, identity mapping and
 * local client. Cloud installations intentionally receive `client: null`;
 * callers must keep using the existing cloud path unchanged.
 * @param {ModernBarLocalAdapterOptions} [options]
 */
export function createModernBarLocalAdapter(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'Modern Bar-local adapter options must be an object.')
  }
  const clock = options.clock ?? (() => new Date())
  const router = options.router ?? createAuthorityRouter(options.authority_config ?? options.authority)
  const journal = options.journal ?? openIntentJournal({
    ...(options.journal_options ?? {}),
    clock
  })
  const identity = options.identity === undefined || options.identity === null
    ? null
    : createIdentityMapping(options.identity)
  const deviceStore = options.device_store
    ?? options.deviceStore
    ?? createMemoryDeviceCredentialStore(options.device_credential ?? null)
  const hasExplicitTransport = options.transport !== undefined && options.transport !== null
  const client = router.mode === AUTHORITY_MODES.BAR_LOCAL || hasExplicitTransport
    ? new BarLocalClient({
        router,
        transport: options.transport,
        journal,
        device_store: deviceStore,
        identity,
        logger: options.logger ?? null,
        clock,
        request_timeout_ms: options.request_timeout_ms,
        connect_timeout_ms: options.connect_timeout_ms
      })
    : null

  return Object.freeze({
    version: MODERN_BAR_LOCAL_ADAPTER_VERSION,
    authority_mode: router.mode,
    router,
    identity,
    journal,
    device_store: deviceStore,
    client,
    /** @returns {BarLocalClient} */
    requireClient() {
      if (client === null) {
        throw new BarLocalAdapterError(
          'WRONG_AUTHORITY',
          'This installation is committed to cloud authority; there is no local Bar client.'
        )
      }
      return client
    },
    describe() {
      return Object.freeze({
        version: MODERN_BAR_LOCAL_ADAPTER_VERSION,
        authority: router.describe(),
        identity: identity === null
          ? null
          : Object.freeze({ business_id: identity.business_id, lodge_id: identity.lodge_id }),
        journal_records: journal.size,
        has_local_client: client !== null
      })
    },
    close() {
      if (client !== null) {
        client.close()
        return
      }
      journal.close()
    }
  })
}
