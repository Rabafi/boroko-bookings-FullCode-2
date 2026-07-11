import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, RefreshCw, Check, X, AlertTriangle, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { Modal } from './shared/Modal'

const PROVIDERS = [
  { key: 'dpo', label: 'DPO' },
  { key: 'paygate', label: 'PayGate' },
  { key: 'paystack', label: 'PayStack' },
  { key: 'flutterwave', label: 'Flutterwave' },
  { key: 'stripe', label: 'Stripe' },
  { key: 'manual_adapter', label: 'Manual / Cash' }
]

const emptyForm = {
  provider: '',
  label: '',
  mode: 'test',
  public_key: '',
  secret_key: '',
  webhook_secret: '',
  merchant_account_id: '',
  country: 'BW',
  currency: 'BWP',
  default_currency: 'BWP',
  supported_currencies: ['BWP'],
  allowed_payment_methods: ['card', 'mobile_money']
}

export default function PaymentGatewayConfig() {
  const [configs, setConfigs] = useState([])
  const [dashboard, setDashboard] = useState({ recent_transactions: [], pending_transactions: [], failed_transactions: [] })
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [showSecrets, setShowSecrets] = useState({})
  const [testResult, setTestResult] = useState(null)
  const [signatureTest, setSignatureTest] = useState({
    provider: '',
    signature: '',
    payload: '{"event_id":"sandbox_event","status":"completed","amount":1,"currency":"BWP"}',
    timestamp: ''
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [configData, dashData] = await Promise.all([
        window.api.payments.getProviderConfig().catch(() => []),
        window.api.payments.getPaymentDashboard().catch(() => ({ recent_transactions: [], pending_transactions: [], failed_transactions: [] }))
      ])
      setConfigs(Array.isArray(configData) ? configData : [])
      if (Array.isArray(configData) && configData.length > 0) {
        setSignatureTest((current) => current.provider ? current : ({ ...current, provider: configData[0].provider || '' }))
      }
      setDashboard(dashData)
    } catch (err) {
      setError(err?.message || 'Failed to load payment config')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(''), 3000)
    return () => clearTimeout(timer)
  }, [success])

  const openAdd = () => { setEditing(null); setForm(emptyForm); setError(''); setShowModal(true) }
  const openEdit = (c) => {
    setEditing(c.id)
    setForm({
      provider: c.provider || '',
      label: c.label || '',
      mode: c.mode || 'test',
      public_key: c.public_key || '',
      secret_key: '',
      webhook_secret: '',
      merchant_account_id: c.merchant_account_id || '',
      country: c.country || 'BW',
      currency: c.currency || 'BWP',
      default_currency: c.default_currency || 'BWP',
      supported_currencies: c.supported_currencies || ['BWP'],
      allowed_payment_methods: c.allowed_payment_methods || ['card', 'mobile_money']
    })
    setError('')
    setShowModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.provider) { setError('Provider is required'); return }
    setSaving(true)
    setError('')
    try {
      await window.api.payments.saveProviderConfig(form)
      setShowModal(false)
      setSuccess('Payment config saved')
      load()
    } catch (err) {
      setError(err?.message || 'Failed to save config')
    } finally {
      setSaving(false)
    }
  }

  const handleVerifySignature = async () => {
    setTestResult(null)
    setError('')
    if (!signatureTest.provider) { setError('Provider is required'); return }
    if (!signatureTest.signature.trim()) { setError('Webhook signature is required'); return }
    try {
      const result = await window.api.payments.verifyWebhookSignature(
        signatureTest.provider,
        signatureTest.signature.trim(),
        signatureTest.payload,
        signatureTest.timestamp || null
      )
      setTestResult(result)
      if (result?.verified) setSuccess('Webhook signature verified')
    } catch (err) {
      setError(err?.message || 'Signature verification failed')
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin w-6 h-6 text-gray-400" /></div>

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Payment Gateway Configuration</h1>
        <button onClick={openAdd} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-1"><Plus className="w-4 h-4" />Add Provider</button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700"><AlertTriangle className="w-4 h-4" />{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700"><Check className="w-4 h-4" />{success}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border">
          <div className="p-4 border-b">
            <h3 className="font-semibold">Configured Providers</h3>
          </div>
          <div className="p-4 space-y-3">
            {configs.length === 0 ? (
              <div className="text-gray-500 text-sm">No payment providers configured</div>
            ) : configs.map(c => (
              <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <div className="font-medium">{c.label || c.provider}</div>
                  <div className="text-xs text-gray-500">{c.provider} | {c.mode} | {c.currency}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${c.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{c.is_active ? 'Active' : 'Inactive'}</span>
                  <button onClick={() => openEdit(c)} className="p-1 hover:bg-gray-100 rounded"><Pencil className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
            <button onClick={openAdd} className="w-full p-3 border-2 border-dashed rounded-lg text-gray-400 hover:text-gray-600 hover:border-gray-300 text-sm">+ Add Provider</button>
          </div>
        </div>

        <div className="bg-white rounded-xl border">
          <div className="p-4 border-b">
            <h3 className="font-semibold">Recent Transactions</h3>
          </div>
          <div className="p-4">
            {(!Array.isArray(dashboard.recent_transactions) || dashboard.recent_transactions.length === 0) ? (
              <div className="text-gray-500 text-sm">No transactions yet</div>
            ) : (
              <div className="space-y-2">
                {dashboard.recent_transactions.slice(0, 5).map(t => (
                  <div key={t.id} className="flex items-center justify-between p-2 border rounded text-sm">
                    <div>
                      <div className="font-medium">{t.provider}</div>
                      <div className="text-xs text-gray-500">{new Date(t.created_at).toLocaleString()}</div>
                    </div>
                    <div className="text-right">
                      <div>{t.currency} {Number(t.amount).toFixed(2)}</div>
                      <span className={`px-1.5 py-0.5 rounded text-xs ${t.status === 'completed' ? 'bg-green-100 text-green-800' : t.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>{t.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border">
          <div className="p-4 border-b">
            <h3 className="font-semibold">Failed Transactions</h3>
          </div>
          <div className="p-4">
            {(!Array.isArray(dashboard.failed_transactions) || dashboard.failed_transactions.length === 0) ? (
              <div className="text-gray-500 text-sm">No failed transactions</div>
            ) : (
              <div className="space-y-2">
                {dashboard.failed_transactions.map(t => (
                  <div key={t.id} className="p-2 border rounded text-sm bg-red-50">
                    <div className="font-medium">{t.provider} - {t.currency} {Number(t.amount).toFixed(2)}</div>
                    <div className="text-xs text-red-600">{t.error_message || 'Unknown error'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border">
          <div className="p-4 border-b">
            <h3 className="font-semibold">Webhook Signature Check</h3>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-sm text-gray-500">Verify a sandbox provider signature without creating a payment or settling a booking.</p>
            <div>
              <label className="block text-sm font-medium mb-1">Provider</label>
              <select value={signatureTest.provider} onChange={e => setSignatureTest({ ...signatureTest, provider: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">Select...</option>
                {configs.map(c => <option key={c.id || c.provider} value={c.provider}>{c.label || c.provider}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Signature</label>
              <input value={signatureTest.signature} onChange={e => setSignatureTest({ ...signatureTest, signature: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="provider signature" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Timestamp</label>
              <input value={signatureTest.timestamp} onChange={e => setSignatureTest({ ...signatureTest, timestamp: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="optional provider timestamp" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Payload</label>
              <textarea value={signatureTest.payload} onChange={e => setSignatureTest({ ...signatureTest, payload: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm min-h-[90px] font-mono" />
            </div>
            <button onClick={handleVerifySignature} className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 flex items-center gap-1"><ShieldCheck className="w-4 h-4" />Verify Signature</button>
            {testResult && (
              <div className="p-3 bg-green-50 border rounded-lg text-sm">
                <div className="font-medium text-green-800">Verification Result</div>
                <pre className="text-xs text-green-700 mt-1 overflow-auto">{JSON.stringify(testResult, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <Modal title={editing ? 'Edit Provider' : 'Add Provider'} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium mb-1">Provider</label>
                <select value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required>
                  <option value="">Select...</option>
                  {PROVIDERS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select></div>
              <div><label className="block text-sm font-medium mb-1">Mode</label>
                <select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="test">Test</option>
                  <option value="live">Live</option>
                </select></div>
            </div>
            <div><label className="block text-sm font-medium mb-1">Label</label>
              <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="My Payment Provider" /></div>
            <div><label className="block text-sm font-medium mb-1">Public Key</label>
              <input value={form.public_key} onChange={e => setForm({ ...form, public_key: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="pk_..." /></div>
            <div className="relative"><label className="block text-sm font-medium mb-1">Secret Key</label>
              <div className="flex gap-2">
                <input type={showSecrets.secret_key ? 'text' : 'password'} value={form.secret_key} onChange={e => setForm({ ...form, secret_key: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="sk_..." />
                <button type="button" onClick={() => setShowSecrets({ ...showSecrets, secret_key: !showSecrets.secret_key })} className="p-2 border rounded-lg hover:bg-gray-50">{showSecrets.secret_key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </div></div>
            <div className="relative"><label className="block text-sm font-medium mb-1">Webhook Secret</label>
              <div className="flex gap-2">
                <input type={showSecrets.webhook_secret ? 'text' : 'password'} value={form.webhook_secret} onChange={e => setForm({ ...form, webhook_secret: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="whsec_..." />
                <button type="button" onClick={() => setShowSecrets({ ...showSecrets, webhook_secret: !showSecrets.webhook_secret })} className="p-2 border rounded-lg hover:bg-gray-50">{showSecrets.webhook_secret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </div></div>
            <div><label className="block text-sm font-medium mb-1">Merchant Account ID</label>
              <input value={form.merchant_account_id} onChange={e => setForm({ ...form, merchant_account_id: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium mb-1">Default Currency</label>
                <input value={form.default_currency} onChange={e => setForm({ ...form, default_currency: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="BWP" /></div>
              <div><label className="block text-sm font-medium mb-1">Country</label>
                <input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="BW" /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
