import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  Circle,
  ClipboardList,
  DollarSign,
  ExternalLink,
  Package,
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
  const [alertHistory, setAlertHistory] = useState([]);
  const [barTemplates, setBarTemplates] = useState([]);
  const [alertCategory, setAlertCategory] = useState('all');
  const [alertSeverity, setAlertSeverity] = useState('all');
  const [showResolved, setShowResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [activeTab, setActiveTab] = useState('checklists');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const alertOperationIds = useRef(new Map());
  const checklistOperationIds = useRef(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setActionError('');
    try {
      if (barOnly) {
        await window.api?.pos?.seedBarChecklistTemplates?.();
      }
      const [checklistResult, alertResult, historyResult, templateResult] = await Promise.all([
        window.api?.pos?.getChecklists?.() ?? [],
        window.api?.pos?.getActiveAlerts?.() ?? [],
        window.api?.pos?.getAlertHistory?.({ includeResolved: true }) ?? [],
        barOnly ? (window.api?.pos?.getBarChecklistTemplates?.() ?? []) : [],
      ]);
      setChecklists(Array.isArray(checklistResult) ? checklistResult : []);
      setAlerts(Array.isArray(alertResult) ? alertResult : []);
      setAlertHistory(Array.isArray(historyResult) ? historyResult : []);
      setBarTemplates(Array.isArray(templateResult) ? templateResult : []);
    } catch (error) {
      setActionError(error?.message || 'Control information could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [barOnly]);

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

  const createTemplateChecklist = async (template) => {
    if (!template?.template_key || !canManage) return;
    setBusyId(`template:${template.template_key}`);
    setActionError('');
    try {
      const operationId = checklistOperationIds.current.get(template.template_key) || crypto.randomUUID();
      checklistOperationIds.current.set(template.template_key, operationId);
      const result = await window.api?.pos?.createBarChecklistFromTemplate?.({ templateKey: template.template_key, operationId });
      if (!result?.success) throw new Error(result?.error || 'Could not start this checklist.');
      checklistOperationIds.current.delete(template.template_key);
      setNotice(`${template.name || 'Bar checklist'} started.`);
      const refreshed = await window.api?.pos?.getChecklists?.();
      setChecklists(Array.isArray(refreshed) ? refreshed : []);
    } catch (error) {
      setActionError(error?.message || 'Could not start this checklist.');
    } finally {
      setBusyId('');
    }
  };

  const acknowledgeAlert = async (alert) => {
    if (!alert.id || !canManage) return;
    const reason = window.prompt('Why is this alert being acknowledged for follow-up?', alert.acknowledgement_reason || '');
    if (!reason || reason.trim().length < 3) return;
    setBusyId(`ack:${alert.id}`);
    setActionError('');
    setNotice('');
    try {
      const operationId = alertOperationIds.current.get(`ack:${alert.id}`) || crypto.randomUUID();
      alertOperationIds.current.set(`ack:${alert.id}`, operationId);
      const result = await window.api?.pos?.acknowledgeAlert?.(alert.id, reason.trim(), operationId);
      if (!result?.success) throw new Error(result?.error || 'Could not acknowledge this alert.');
      if (!result.acknowledged_at) throw new Error('The server did not return acknowledgement evidence. Refresh and retry the original action.');
      const acknowledgedAt = result.acknowledged_at;
      const update = (row) => row.id === alert.id ? { ...row, acknowledged_at: acknowledgedAt, acknowledged_by: result.acknowledged_by } : row;
      setAlerts((previous) => previous.map(update));
      setAlertHistory((previous) => previous.map(update));
      alertOperationIds.current.delete(`ack:${alert.id}`);
      setNotice('Alert acknowledged; it remains active until resolved.');
    } catch (error) {
      setActionError(error?.message || 'Could not acknowledge this alert.');
    } finally {
      setBusyId('');
    }
  };

  const resolveAlert = async (alert) => {
    if (!alert.id || !canManage) return;
    const reason = window.prompt('Why is this alert being resolved?', alert.resolved_reason || '');
    if (!reason || reason.trim().length < 3) return;
    setBusyId(alert.id);
    setActionError('');
    setNotice('');
    try {
      const operationId = alertOperationIds.current.get(`resolve:${alert.id}`) || crypto.randomUUID();
      alertOperationIds.current.set(`resolve:${alert.id}`, operationId);
      const result = await window.api?.pos?.resolveAlert?.(alert.id, reason.trim(), operationId);
      if (!result?.success) throw new Error(result?.error || 'Could not resolve this alert.');
      if (!result.resolved_at) throw new Error('The server did not return resolution evidence. Refresh and retry the original action.');
      setAlerts((previous) => previous.filter((row) => row.id !== alert.id));
      setAlertHistory((previous) => previous.map((row) => row.id === alert.id ? { ...row, is_resolved: true, resolved_at: result.resolved_at, resolved_by: result.resolved_by, resolved_reason: reason.trim() } : row));
      alertOperationIds.current.delete(`resolve:${alert.id}`);
      setNotice('Alert resolved and removed from the active queue.');
    } catch (error) {
      setActionError(error?.message || 'Could not resolve this alert.');
    } finally {
      setBusyId('');
    }
  };

  const visibleAlerts = alerts.filter((alert) => (alertCategory === 'all' || String(alert.category || 'operational').toLowerCase() === alertCategory) && (alertSeverity === 'all' || String(alert.severity || 'info').toLowerCase() === alertSeverity));
  const alertCategories = Array.from(new Set(alertHistory.map((alert) => String(alert.category || 'operational').trim().toLowerCase()).filter(Boolean))).sort();
  const visibleHistory = alertHistory.filter((alert) => (alertCategory === 'all' || String(alert.category || 'operational').toLowerCase() === alertCategory) && (alertSeverity === 'all' || String(alert.severity || 'info').toLowerCase() === alertSeverity));

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
          <>
            {barOnly && barTemplates.length > 0 && <section className="hpos-checklist-grid">
              {barTemplates.map((template) => <article className="hpos-checklist-card" key={template.template_key}><header><div><h2>{template.name}</h2><p>Server-seeded Bar Base template</p></div><HposButton disabled={!canManage || busyId === `template:${template.template_key}`} onClick={() => createTemplateChecklist(template)}>{busyId === `template:${template.template_key}` ? 'Starting…' : 'Start checklist'}</HposButton></header></article>)}
            </section>}
            <HposEmptyState icon={ClipboardList} title={barOnly && barTemplates.length ? 'Start a checklist for this shift' : 'No checklists configured'} description={barOnly && barTemplates.length ? 'Templates are provided by the Bar operating profile and cannot be edited from the workstation.' : 'Create opening, service, safety, and closing routines in the full control workspace.'} />
          </>
        ) : (
          <>
          {barOnly && barTemplates.length > 0 && <section className="hpos-checklist-grid">
            {barTemplates.map((template) => <article className="hpos-checklist-card" key={template.template_key}><header><div><h2>{template.name}</h2><p>Server-seeded Bar Base template</p></div><HposButton disabled={!canManage || busyId === `template:${template.template_key}`} onClick={() => createTemplateChecklist(template)}>{busyId === `template:${template.template_key}` ? 'Starting…' : 'Start another'}</HposButton></header></article>)}
          </section>}
          <section className="hpos-checklist-grid">
            {checklists.map((checklist) => {
              const items = checklist.items || [];
              const complete = items.filter(isComplete).length;
              const percentage = items.length ? Math.round((complete / items.length) * 100) : 0;
              return (
                <article key={checklist.id} className="hpos-checklist-card">
                  <header>
                    <div><h2>{checklist.name || checklist.type || checklist.checklist_type || 'Daily checklist'}</h2><p>{complete} of {items.length} complete</p></div>
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
          </>
        )
      ) : alerts.length === 0 ? (
        <>
          <AlertToolbar categories={alertCategories} value={alertCategory} onChange={setAlertCategory} severity={alertSeverity} onSeverityChange={setAlertSeverity} showResolved={showResolved} onToggleResolved={() => setShowResolved((value) => !value)} />
          <HposEmptyState icon={ShieldCheck} title="No active alerts" description="The live exception queue is clear." />
          {showResolved && <AlertHistoryList alerts={visibleHistory.filter((alert) => alert.is_resolved)} />}
        </>
      ) : (
        <>
        <AlertToolbar categories={alertCategories} value={alertCategory} onChange={setAlertCategory} severity={alertSeverity} onSeverityChange={setAlertSeverity} showResolved={showResolved} onToggleResolved={() => setShowResolved((value) => !value)} />
        <section className="hpos-alert-list">
          {visibleAlerts.map((alert) => {
            const severity = String(alert.severity || 'medium').toLowerCase();
            return (
              <article key={alert.id} className={`is-${severity}`}>
                <span className="hpos-alert-icon"><AlertCategoryIcon category={alert.category} /></span>
                <div>
                  <strong>{alert.message || alert.title || 'Operational alert'}</strong>
                  <p>{formatAlertCategory(alert.category)} · {alert.detail || alert.description || 'Review the source of this alert before resolving it.'}</p>
                  <small>{alert.created_at ? new Date(alert.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Time unavailable'}</small>
                </div>
                <HposStatusBadge tone={['critical', 'high'].includes(severity) ? 'danger' : 'warning'}>{severity}</HposStatusBadge>
                {canManage && <div className="hpos-alert-actions">{!alert.acknowledged_at && <HposButton disabled={busyId === `ack:${alert.id}`} onClick={() => acknowledgeAlert(alert)}>{busyId === `ack:${alert.id}` ? 'Acknowledging…' : 'Acknowledge'}</HposButton>}<HposButton disabled={busyId === alert.id} onClick={() => resolveAlert(alert)}>{busyId === alert.id ? 'Resolving…' : 'Resolve'}</HposButton></div>}
              </article>
            );
          })}
        </section>
        {showResolved && <AlertHistoryList alerts={visibleHistory.filter((alert) => alert.is_resolved)} />}
        </>
      )}
    </div>
  );
}

function AlertToolbar({ categories, value, onChange, severity, onSeverityChange, showResolved, onToggleResolved }) {
  return <div className="hpos-alert-toolbar"><label>Category <select value={value} onChange={(event) => onChange(event.target.value)}><option value="all">All categories</option>{categories.map((category) => <option key={category} value={category}>{formatAlertCategory(category)}</option>)}</select></label><label>Severity <select value={severity} onChange={(event) => onSeverityChange(event.target.value)}><option value="all">All severities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="warning">Warning</option><option value="low">Low</option><option value="info">Info</option></select></label><HposButton onClick={onToggleResolved}>{showResolved ? 'Hide resolved history' : 'Show resolved history'}</HposButton></div>;
}

function formatAlertCategory(category) {
  const value = String(category || 'operational').toLowerCase();
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function AlertCategoryIcon({ category }) {
  const Icon = { stock: Package, financial: DollarSign, compliance: ShieldCheck, operational: BriefcaseBusiness }[String(category || 'operational').toLowerCase()] || AlertTriangle;
  return <Icon size={19} />;
}

function AlertHistoryList({ alerts }) {
  if (!alerts.length) return null;
  return <section className="hpos-alert-history"><h2>Resolved alert history</h2>{alerts.map((alert) => <article key={`history-${alert.id}`}><strong>{alert.message || 'Operational alert'}</strong><small>{formatAlertCategory(alert.category)} · {alert.resolved_at ? new Date(alert.resolved_at).toLocaleString('en-GB') : 'Resolved time unavailable'}{alert.resolved_reason ? ` · ${alert.resolved_reason}` : ''}</small></article>)}</section>;
}
