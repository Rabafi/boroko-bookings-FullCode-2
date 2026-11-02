import path from 'node:path'
import {
  LOCAL_BAR_SETUP_REQUEST_FILE,
  LOCAL_BAR_SETUP_REQUEST_VERSION,
  LOCAL_BAR_WORKSPACE_DIR,
  LOCAL_BAR_WORKSPACE_FLAG
} from '../../shared/barLocalWorkspace.js'

/**
 * Handoff of a brand-new local Bar from the ordinary cloud workspace into its
 * own workspace window.
 *
 * Only the business name and currency cross over. No cloud company id, user,
 * credential, customer record, queue entry or provider secret is copied, so the
 * local workspace cannot inherit or disturb the existing cloud business.
 */
export type NormalizedLocalBarSetupRequest = {
  business_name: string | null
  currency: string
  business_profile: Record<string, string>
  entry_mode: 'commission' | 'join'
}

export const DEFAULT_LOCAL_BAR_CURRENCY = 'BWP'

/** @param {unknown} request */
export function normalizeLocalBarSetupRequest(request: unknown): NormalizedLocalBarSetupRequest {
  const record: Record<string, unknown> = request && typeof request === 'object'
    ? request as Record<string, unknown>
    : {}
  const rawName = typeof record.business_name === 'string' ? record.business_name.trim().slice(0, 200) : ''
  const rawCurrency = typeof record.currency === 'string' ? record.currency.trim() : ''
  const currencyAliases: Record<string, string> = { P: 'BWP', R: 'ZAR', '$': 'USD', '€': 'EUR', '£': 'GBP', 'N$': 'NAD', ZK: 'ZMW' }
  const profile: Record<string, string> = {}
  for (const [key, max] of Object.entries({ company_name: 200, address: 240, city: 120, country: 120, phone: 80, email: 254, website: 240, vat_number: 80 })) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) profile[key] = value.trim().slice(0, max)
  }
  return {
    business_name: rawName.length > 0 ? rawName : null,
    currency: currencyAliases[rawCurrency.toUpperCase()] || (/^[A-Za-z]{3}$/.test(rawCurrency) ? rawCurrency.toUpperCase() : DEFAULT_LOCAL_BAR_CURRENCY),
    business_profile: profile,
    entry_mode: record.entry_mode === 'join' ? 'join' : 'commission'
  }
}

export function dedicatedWorkspaceRoot(userDataPath: string): string {
  return path.join(userDataPath, LOCAL_BAR_WORKSPACE_DIR)
}

export function dedicatedWorkspacePrefillPath(userDataPath: string): string {
  return path.join(dedicatedWorkspaceRoot(userDataPath), LOCAL_BAR_SETUP_REQUEST_FILE)
}

/** Durable prefill record read back by the dedicated window. */
export function buildWorkspacePrefill(
  request: NormalizedLocalBarSetupRequest,
  nowIso: string
): Record<string, unknown> {
  return {
    version: LOCAL_BAR_SETUP_REQUEST_VERSION,
    business_name: request.business_name,
    currency: request.currency,
    business_profile: request.business_profile,
    entry_mode: request.entry_mode,
    created_at: nowIso
  }
}

/**
 * Packaged builds relaunch the packaged executable; dev builds relaunch the
 * app entry point. Both open the same application in its dedicated profile.
 */
export function buildWorkspaceLaunchArguments(options: { isPackaged: boolean, appPath: string }): string[] {
  return options.isPackaged
    ? [LOCAL_BAR_WORKSPACE_FLAG]
    : [options.appPath, LOCAL_BAR_WORKSPACE_FLAG]
}

const SECRET_ENV = /^(BAR_LOCAL_|PG|SUPABASE_|DATABASE_URL$|ELECTRON_RUN_AS_NODE$|BOROKO_TEST_)/i

/**
 * The new window must not inherit a provider key, database URL or test database
 * flag from this process. It starts from the machine environment only.
 */
export function sanitizeWorkspaceEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { ...environment }
  for (const key of Object.keys(clean)) {
    if (SECRET_ENV.test(key)) delete clean[key]
  }
  return clean
}
