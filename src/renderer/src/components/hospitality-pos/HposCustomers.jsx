// @ts-check
import { useEffect, useMemo, useState } from 'react';
import {
  Mail,
  Megaphone,
  Pencil,
  Phone,
  Plus,
  Search,
  Star,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useAccess, useAuth, useSettings } from '../../app-context';
import { canAccessCapability } from '../../../../shared/accessControl';
import { isBarOnlyMode } from '../../../../shared/propertyTypes';
import { loadCompleteBarList } from '../../../../shared/barLocalPagination.js';
import { readPendingCustomerIntent, submitLocalCustomer } from './bar-local/hposCustomerApi.js';
import {
  HposButton,
  HposEmptyState,
  HposNotice,
  HposPageHero,
  HposStatusBadge,
} from './HposUi';

const EMPTY_CUSTOMER = {
  name: '',
  phone: '',
  email: '',
  notes: '',
  marketing_opt_in: false,
};

export default function HposCustomers() {
  const access = useAccess();
  const { user } = useAuth();
  const localAuthority = user?.localAuthority === true;
  const { settings } = useSettings();
  const currency = settings?.currency || 'P';
  const barOnly = isBarOnlyMode(settings);
  const canManage = canAccessCapability(access, 'pos.manage');
  const canManageLocal = canAccessCapability(access, 'customers.manage');
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(EMPTY_CUSTOMER);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingLocalCustomer, setPendingLocalCustomer] = useState(() => readPendingCustomerIntent(window.localStorage));

  const loadCustomers = async () => {
    if (localAuthority) {
      const rows = await loadCompleteBarList((name, filters) => window.api.barLocal.query(name, filters), 'customers.list');
      setCustomers(rows.map((row) => ({
        id: row.customer_id,
        name: row.name,
        phone: row.phone,
        email: row.email,
        outstanding: row.outstanding,
        credit_limit: row.credit_limit,
        status: row.status,
        total_visits: null,
        total_spent: null,
        loyalty_points: null
      })))
      return
    }
    const data = (await window.api?.pos?.getCustomers?.()) ?? [];
    setCustomers(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        await loadCustomers();
      } catch (loadError) {
        if (active) setError(loadError?.message || 'Customer accounts could not be loaded.');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [localAuthority]);

  const openCreate = () => {
    setEditing({});
    setDraft(EMPTY_CUSTOMER);
    setError('');
  };

  const openEdit = (customer) => {
    setEditing(customer);
    setDraft({
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      notes: customer.notes || '',
      marketing_opt_in: customer.marketing_opt_in === true,
    });
    setError('');
  };

  const saveCustomer = async (event) => {
    event.preventDefault();
    if (localAuthority) {
      if (editing?.id) { setError('Editing an existing local customer is not supported yet. No change was made.'); return; }
      if (!canManageLocal || pendingLocalCustomer) return;
      if (!draft.name.trim()) { setError('A customer name is required.'); return; }
      setSaving(true); setError(''); setNotice('');
      try {
        const payload = { name: draft.name.trim(), ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}), ...(draft.email.trim() ? { email: draft.email.trim() } : {}) };
        await submitLocalCustomer({ storage: window.localStorage, command: (intent) => window.api.barLocal.command(intent), payload });
        setPendingLocalCustomer(null);
        setNotice('Customer account saved in the local Bar database.');
        setEditing(null); setDraft(EMPTY_CUSTOMER);
        await loadCustomers();
      } catch (saveError) {
        setPendingLocalCustomer(readPendingCustomerIntent(window.localStorage));
        setError(saveError?.message || 'The local authority did not confirm the customer account.');
      } finally { setSaving(false); }
      return;
    }
    if (!draft.name.trim()) {
      setError('A customer name is required.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await window.api?.pos?.saveCustomer?.({
        id: editing?.id || null,
        name: draft.name.trim(),
        phone: draft.phone.trim() || null,
        email: draft.email.trim() || null,
        notes: draft.notes.trim() || null,
        marketing_opt_in: draft.marketing_opt_in,
      });
      if (!result?.success) throw new Error(result?.error || 'Could not save customer.');
      setNotice(editing?.id ? 'Customer account updated.' : 'Customer account created.');
      setEditing(null);
      setDraft(EMPTY_CUSTOMER);
      await loadCustomers();
    } catch (saveError) {
      setError(saveError?.message || 'Could not save customer.');
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return customers.filter(
      (customer) =>
        !query ||
        String(customer.name || '').toLowerCase().includes(query) ||
        String(customer.phone || '').toLowerCase().includes(query) ||
        String(customer.email || '').toLowerCase().includes(query),
    );
  }, [customers, search]);

  const loyaltyMembers = localAuthority ? null : customers.filter((row) => Number(row.loyalty_points || 0) > 0).length;
  const returningCustomers = localAuthority ? null : customers.filter((row) => Number(row.total_visits || 0) > 1).length;

  return (
    <div className="hpos-page-frame hpos-customers-page">
      <HposPageHero
        eyebrow={barOnly ? 'Bar customer growth' : 'Guest relationships'}
        title="Customers & loyalty"
        description={barOnly ? 'Recognise regular customers, manage loyalty details, and keep useful service notes without slowing the till.' : 'Recognise returning guests, keep useful service notes, and find contact details without leaving the POS.'}
        actions={localAuthority ? canManageLocal && !pendingLocalCustomer ? <HposButton tone="primary" icon={Plus} onClick={openCreate}>Add customer</HposButton> : null : canManage ? <HposButton tone="primary" icon={Plus} onClick={openCreate}>Add customer</HposButton> : null}
      />
      {localAuthority && <HposNotice tone="warning">Customer records are read from the local Bar database. New customer accounts can be saved with a name and optional contact details. Notes, marketing consent, history, loyalty changes, credit changes and editing existing customers are not available in this local workflow.</HposNotice>}
      {localAuthority && pendingLocalCustomer && <section className="hpos-money-ledger" aria-live="polite"><strong>Saved customer submission needs resolution</strong><p>The original name, contact details and operation ID remain saved on this device. Submit again only to resolve that same operation; do not create another account.</p><HposButton tone="primary" disabled={saving} onClick={async () => { setSaving(true); setError(''); try { await submitLocalCustomer({ storage: window.localStorage, command: (intent) => window.api.barLocal.command(intent) }); setPendingLocalCustomer(null); setNotice('Saved customer submission was confirmed by the local authority.'); await loadCustomers(); } catch (cause) { setError(cause?.message || 'The saved customer result remains unresolved.'); setPendingLocalCustomer(readPendingCustomerIntent(window.localStorage)); } finally { setSaving(false); } }}>{saving ? 'Checking saved submission…' : 'Retry saved submission'}</HposButton></section>}
      {error && !editing && <HposNotice tone="error">{error}</HposNotice>}
      {notice && <HposNotice>{notice}</HposNotice>}

      <section className="hpos-customer-summary">
        <article><UsersRound size={19} /><small>Customer accounts</small><strong>{loading ? '—' : customers.length}</strong></article>
        <article><Star size={19} /><small>Loyalty members</small><strong>{loading || localAuthority ? '—' : loyaltyMembers}</strong></article>
        <article><UserRound size={19} /><small>{barOnly ? 'Regular customers' : 'Returning guests'}</small><strong>{loading || localAuthority ? '—' : returningCustomers}</strong></article>
        <label className="hpos-customer-search">
          <Search size={17} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone or email" />
        </label>
      </section>

      {loading ? (
        <div className="hpos-list-loading">Loading customer accounts…</div>
      ) : filtered.length === 0 ? (
        <HposEmptyState
          icon={UserRound}
          title={search ? 'No matching customer' : 'No customer accounts yet'}
          description={search ? 'Try a different name, phone number, or email address.' : 'Customer accounts created here can be selected during service.'}
        />
      ) : (
        <section className="hpos-customer-grid">
          {filtered.map((customer) => (
            <article key={customer.id} className="hpos-customer-card">
              <div className="hpos-customer-card-head">
                <span className="hpos-customer-avatar">{customer.name?.charAt(0)?.toUpperCase() || '?'}</span>
                <div>
                  <strong>{customer.name || 'Unnamed customer'}</strong>
                  <span>{Number(customer.total_visits || 0) > 1 ? (barOnly ? 'Regular customer' : 'Returning guest') : 'Customer account'}</span>
                </div>
                {canManage && !localAuthority && (
                  <button type="button" className="hpos-icon-action" onClick={() => openEdit(customer)} aria-label={`Edit ${customer.name}`} title="Edit customer">
                    <Pencil size={15} />
                  </button>
                )}
              </div>
              <div className="hpos-customer-contact">
                {customer.phone ? <span><Phone size={14} />{customer.phone}</span> : <span className="is-muted"><Phone size={14} />No phone</span>}
                {customer.email ? <span><Mail size={14} />{customer.email}</span> : <span className="is-muted"><Mail size={14} />No email</span>}
              </div>
              {!localAuthority && customer.notes && <p className="hpos-customer-note">{customer.notes}</p>}
              <footer>
                {!localAuthority && <><div><small>Visits</small><strong>{customer.total_visits || 0}</strong></div>
                <div><small>Recorded spend</small><strong>{currency} {Number(customer.total_spent || 0).toFixed(2)}</strong></div></>}
                {localAuthority ? <div><small>Outstanding credit</small><strong>{currency} {Number(customer.outstanding || 0).toFixed(2)}</strong></div> : <HposStatusBadge tone={Number(customer.loyalty_points || 0) > 0 ? 'warning' : 'neutral'}>
                  <Star size={11} /> {Number(customer.loyalty_points || 0)} points
                </HposStatusBadge>}
              </footer>
            </article>
          ))}
        </section>
      )}

      {editing && (
        <div className="hpos-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditing(null)}>
          <form className="hpos-customer-modal" onSubmit={saveCustomer} role="dialog" aria-modal="true" aria-labelledby="customer-dialog-title">
            <button type="button" className="hpos-modal-close" onClick={() => setEditing(null)} aria-label="Close"><X size={18} /></button>
            <p className="hpos-eyebrow">Customer account</p>
            <h2 id="customer-dialog-title">{editing.id ? 'Edit customer' : 'New customer'}</h2>
            <p>Keep only details that help the team serve this customer well.</p>
            <div className="hpos-form-grid">
              <label className="is-wide">Name<input autoFocus required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Customer name" /></label>
              <label>Phone<input type="tel" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} placeholder="+267 …" /></label>
              <label>Email<input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="customer@example.com" /></label>
              {!localAuthority && <label className="is-wide">Service notes<textarea rows="3" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Preferences or useful service context" /></label>}
            </div>
            {!localAuthority && <label className="hpos-consent-row">
              <input type="checkbox" checked={draft.marketing_opt_in} onChange={(event) => setDraft({ ...draft, marketing_opt_in: event.target.checked })} />
              <Megaphone size={17} />
              <span><strong>Marketing permission recorded</strong><small>Enable only when the customer has explicitly opted in.</small></span>
            </label>}
            {error && <HposNotice tone="error">{error}</HposNotice>}
            <div className="hpos-modal-actions">
              <HposButton onClick={() => setEditing(null)}>Cancel</HposButton>
              <HposButton type="submit" tone="primary" disabled={saving || (localAuthority && (!canManageLocal || pendingLocalCustomer))}>{saving ? 'Saving…' : 'Save customer'}</HposButton>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
