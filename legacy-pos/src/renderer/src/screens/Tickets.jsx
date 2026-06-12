import { useState, useEffect, useCallback } from 'react';
import { Clock, Check, RefreshCw } from 'lucide-react';

function formatElapsed(value, now = Date.now()) {
  const started = new Date(value || now).getTime();
  if (!Number.isFinite(started)) return '0m';
  const minutes = Math.max(0, Math.floor((now - started) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function statusTone(status) {
  if (status === 'ready') return 'border-emerald-400 bg-emerald-50 text-emerald-800';
  if (status === 'preparing') return 'border-blue-400 bg-blue-50 text-blue-800';
  return 'border-amber-300 bg-amber-50 text-amber-800';
}

export default function Tickets({ user, settings, isOnline }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [station, setStation] = useState('all');

  const loadTickets = useCallback(async () => {
    try {
      const data = await window.api.pos.getTickets({ station });
      setTickets((data || []).filter((t) => !['served', 'cancelled'].includes(String(t.status || '').toLowerCase())));
    } catch (e) {
      console.error('Failed to load tickets:', e);
    } finally {
      setLoading(false);
    }
  }, [station]);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  useEffect(() => {
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
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Kitchen / Prep Tickets</h1>
        <div className="flex items-center gap-3">
          <select value={station} onChange={(e) => setStation(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
            <option value="all">All Stations</option>
            <option value="kitchen">Kitchen</option>
            <option value="bar">Bar</option>
          </select>
          <button onClick={loadTickets} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
            <RefreshCw className="inline h-4 w-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex py-12 justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        </div>
      ) : tickets.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">No active tickets</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tickets.map((ticket) => {
            const status = String(ticket.status || 'new').toLowerCase();
            return (
              <div key={ticket.id} className={`rounded-xl border-2 p-4 ${statusTone(status)}`}>
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <p className="text-lg font-bold">{ticket.table_name || ticket.tab_name || (ticket.room_id ? 'Room order' : 'POS order')}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs opacity-75">
                      <Clock className="h-3 w-3" /> {formatElapsed(ticket.created_at, now)}
                    </p>
                  </div>
                  <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-bold uppercase">{status}</span>
                </div>
                {ticket.waiter_name && <p className="mb-2 text-xs font-semibold opacity-75">Served by {ticket.waiter_name}</p>}
                <div className="mb-3 space-y-1">
                  {(ticket.items || []).map((item, idx) => (
                    <div key={idx} className="flex justify-between rounded bg-black/10 px-2 py-1 text-sm">
                      <span className="font-bold">{item.item_name}</span>
                      <span className="font-bold">x{item.quantity}</span>
                    </div>
                  ))}
                </div>
                {ticket.notes && <p className="mb-3 rounded bg-black/10 px-2 py-1 text-xs">{ticket.notes}</p>}
                <div className="grid grid-cols-2 gap-2">
                  {status !== 'preparing' && (
                    <button onClick={() => handleStatus(ticket, 'preparing')} className="rounded-lg bg-white px-3 py-2 text-xs font-bold shadow hover:shadow-md">
                      Preparing
                    </button>
                  )}
                  {status !== 'ready' && (
                    <button onClick={() => handleStatus(ticket, 'ready')} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-emerald-700 shadow hover:shadow-md">
                      Ready
                    </button>
                  )}
                  <button onClick={() => handleStatus(ticket, 'served')} className="col-span-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white shadow hover:shadow-md">
                    <Check className="mr-1 inline h-3 w-3" /> Close
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
