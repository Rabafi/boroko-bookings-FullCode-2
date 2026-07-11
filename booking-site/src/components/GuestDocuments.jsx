import { useState, useEffect } from 'react'
import { FileText, Eye, Download, File } from 'lucide-react'
import { rpc } from '../lib/publicApi.js'
import { useGuestPortal } from './GuestPortalSession.jsx'

const DOC_ICONS = {
  invoice: FileText,
  receipt: FileText,
  registration_card: FileText,
  voucher: FileText,
  statement: FileText
}

const DOC_LABELS = {
  invoice: 'Invoice',
  receipt: 'Receipt',
  registration_card: 'Registration Card',
  voucher: 'Voucher',
  statement: 'Statement'
}

export default function GuestDocuments() {
  const { token } = useGuestPortal()
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data, error: rpcErr } = await rpc('get_guest_portal_documents', { p_token: token })
        if (cancelled) return
        if (rpcErr) { setError(rpcErr.message); return }
        if (!data || data.success === false) { setError(data?.error || 'Could not load documents.'); return }
        setDocuments(data.documents || [])
      } catch (e) {
        if (!cancelled) setError(e.message || 'Network error.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [token])

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="skeleton h-16 w-full" />
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

  if (documents.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-8 text-center">
        <File className="mx-auto mb-3 h-10 w-10 text-[var(--muted)]" />
        <p className="text-sm text-[var(--muted)]">No documents are available yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {documents.map((doc, i) => {
        const Icon = DOC_ICONS[doc.document_type] || FileText
        const label = DOC_LABELS[doc.document_type] || doc.document_type
        return (
          <div key={doc.id || i} className="surface-card rounded-[16px] border border-[var(--line)] p-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)]">
                <Icon className="h-6 w-6 text-[var(--brand)]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[var(--text)]">{label}</p>
                {doc.document_number && (
                  <p className="text-xs text-[var(--muted)]">{doc.document_number}</p>
                )}
                {doc.created_at && (
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                    {new Date(doc.created_at).toLocaleDateString()}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {doc.download_url && (
                  <a
                    href={doc.download_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] bg-white text-[var(--muted)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text)]"
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                )}
                {doc.view_url && (
                  <a
                    href={doc.view_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] bg-white text-[var(--muted)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text)]"
                    title="View"
                  >
                    <Eye className="h-4 w-4" />
                  </a>
                )}
                {!doc.download_url && !doc.view_url && (
                  <span className="inline-flex items-center rounded-full bg-[var(--surface-strong)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                    No file
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
