import { useState, useEffect } from 'react';
import { Monitor, RefreshCw } from 'lucide-react';

const CURRENCY = 'P';
const fmt = (v) => Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CustomerDisplay() {
  const [display, setDisplay] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const load = async () => {
      try {
        const row = await window.api.pos.getCustomerDisplay();
        setDisplay(row || null);
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 15000);
    const clock = setInterval(() => setNow(Date.now()), 60000);
    return () => { clearInterval(interval); clearInterval(clock); };
  }, []);

  useEffect(() => {
    const handler = (e) => setDisplay(e.detail);
    window.addEventListener('customer-display-update', handler);
    return () => window.removeEventListener('customer-display-update', handler);
  }, []);

  const items = Array.isArray(display?.items) ? display.items : [];
  const hasOrder = items.length > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="flex min-h-screen flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-slate-900 px-8 py-5">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-emerald-300">
              {display?.lodge_name || 'Tsa Bonno POS Legacy'}
            </p>
            <h1 className="mt-1 text-4xl font-bold">
              {hasOrder ? (display?.table_name ? `Table ${display.table_name}` : 'Current order') : 'Welcome'}
            </h1>
          </div>
          <div className="text-right text-sm text-slate-300">
            {new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex min-h-[70vh] items-center justify-center text-slate-300">
              <RefreshCw className="mr-3 animate-spin" /> Loading display...
            </div>
          ) : hasOrder ? (
            <div className="grid min-h-[70vh] gap-6 lg:grid-cols-[1fr_26rem]">
              <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="text-2xl font-bold">Your Order</h2>
                  {display?.staff_name && (
                    <span className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200">
                      Served by {display.staff_name}
                    </span>
                  )}
                </div>
                <div className="space-y-3">
                  {items.map((item, index) => (
                    <div key={`${item.item_name}-${index}`} className="rounded-2xl border border-white/10 bg-slate-900/80 p-5">
                      <div className="flex items-start justify-between gap-6">
                        <div className="min-w-0">
                          <p className="truncate text-2xl font-bold">{item.item_name}</p>
                          {(item.modifiers?.length > 0 || item.item_notes) && (
                            <p className="mt-2 text-base font-semibold text-amber-200">
                              {[...(item.modifiers || []).map((mod) => mod.name), item.item_notes].filter(Boolean).join(' - ')}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xl font-bold">x{Number(item.quantity || 0)}</p>
                          <p className="mt-1 text-lg text-slate-300">
                            {CURRENCY} {fmt(Number(item.quantity || 0) * Number(item.unit_price || 0))}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <aside className="flex flex-col justify-end rounded-3xl border border-emerald-400/30 bg-emerald-500/10 p-6">
                <div className="space-y-4 text-xl">
                  {Number(display?.discount_total || 0) > 0 && (
                    <div className="flex justify-between text-amber-200">
                      <span>Discount</span>
                      <strong>-{CURRENCY} {fmt(display.discount_total)}</strong>
                    </div>
                  )}
                  {Number(display?.tax_total || 0) > 0 && (
                    <div className="flex justify-between text-slate-200">
                      <span>Tax</span>
                      <strong>{CURRENCY} {fmt(display.tax_total)}</strong>
                    </div>
                  )}
                </div>
                <div className="mt-8 border-t border-white/10 pt-6">
                  <p className="text-lg font-bold uppercase tracking-[0.18em] text-emerald-200">Total Due</p>
                  <p className="mt-2 text-6xl font-black">{CURRENCY} {fmt(display?.total)}</p>
                </div>
              </aside>
            </div>
          ) : (
            <div className="flex min-h-[70vh] flex-col items-center justify-center rounded-3xl border border-white/10 bg-white/[0.03] text-center">
              <Monitor size={58} className="text-emerald-300" />
              <h2 className="mt-5 text-4xl font-bold">Welcome</h2>
              <p className="mt-3 max-w-xl text-xl text-slate-300">
                Your order will appear here as items are added at the POS.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
