import { ArrowUpCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  getUpgradeNudgeCooldownState,
  markUpgradeNudgeShown,
  trackUpgradeIntent
} from '../../../../shared/subscriptionPlans'

export default function UpgradeNudgeBanner({
  visible = false,
  message = 'You’re approaching your plan limits. Consider upgrading to avoid interruptions.',
  onUpgrade,
  sessionKey = 'boroko:upgrade-nudge',
  className = '',
  lodgeId = '',
  lodgeName = '',
  plan = 'Starter',
  usage = {},
  recommendation = null,
  trigger = 'banner'
} = {}) {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!visible || typeof window === 'undefined') return
    try {
      const cooldown = getUpgradeNudgeCooldownState(sessionKey)
      if (!cooldown.allowed) {
        setDismissed(true)
        return
      }
      setDismissed(false)
      markUpgradeNudgeShown(sessionKey)
    } catch {
      // Local storage is best-effort only.
    }
  }, [sessionKey, visible])

  const handleUpgrade = async () => {
    trackUpgradeIntent({
      lodgeId,
      lodgeName,
      plan,
      usage,
      recommendation,
      trigger
    })
    if (typeof onUpgrade === 'function') {
      await onUpgrade()
    }
  }

  if (!visible || dismissed) return null

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 ${className}`}>
      <p className="text-sm font-medium text-amber-900">{message}</p>
      <div className="flex items-center gap-2">
        {typeof onUpgrade === 'function' && (
          <button
            type="button"
            onClick={handleUpgrade}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
          >
            <ArrowUpCircle size={14} />
            Upgrade Plan
          </button>
        )}
      </div>
    </div>
  )
}
