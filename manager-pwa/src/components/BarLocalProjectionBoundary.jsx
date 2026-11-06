import { useAuth } from '../contexts/AuthContext'

/**
 * Keep older hosted POS snapshots from being presented as a local Bar's data.
 * @param {{children: import('react').ReactNode}} props
 */
export default function BarLocalProjectionBoundary({ children }) {
  const { user } = useAuth()
  const isLocalBar = user?.product_family === 'hospitality_pos' && String(user?.hospitality_mode || '').toLowerCase() === 'bar_only'
  if (!isLocalBar) return children

  return (
    <section className="mx-auto max-w-3xl space-y-3 p-4 text-white" aria-labelledby="bar-projection-pending-title">
      <div className="rounded-2xl border border-amber-800 bg-amber-950/50 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">Bar owner view</p>
        <h1 id="bar-projection-pending-title" className="mt-2 text-xl font-bold">Verified local sync is not connected</h1>
        <p className="mt-2 text-sm leading-6 text-amber-100">This screen will show only Bar records received from the local Bar computer after a successful commit. The online owner view is not linked to a verified Bar sync yet, so no older cloud POS or stock records are shown.</p>
        <p className="mt-3 text-xs text-amber-200">Bar sales, stock and financial changes remain on the local Bar computer. The page will show its last successful sync and any pending or stale state once the verified link is ready.</p>
      </div>
    </section>
  )
}
