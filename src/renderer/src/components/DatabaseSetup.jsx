import { AlertTriangle, ExternalLink } from 'lucide-react'

export default function DatabaseSetup({ onComplete }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-900 via-green-800 to-green-700 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
        <div className="bg-amber-600 px-8 py-6 text-white">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white/15 flex items-center justify-center">
              <AlertTriangle size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Legacy Database Setup Disabled</h1>
              <p className="text-amber-100 text-sm mt-1">
                This old bootstrap path is no longer safe for multi-lodge production use.
              </p>
            </div>
          </div>
        </div>

        <div className="px-8 py-6 space-y-5 text-sm text-gray-700">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="font-semibold text-amber-900">Why this screen was disabled</p>
            <p className="mt-2 text-amber-800">
              The previous version included legacy SQL that could create unsafe tenant isolation
              rules. Boroko now expects a checked-in migration flow instead of pasting setup SQL
              from the app.
            </p>
          </div>

          <div className="space-y-2">
            <p className="font-semibold text-gray-900">Use this instead</p>
            <p>
              Apply the checked-in Supabase migration files for this codebase, then return to the
              normal Boroko setup flow. If you need help validating the live database contract, run
              the SQL checks from support and use those results to guide the migration rollout.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              onClick={() => window.api.shell.openExternal('https://supabase.com/dashboard')}
              className="btn-secondary inline-flex items-center gap-2"
            >
              Open Supabase Dashboard <ExternalLink size={14} />
            </button>
            <button
              onClick={() => onComplete?.()}
              className="btn-primary"
            >
              Return to App
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
