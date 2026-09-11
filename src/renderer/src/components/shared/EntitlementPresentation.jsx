import { useMemo } from 'react'
import { ArrowRight, CheckCircle2, Clock3, LockKeyhole, Sparkles, UsersRound } from 'lucide-react'
import {
  FEATURE_LABELS
} from '../../../../shared/accessControl.js'
import {
  getFeatureRequiredPlan,
  normalizeSubscriptionPlan,
  SUBSCRIPTION_PLAN_ORDER
} from '../../../../shared/subscriptionPlans.js'
import {
  getCommercialPackageDisplayName,
  getCommercialPackageForKey
} from '../../../../shared/commercialPackages.js'
import { getModuleByKey } from '../../../../shared/moduleCatalog.js'
import { calculateTrialToPaidImpact } from '../../../../shared/trialImpact.js'
import { getUpgradeShowcaseCopy } from '../../../../shared/upgradeShowcaseContent.js'

/**
 * Trial presentation is deliberately renderer-only. Entitlements remain
 * authoritative in the main process/server; this file only explains the
 * outcome an operator should expect after selecting a paid package.
 */
export function isTrialEntitlement(entitlement) {
  return String(entitlement?.status || '').trim().toLowerCase() === 'trial'
}

function firstValue(...values) {
  return values.find((value) => value !== null && value !== undefined && String(value).trim() !== '') || null
}

/**
 * Accepts the future server fields without making the UI dependent on them.
 * Until a target is stored server-side, callers can provide selectedTargetPlan
 * from the Subscription & Access chooser.
 */
export function getTrialTargetPlan({ entitlement = {}, selectedTargetPlan = null, fallback = null } = {}) {
  const explicitPlan = firstValue(
    selectedTargetPlan,
    entitlement.post_trial_plan,
    entitlement.trial_target_plan,
    entitlement.target_plan,
    entitlement.selected_plan,
    entitlement.postTrialPlan,
    entitlement.trialTargetPlan
  )
  return explicitPlan ? normalizeSubscriptionPlan(explicitPlan) : (fallback ? normalizeSubscriptionPlan(fallback) : null)
}

export function getTrialTargetPackage({
  entitlement = {},
  selectedTargetPlan = null,
  selectedTargetPackage = null,
  productId,
  fallback = null
} = {}) {
  if (selectedTargetPackage && typeof selectedTargetPackage === 'object') return selectedTargetPackage

  const packageKey = firstValue(
    entitlement.post_trial_commercial_package_key,
    entitlement.trial_target_package_key,
    entitlement.target_commercial_package_key,
    entitlement.selected_commercial_package_key,
    entitlement.postTrialCommercialPackageKey,
    entitlement.trialTargetPackageKey
  )
  if (packageKey) {
    const packageForKey = getCommercialPackageForKey(packageKey, productId)
    if (packageForKey) return packageForKey
  }

  const targetPlan = getTrialTargetPlan({ entitlement, selectedTargetPlan, fallback })
  return targetPlan ? getCommercialPackageForKey(String(targetPlan).toLowerCase(), productId) : null
}

export function getTrialCountdownLabel(entitlement = {}) {
  if (!isTrialEntitlement(entitlement)) return null
  const days = Number.isFinite(Number(entitlement.daysLeft)) ? Math.max(0, Number(entitlement.daysLeft)) : null
  if (days === null) return 'Trial active'
  return `${days} day${days === 1 ? '' : 's'} left in trial`
}

function requiredPlanForFeature(feature, explicitRequiredPlan = null) {
  const catalogModule = getModuleByKey(feature)
  return normalizeSubscriptionPlan(explicitRequiredPlan || catalogModule?.requiredPlan || getFeatureRequiredPlan(feature))
}

/**
 * Compact, trial-only label for a feature or sidebar page. Returning null for
 * every non-trial entitlement makes it impossible for paid customers to see
 * trial copy accidentally.
 */
export function TrialFeatureLabel({
  feature,
  requiredPlan = null,
  entitlement,
  selectedTargetPlan = null,
  compact = false
}) {
  if (!isTrialEntitlement(entitlement)) return null

  const required = requiredPlanForFeature(feature, requiredPlan)
  const target = getTrialTargetPlan({ entitlement, selectedTargetPlan, fallback: null })
  const requiredIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(required)
  const targetIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(target)
  const includedAfterTrial = target !== null && targetIndex >= requiredIndex
  const targetLabel = target
    ? getCommercialPackageDisplayName({ productId: entitlement.product_id, plan: target })
    : 'No paid package selected'
  const countdown = getTrialCountdownLabel(entitlement)

  if (compact) {
    return (
      <span
        data-testid="trial-feature-label"
        className="inline-flex shrink-0 items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
        title={`${required} is required after trial. Selected package: ${targetLabel}. ${countdown || ''}`}
      >
        {includedAfterTrial ? `${required} included` : `${required} after trial`}
      </span>
    )
  }

  return (
    <span
      data-testid="trial-feature-label"
      className="mt-2 inline-flex flex-wrap items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800"
    >
      <Clock3 size={12} className="shrink-0" />
      <span>{includedAfterTrial ? `${required} after trial` : `Requires ${required} after trial`}</span>
      <span className="font-medium text-amber-700">· {targetLabel} selected</span>
      {countdown && <span className="font-medium text-amber-700">· {countdown}</span>}
    </span>
  )
}

export function TrialStatusNotice({
  entitlement,
  selectedTargetPlan = null,
  selectedTargetPackage = null,
  productId,
  compact = false
}) {
  if (!isTrialEntitlement(entitlement)) return null

  const targetPackage = getTrialTargetPackage({
    entitlement,
    selectedTargetPlan,
    selectedTargetPackage,
    productId
  })
  const targetPlan = targetPackage?.internalPlan || getTrialTargetPlan({ entitlement, selectedTargetPlan, fallback: null })
  const targetLabel = targetPackage?.displayName || (targetPlan ? getCommercialPackageDisplayName({ productId, plan: targetPlan }) : 'No paid package selected')
  const countdown = getTrialCountdownLabel(entitlement)

  if (compact) {
    return (
      <div data-testid="trial-status-notice" className="rounded-2xl border border-amber-200 bg-amber-50/90 px-3 py-2.5 text-amber-950">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">
          <Sparkles size={12} /> Trial preview
        </div>
        <p className="mt-1 text-xs font-semibold">{countdown || 'Trial active'}</p>
        <p className="mt-0.5 text-[11px] text-amber-800">After trial: {targetLabel}{!targetPlan && ' · access pauses'}</p>
      </div>
    )
  }

  return (
    <div data-testid="trial-status-notice" className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-white backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold">
        <span className="inline-flex items-center gap-1.5"><Clock3 size={13} /> {countdown || 'Trial active'}</span>
        <span className="text-white/60">·</span>
        <span>Selected after trial: {targetLabel}</span>
      </div>
      <p className="mt-1 text-xs text-white/75">You have full access during the trial. We&apos;ll show exactly what changes before this date.</p>
    </div>
  )
}

/**
 * Trial-only capacity and feature preview. `usage` is intentionally a prop so
 * a future shared impact calculator can provide authoritative effective limits
 * without changing this presentation component.
 */
export function PostTrialImpactPreview({
  entitlement,
  targetPlan = null,
  targetPackage = null,
  usage = {},
  productId,
  propertyType = null,
  targetLimits = null,
  className = ''
}) {
  if (!isTrialEntitlement(entitlement)) return null

  const impact = useMemo(() => calculateTrialToPaidImpact({
    productId,
    trialEntitlement: entitlement,
    // A package object gives the preview its commercial label and overrides;
    // a plan-only prop remains a valid future/root integration contract.
    selectedTargetPackage: targetPackage || targetPlan || null,
    effectiveLimits: targetLimits,
    usage,
    propertyType: propertyType || usage.propertyType || usage.property_type || null,
    activePwaSessions: usage.activePwaSessions ?? usage.active_pwa_sessions,
    offlineQueueCounts: usage.offlineQueueCounts ?? usage.offline_queue_counts
  }), [entitlement, productId, propertyType, targetLimits, targetPackage, targetPlan, usage])
  const resolvedTarget = impact.targetPackage
  const targetLabel = resolvedTarget?.displayName || 'No paid package selected'
  const metrics = [
    { key: 'users', label: 'Active users', impact: impact.impacts?.users },
    { key: 'rooms', label: 'Rooms', impact: impact.impacts?.rooms },
    { key: 'bookings', label: 'Check-in-month bookings', impact: impact.impacts?.checkInMonthBookings }
  ]
  const impactedFeatures = impact.impacts?.featureLoss?.lostFeatures || []
  const aboveLimit = metrics.filter((metric) => ['needs_remediation', 'above_limit'].includes(metric.impact?.status))

  return (
    <section data-testid="post-trial-impact-preview" className={`rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-5 shadow-sm ${className}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-800">
            <Clock3 size={12} /> Trial-only preview
          </div>
          <h3 className="mt-3 text-lg font-bold text-slate-900">What changes after your trial?</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            {resolvedTarget
              ? <>Your selected package is <strong>{targetLabel}</strong>. The trial keeps every workspace open; this preview identifies anything that needs attention before activation.</>
              : <>No paid package is selected. Access pauses when the trial expires; choose a package below to preview the exact transition.</>}
          </p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-white/80 px-3 py-2 text-right text-xs text-amber-900">
          <p className="font-semibold">{getTrialCountdownLabel(entitlement) || 'Trial active'}</p>
          <p className="mt-1 text-[11px] text-amber-700">Target: {targetLabel}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.key} className={`rounded-2xl border bg-white/80 p-3 ${['needs_remediation', 'above_limit'].includes(metric.impact?.status) ? 'border-rose-200' : 'border-slate-200'}`}>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              {metric.key === 'users' ? <UsersRound size={14} className="text-amber-600" /> : <CheckCircle2 size={14} className="text-emerald-600" />}
              {metric.label}
            </div>
            <p className="mt-2 text-sm font-bold text-slate-900">
              {metric.impact?.status === 'not_evaluated' ? 'Select a paid package' : metric.impact?.copy || 'Usage preview unavailable'}
            </p>
            {['needs_remediation', 'above_limit'].includes(metric.impact?.status) && <p className="mt-1 text-xs font-medium text-rose-700">Action required before {targetLabel} can be activated.</p>}
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white/75 p-4">
          <h4 className="text-sm font-semibold text-slate-900">Capacity actions</h4>
          {!resolvedTarget ? (
            <p className="mt-2 text-sm text-amber-800">Select a paid package to evaluate capacity. Access pauses without an activated package.</p>
          ) : aboveLimit.length === 0 ? (
            <p className="mt-2 text-sm text-emerald-700">Your current usage fits within {targetLabel}.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              {aboveLimit.map((metric) => (
                <li key={metric.key} className="flex items-start gap-2"><LockKeyhole size={14} className="mt-0.5 shrink-0 text-rose-500" />
                  <span>{metric.impact?.copy || `${metric.label} needs attention before activation.`}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white/75 p-4">
          <h4 className="text-sm font-semibold text-slate-900">Features that need a higher package</h4>
          {!resolvedTarget ? (
            <p className="mt-2 text-sm text-amber-800">Select a paid package to preview which trial features would be locked.</p>
          ) : impactedFeatures.length === 0 ? (
            <p className="mt-2 text-sm text-emerald-700">Your selected package keeps all currently previewed features available.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {impactedFeatures.slice(0, 10).map((item) => (
                <span key={item.featureKey || item.key} className="rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-800">
                  {item.label}{item.requiredPlan ? ` · ${item.requiredPlan}` : ''}
                </span>
              ))}
              {impactedFeatures.length > 10 && <span className="px-1 py-1 text-xs text-slate-500">+{impactedFeatures.length - 10} more</span>}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white/70 p-3 text-xs leading-5 text-slate-600">
        <p className="font-semibold text-slate-800">{impact.remediation?.copy || 'Choose a package to see the transition plan.'}</p>
        <p className="mt-1">No operational or financial records are deleted by this preview. Any required user selection, package override, or activation approval will be shown as an explicit action.</p>
      </div>
    </section>
  )
}

/**
 * Route-level plan lock. This component intentionally accepts no children and
 * therefore never mounts a protected premium workspace while showing the
 * showcase. Role/permission denials are handled separately by CapabilityRoute.
 */
export function UpgradeShowcase({
  feature,
  requiredPlan = null,
  requiredPackage = null,
  currentPlan = 'Starter',
  productId,
  module = null,
  routePath = null,
  onRequestUpgrade = null
}) {
  const resolvedModule = module || getModuleByKey(feature)
  const required = requiredPlanForFeature(feature, requiredPlan)
  const showcase = useMemo(() => getUpgradeShowcaseCopy({
    feature,
    routePath,
    module: resolvedModule
  }), [feature, resolvedModule, routePath])
  const moduleLabel = showcase.title || resolvedModule?.label || FEATURE_LABELS[feature] || 'This workspace'
  const moduleDescription = showcase.description || resolvedModule?.description || `Explore ${moduleLabel.toLowerCase()} for this operation.`
  const currentLabel = getCommercialPackageDisplayName({ productId, plan: currentPlan })
  const requiredLabel = requiredPackage?.displayName || getCommercialPackageDisplayName({ productId, plan: required })
  const benefits = showcase.benefits

  const requestUpgrade = () => {
    if (typeof onRequestUpgrade === 'function') {
      onRequestUpgrade({ feature, requiredPlan: required, module: resolvedModule })
      return
    }
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams({
        tab: 'license',
        upgrade: '1',
        requestedPlan: required,
        feature: feature || ''
      })
      window.location.hash = `#/settings?${params.toString()}`
    }
  }

  return (
    <main data-testid="upgrade-showcase" data-lock-reason="plan" className="flex min-h-[560px] items-center justify-center p-5 sm:p-8">
      <section className="relative w-full max-w-4xl overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.14)]">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald-100/70 blur-3xl" />
        <div className="absolute -bottom-28 -left-16 h-64 w-64 rounded-full bg-purple-100/70 blur-3xl" />
        <div className="relative grid gap-8 p-6 sm:p-9 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.15em] text-purple-800">
              <LockKeyhole size={13} /> {requiredLabel} feature
            </div>
            <h1 className="mt-5 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Unlock {moduleLabel}</h1>
            <p data-testid="upgrade-showcase-description" className="mt-4 text-base leading-7 text-slate-600">{moduleDescription}</p>
            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-1.5 font-semibold">Current package: {currentLabel}</span>
              <ArrowRight size={14} />
              <span className="rounded-full bg-purple-100 px-3 py-1.5 font-semibold text-purple-800">Included in: {requiredLabel}</span>
            </div>
            <button type="button" onClick={requestUpgrade} className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-700/20 transition-colors hover:bg-emerald-800">
              <Sparkles size={16} /> Request upgrade <ArrowRight size={15} />
            </button>
            <p className="mt-3 text-xs text-slate-500">Your role permissions remain separate from package access. Upgrading does not change who can use this workspace.</p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-5 sm:p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Sparkles size={16} className="text-amber-500" /> What this workspace gives you</div>
            <div className="mt-4 space-y-3">
              {benefits.map((benefit) => (
                <div key={benefit} className="flex items-start gap-3 rounded-2xl border border-white bg-white/80 p-3 text-sm leading-6 text-slate-700 shadow-sm">
                  <CheckCircle2 size={16} className="mt-1 shrink-0 text-emerald-600" />
                  <span>{benefit}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-5 text-emerald-900">
              <p className="font-semibold">Your data stays protected</p>
              <p className="mt-1">This preview does not load or alter the locked workspace. Existing records remain safe while your package request is reviewed.</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
