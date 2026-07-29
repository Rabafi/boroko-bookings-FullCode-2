import { Lock, Mail, MessageCircle, Sparkles, TrendingUp } from 'lucide-react'
import { Modal } from './Modal'
import {
  buildUpgradeRequestMessage,
  getNextSubscriptionPlan,
  getPlanUpsell,
  formatPlanLimits,
  getSubscriptionPlan,
  isUnlimited,
  trackUpgradeIntent
} from '../../../../shared/subscriptionPlans'
import { getCommercialPackageLabel } from '../../../../shared/commercialPackages'
import { getProductDefinition, getRuntimeProductId } from '../../../../shared/productIdentity'

const BUILD_PRODUCT = getProductDefinition(getRuntimeProductId())
const IS_CAPACITYLESS_PRODUCT = BUILD_PRODUCT.id === 'hotel' || BUILD_PRODUCT.id === 'hospitality-pos'

export default function UsageUpgradePrompt({
  open = false,
  onClose,
  onUpgrade,
  resourceLabel = 'capacity',
  currentPlan = 'Starter',
  used = 0,
  limit = null,
  grace = 0,
  status = null,
  message = '',
  lodgeName = '',
  lodgeId = '',
  usage = null,
  recommendation = null,
  onRequestUpgrade,
  trigger = 'modal'
} = {}) {
  if (!open) return null

  const internalNextPlan = getNextSubscriptionPlan(currentPlan)
  const nextPlan = !IS_CAPACITYLESS_PRODUCT && internalNextPlan !== 'Enterprise' ? internalNextPlan : null
  const nextPlanMeta = getSubscriptionPlan(nextPlan || currentPlan)
  const upsell = nextPlan ? getPlanUpsell(currentPlan) : null
  const currentLimits = IS_CAPACITYLESS_PRODUCT ? null : formatPlanLimits(currentPlan)
  const nextLimits = IS_CAPACITYLESS_PRODUCT || !nextPlan ? null : formatPlanLimits(nextPlan)
  const requestContext = buildUpgradeRequestMessage(
    { lodgeName, currentPlan },
    usage || { bookings: used, rooms: 0, users: 0 },
    recommendation || { recommendedPlan: nextPlan || currentPlan },
    { channel: 'whatsapp' }
  )
  const usageText = isUnlimited(limit)
    ? 'Unlimited access'
    : `${used} / ${limit}${grace ? ` (+${grace} grace)` : ''}`
  const blockedLabel = String(resourceLabel || 'capacity').toLowerCase().includes('staff')
    ? 'staff users'
    : String(resourceLabel || 'capacity').toLowerCase().includes('room')
      ? 'rooms'
      : String(resourceLabel || 'capacity').toLowerCase().includes('book')
        ? 'bookings'
        : 'records'
  const statusNote = status?.isBlocked
    ? `New ${blockedLabel} are currently blocked until you upgrade.`
    : status?.isInGrace
      ? `You’re using your grace allowance. New ${blockedLabel} will soon be blocked.`
      : ''
  const trackIntent = () => {
    trackUpgradeIntent({
      lodgeId,
      lodgeName,
      plan: currentPlan,
      usage: usage || { bookings: used, rooms: 0, users: 0 },
       recommendation: recommendation || { recommendedPlan: nextPlan || currentPlan },
      trigger
    })
  }
  const requestUpgrade = async () => {
    trackIntent()
    if (typeof onRequestUpgrade === 'function') {
      await onRequestUpgrade()
      return
    }

    const subject = requestContext.emailSubject
    const body = [
      requestContext.emailBody,
      '',
      message || 'Upgrade review requested from the app.'
    ].join('\n')
    const externalOpen = window.api?.shell?.openExternal
    if (typeof externalOpen === 'function') {
      await externalOpen(
        `mailto:support@boroko.io?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      ).catch(() => {})
    }
  }

  const requestWhatsApp = async () => {
    trackIntent()
    const externalOpen = window.api?.shell?.openExternal
    if (typeof externalOpen === 'function') {
      await externalOpen(
        `https://wa.me/?text=${encodeURIComponent(requestContext.whatsappText)}`
      ).catch(() => {})
    }
  }

  return (
    <Modal title={IS_CAPACITYLESS_PRODUCT ? 'Request package access' : 'Upgrade to keep creating records'} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <Lock size={15} /> {resourceLabel}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {message || (IS_CAPACITYLESS_PRODUCT
              ? `${resourceLabel} is controlled by your ${BUILD_PRODUCT.id === 'hotel' ? 'Hotel Core quotation' : 'commercial POS package'} and is not a LodgingOS capacity limit.`
              : `Current package: ${getCommercialPackageLabel(currentPlan, BUILD_PRODUCT.id)}. Upgrade to unlock more capacity.`)}
          </p>
          {IS_CAPACITYLESS_PRODUCT ? (
            <p className="mt-2 text-xs text-amber-700">
              {BUILD_PRODUCT.id === 'hotel'
                ? 'Hotel Core access is configured through the Hotel quotation and optional services.'
                : 'POS access is feature-bundle based: Service, Control, and Growth unlock different workflows.'}
            </p>
          ) : (
            <>
              <p className="mt-2 text-xs text-amber-700">
                Current package: {getCommercialPackageLabel(currentPlan, BUILD_PRODUCT.id)} · Usage: {usageText}
                {status?.isInGrace ? ` · Grace remaining: ${status.remainingGrace}` : ''}
              </p>
              {statusNote && <p className="mt-2 text-xs font-semibold text-amber-900">{statusNote}</p>}
              <p className="mt-1 text-xs text-amber-700">
                {currentLimits.bookings} · {currentLimits.rooms} · {currentLimits.users}
              </p>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
          {nextPlan ? (
            <>
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <TrendingUp size={15} /> Upgrade to {getCommercialPackageLabel(nextPlan, BUILD_PRODUCT.id)}
              </p>
              <p className="mt-1 text-sm text-slate-600">{nextPlanMeta.headline}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {upsell.capacities.map((item) => (
                  <span key={item} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                    {item}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {upsell.features.map((item) => (
                  <span key={item} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">
                    {item}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-600">
                Next package limits: {nextLimits.bookings} · {nextLimits.rooms} · {nextLimits.users}
              </p>
              <p className="mt-3 text-xs text-slate-500">
                {status?.isInGrace
                  ? 'A small grace allowance is active right now, but new record creation will stop once it is used up.'
                  : 'Open subscription access to request the next package for this property.'}
              </p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <TrendingUp size={15} /> Contact Tsa Bonno about the next fit
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {BUILD_PRODUCT.id === 'hotel'
                  ? 'Hotel Core is quoted as a separate product with optional services activated by quotation.'
                  : BUILD_PRODUCT.id === 'hospitality-pos'
                    ? 'Commercial POS packages are selected by feature bundle. Request Restaurant Service, Control, or Growth when you need more workflows.'
                    : `Pro is the highest ${BUILD_PRODUCT.shortName} package. If you need hotel-native operations, Tsa Bonno HotelOS is a separate product with quotation-based access.`}
              </p>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button type="button" onClick={onClose} className="btn-secondary w-full">
            Close
          </button>
          <button type="button" onClick={requestUpgrade} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
            <Mail size={15} /> Request Upgrade
          </button>
          <button type="button" onClick={requestWhatsApp} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 transition-colors hover:bg-green-100">
            <MessageCircle size={15} /> Request via WhatsApp
          </button>
          <button
            type="button"
            onClick={async () => {
              trackIntent()
              if (typeof onUpgrade === 'function') {
                await onUpgrade()
              }
            }}
            className="btn-primary w-full"
          >
            <Sparkles size={15} /> {IS_CAPACITYLESS_PRODUCT ? 'Request Package' : 'Upgrade Plan'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
