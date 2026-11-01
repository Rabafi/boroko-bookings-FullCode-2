// @ts-check
import { useState } from 'react'

/** @param {{onConnect:(request:{base_url:string,certificate_fingerprint:string,staff_id:string,pin:string,confirm:string})=>Promise<unknown>}} props */
export default function BarReplacementConnection({ onConnect }) {
  const [base, setBase] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [staff, setStaff] = useState('')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const connect = async () => {
    setBusy(true); setMessage('')
    try {
      await onConnect({ base_url: base.trim(), certificate_fingerprint: fingerprint.trim(), staff_id: staff.trim(), pin, confirm })
      setMessage('Replacement verified and saved. Restart this till, sign in, then check every saved operation before trading.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Replacement was not verified. The original profile is retained.') }
    finally { setBusy(false); setPin('') }
  }
  return <details className="mt-5 rounded border border-slate-700 p-3 text-sm">
    <summary className="cursor-pointer font-semibold">Owner: connect this till to a replacement server</summary>
    <p className="mt-3 text-slate-300">Use this after a verified physical replacement has fenced the old server and promoted its replica. Your original device credential and saved operations are kept. A new empty Bar cannot replace your existing Bar.</p>
    <label className="block mt-3">Replacement service address<input value={base} onChange={e => setBase(e.target.value)} placeholder="https://192.168.1.20:8787" className="block w-full rounded bg-slate-800 p-2"/></label>
    <label className="block mt-3">Server certificate fingerprint<input value={fingerprint} onChange={e => setFingerprint(e.target.value)} className="block w-full rounded bg-slate-800 p-2"/></label>
    <label className="block mt-3">Owner staff ID<input value={staff} onChange={e => setStaff(e.target.value)} className="block w-full rounded bg-slate-800 p-2"/></label>
    <label className="block mt-3">Owner PIN<input type="password" autoComplete="off" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} className="block w-full rounded bg-slate-800 p-2"/></label>
    <label className="block mt-3">Type RECONNECT_SERVER<input value={confirm} onChange={e => setConfirm(e.target.value)} className="block w-full rounded bg-slate-800 p-2"/></label>
    <button type="button" disabled={busy || confirm !== 'RECONNECT_SERVER'} onClick={() => void connect()} className="mt-3 rounded border px-3 py-2 disabled:opacity-50">{busy ? 'Verifying original Bar…' : 'Verify replacement and restart'}</button>
    {message && <p role="status" className="mt-3 text-amber-200">{message}</p>}
  </details>
}
