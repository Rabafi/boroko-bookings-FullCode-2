/**
 * Explicit per-tab read decisions for restaurant workspaces.
 *
 * A tab mounts only when BOTH hold:
 * 1. its commercial feature is not explicitly disabled in the resolved
 *    features map (force-off aware; an empty/unknown map never blocks), and
 * 2. the operator snapshot carries at least one of the tab's read
 *    capabilities. A missing capability context fails closed.
 *
 * Action capabilities (posting, approving, paying) stay enforced inside the
 * child components and on the server; this contract governs mounting/reads.
 */
import { canAccessCapability } from './accessControl.js'

// Read capability per workspace tab. Mirrors the lodge-side tab contract;
// floor/kitchen/menu tabs already carry their own `capability` field, which
// takes precedence when no map entry exists.
export const WORKSPACE_TAB_CAPABILITIES = Object.freeze({
  'finance:overview': ['reports.view'],
  'finance:cashups': ['pos.cashup'],
  'finance:sales': ['reports.view'],
  'finance:settlements': ['reports.view'],
  'finance:customer-funds': ['pos.manage'],
  'finance:expenses': ['expenses.view'],
  'finance:tips': ['staff.view'],
  'finance:daily-close': ['reports.view'],
  'finance:owner-review': ['reports.view'],
  'stock:stock': ['inventory.view'],
  'stock:purchasing': ['inventory.manage'],
  'stock:suggestions': ['inventory.view'],
  'stock:lots': ['inventory.manage'],
  'team:shifts': ['pos.manage'],
  'team:roster': ['staff.view'],
  'team:performance': ['reports.view'],
  'team:tips': ['staff.view'],
  'control:checklists': ['pos.manage'],
  'control:alerts': ['reports.view'],
  'control:feedback': ['pos.manage'],
  'control:policies': ['pos.manage']
})

export function getTabCapabilities(workspace, tab = {}) {
  const mapped = WORKSPACE_TAB_CAPABILITIES[`${workspace}:${tab.key}`]
  if (Array.isArray(mapped) && mapped.length > 0) return [...mapped]
  if (Array.isArray(tab.capabilities) && tab.capabilities.length > 0) return [...tab.capabilities]
  if (tab.capability) return [tab.capability]
  return []
}

export function getTabDecision(workspace, tab = {}, { access = null, features = {} } = {}) {
  const feature = tab.feature
  if (feature && features && Object.keys(features).length > 0 && features[feature] === false) {
    return { allowed: false, reason: 'commercial' }
  }
  const required = getTabCapabilities(workspace, tab)
  if (required.length > 0 && !required.some((capability) => canAccessCapability(access, capability))) {
    return { allowed: false, reason: access ? 'capability' : 'no-capability-context' }
  }
  return { allowed: true, reason: null }
}

export function getVisibleWorkspaceTabs(workspace, tabs = [], context = {}) {
  return (Array.isArray(tabs) ? tabs : []).filter((tab) => getTabDecision(workspace, tab, context).allowed)
}

/**
 * Resolve the active tab against the SAME visible set used for navigation.
 * Unknown or denied `?tab=` selections resolve to an explicit denial (never
 * a silent switch, never the protected component).
 */
export function resolveWorkspaceTab(workspace, tabs = [], requestedKey = null, defaultKey = null, context = {}) {
  const list = Array.isArray(tabs) ? tabs : []
  const visible = getVisibleWorkspaceTabs(workspace, list, context)
  const requested = requestedKey ? list.find((tab) => tab.key === requestedKey) : null
  if (requested) {
    const decision = getTabDecision(workspace, requested, context)
    if (decision.allowed) return { tab: requested, visible, denied: null }
    return { tab: null, visible, denied: { tab: requested, reason: decision.reason } }
  }
  const fallback = (defaultKey ? visible.find((tab) => tab.key === defaultKey) : null) || visible[0] || null
  return { tab: fallback, visible, denied: null }
}

const OUTLET_SCOPE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export function sanitizeOutletScope(value) {
  const text = String(value || '').trim()
  return OUTLET_SCOPE_PATTERN.test(text) ? text : null
}
