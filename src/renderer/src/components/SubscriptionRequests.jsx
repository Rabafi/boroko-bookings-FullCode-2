import { useEffect, useState, useCallback, useMemo } from 'react'
import { useToast } from './shared/Toast'
import { timeAgo } from '../utils/timeAgo'
import {
  SUBSCRIPTION_REQUEST_STATUS,
  normalizePlanName
} from '../../../shared/subscriptionRequest'
import { ENTERPRISE_ADDON_CATALOG } from '../../../shared/enterpriseAddons'
import { getCommercialAddon } from '../../../shared/commercialEntitlements'
import { DarkConfirmDialog } from './shared/DarkConfirmDialog'
import {
  FileText, CheckCircle, XCircle, Clock, Send, Eye, ChevronDown, ChevronUp,
  Filter, RefreshCw, AlertTriangle, Mail, Phone, Building2, Home, FileDown
} from 'lucide-react'

const STATUS_META = {
  draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400', icon: FileText },
  submitted: { label: 'Submitted', color: 'bg-blue-500/20 text-blue-300', icon: Send },
  quoted: { label: 'Quoted', color: 'bg-amber-500/20 text-amber-300', icon: FileText },
  invoice_sent: { label: 'Invoice Sent', color: 'bg-orange-500/20 text-orange-300', icon: Mail },
  payment_under_review: { label: 'Payment Review', color: 'bg-yellow-500/20 text-yellow-300', icon: Clock },
  approved: { label: 'Approved', color: 'bg-green-500/20 text-green-300', icon: CheckCircle },
  activated: { label: 'Activated', color: 'bg-emerald-500/20 text-emerald-300', icon: CheckCircle },
  rejected: { label: 'Rejected', color: 'bg-red-500/20 text-red-300', icon: XCircle },
  expired: { label: 'Expired', color: 'bg-gray-500/20 text-gray-500', icon: Clock }
}

const STATUS_FLOW = [
  { from: 'submitted', to: 'quoted', label: 'Send Quote' },
  { from: 'quoted', to: 'invoice_sent', label: 'Send Invoice' },
  { from: 'invoice_sent', to: 'payment_under_review', label: 'Payment Received' },
  { from: 'payment_under_review', to: 'approved', label: 'Approve' },
  { from: 'approved', to: 'activated', label: 'Activate' },
  { from: 'submitted', to: 'rejected', label: 'Reject' },
  { from: 'quoted', to: 'rejected', label: 'Reject' },
  { from: 'invoice_sent', to: 'rejected', label: 'Reject' },
  { from: 'payment_under_review', to: 'rejected', label: 'Reject' }
]

function addonLabel(key, productId = null) {
  const addon = getCommercialAddon(productId, key)
    || ENTERPRISE_ADDON_CATALOG.find((a) => a.key === key)
  return addon?.label || key?.replace(/_/g, ' ')
}

function isActivationTargetLicense(license, request) {
  if (!license || !request?.lodge_id) return false
  if (String(license.lodge_id || '') !== String(request.lodge_id)) return false
  if (license.is_active === false) return false
  const state = String(license.subscription_state || license.payment_status || '').toLowerCase()
  if (['cancelled', 'expired', 'superseded', 'deleted', 'inactive'].includes(state)) return false
  return !request.product_id || String(license.product_id || '') === String(request.product_id)
}

export default function SubscriptionRequests({ licenses = [] }) {
  const toast = useToast()
  const [requests, setRequests] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState(null)
  const [selected, setSelected] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [showActivationConfirm, setShowActivationConfirm] = useState(false)
  const [selectedLicenseId, setSelectedLicenseId] = useState('')

  const loadRequests = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.subscriptionRequests.getAll(statusFilter, 50, 0)
      setRequests(result?.rows || [])
      setTotal(result?.total || 0)
    } catch (err) {
      console.error('Failed to load subscription requests:', err)
      toast.error('Failed to load subscription requests')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { loadRequests() }, [loadRequests])

  const openDetail = async (req) => {
    setSelected(req)
    setSelectedLicenseId(req.existing_license_id || '')
    setDetailLoading(true)
    try {
      const full = await window.api.subscriptionRequests.getById(req.id)
      if (full) {
        setSelected(full)
        setSelectedLicenseId(full.existing_license_id || req.existing_license_id || '')
      }
    } catch (err) {
      console.error('Failed to load request detail:', err)
    } finally {
      setDetailLoading(false)
    }
  }

  const updateStatus = async (requestId, newStatus) => {
    setActionLoading(true)
    try {
      let result
      if (newStatus === 'quoted') {
        result = await window.api.subscriptionRequests.createDocument(requestId, 'quote', {
          notes: 'Quote prepared in Command Central. Final price must be confirmed before payment activation.'
        })
      } else if (newStatus === 'invoice_sent') {
        result = await window.api.subscriptionRequests.createDocument(requestId, 'invoice', {
          notes: 'Pro-forma invoice prepared in Command Central for manual payment review.'
        })
      } else {
        result = await window.api.subscriptionRequests.updateStatus(
          requestId,
          newStatus,
          null,
          newStatus === 'rejected' ? rejectReason : null
        )
      }
      if (result?.success === false) throw new Error(result.error)
      toast.success(`Request status updated to ${STATUS_META[newStatus]?.label || newStatus}`)
      setShowReject(false)
      setRejectReason('')
      await loadRequests()
      if (selected?.id === requestId) {
        const updated = await window.api.subscriptionRequests.getById(requestId)
        if (updated) setSelected(updated)
      }
    } catch (err) {
      toast.error(err.message || 'Failed to update status')
    } finally {
      setActionLoading(false)
    }
  }

  const activateRequest = async (requestId) => {
    setActionLoading(true)
    try {
      const license = licenses.find((entry) => entry.id === selectedLicenseId) || null
      const lodgeId = license?.lodge_id || null
      if (!selectedLicenseId || !lodgeId || !isActivationTargetLicense(license, selected)) {
        throw new Error('Select the active license for this exact company and product before continuing.')
      }
      const result = await window.api.subscriptionRequests.activate(requestId, null, {
        operation_id: crypto.randomUUID(),
        license_id: selectedLicenseId,
        lodge_id: lodgeId,
        plan: selected?.requested_plan,
        product_id: selected?.product_id || null,
        commercial_package_key: selected?.commercial_package_key || null,
        enterprise_addons: selected?.requested_addons || [],
        activation_reason: 'Manual Command Central activation after payment approval'
      })
      if (result?.success === false) throw new Error(result.error)
      toast.success('Request activated successfully')
      await loadRequests()
      if (selected?.id === requestId) {
        const updated = await window.api.subscriptionRequests.getById(requestId)
        if (updated) setSelected(updated)
      }
    } catch (err) {
      toast.error(err.message || 'Failed to activate')
    } finally {
      setActionLoading(false)
    }
  }

  const exportDocumentPdf = async (documentPayload) => {
    if (!documentPayload) return
    setActionLoading(true)
    try {
      const result = await window.api.subscriptionRequests.exportDocumentPdf(documentPayload)
      if (result?.canceled) return
      if (result?.success === false) throw new Error(result.error || 'PDF export failed')
      toast.success('PDF saved')
    } catch (err) {
      toast.error(err.message || 'Failed to save PDF')
    } finally {
      setActionLoading(false)
    }
  }

  const availableActions = useMemo(() => {
    if (!selected) return []
    return STATUS_FLOW.filter((f) => f.from === selected.status)
  }, [selected])

  const summary = useMemo(() => {
    const counts = {}
    for (const req of requests) {
      counts[req.status] = (counts[req.status] || 0) + 1
    }
    return counts
  }, [requests])

  const licenseOptions = useMemo(() => {
    const rows = Array.isArray(licenses) ? licenses : []
    return rows.filter((license) => isActivationTargetLicense(license, selected))
  }, [licenses, selected])

  const selectedActivationLicense = useMemo(
    () => licenseOptions.find((license) => license.id === selectedLicenseId) || null,
    [licenseOptions, selectedLicenseId]
  )

  return (
    <div className="flex gap-5 h-full">
      {/* List */}
      <div className={`flex-1 min-w-0 bg-gray-800 rounded-xl overflow-hidden ${selected ? 'hidden md:block' : ''}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <FileText size={16} className="text-purple-400" />
            <p className="text-sm font-semibold text-white">Subscription Requests</p>
            <span className="text-xs text-gray-500">({total})</span>
          </div>
          <button onClick={loadRequests} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">
            <RefreshCw size={14} />
          </button>
        </div>

        {/* Status filter tabs */}
        <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-gray-700 bg-gray-900/40">
          <button
            onClick={() => setStatusFilter(null)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              statusFilter === null ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30' : 'bg-gray-800 text-gray-400 border border-gray-700 hover:bg-gray-700'
            }`}
          >
            All ({requests.length})
          </button>
          {Object.entries(STATUS_META).map(([key, meta]) => (
            summary[key] > 0 && (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  statusFilter === key ? `${meta.color} border border-current/30` : 'bg-gray-800 text-gray-400 border border-gray-700 hover:bg-gray-700'
                }`}
              >
                {meta.label} ({summary[key]})
              </button>
            )
          ))}
        </div>

        {loading ? (
          <div className="px-6 py-16 text-center text-gray-500">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent mx-auto mb-3" />
            <p className="text-sm">Loading requests...</p>
          </div>
        ) : requests.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500">
            <FileText size={32} className="mx-auto mb-3 opacity-40" />
            <p>No subscription requests found.</p>
            <p className="text-xs text-gray-500 mt-1">Requests appear here when lodges submit upgrade or add-on requests.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-700/50 max-h-[calc(100vh-280px)] overflow-y-auto">
            {requests.map((req) => {
              const meta = STATUS_META[req.status] || STATUS_META.draft
              const Icon = meta.icon
              return (
                <button
                  key={req.id}
                  onClick={() => openDetail(req)}
                  className={`w-full text-left px-4 py-3 transition-colors hover:bg-gray-700/50 ${
                    selected?.id === req.id ? 'bg-gray-700/50 border-l-2 border-purple-500' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-white truncate">
                          {req.property_name || req.company_name || 'Unknown'}
                        </p>
                        <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.color}`}>
                          <Icon size={10} />
                          {meta.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {normalizePlanName(req.current_plan || 'Starter')} → {normalizePlanName(req.requested_plan)}
                        {req.requested_addons?.length > 0 && ` + ${req.requested_addons.length} addon${req.requested_addons.length > 1 ? 's' : ''}`}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500">
                        <span>{req.contact_name || 'No name'}</span>
                        {req.contact_email && <span className="flex items-center gap-0.5"><Mail size={9} />{req.contact_email}</span>}
                        {req.quote_number && <span className="font-mono">{req.quote_number}</span>}
                        <span>{timeAgo(req.submitted_at)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="w-full md:w-[420px] shrink-0 bg-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
            <p className="text-sm font-semibold text-white">Request Detail</p>
            <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-white text-xs">Close</button>
          </div>

          {detailLoading ? (
            <div className="px-6 py-12 text-center text-gray-500">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-500 border-t-transparent mx-auto mb-2" />
              <p className="text-xs">Loading details...</p>
            </div>
          ) : (
            <div className="p-4 space-y-4 max-h-[calc(100vh-280px)] overflow-y-auto">
              {/* Status badge */}
              <div className="flex items-center gap-2">
                {(() => {
                  const meta = STATUS_META[selected.status] || STATUS_META.draft
                  const Icon = meta.icon
                  return (
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${meta.color}`}>
                      <Icon size={12} />
                      {meta.label}
                    </span>
                  )
                })()}
                {selected.quote_number && (
                  <span className="text-xs font-mono text-gray-500">{selected.quote_number}</span>
                )}
                {selected.invoice_number && (
                  <span className="text-xs font-mono text-orange-300">{selected.invoice_number}</span>
                )}
              </div>

              {/* Property info */}
              <div className="bg-gray-900 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm text-white">
                  <Building2 size={14} className="text-gray-400" />
                  {selected.property_name || selected.company_name || 'Unknown'}
                </div>
                {selected.contact_name && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Home size={12} className="text-gray-500" />
                    {selected.contact_name}
                  </div>
                )}
                {selected.contact_email && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Mail size={12} className="text-gray-500" />
                    {selected.contact_email}
                  </div>
                )}
                {selected.contact_phone && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Phone size={12} className="text-gray-500" />
                    {selected.contact_phone}
                  </div>
                )}
              </div>

              {/* Plan change */}
              <div className="bg-gray-900 rounded-xl p-3">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Plan Change</p>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-400">{normalizePlanName(selected.current_plan || 'Starter')}</span>
                  <span className="text-gray-600">→</span>
                  <span className="text-white font-semibold">{normalizePlanName(selected.requested_plan)}</span>
                </div>
                {selected.requested_addons?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selected.requested_addons.map((key) => (
                      <span key={key} className="inline-block rounded-full bg-purple-500/20 text-purple-300 px-2 py-0.5 text-[10px] font-medium">
                        {addonLabel(key, selected.product_id)}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Property details */}
              <div className="bg-gray-900 rounded-xl p-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase">Rooms</p>
                  <p className="text-sm font-semibold text-white">{selected.room_count || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase">Users</p>
                  <p className="text-sm font-semibold text-white">{selected.user_count || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase">Bookings/mo</p>
                  <p className="text-sm font-semibold text-white">{selected.expected_monthly_bookings || '—'}</p>
                </div>
              </div>

              {/* Notes */}
              {selected.notes && (
                <div className="bg-gray-900 rounded-xl p-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Notes</p>
                  <p className="text-xs text-gray-300 whitespace-pre-wrap">{selected.notes}</p>
                </div>
              )}

              {/* Timestamps */}
              <div className="text-[10px] text-gray-500 space-y-0.5">
                <p>Submitted: {selected.submitted_at ? new Date(selected.submitted_at).toLocaleString() : '—'}</p>
                {selected.reviewed_at && <p>Reviewed: {new Date(selected.reviewed_at).toLocaleString()} by {selected.reviewed_by}</p>}
                {selected.activated_at && <p>Activated: {new Date(selected.activated_at).toLocaleString()} by {selected.activated_by}</p>}
                {selected.rejection_reason && <p className="text-red-400">Rejection reason: {selected.rejection_reason}</p>}
              </div>

              {(selected.quote_payload || selected.invoice_payload) && (
                <div className="bg-gray-900 rounded-xl p-3 space-y-2">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Commercial Documents</p>
                  {selected.quote_payload && (
                    <div className="rounded-lg border border-gray-700 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-white">Quote {selected.quote_payload.document_number || selected.quote_number}</p>
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={() => exportDocumentPdf(selected.quote_payload)}
                          className="inline-flex items-center gap-1 rounded-md bg-gray-800 px-2 py-1 text-[10px] font-semibold text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                        >
                          <FileDown size={11} /> PDF
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-500">{selected.quote_payload.notes || 'Quote record saved on this request.'}</p>
                    </div>
                  )}
                  {selected.invoice_payload && (
                    <div className="rounded-lg border border-orange-500/30 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-orange-200">Pro-forma {selected.invoice_payload.document_number || selected.invoice_number}</p>
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={() => exportDocumentPdf(selected.invoice_payload)}
                          className="inline-flex items-center gap-1 rounded-md bg-orange-500/20 px-2 py-1 text-[10px] font-semibold text-orange-200 hover:bg-orange-500/30 disabled:opacity-50"
                        >
                          <FileDown size={11} /> PDF
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-500">{selected.invoice_payload.notes || 'Manual payment invoice record saved on this request.'}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Activation target */}
              {selected.status === 'approved' && (
                <div className="bg-gray-900 rounded-xl p-3 space-y-2">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Activation Target</p>
                  <select
                    value={selectedLicenseId}
                    onChange={(e) => setSelectedLicenseId(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Select matching active license...</option>
                    {licenseOptions.map((license) => (
                      <option key={license.id} value={license.id}>
                        {license.lodge_name || license.lodge_id} - {normalizePlanName(license.subscription_plan || 'Starter')}
                      </option>
                    ))}
                  </select>
                  {licenseOptions.length === 0 ? (
                    <p className="text-[10px] leading-4 text-amber-300">
                      No active {selected.product_id || 'matching'} license is linked to this exact company. Create or correct the product-matched assignment in Licensing Workbench, set its commercial due date and payment state, then return here to activate the approved request.
                    </p>
                  ) : (
                    <p className="text-[10px] leading-4 text-gray-500">
                      Activation applies the immutable approved quote to the selected license and enables only its package and add-on entitlements. The server records the operator and rejects unapproved or mismatched requests.
                    </p>
                  )}
                </div>
              )}

              {/* Action buttons */}
              {availableActions.length > 0 && (
                <div className="border-t border-gray-700 pt-3 space-y-2">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Actions</p>
                  <div className="flex flex-wrap gap-2">
                    {availableActions.map((action) => (
                      <button
                        key={action.to}
                        disabled={actionLoading}
                        onClick={() => {
                          if (action.to === 'rejected') {
                            setShowReject(true)
                          } else if (action.to === 'activated') {
                            if (!selectedActivationLicense) {
                              toast.error('Select the active license for this exact company and product before activating.')
                            } else {
                              setShowActivationConfirm(true)
                            }
                          } else {
                            updateStatus(selected.id, action.to)
                          }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                          action.to === 'rejected'
                            ? 'bg-red-600/20 text-red-400 hover:bg-red-600/40'
                            : action.to === 'activated'
                              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                              : 'bg-purple-600 text-white hover:bg-purple-700'
                        }`}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>

                  {/* Reject reason input */}
                  {showReject && (
                    <div className="mt-2 space-y-2">
                      <textarea
                        className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-red-500"
                        rows={2}
                        placeholder="Reason for rejection (optional)"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          disabled={actionLoading}
                          onClick={() => updateStatus(selected.id, 'rejected')}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          Confirm Reject
                        </button>
                        <button
                          onClick={() => { setShowReject(false); setRejectReason('') }}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-700 text-gray-300 hover:bg-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <DarkConfirmDialog
        open={showActivationConfirm}
        title="Activate approved subscription?"
        message={`This applies the approved quote to ${selectedActivationLicense?.lodge_name || 'the selected company'} and grants its package and add-ons. Confirm only after payment approval and the due date have been checked.`}
        confirmLabel="Activate subscription"
        cancelLabel="Review again"
        tone="warning"
        onCancel={() => setShowActivationConfirm(false)}
        onConfirm={() => {
          setShowActivationConfirm(false)
          if (selected) activateRequest(selected.id)
        }}
      />
    </div>
  )
}
