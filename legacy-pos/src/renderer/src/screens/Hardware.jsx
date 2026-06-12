import { useState, useEffect, useCallback } from 'react';
import { Monitor, Save, TestTube } from 'lucide-react';

const HARDWARE_FIELDS = [
  { key: 'receipt_printer_name', label: 'Receipt Printer', type: 'text', placeholder: 'Default printer name' },
  { key: 'receipt_paper_width', label: 'Paper Width', type: 'select', options: ['80mm', '58mm'] },
  { key: 'receipt_print_mode', label: 'Print Mode', type: 'select', options: ['windows', 'escpos'] },
  { key: 'auto_print_receipts', label: 'Auto Print Receipts', type: 'checkbox' },
  { key: 'receipt_cut_enabled', label: 'Auto Cut Paper', type: 'checkbox' },
  { key: 'cash_drawer_enabled', label: 'Cash Drawer Enabled', type: 'checkbox' },
  { key: 'cash_drawer_open_on_cash', label: 'Open Drawer on Cash Sale', type: 'checkbox' },
  { key: 'cash_drawer_open_timing', label: 'Drawer Open Timing', type: 'select', options: ['after_payment', 'before_receipt'] },
  { key: 'cash_drawer_pin', label: 'Drawer Pin', type: 'select', options: ['0', '1'] },
  { key: 'cash_drawer_pulse_on_ms', label: 'Pulse ON (ms)', type: 'number', min: 10, max: 2550 },
  { key: 'cash_drawer_pulse_off_ms', label: 'Pulse OFF (ms)', type: 'number', min: 10, max: 2550 },
  { key: 'escpos_enabled', label: 'ESC/POS Direct', type: 'checkbox' },
  { key: 'escpos_connection_type', label: 'Connection Type', type: 'select', options: ['network', 'path', 'share', 'serial'] },
  { key: 'escpos_network_host', label: 'Network Host', type: 'text', placeholder: '192.168.1.100' },
  { key: 'escpos_network_port', label: 'Network Port', type: 'number', min: 1, max: 65535 },
  { key: 'escpos_printer_path', label: 'Printer Path', type: 'text', placeholder: '\\\\server\\printer or COM1' },
  { key: 'escpos_codepage', label: 'Codepage', type: 'select', options: ['cp437', 'cp850', 'cp858', 'cp860', 'cp863', 'cp865'] },
  { key: 'escpos_timeout_ms', label: 'Timeout (ms)', type: 'number', min: 1500, max: 60000 },
  { key: 'customer_display_enabled', label: 'Customer Display', type: 'checkbox' }
];

export default function Hardware({ user, settings, isOnline }) {
  const [hwSettings, setHwSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [testKind, setTestKind] = useState('');

  const loadSettings = useCallback(async () => {
    try {
      const s = await window.api.pos.getHardwareSettings();
      setHwSettings(s || {});
    } catch (e) {
      console.error('Failed to load hardware settings:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await window.api.pos.saveHardwareSettings(hwSettings);
      alert('Hardware settings saved.');
    } catch (e) {
      alert(e?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (kind) => {
    setTestKind(kind);
    setTestResult('');
    try {
      const result = await window.api.pos.testHardware({ kind, settings: hwSettings, business: settings || {} });
      setTestResult(result?.success ? (result?.message || 'Test passed.') : (result?.error || 'Test failed.'));
    } catch (e) {
      setTestResult(e?.message || 'Test failed.');
    } finally {
      setTestKind('');
    }
  };

  const updateField = (key, value) => {
    setHwSettings((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="flex py-12 justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Hardware Setup</h1>
        <button onClick={handleSave} disabled={saving}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          <Save className="mr-1 inline h-4 w-4" /> {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 font-bold text-slate-800">Receipt Printer</h2>
          <div className="space-y-3">
            {HARDWARE_FIELDS.filter((f) => ['receipt_printer_name', 'receipt_paper_width', 'receipt_print_mode', 'auto_print_receipts', 'receipt_cut_enabled'].includes(f.key)).map((field) => (
              <div key={field.key}>
                <label className="text-xs font-medium text-slate-500">{field.label}</label>
                {field.type === 'checkbox' ? (
                  <label className="mt-1 flex items-center gap-2">
                    <input type="checkbox" checked={hwSettings[field.key] || false}
                      onChange={(e) => updateField(field.key, e.target.checked)} className="rounded border-slate-300" />
                    <span className="text-sm">{hwSettings[field.key] ? 'Enabled' : 'Disabled'}</span>
                  </label>
                ) : field.type === 'select' ? (
                  <select value={hwSettings[field.key] || ''} onChange={(e) => updateField(field.key, e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={field.type} value={hwSettings[field.key] || ''} placeholder={field.placeholder || ''}
                    onChange={(e) => updateField(field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 font-bold text-slate-800">ESC/POS Connection</h2>
          <div className="space-y-3">
            {HARDWARE_FIELDS.filter((f) => f.key.startsWith('escpos_')).map((field) => (
              <div key={field.key}>
                <label className="text-xs font-medium text-slate-500">{field.label}</label>
                {field.type === 'checkbox' ? (
                  <label className="mt-1 flex items-center gap-2">
                    <input type="checkbox" checked={hwSettings[field.key] || false}
                      onChange={(e) => updateField(field.key, e.target.checked)} className="rounded border-slate-300" />
                    <span className="text-sm">{hwSettings[field.key] ? 'Enabled' : 'Disabled'}</span>
                  </label>
                ) : field.type === 'select' ? (
                  <select value={hwSettings[field.key] || ''} onChange={(e) => updateField(field.key, e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={field.type} value={hwSettings[field.key] || ''} placeholder={field.placeholder || ''}
                    min={field.min} max={field.max}
                    onChange={(e) => updateField(field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 font-bold text-slate-800">Cash Drawer</h2>
          <div className="space-y-3">
            {HARDWARE_FIELDS.filter((f) => f.key.startsWith('cash_drawer_')).map((field) => (
              <div key={field.key}>
                <label className="text-xs font-medium text-slate-500">{field.label}</label>
                {field.type === 'checkbox' ? (
                  <label className="mt-1 flex items-center gap-2">
                    <input type="checkbox" checked={hwSettings[field.key] || false}
                      onChange={(e) => updateField(field.key, e.target.checked)} className="rounded border-slate-300" />
                    <span className="text-sm">{hwSettings[field.key] ? 'Enabled' : 'Disabled'}</span>
                  </label>
                ) : field.type === 'select' ? (
                  <select value={hwSettings[field.key] || ''} onChange={(e) => updateField(field.key, e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={field.type} value={hwSettings[field.key] || ''} placeholder={field.placeholder || ''}
                    min={field.min} max={field.max}
                    onChange={(e) => updateField(field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 font-bold text-slate-800">Display & Tests</h2>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hwSettings.customer_display_enabled || false}
                onChange={(e) => updateField('customer_display_enabled', e.target.checked)} className="rounded border-slate-300" />
              Customer Display Enabled
            </label>
            <hr className="border-slate-100" />
            <p className="text-xs font-medium text-slate-500">Hardware Tests</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => handleTest('receipt')} disabled={!!testKind}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-50">
                <TestTube className="mr-1 inline h-3 w-3" /> Test Printer
              </button>
              <button onClick={() => handleTest('drawer')} disabled={!!testKind}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-50">
                <TestTube className="mr-1 inline h-3 w-3" /> Test Drawer
              </button>
              <button onClick={() => window.api.pos.openCustomerDisplay()}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium hover:bg-slate-50">
                <Monitor className="mr-1 inline h-3 w-3" /> Customer Display
              </button>
              <button onClick={() => window.api.pos.openKitchenDisplay()}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium hover:bg-slate-50">
                <Monitor className="mr-1 inline h-3 w-3" /> Kitchen Display
              </button>
            </div>
            {testResult && (
              <p className={`rounded-lg px-3 py-2 text-xs ${testResult.includes('success') || testResult.includes('sent') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {testResult}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
