import { useState, useEffect, useCallback } from 'react';
import { Check, Clock, RefreshCw } from 'lucide-react';

function formatElapsed(value, now = Date.now()) {
  const started = new Date(value || now).getTime();
  if (!Number.isFinite(started)) return '0m';
  const minutes = Math.max(0, Math.floor((now - started) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function statusTone(status) {
  if (status === 'ready') return 'border-emerald-400 bg-emerald-500 text-white';
  if (status === 'preparing') return 'border-blue-400 bg-blue-500 text-white';
  return 'border-amber-400 bg-amber-400 text-slate-950';
}

export default function KitchenDisplay() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  const loadTickets = useCallback(async () => {
    try {
      const data = await window.api.pos.getTickets({ station: 'all' });
      setTickets((data || []).filter((t) => !['served', 'cancelled'].includes(String(t.status || '').toLowerCase())));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTickets();
    const interval = setInterval(() => { setNow(Date.now()); loadTickets(); }, 15000);
    return () => clearInterval(interval);
  }, [loadTickets]);

  const handleStatus = async (ticket, newStatus) => {
    try {
      await window.api.pos.updateTicketStatus({ ticketId: ticket.id, status: newStatus });
      await loadTickets();
    } catch (e) {
      console.error('Failed to update ticket:', e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="flex min-h-screen flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-slate-900 px-8 py-5">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-emerald-300">Tsa Bonno POS Legacy</p>
            <h1 className="mt-1 text-4xl font-bold">Kitchen Display</h1>
            <p className="mt-1 text-base text-slate-300">{tickets.length} active ticket(s)</p>
          </div>
          <div className="text-right text-sm text-slate-300">
            {new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex min-h-[70vh] items-center justify-center text-slate-300">
              <RefreshCw className="mr-3 animate-spin" /> Loading tickets...
            </div>
          ) : tickets.length === 0 ? (
            <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
              <Check size={58} className="text-emerald-300" />
              <h2 className="mt-5 text-4xl font-bold">All Clear</h2>
              <p className="mt-3 text-xl text-slate-300">No pending prep tickets.</p>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {tickets.map((ticket) => {
                const status = String(ticket.status || 'new').toLowerCase();
                return (
                  <article key={ticket.id} className={`flex min-h-[22rem] flex-col rounded-3xl border-2 p-5 shadow-2xl ${statusTone(status)}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-3xl font-black">
                          {ticket.table_name || ticket.tab_name || (ticket.room_id ? 'Room order' : 'POS order')}
                        </p>
                        <p className="mt-2 flex items-center gap-2 text-base font-bold opacity-80">
                          <Clock size={18} /> {formatElapsed(ticket.created_at, now)}
                        </p>
                      </div>
                      <span className="rounded-full bg-black/20 px-4 py-2 text-sm font-black uppercase tracking-[0.16em]">{status}</span>
                    </div>
                    {ticket.waiter_name && (
                      <p className="mt-3 text-base font-bold opacity-80">Served by {ticket.waiter_name}</p>
                    )}
                    <div className="mt-5 flex-1 space-y-3">
                      {(ticket.items || []).map((item, index) => (
                        <div key={`${item.item_name}-${index}`} className="rounded-2xl bg-black/18 px-4 py-3">
                          <div className="flex justify-between gap-4">
                            <span className="text-2xl font-black">{item.item_name}</span>
                            <span className="text-2xl font-black">x{item.quantity}</span>
                          </div>
                          {(item.modifiers?.length > 0 || item.item_notes) && (
                            <p className="mt-2 text-lg font-black text-white">
                              {[...(item.modifiers || []).map((mod) => mod.name), item.item_notes].filter(Boolean).join(' - ')}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                    {ticket.notes && (
                      <p className="mt-4 rounded-2xl bg-black/18 px-4 py-3 text-lg font-bold">{ticket.notes}</p>
                    )}
                    <div className="mt-5 grid grid-cols-2 gap-3">
                      {status !== 'preparing' && (
                        <button type="button" onClick={() => handleStatus(ticket, 'preparing')}
                          className="rounded-2xl bg-white px-5 py-4 text-lg font-black text-slate-950 shadow-lg active:scale-[0.99]">
                          Preparing
                        </button>
                      )}
                      {status !== 'ready' && (
                        <button type="button" onClick={() => handleStatus(ticket, 'ready')}
                          className="rounded-2xl bg-white px-5 py-4 text-lg font-black text-emerald-700 shadow-lg active:scale-[0.99]">
                          Ready
                        </button>
                      )}
                      <button type="button" onClick={() => handleStatus(ticket, 'served')}
                        className="rounded-2xl bg-slate-950 px-5 py-4 text-lg font-black text-white shadow-lg active:scale-[0.99]">
                        <Check className="mr-2 inline" size={20} /> Close
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
