import { ArrowUpCircle, Clock, Lock } from 'lucide-react'
import { getEnterpriseAddonByKey } from '../../../shared/enterpriseAddons'

export default function EnterpriseAddonPlaceholder({ addonKey }) {
  const addon = getEnterpriseAddonByKey(addonKey)
  const label = addon?.label || 'Enterprise add-on'
  const description = addon?.description || 'This add-on is available through Enterprise activation.'
  const status = addon?.status || 'planned'
  const requestable = status === 'requestable'

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Enterprise add-on</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{label}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className={`rounded-2xl p-3 ${requestable ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
            {requestable ? <ArrowUpCircle size={22} /> : <Clock size={22} />}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">
              {requestable ? 'Available by request' : 'Planned for a later rollout'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              This screen is a controlled placeholder. The add-on still requires explicit entitlement before operators can use it, and the production workflow should not be treated as complete until the add-on domain, database contract, permissions, and tests are implemented.
            </p>
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
              <Lock size={13} />
              Requires Enterprise add-on activation
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
