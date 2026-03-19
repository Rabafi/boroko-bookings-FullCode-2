import { useState } from 'react'
import { Database, CheckCircle, AlertCircle, Loader, Eye, EyeOff, ExternalLink } from 'lucide-react'

const SQL_SCRIPT = `-- Run this once in your Supabase project's SQL Editor
-- Go to: Supabase Dashboard → SQL Editor → New Query → paste & run

CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_number TEXT NOT NULL UNIQUE,
  room_type TEXT NOT NULL,
  rate_per_night NUMERIC NOT NULL DEFAULT 0,
  max_occupancy INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'available',
  housekeeping_status TEXT DEFAULT 'clean',
  housekeeping_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  id_number TEXT,
  address TEXT,
  nationality TEXT,
  notes TEXT,
  is_blacklisted BOOLEAN DEFAULT FALSE,
  blacklist_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id),
  customer_id UUID REFERENCES customers(id),
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  adults INTEGER DEFAULT 1,
  children INTEGER DEFAULT 0,
  total_amount NUMERIC DEFAULT 0,
  amount_paid NUMERIC DEFAULT 0,
  payment_status TEXT DEFAULT 'unpaid',
  payment_method TEXT,
  booking_status TEXT DEFAULT 'confirmed',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER DEFAULT 1 PRIMARY KEY,
  lodge_name TEXT,
  company_name TEXT,
  address TEXT,
  city TEXT,
  country TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  vat_number TEXT,
  currency TEXT DEFAULT 'P',
  logo TEXT,
  setup_complete BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON rooms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON bookings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON settings FOR ALL USING (true) WITH CHECK (true);`

export default function DatabaseSetup({ onComplete }) {
  const [step, setStep] = useState(1) // 1=enter creds, 2=run sql, 3=done
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const handleTest = async () => {
    if (!url.trim() || !key.trim()) {
      setError('Please fill in both fields.')
      return
    }
    setError('')
    setTesting(true)
    try {
      const result = await window.api.database.test(url.trim(), key.trim())
      if (result.success) {
        // Tables exist — go straight to save
        await handleSave()
      } else if (result.tablesNeeded) {
        // Connected but no tables yet — show SQL step
        setStep(2)
      } else {
        setError(result.error || 'Could not connect. Check your URL and API key.')
      }
    } catch (e) {
      setError('Connection failed. Check your URL and API key.')
    }
    setTesting(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const result = await window.api.database.configure(url.trim(), key.trim())
      if (result.success) {
        setStep(3)
        setTimeout(() => onComplete(), 1200)
      } else {
        setError(result.error || 'Setup failed. Please try again.')
      }
    } catch (e) {
      setError('Setup failed. Please try again.')
    }
    setSaving(false)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(SQL_SCRIPT)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-900 via-green-800 to-green-700 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">

        {/* Header */}
        <div className="bg-green-700 px-8 py-6 text-white">
          <div className="text-3xl mb-2">🏕️</div>
          <h1 className="text-2xl font-bold">Boroko Bookings</h1>
          <p className="text-green-200 text-sm mt-1">
            Connect your private database to get started
          </p>
        </div>

        {/* Progress */}
        <div className="flex px-8 pt-5 gap-2">
          {[1, 2].map((s) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${
                step > s ? 'bg-green-600 text-white' : step === s ? 'bg-green-600 text-white ring-4 ring-green-100' : 'bg-gray-200 text-gray-400'
              }`}>
                {step > s ? <CheckCircle size={14} /> : s}
              </div>
              <span className={`text-xs font-medium ${step === s ? 'text-green-700' : 'text-gray-400'}`}>
                {s === 1 ? 'Database Credentials' : 'Create Tables'}
              </span>
              {s < 2 && <div className={`flex-1 h-0.5 ${step > s ? 'bg-green-500' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        <div className="px-8 py-6">

          {/* Step 1 — Enter credentials */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
                <strong>You need a Supabase account.</strong> If you don't have one, go to{' '}
                <button
                  onClick={() => window.api.shell.openExternal('https://supabase.com')}
                  className="underline font-semibold inline-flex items-center gap-0.5"
                >
                  supabase.com <ExternalLink size={10} />
                </button>{' '}
                and create a free account + new project. Then come back here.
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Database size={13} className="inline mr-1 text-green-600" />
                  Project URL
                </label>
                <input
                  className="input"
                  placeholder="https://xxxxxxxxxxxx.supabase.co"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setError('') }}
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-1">
                  Supabase Dashboard → Settings → API → Project URL
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API Key <span className="text-gray-400 font-normal">(service_role)</span>
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder="eyJhbGciOiJIUz..."
                    value={key}
                    onChange={(e) => { setKey(e.target.value); setError('') }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Supabase Dashboard → Settings → API → service_role key (Secret)
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              <button
                onClick={handleTest}
                disabled={testing || !url.trim() || !key.trim()}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {testing ? (
                  <><Loader size={15} className="animate-spin" /> Testing connection…</>
                ) : (
                  'Test & Connect →'
                )}
              </button>
            </div>
          )}

          {/* Step 2 — Run SQL */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                <strong>Almost there!</strong> Your credentials are correct, but the database tables haven't been created yet. Copy the script below and run it in your Supabase project.
              </div>

              <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
                <li>Go to your Supabase project dashboard</li>
                <li>Click <strong>SQL Editor</strong> in the left sidebar</li>
                <li>Click <strong>New query</strong></li>
                <li>Paste the script below and click <strong>Run</strong></li>
                <li>Come back here and click <strong>I've done this</strong></li>
              </ol>

              <div className="relative">
                <pre className="bg-gray-900 text-green-400 text-xs rounded-lg p-3 overflow-auto max-h-36 leading-relaxed">
                  {SQL_SCRIPT.slice(0, 300)}...
                </pre>
                <button
                  onClick={handleCopy}
                  className={`absolute top-2 right-2 text-xs px-2 py-1 rounded font-medium transition-colors ${
                    copied ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                  }`}
                >
                  {copied ? '✓ Copied!' : 'Copy script'}
                </button>
              </div>

              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => { setStep(1); setError('') }} className="btn-secondary flex-1">
                  ← Back
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <><Loader size={15} className="animate-spin" /> Connecting…</>
                  ) : (
                    "I've done this ✓"
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Success */}
          {step === 3 && (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <CheckCircle size={28} className="text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-800">Database connected!</h3>
              <p className="text-sm text-gray-500 mt-1">Setting up your lodge…</p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 pb-4">
          Each lodge has its own private, isolated database
        </p>
      </div>
    </div>
  )
}
