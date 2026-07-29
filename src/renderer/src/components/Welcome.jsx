import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useProfiles } from '../app-context'
import { productLogoColor } from '../assets/productLogos'
import { getProductDefinition, getRuntimeProductId } from '../../../shared/productIdentity'
import { HOTEL_CHROME } from './hotel/hotelChrome'

const BUILD_PRODUCT = getProductDefinition(getRuntimeProductId())
const IS_HOSPITALITY_POS = BUILD_PRODUCT.id === 'hospitality-pos'
const IS_HOTEL = BUILD_PRODUCT.id === 'hotel'

export default function Welcome() {
  const navigate = useNavigate()
  const { createDraftProfile } = useProfiles()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const root = document.documentElement
    if (IS_HOTEL) root.dataset.product = 'hotel'
    else if (IS_HOSPITALITY_POS) root.dataset.product = 'hospitality-pos'
    document.title = BUILD_PRODUCT.name
  }, [])

  const handleCreateBusiness = async () => {
    setError('')
    setCreating(true)
    try {
      await createDraftProfile()
      navigate('/setup')
    } catch (e) {
      setError(e.message || `Could not create a new ${BUILD_PRODUCT.businessNoun} on this computer.`)
    } finally {
      setCreating(false)
    }
  }

  const shellBg = IS_HOSPITALITY_POS
    ? 'bg-[radial-gradient(circle_at_top_left,rgba(242,181,170,0.34),transparent_28%),radial-gradient(circle_at_top_right,rgba(205,218,183,0.34),transparent_24%),linear-gradient(135deg,#f1dfc6_0%,#d08a64_52%,#6f8061_100%)]'
    : IS_HOTEL
      ? HOTEL_CHROME.shell
      : 'bg-[radial-gradient(circle_at_top_left,rgba(187,247,208,0.24),transparent_24%),radial-gradient(circle_at_top_right,rgba(134,239,172,0.16),transparent_18%),linear-gradient(135deg,#0f3d2c_0%,#166534_50%,#22c55e_100%)]'

  return (
    <div className={`min-h-screen flex items-center justify-center px-6 ${shellBg}`}>
      <div className={IS_HOTEL
        ? `${HOTEL_CHROME.card} p-10 text-center`
        : 'w-full max-w-md rounded-[28px] border border-white/50 bg-white/96 p-10 text-center shadow-[0_30px_90px_rgba(15,23,42,0.28)]'
      }>
        <div className="mx-auto mb-4 flex h-28 w-80 max-w-full items-center justify-center"><img src={productLogoColor} alt={BUILD_PRODUCT.brandName} className="max-h-full max-w-full object-contain" draggable="false" /></div>
        <p className={`mb-2 text-[11px] font-bold uppercase tracking-[0.16em] ${IS_HOTEL ? HOTEL_CHROME.copperDeep : 'text-slate-400'}`}>
          {IS_HOTEL ? HOTEL_CHROME.productLine : IS_HOSPITALITY_POS ? 'Restaurant & Bar POS' : 'Welcome'}
        </p>
        <h1 className={`mb-2 text-2xl font-bold tracking-[-0.02em] ${IS_HOTEL ? HOTEL_CHROME.ink : 'text-slate-900'}`}>{BUILD_PRODUCT.name}</h1>
        <p className={`mb-8 text-sm ${IS_HOTEL ? HOTEL_CHROME.mute : 'text-slate-500'}`}>{BUILD_PRODUCT.tagline}</p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button
            onClick={handleCreateBusiness}
            disabled={creating}
            className={
              IS_HOTEL
                ? `w-full ${HOTEL_CHROME.primaryBtn}`
                : IS_HOSPITALITY_POS
                  ? 'w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[linear-gradient(135deg,#c95635,#a83c26)] py-2.5 font-semibold text-white transition-colors hover:brightness-105 disabled:opacity-60'
                  : 'w-full inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 py-2.5 font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-60'
            }
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : null}
            {creating
              ? 'Preparing setup…'
              : IS_HOTEL
                ? 'Create new hotel'
                : IS_HOSPITALITY_POS
                  ? 'Create new restaurant or bar'
                  : 'Create New Business'}
          </button>

          <button
            onClick={() => navigate('/login')}
            className={
              IS_HOTEL
                ? `w-full ${HOTEL_CHROME.secondaryBtn}`
                : 'w-full rounded-lg border border-gray-300 py-2.5 font-semibold text-gray-700 transition-colors hover:bg-gray-50'
            }
          >
            Log in
          </button>
        </div>
      </div>
    </div>
  )
}
