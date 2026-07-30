import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ClipboardList,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import { useAccess, useSettings } from '../../app-context';
import { canAccessCapability } from '../../../../shared/accessControl';
import { isBarOnlyMode } from '../../../../shared/propertyTypes';
import {
  HposButton,
  HposEmptyState,
  HposNotice,
  HposPageHero,
  HposStatusBadge,
} from './HposUi';

const isComplete = (item) => item.completed === true || item.is_completed === true;
const itemLabel = (item) => item.text || item.item_label || item.label || 'Checklist item';

export default function HposControl() {
  const navigate = useNavigate();
  const access = useAccess();
  const { settings } = useSettings();
  const barOnly = isBarOnlyMode(settings);
  const canManage = canAccessCapability(access, 'pos.manage');
  const [checklists, setChecklists] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [activeTab, setActiveTab] = useState('checklists');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setActionError('');
    try {
      const [checklistResult, alertResult] = await Promise.all([
        window.api?.pos?.getChecklists?.() ?? [],
        window.api?.pos?.getActiveAlerts?.() ?? [],
      ]);
      setChecklists(Array.isArray(checklistResult) ? checklistResult : []);
      setAlerts(Array.isArray(alertResult) ? alertResult : []);
    } catch (error) {
      setActionError(error?.message || 'Control information could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openItems = useMemo(
    () => checklists.reduce((count, checklist) => count + (checklist.items || []).filter((item) => !isComplete(item)).length, 0),
    [checklists],
  );

  const toggleChecklistItem = async (item) => {
    if (isComplete(item) || !item.id || !canManage) return;
    setBusyId(item.id);
    setActionError('');
    setNotice('');
    try {
      const result = await window.api?.pos?.completeChecklistItem?.({ itemId: item.id });
      if (!result?.success) throw new Error(result?.error || 'Could not complete this item.');
      setChecklists((previous) =>
        previous.map((checklist) => ({
          ...checklist,
          items: (checklist.items || []).map((entry) =>
            entry.id === item.id ? { ...entry, completed: true, is_completed: true } : entry,
          ),
        })),
      );
      setNotice(`Completed: ${itemLabel(item)}`);
    } catch (error) {
      setActionError(error?.message || 'Could not complete this item.');
    } finally {
      setBusyId('');
    }
  };

  const resolveAlert = async (alert) => {
    if (!alert.id || !canManage) return;
    setBusyId(alert.id);
    setActionError('');
    setNotice('');
    try {
      const result = await window.api?.pos?.resolveAlert?.(alert.id);
      if (!result?.success) throw new Error(result?.error || 'Could not resolve this alert.');
      setAlerts((previous) => previous.filter((row) => row.id !== alert.id));
      setNotice('Alert resolved and removed from the active queue.');
    } catch (error) {
      setActionError(error?.message || 'Could not resolve this alert.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="hpos-page-frame hpos-quick-control-page">
      <HposPageHero
        eyebrow="Service readiness"
        title={barOnly ? 'Bar control board' : 'Restaurant control board'}
        description="Finish today’s opening, service, safety, and closing checks; act on live exceptions before they become handover problems."
        actions={
          !barOnly && canManage ? (
            <HposButton icon={ExternalLink} onClick={() => navigate('/restaurant/control-workspace')}>
              Full control workspace
            </HposButton>
          ) : null
        }
      />
      {actionError && <HposNotice tone="error">{actionError}</HposNotice>}
      {notice && <HposNotice>{notice}</HposNotice>}

      <section className="hpos-control-overview">
        <article><ClipboardList size={20} /><small>Checklists</small><strong>{loading ? '—' : checklists.length}</strong></article>
        <article className={openItems ? 'is-warning' : 'is-clear'}><Circle size={20} /><small>Open tasks</small><strong>{loading ? '—' : openItems}</strong></article>
        <article className={alerts.length ? 'is-danger' : 'is-clear'}><AlertTriangle size={20} /><small>Active alerts</small><strong>{loading ? '—' : alerts.length}</strong></article>
        <div className="hpos-control-readiness">
          <ShieldCheck size={22} />
          <div><strong>{alerts.length || openItems ? 'Service needs attention' : 'Ready for service'}</strong><span>{alerts.length || openItems ? 'Work through the open items below.' : 'No open checklist tasks or active alerts.'}</span></div>
        </div>
      </section>

      <div className="hpos-control-tabs" role="tablist" aria-label="Control board views">
        <button type="button" role="tab" aria-selected={activeTab === 'checklists'} className={activeTab === 'checklists' ? 'is-active' : ''} onClick={() => setActiveTab('checklists')}>
          <ClipboardList size={15} /> Checklists <span>{checklists.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={activeTab === 'alerts'} className={activeTab === 'alerts' ? 'is-active' : ''} onClick={() => setActiveTab('alerts')}>
          <AlertTriangle size={15} /> Alerts <span>{alerts.length}</span>
        </button>
      </div>

      {loading ? (
        <div className="hpos-list-loading">Loading control board…</div>
      ) : activeTab === 'checklists' ? (
        checklists.length === 0 ? (
          <HposEmptyState icon={ClipboardList} title="No checklists configured" description="Create opening, service, safety, and closing routines in the full control workspace." />
        ) : (
          <section className="hpos-checklist-grid">
            {checklists.map((checklist) => {
              const items = checklist.items || [];
              const complete = items.filter(isComplete).length;
              const percentage = items.length ? Math.round((complete / items.length) * 100) : 0;
              return (
                <article key={checklist.id} className="hpos-checklist-card">
                  <header>
                    <div><h2>{checklist.name || checklist.type || 'Daily checklist'}</h2><p>{complete} of {items.length} complete</p></div>
                    <HposStatusBadge tone={percentage === 100 ? 'success' : 'warning'}>{percentage}%</HposStatusBadge>
                  </header>
                  <div className="hpos-check-progress"><span style={{ width: `${percentage}%` }} /></div>
                  <div className="hpos-checklist-items">
                    {items.map((item, index) => (
                      <button
                        key={item.id || index}
                        type="button"
                        disabled={!canManage || isComplete(item) || busyId === item.id}
                        className={isComplete(item) ? 'is-complete' : ''}
                        onClick={() => toggleChecklistItem(item)}
                      >
                        {isComplete(item) ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                        <span>{itemLabel(item)}</span>
                        {!isComplete(item) && canManage && <em>{busyId === item.id ? 'Saving…' : 'Mark done'}</em>}
                      </button>
                    ))}
                    {items.length === 0 && <p>No tasks have been added to this checklist.</p>}
                  </div>
                </article>
              );
            })}
          </section>
        )
      ) : alerts.length === 0 ? (
        <HposEmptyState icon={ShieldCheck} title="No active alerts" description="The live exception queue is clear." />
      ) : (
        <section className="hpos-alert-list">
          {alerts.map((alert) => {
            const severity = String(alert.severity || 'medium').toLowerCase();
            return (
              <article key={alert.id} className={`is-${severity}`}>
                <span className="hpos-alert-icon"><AlertTriangle size={19} /></span>
                <div>
                  <strong>{alert.message || alert.title || 'Operational alert'}</strong>
                  <p>{alert.detail || alert.description || 'Review the source of this alert before resolving it.'}</p>
                  <small>{alert.created_at ? new Date(alert.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Time unavailable'}</small>
                </div>
                <HposStatusBadge tone={['critical', 'high'].includes(severity) ? 'danger' : 'warning'}>{severity}</HposStatusBadge>
                {canManage && <HposButton disabled={busyId === alert.id} onClick={() => resolveAlert(alert)}>{busyId === alert.id ? 'Resolving…' : 'Resolve'}</HposButton>}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
