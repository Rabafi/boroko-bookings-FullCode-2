import { useState, useEffect } from 'react'
import { CreditCard, Loader2, CheckCircle2, Clock, ExternalLink } from 'lucide-react'
import { rpc } from '../lib/publicApi.js'
import { useGuestPortal } from './GuestPortalSession.jsx'

/** Expected SQL view fields; RPC JSON remains unvalidated by this component. */
/** @typedef {{balance: number|string|null, booking_reference: string|null}} GuestPaymentBookingView */
/** @typedef {{id: string|null, status: string|null, description: string|null, created_at: string|null, amount: number|string|null, method: string|null}} GuestPaymentHistoryRow */
/** @typedef {{success?: boolean, error?: string|null, booking?: GuestPaymentBookingView|null}} GuestPaymentBookingResponse */
/** @typedef {{success?: boolean, error?: string|null, payments?: GuestPaymentHistoryRow[]|null}} GuestPaymentHistoryResponse */
/** @typedef {{success?: boolean, error?: string|null, payment_url?: string|null}} GuestPaymentLinkResponse */

export default function GuestPayment() {
  const { token } = useGuestPortal()
  const [booking, setBooking] = useState(/** @type {GuestPaymentBookingView|null} */ (null))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(/** @type {string|null} */ (null))
  const [paymentLink, setPaymentLink] = useState(/** @type {string|null} */ (null))
  const [requesting, setRequesting] = useState(false)
  const [requestError, setRequestError] = useState(/** @type {string|null} */ (null))
  const [paymentHistory, setPaymentHistory] = useState(/** @type {GuestPaymentHistoryRow[]} */ ([]))

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [bookingRes, historyRes] = await Promise.all([
          rpc('get_guest_portal_booking_details', { p_token: token }),
          rpc('get_guest_payment_history', { p_token: token })
        ])
        if (cancelled) return

        if (bookingRes.error) { setError(bookingRes.error.message); return }
        // The SQL RPC defines these fields; neither response is runtime-validated here.
        const bookingResponse = /** @type {GuestPaymentBookingResponse|null} */ (bookingRes.data)
        if (bookingResponse?.success === false) { setError(bookingResponse?.error || 'Could not load booking.'); return }
        setBooking(bookingResponse?.booking || null)

        const historyResponse = /** @type {GuestPaymentHistoryResponse|null} */ (historyRes.data)
        if (!historyRes.error && historyResponse?.success !== false) {
          setPaymentHistory(historyResponse?.payments || [])
        }
      } catch (e) {
        if (!cancelled) setError((/** @type {Error} */ (e)).message || 'Network error.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [token])

  async function handleRequestPaymentLink() {
    setRequesting(true)
    setRequestError(null)
    setPaymentLink(null)
    try {
      const { data, error: rpcErr } = await rpc('request_payment_link', { p_token: token })
      if (rpcErr) { setRequestError(rpcErr.message); return }
      // SQL currently returns the unavailable response; this view is not validation.
      const response = /** @type {GuestPaymentLinkResponse|null} */ (data)
      if (!response || response.success === false) {
        setRequestError(
          response?.error
          || 'Online payment links are not enabled for this property yet. Please pay at the property or contact the front desk.'
        )
        return
      }
      if (response.payment_url) {
        setPaymentLink(response.payment_url)
      } else {
        setRequestError('Online payment links are not available. Please pay at the property or contact the front desk.')
      }
    } catch (e) {
      setRequestError((/** @type {Error} */ (e)).message || 'Network error.')
    } finally {
      setRequesting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="skeleton h-14 w-full" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    )
  }

  const balance = booking?.balance != null ? Number(booking.balance) : null
  const hasBalance = balance > 0

  return (
    <div className="space-y-5">
      <div className="surface-card rounded-[24px] overflow-hidden">
        <div className="bg-gradient-to-r from-[var(--brand)] to-[var(--brand-strong)] px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Current Balance</p>
          <p className={`font-display mt-1 text-3xl font-bold ${hasBalance ? 'text-white' : 'text-emerald-200'}`}>
            {balance !== null ? `$${balance.toFixed(2)}` : '—'}
          </p>
          {balance === 0 && (
            <p className="mt-1 text-xs font-semibold text-emerald-200">Paid in full</p>
          )}
        </div>
      </div>

      {hasBalance && (
        <div className="surface-card rounded-[20px] border border-[var(--line)] p-5 text-center">
          <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
            Outstanding balances are settled with the property. Online payment links are only available when the property has enabled them.
          </p>

          {requestError && (
            <p className="mb-3 text-xs font-semibold text-[var(--danger)]">{requestError}</p>
          )}

          {paymentLink ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                  <p className="text-sm font-semibold text-emerald-800">Payment link generated</p>
                </div>
              </div>
              <a
                href={paymentLink}
                target="_blank"
                rel="noreferrer"
                className="brand-button inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold"
              >
                <ExternalLink className="h-4 w-4" />
                Open Payment Page
              </a>
              <button
                onClick={() => setPaymentLink(null)}
                className="w-full rounded-full border border-[var(--line)] bg-white px-4 py-2 text-xs font-semibold text-[var(--muted)] transition-colors hover:border-[var(--line-strong)]"
              >
                Generate New Link
              </button>
            </div>
          ) : (
            <button
              onClick={handleRequestPaymentLink}
              disabled={requesting}
              className="brand-button inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
            >
              {requesting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <CreditCard className="h-4 w-4" />
                  Request Payment Link
                </>
              )}
            </button>
          )}
        </div>
      )}

      {paymentHistory.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Payment History</h3>
          <div className="space-y-2">
            {paymentHistory.map((pmt, i) => (
              <div key={pmt.id || i} className="surface-card flex items-center justify-between rounded-[16px] border border-[var(--line)] p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-strong)]">
                    {pmt.status === 'completed' || pmt.status === 'success' ? (
                      <CheckCircle2 className="h-5 w-5 text-[var(--success)]" />
                    ) : (
                      <Clock className="h-5 w-5 text-amber-500" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--text)]">
                      {pmt.description || 'Payment'}
                    </p>
                    {pmt.created_at && (
                      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                        {new Date(pmt.created_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-display text-lg font-bold text-[var(--text)]">
                    ${pmt.amount != null ? Number(pmt.amount).toFixed(2) : '—'}
                  </p>
                  {pmt.method && (
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                      {pmt.method}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {booking?.booking_reference && (
        <p className="text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
          Booking: {booking.booking_reference}
        </p>
      )}
    </div>
  )
}
