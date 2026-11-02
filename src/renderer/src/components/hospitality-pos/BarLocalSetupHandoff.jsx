// @ts-check
import { useState } from 'react'
import { ErrorNotice } from '../shared/ErrorNotice'

/**
 * Bar handoff inside the ordinary company-creation journey.
 *
 * A Bar is local-first, so this handoff never sends Bar details to a hosted account.
 * When this window already runs another workspace, the local Bar is opened in
 * a dedicated window with its own profile directory and saved records.
 *
 * @param {{ businessName?: string, currency?: string, businessProfile?: Record<string, string>, onBackToDetails?: () => void }} props
 */
export default function BarLocalSetupHandoff({ businessName = '', currency = 'BWP', businessProfile = {}, onBackToDetails }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [opened, setOpened] = useState(false)
  const [openedMode, setOpenedMode] = useState('commission')
  const [dedicatedWindow, setDedicatedWindow] = useState(false)

  const openWorkspace = async (entryMode) => {
    setBusy(true)
    setError('')
    try {
      const status = await window.api?.barLocal?.getStatus?.().catch(() => null)
      if (status?.workspace_isolation === 'dedicated_bar') {
        setDedicatedWindow(true)
        return
      }
      const result = await window.api.barLocal.openLocalBarWorkspace({
        business_name: businessName,
        currency,
        entry_mode: entryMode,
        ...businessProfile
      })
      if (!result || result.opened !== true) {
        throw new Error('The local Bar setup window did not open. Try again, or restart the application.')
      }
      setOpenedMode(entryMode)
      setOpened(true)
    } catch (e) {
      setError(
        e && typeof e === 'object' && 'message' in e && typeof e.message === 'string'
          ? e.message
          : 'The local Bar setup window could not be opened.'
      )
    } finally {
      setBusy(false)
    }
  }

  if (dedicatedWindow) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
          <p className="text-sm font-semibold text-[#7a2e1c]">This is your local Bar setup window</p>
          <p className="mt-1 text-xs text-[#7a2e1c]">Choose whether to set up a new Bar or connect to your existing Bar in the local workspace.</p>
        </div>
        {onBackToDetails && (
          <button type="button" onClick={onBackToDetails} className="btn-secondary w-full">← Back to business details</button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
        <p className="text-sm font-semibold text-[#7a2e1c]">Your Bar records stay on the main computer at your venue</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[#7a2e1c]">
          <li>Choose a <strong>new Bar</strong> to install its records on this main computer, or connect this till to an existing Bar.</li>
          <li>Enter the business details during local setup. Existing Bars use their saved records on the main Bar computer.</li>
          <li>You will create an offline owner sign-in with an email address and password, plus a PIN for in-person approvals.</li>
          <li>Choose whether this is the main Bar computer or a till that connects to it.</li>
        </ul>
      </div>

      {opened ? (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-800">{openedMode === 'join' ? 'Your existing-Bar connection window is ready' : 'Your new-Bar setup window is ready'}</p>
          <p className="mt-1 text-xs text-emerald-800">
            Continue in the Bar window to finish setup.
          </p>
          <p className="mt-2 text-xs text-emerald-800">
          Windows may ask for administrator approval once when this computer becomes the Bar server. Keep the setup
            window open while it installs the local Bar records and service.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <button type="button" onClick={() => void openWorkspace('commission')} disabled={busy} className="btn-primary w-full">{busy ? 'Opening local Bar setup…' : 'Set up a new Bar'}</button>
          <button type="button" onClick={() => void openWorkspace('join')} disabled={busy} className="btn-secondary w-full">Connect to an existing Bar</button>
        </div>
      )}

      {error && <ErrorNotice className="text-red-500 text-sm">{error}</ErrorNotice>}

      <p className="text-xs text-gray-400">
      If your Bar already has a main computer, choose “Connect this till to my Bar”.
      </p>

      {onBackToDetails && (
        <button type="button" onClick={onBackToDetails} disabled={busy} className="btn-secondary w-full">← Back to business details</button>
      )}
    </div>
  )
}
