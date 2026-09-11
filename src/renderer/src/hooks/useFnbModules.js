import { useCallback, useEffect, useMemo, useState } from 'react'
import { normalizeFnbPreferences } from '../../../shared/fnbModules.js'

/**
 * Shared F&B module preference state.
 * - Online, server-confirmed activation only. Offline keeps the last
 *   confirmed state and surfaces a retry message.
 * - Never infers entitlement from the toggle; the server row carries
 *   enabled/entitled/can_manage/reason/version.
 */
export function useFnbModules() {
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState('')
  const [updatingKey, setUpdatingKey] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const cached = await window.api?.fnb?.getCachedModulePreferences?.().catch(() => []) || []
      if (Array.isArray(cached) && cached.length > 0 && modules.length === 0) {
        setModules(cached)
      }
    } catch {
      // Cache is best-effort.
    }
    try {
      const result = await window.api?.fnb?.getModulePreferences?.()
      const rows = Array.isArray(result?.modules) ? result.modules : []
      setModules(rows)
      setOffline(Boolean(result?.offline))
      if (result?.success === false) setError(result?.error || 'Module settings are unavailable.')
    } catch (e) {
      setError(e?.message || 'Module settings are unavailable. Reconnect and retry.')
      try {
        const cached = await window.api?.fnb?.getCachedModulePreferences?.().catch(() => []) || []
        if (Array.isArray(cached) && cached.length > 0) {
          setModules(cached)
          setOffline(true)
          setError('You are offline. Showing the last confirmed module settings.')
        }
      } catch {
        // Keep the explicit error.
      }
    } finally {
      setLoading(false)
    }
  }, [modules.length])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (cancelled) return
      await load()
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const preferenceMap = useMemo(() => normalizeFnbPreferences(modules), [modules])

  const setPreference = useCallback(async (moduleKey, enabled, expectedVersion) => {
    setUpdatingKey(moduleKey)
    setError('')
    try {
      const result = await window.api?.fnb?.setModulePreference?.(moduleKey, enabled, expectedVersion ?? null)
      if (!result || result.success === false) {
        const err = new Error(result?.error || 'Could not update the module.')
        err.code = result?.code
        err.blockers = result?.blockers
        err.server_version = result?.server_version
        throw err
      }
      await load()
      return result
    } catch (e) {
      setError(e?.message || 'Could not update the module.')
      throw e
    } finally {
      setUpdatingKey(null)
    }
  }, [load])

  return { modules, preferenceMap, loading, offline, error, updatingKey, reload: load, setPreference }
}
