import { useCallback, useEffect, useState } from 'react'
import { Eye, FileCheck2, RefreshCw, Upload } from 'lucide-react'
import { HposButton, HposNotice } from './HposUi'

const MAX_PROOF_BYTES = 8 * 1024 * 1024
const PROOF_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])

function operationKey(submissionId, sha256) {
  const storageKey = `hpos.cashup-proof.operation.${submissionId}.${sha256}`
  try {
    const existing = window.localStorage.getItem(storageKey)
    if (existing) return existing
    const next = `cashup-proof:${submissionId}:${sha256}`
    window.localStorage.setItem(storageKey, next)
    return next
  } catch {
    // The deterministic key is still stable for this file across a retry in this view.
    return `cashup-proof:${submissionId}:${sha256}`
  }
}

async function sha256(bytes) {
  const digest = await window.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

function formatBytes(value) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(value / 1024))} KB`
}

export default function HposCashupProofs({ submissionId, canUpload = false }) {
  const [attachments, setAttachments] = useState([])
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [openingId, setOpeningId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    if (!submissionId) return
    setLoading(true)
    setError('')
    try {
      const getProofs = window.api?.pos?.getCashupProofAttachments
      if (typeof getProofs !== 'function') throw new Error('Cash-up proof support is unavailable in this app build.')
      const result = await getProofs(submissionId)
      if (result?.success === false) throw new Error(result.error || 'Cash-up proof metadata is unavailable.')
      setAttachments(Array.isArray(result) ? result : [])
    } catch (loadError) {
      setAttachments([])
      setError(loadError?.message || 'Cash-up proof metadata is unavailable until the server policy is ready.')
    } finally {
      setLoading(false)
    }
  }, [submissionId])

  useEffect(() => { refresh() }, [refresh])

  const chooseFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    setError('')
    setNotice('')
    if (!file) return
    const mimeType = String(file.type || '').toLowerCase()
    if (!PROOF_MIME_TYPES.has(mimeType)) {
      setError('Choose a PDF, JPG or PNG proof.')
      return
    }
    if (!file.size || file.size > MAX_PROOF_BYTES) {
      setError('Proof files must be between 1 byte and 8 MB.')
      return
    }
    if (file.name.length > 120 || /[\\/]/.test(file.name)) {
      setError('The proof file name is too long or contains an unsafe path character.')
      return
    }
    try {
      const bytes = await file.arrayBuffer()
      const hash = await sha256(bytes)
      setDraft({ fileName: file.name, mimeType, byteCount: file.size, bytes, sha256: hash, idempotencyKey: operationKey(submissionId, hash) })
    } catch (selectionError) {
      setError(selectionError?.message || 'The proof file could not be prepared.')
    }
  }

  const upload = async () => {
    if (!draft || busy || !canUpload) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const attachProof = window.api?.pos?.attachCashupProof
      if (typeof attachProof !== 'function') throw new Error('Cash-up proof upload is unavailable in this app build.')
      const result = await attachProof({
        submission_id: submissionId,
        file_name: draft.fileName,
        mime_type: draft.mimeType,
        byte_count: draft.byteCount,
        sha256: draft.sha256,
        idempotency_key: draft.idempotencyKey,
        file_bytes: draft.bytes,
      })
      if (!result?.success) throw new Error(result?.error || 'Durable cash-up proof storage is unavailable. No cash-up record was changed.')
      setDraft(null)
      setNotice('Proof attached to this cash-up. The server metadata is authoritative.')
      await refresh()
    } catch (uploadError) {
      setError(uploadError?.message || 'Proof upload could not be completed. Keep this file and retry with the same selected proof.')
    } finally {
      setBusy(false)
    }
  }

  const openProof = async (attachment) => {
    if (!attachment?.id || openingId) return
    setOpeningId(attachment.id)
    setError('')
    try {
      const createSignedUrl = window.api?.pos?.createCashupProofSignedUrl
      if (typeof createSignedUrl !== 'function') throw new Error('Cash-up proof read support is unavailable in this app build.')
      const result = await createSignedUrl(submissionId, attachment.id)
      if (!result?.success || !result.signed_url) throw new Error(result?.error || 'A short-lived proof read could not be created.')
      const opened = window.open(result.signed_url, '_blank', 'noopener,noreferrer')
      if (!opened) setNotice('The short-lived proof link was created, but the window was blocked. Allow pop-ups and try View again.')
    } catch (openError) {
      setError(openError?.message || 'The proof could not be opened for this authorized cash-up.')
    } finally {
      setOpeningId('')
    }
  }

  if (!submissionId) return null

  return <section className="hpos-cashup-proofs" aria-label="Cash-up proof attachments">
    <header><div><p className="hpos-eyebrow">Proof attachment</p><h3><FileCheck2 size={17} /> Cash-up evidence</h3></div><HposButton icon={RefreshCw} onClick={refresh} disabled={loading || busy}>{loading ? 'Loading…' : 'Refresh'}</HposButton></header>
    {error && <HposNotice tone="error">{error}</HposNotice>}
    {notice && <HposNotice>{notice}</HposNotice>}
    {loading ? <p className="hpos-cashup-proof-empty">Checking the authoritative proof register…</p> : error ? <p className="hpos-cashup-proof-empty">The proof register could not be read, so this screen will not infer that evidence is absent.</p> : attachments.length === 0 ? <p className="hpos-cashup-proof-empty">No proof is attached yet. Only an authorized cashier or supervisor can add one while this cash-up is still submitted.</p> : <ul className="hpos-cashup-proof-list">{attachments.map((attachment) => <li key={attachment.id}><span><strong>{attachment.file_name || 'Cash-up proof'}</strong><small>{attachment.sha256 ? `${attachment.sha256.slice(0, 12)}…` : 'Hash unavailable'} · {attachment.byte_count ? formatBytes(attachment.byte_count) : 'Size unavailable'} · {attachment.created_at ? new Date(attachment.created_at).toLocaleString('en-GB') : 'Time unavailable'}</small></span><HposButton icon={Eye} onClick={() => openProof(attachment)} disabled={openingId === attachment.id}>{openingId === attachment.id ? 'Opening…' : 'View (60s)'}</HposButton></li>)}</ul>}
    {canUpload && <div className="hpos-cashup-proof-upload"><label><span>Select a PDF, JPG or PNG (max 8 MB)</span><input type="file" accept="application/pdf,image/jpeg,image/png" onChange={chooseFile} disabled={busy} /></label>{draft && <div className="hpos-cashup-proof-selected"><span>{draft.fileName} · {formatBytes(draft.byteCount)} · SHA-256 verified</span><HposButton tone="primary" icon={Upload} onClick={upload} disabled={busy}>{busy ? 'Saving proof…' : 'Attach proof'}</HposButton></div>}</div>}
  </section>
}
