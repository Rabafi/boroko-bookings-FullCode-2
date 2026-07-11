import { useCallback, useState } from 'react'
import { Download, Send, CheckCircle, AlertTriangle, ArrowLeft } from 'lucide-react'
import { useSettings } from '../app-context'
import { computeEffectiveFeatures } from '../../../shared/entitlementMerge'
import { buildSubscriptionRequest, generateQuoteNumber, SUBSCRIPTION_REQUEST_TYPES, SUBSCRIPTION_REQUEST_STATUS } from '../../../shared/subscriptionRequest'
import { ENTERPRISE_ADDON_CATALOG } from '../../../shared/enterpriseAddons'
import { buildCommercialPricingSnapshot, buildSubscriptionCommercialDocument, formatCommercialMoney, getAdvertisedEnterpriseAddons, TRIAL_POLICY } from '../../../shared/commercialPackages'
import { SUBSCRIPTION_PLAN_ORDER, getSubscriptionPlan } from '../../../shared/subscriptionPlans'

export default function SubscriptionPackageBuilder() {
  const { settings } = useSettings()
  const [selectedPlan, setSelectedPlan] = useState('Enterprise')
  const [selectedAddons, setSelectedAddons] = useState([])
  const [roomCount, setRoomCount] = useState('')
  const [userCount, setUserCount] = useState('')
  const [expectedBookings, setExpectedBookings] = useState('')
  const [trialAlreadyUsed, setTrialAlreadyUsed] = useState(() => Boolean(settings?.trial_started_at))
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submittedQuote, setSubmittedQuote] = useState(null)
  const [error, setError] = useState('')

  const eligibleAddons = getAdvertisedEnterpriseAddons(settings?.property_type || settings?.business_type || 'lodge')

  const effectiveFeatures = computeEffectiveFeatures(settings?.subscription_plan || 'Starter', selectedAddons)

  const toggleAddon = (key) => {
    setSelectedAddons((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])
  }

  const buildRequest = useCallback((status = SUBSCRIPTION_REQUEST_STATUS.draft) => {
    const quoteNumber = generateQuoteNumber()
    const trialEligible = TRIAL_POLICY.appliesToPlans.includes(selectedPlan) && trialAlreadyUsed !== true
    const pricing = buildCommercialPricingSnapshot({
      plan: selectedPlan,
      addons: selectedAddons,
      roomCount: Number(roomCount) || 0,
      userCount: Number(userCount) || 0,
      trialEligible,
      trialAlreadyUsed
    })
    const request = buildSubscriptionRequest({
      source: 'desktop_app',
      request_type: SUBSCRIPTION_REQUEST_TYPES.plan_upgrade,
      lodge_id: settings?.lodge_id || null,
      company_name: settings?.company_name || settings?.lodge_name || '',
      property_name: settings?.lodge_name || '',
      contact_name: settings?.contact_name || '',
      contact_email: settings?.contact_email || '',
      contact_phone: settings?.contact_phone || '',
      country: settings?.country || '',
      property_type: settings?.property_type || settings?.business_type || 'lodge',
      current_plan: settings?.subscription_plan || 'Starter',
      requested_plan: selectedPlan,
      requested_addons: selectedAddons,
      room_count: Number(roomCount) || null,
      user_count: Number(userCount) || null,
      expected_monthly_bookings: Number(expectedBookings) || null,
      pricing_snapshot: pricing,
      notes: [
        notes,
        trialAlreadyUsed ? 'Client indicated this property has already used its free trial.' : 'Client indicated this property has not used its free trial.'
      ].filter(Boolean).join('\n')
    })
    request.quote_number = quoteNumber
    request.status = status
    return request
  }, [selectedPlan, selectedAddons, roomCount, userCount, expectedBookings, notes, settings, trialAlreadyUsed])

  const generateQuote = useCallback(async () => {
    const request = buildRequest(SUBSCRIPTION_REQUEST_STATUS.draft)
    const documentPayload = buildSubscriptionCommercialDocument(request, 'quote', {
      document_number: request.quote_number
    })
    try {
      const result = await window.api.subscriptionRequests.exportDocumentPdf(documentPayload)
      if (result?.success === false && !result?.canceled) throw new Error(result.error || 'PDF export failed')
    } catch {
    const lines = [
      `SUBSCRIPTION QUOTATION`,
        `Quote: ${request.quote_number}`,
      `Date: ${new Date().toLocaleDateString()}`,
      ``,
      `Property: ${request.property_name}`,
      `Current Plan: ${request.current_plan}`,
      `Requested Plan: ${request.requested_plan}`,
      ``,
      `Room Count: ${request.room_count || 'TBD'}`,
      `User Count: ${request.user_count || 'TBD'}`,
      `Expected Monthly Bookings: ${request.expected_monthly_bookings || 'TBD'}`,
      ``
    ]

    if (selectedAddons.length > 0) {
      lines.push(`ADD-ONS:`)
      for (const addonKey of selectedAddons) {
        const addon = ENTERPRISE_ADDON_CATALOG.find((a) => a.key === addonKey)
        lines.push(`  - ${addon?.label || addonKey}`)
      }
      lines.push(``)
    }

      lines.push(`PRICING:`)
      lines.push(`  Annual package: ${formatCommercialMoney(request.pricing_snapshot?.annual_subtotal)}`)
      lines.push(`  Due now: ${formatCommercialMoney(request.pricing_snapshot?.total_due_now)}`)
      lines.push(`  Trial: ${request.pricing_snapshot?.trial?.eligible ? `${TRIAL_POLICY.trialDays} days included once` : 'Not included / already used'}`)
      lines.push(``)
      lines.push(`FEATURES INCLUDED:`)
    for (const [feature, enabled] of Object.entries(effectiveFeatures)) {
      if (enabled) lines.push(`  ✓ ${feature.replace(/_/g, ' ')}`)
    }

    if (notes) { lines.push(``, `NOTES:`, notes) }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
      a.download = `${request.quote_number}.txt`
    a.click()
    URL.revokeObjectURL(url)
    }
  }, [buildRequest, selectedAddons, effectiveFeatures])

  const submitRequest = async () => {
    setSubmitting(true)
    setError('')
    try {
      const request = buildRequest(SUBSCRIPTION_REQUEST_STATUS.submitted)
      const documentPayload = buildSubscriptionCommercialDocument(request, 'quote', {
        document_number: request.quote_number
      })

      const result = await window.api.subscriptionRequests.submit(request)
      await window.api.subscriptionRequests.exportDocumentPdf(documentPayload).catch(() => null)
      setSubmittedQuote(result?.quote_number || request.quote_number)
      setSubmitted(true)
    } catch (err) {
      setError(err?.message || 'Failed to submit request')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="bb-page">
        <div className="bb-card flex flex-col items-center justify-center py-16 text-center">
          <CheckCircle size={48} className="mb-4 text-emerald-500" />
          <h2 className="text-lg font-bold text-slate-800">Request Submitted</h2>
          <p className="mt-2 max-w-md text-sm text-slate-500">
            Your subscription upgrade request has been submitted successfully.
          </p>
          {submittedQuote && (
            <p className="mt-2 text-xs font-mono text-slate-400">
              Reference: {submittedQuote}
            </p>
          )}
          <p className="mt-3 max-w-md text-xs text-slate-400">
            The quotation has been generated for your records and the same request has been sent to Boroko for review.
            Activation only happens after manual payment approval.
          </p>
          <button onClick={() => { setSubmitted(false); setSubmittedQuote(null) }} className="mt-6 btn-primary">
            Submit Another Request
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bb-page">
      <div className="bb-page-header">
        <div>
          <p className="bb-section-kicker">SUBSCRIPTION</p>
          <h1 className="bb-page-header-title">Upgrade Plan</h1>
          <p className="bb-page-header-subtitle">Select your target plan and any add-ons to request a quotation.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <section className="bb-card p-5">
            <h2 className="mb-3 text-sm font-bold text-slate-800">Target Plan</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SUBSCRIPTION_PLAN_ORDER.map((plan) => (
                <button
                  key={plan}
                  onClick={() => setSelectedPlan(plan)}
                  className={`rounded-xl border p-3 text-left text-sm transition-colors ${
                    selectedPlan === plan ? 'border-[#174c3a] bg-emerald-50 ring-1 ring-[#174c3a]' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <p className="font-bold text-slate-800">{getSubscriptionPlan(plan).name || plan}</p>
                  {plan === 'Enterprise' && <p className="mt-0.5 text-[10px] text-slate-500">Hotel-grade PMS</p>}
                  {plan === 'Pro' && <p className="mt-0.5 text-[10px] text-slate-500">Commercial suite</p>}
                </button>
              ))}
            </div>
          </section>

          {selectedPlan === 'Enterprise' && (
            <section className="bb-card p-5">
              <h2 className="mb-3 text-sm font-bold text-slate-800">Enterprise Add-Ons</h2>
              <div className="space-y-2">
                {eligibleAddons.map((addon) => (
                  <label key={addon.key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${selectedAddons.includes(addon.key) ? 'border-[#174c3a] bg-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}>
                    <input type="checkbox" checked={selectedAddons.includes(addon.key)} onChange={() => toggleAddon(addon.key)} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800">{addon.label}</p>
                      <p className="text-xs text-slate-500">{addon.description}</p>
                      <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">{addon.status}</span>
                    </div>
                  </label>
                ))}
              </div>
            </section>
          )}

          <section className="bb-card p-5">
            <h2 className="mb-3 text-sm font-bold text-slate-800">Property Details</h2>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Room Count</label>
                <input className="input" type="number" min="0" value={roomCount} onChange={(e) => setRoomCount(e.target.value)} placeholder="e.g. 50" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Users</label>
                <input className="input" type="number" min="0" value={userCount} onChange={(e) => setUserCount(e.target.value)} placeholder="e.g. 10" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Monthly Bookings</label>
                <input className="input" type="number" min="0" value={expectedBookings} onChange={(e) => setExpectedBookings(e.target.value)} placeholder="e.g. 500" />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Notes</label>
              <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any additional requirements or questions..." />
            </div>
            <label className="mt-3 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <input type="checkbox" checked={!trialAlreadyUsed} onChange={(e) => setTrialAlreadyUsed(!e.target.checked)} className="mt-0.5" />
              <span>This property has not used its one-month free trial yet. The trial is available once per property for Starter, Standard, and Pro.</span>
            </label>
          </section>
        </div>

        <div className="space-y-4">
          <section className="bb-card p-5">
            <h2 className="mb-3 text-sm font-bold text-slate-800">Quote Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Plan</span><span className="font-semibold text-slate-800">{getSubscriptionPlan(selectedPlan).name || selectedPlan}</span></div>
              {selectedAddons.length > 0 && (
                <div>
                  <span className="text-slate-500">Add-ons:</span>
                  <ul className="mt-1 space-y-0.5">
                    {selectedAddons.map((key) => {
                      const addon = ENTERPRISE_ADDON_CATALOG.find((a) => a.key === key)
                      return <li key={key} className="text-xs text-slate-600">• {addon?.label || key}</li>
                    })}
                  </ul>
                </div>
              )}
              <div className="border-t border-slate-100 pt-2">
                <p className="text-xs text-slate-500">Annual: {formatCommercialMoney(buildRequest().pricing_snapshot?.annual_subtotal)}</p>
                <p className="text-xs text-slate-400">Trial: {buildRequest().pricing_snapshot?.trial?.eligible ? '30 days included once' : 'Not included / already used'}</p>
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-2">
            <button onClick={generateQuote} className="btn-secondary w-full justify-center"><Download size={14} /> Download Quote</button>
            <button onClick={submitRequest} disabled={submitting} className="btn-primary w-full justify-center"><Send size={14} /> {submitting ? 'Submitting...' : 'Generate & Submit Quote'}</button>
          </div>

          {error && <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700"><AlertTriangle size={12} className="shrink-0" />{error}</div>}

          <p className="text-[10px] text-center text-slate-400">This is a request, not a payment. Our team will review and send a formal quotation.</p>
        </div>
      </div>
    </div>
  )
}
