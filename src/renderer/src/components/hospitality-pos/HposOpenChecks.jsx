import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Clock3,
  RefreshCw,
  Scissors,
  Search,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth, useSettings } from "../../app-context";
import { isBarOnlyMode } from "../../../../shared/propertyTypes";
import {
  TAB_RECOVERY_OUTCOMES,
  buildSplitPayload,
  buildTransferPayload,
  defaultCanReplayOperation,
  describeRecoveryEnvelope,
  listRecoveryEnvelopes,
  readRecoveryEnvelope,
  recoveryResultMessage,
  replaySavedTabOperation,
  submitNewTabOperation
} from "../../../../shared/posTabRecovery";
import { HposButton, HposEmptyState, HposNotice, HposPageHero } from "./HposUi";

const age = (value) => {
  const mins = Math.max(
    0,
    Math.floor((Date.now() - new Date(value || Date.now()).getTime()) / 60000),
  );
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

const tabValue = (tab) => {
  const financialComplete = tab?.financial_complete === true || tab?._financial_complete === true || tab?.financial_snapshot?.financial_complete === true;
  if (!financialComplete) return null;
  if (tab?.total === null || tab?.total === undefined || tab?.total === "") return null;
  const value = Number(tab.total);
  return Number.isFinite(value) ? value : null;
};

export default function HposOpenChecks() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings } = useSettings();
  const barOnly = isBarOnlyMode(settings);
  const currency = settings?.currency || "P";
  const [tabs, setTabs] = useState([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [splitTab, setSplitTab] = useState(null);
  const [splitCount, setSplitCount] = useState(2);
  const [splitBusy, setSplitBusy] = useState(false);
  const [splitError, setSplitError] = useState("");
  const [splitPending, setSplitPending] = useState(null);
  const [splitQuarantine, setSplitQuarantine] = useState("");
  const [transferTab, setTransferTab] = useState(null);
  const [transferChoices, setTransferChoices] = useState([]);
  const [transferTarget, setTransferTarget] = useState("");
  const [transferNotes, setTransferNotes] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [transferPending, setTransferPending] = useState(null);
  const [transferQuarantine, setTransferQuarantine] = useState("");
  const [sharedTillOperatorId, setSharedTillOperatorId] = useState(null);
  const tenantId = settings?.lodge_id || user?.lodge_id || null;
  const actorId = sharedTillOperatorId || user?.id || null;
  const actorRole = user?.role || null;
  const [inbox, setInbox] = useState([]);

  const refreshInbox = useCallback(() => {
    const { envelopes } = listRecoveryEnvelopes({ tenantId });
    setInbox(envelopes);
  }, [tenantId]);

  const refreshSplitPending = useCallback((tab) => {
    if (!tab?.id) {
      setSplitPending(null);
      setSplitQuarantine("");
      return;
    }
    const { envelope, corrupt, raw } = readRecoveryEnvelope("split", { tenantId, sourceTabId: tab.id });
    if (corrupt) {
      const qkey = quarantineRecoveryRecord("split", { sourceTabId: tab.id, raw });
      setSplitPending({ outcome: TAB_RECOVERY_OUTCOMES.NEEDS_REVIEW, corrupt: true });
      setSplitQuarantine(qkey || "");
      return;
    }
    setSplitQuarantine("");
    setSplitPending(envelope);
  }, [tenantId]);

  const refreshTransferPending = useCallback((tab) => {
    if (!tab?.id) {
      setTransferPending(null);
      setTransferQuarantine("");
      return;
    }
    const { envelope, corrupt, raw } = readRecoveryEnvelope("transfer", { tenantId, sourceTabId: tab.id });
    if (corrupt) {
      const qkey = quarantineRecoveryRecord("transfer", { sourceTabId: tab.id, raw });
      setTransferPending({ outcome: TAB_RECOVERY_OUTCOMES.NEEDS_REVIEW, corrupt: true });
      setTransferQuarantine(qkey || "");
      return;
    }
    setTransferQuarantine("");
    setTransferPending(envelope);
  }, [tenantId]);

  useEffect(() => {
    if (!barOnly) {
      setSharedTillOperatorId(null);
      return undefined;
    }
    let active = true;
    // This is a read-only rehydration path. It must not touch or extend the
    // Till lease merely because Open Tabs mounted.
    Promise.resolve(window.api?.pos?.getSharedTillOperatorSession?.({}))
      .then((result) => {
        if (active) setSharedTillOperatorId(result?.success ? result.session?.staffId || null : null);
      })
      .catch(() => {
        if (active) setSharedTillOperatorId(null);
      });
    return () => { active = false; };
  }, [barOnly]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const rows =
        (await window.api?.pos?.getTabs?.({ status: "active" })) || [];
      setTabs(
        rows.filter(
          (row) =>
            !["closed", "paid", "cancelled", "voided"].includes(
              String(row.status || "").toLowerCase(),
            ),
        ),
      );
    } catch (loadError) {
      setError(loadError?.message || "Open tabs could not be loaded.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    refreshInbox();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load({ quiet: true });
    }, 15000);
    const handleVisible = () => {
      if (document.visibilityState === "visible") load({ quiet: true });
    };
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [load, refreshInbox]);

  const filtered = useMemo(
    () =>
      tabs.filter((tab) =>
        `${tab.table_name || ""} ${tab.tab_name || ""} ${tab.customer_name || ""} ${tab.waiter_name || ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [tabs, query],
  );
  // Operator-chosen ordering over the filtered set; search matching above
  // is unchanged.
  const sorted = useMemo(() => {
    const rows = [...filtered];
    const ageOf = (tab) => new Date(tab.updated_at || tab.created_at || 0).getTime();
    const valueOf = (tab) => tabValue(tab);
    rows.sort((a, b) => {
      if (sort === "oldest") return ageOf(a) - ageOf(b);
      if (sort === "highest") return (valueOf(b) ?? -1) - (valueOf(a) ?? -1);
      if (sort === "lowest") return (valueOf(a) ?? Number.MAX_SAFE_INTEGER) - (valueOf(b) ?? Number.MAX_SAFE_INTEGER);
      return ageOf(b) - ageOf(a);
    });
    return rows;
  }, [filtered, sort]);
  const tabTotalsComplete = tabs.every((tab) => tabValue(tab) !== null);
  const total = tabTotalsComplete ? tabs.reduce((sum, tab) => sum + tabValue(tab), 0) : null;
  const currentOwnerId = sharedTillOperatorId || user?.id || null;
  const canControl = (tab) => !barOnly || Boolean(tab?.waiter_id && currentOwnerId && tab.waiter_id === currentOwnerId);
  const ownerTitle = (tab) => canControl(tab)
    ? "Only the assigned waiter or verified Till operator can change this tab."
    : `Assigned to ${tab?.waiter_name || tab?.opened_by_name || "another waiter"}. Unlock that waiter or ask them to transfer it.`;
  const resume = (tab) => {
    if (!canControl(tab)) return;
    return navigate("/hpos/pos", {
      state: {
        tableName: tab.table_name || "",
        tabName: tab.tab_name || tab.customer_name || "",
        tabId: tab.id,
        tabVersion: tab.tab_version ?? tab.version ?? null,
        resumeIntent: true,
      },
    });
  };
  // Settle resumes the tab and opens payment immediately so adding items and
  // paying stay distinct actions: Resume tab = keep selling, Settle = pay now.
  // A certified total is required; without one the operator resumes instead.
  const settle = (tab) => {
    if (!canControl(tab) || tabValue(tab) === null) return;
    return navigate("/hpos/pos", {
      state: {
        tableName: tab.table_name || "",
        tabName: tab.tab_name || tab.customer_name || "",
        tabId: tab.id,
        tabVersion: tab.tab_version ?? tab.version ?? null,
        resumeIntent: true,
        settle: true,
      },
    });
  };
  const openSplit = (tab) => {
    if (!canControl(tab)) return;
    setSplitTab(tab);
    setSplitCount(2);
    setSplitError("");
    refreshSplitPending(tab);
  };
  const applySplitOutcome = (out) => {
    setSplitPending(out.envelope);
    refreshInbox();
    if (out.classification.outcome === TAB_RECOVERY_OUTCOMES.COMMITTED) {
      setSplitPending(null);
      setSplitTab(null);
      load({ quiet: true });
      return null;
    }
    return recoveryResultMessage('split', out.classification, out.result, out.envelope?.operationId);
  };

  const runSplit = async ({ corrected = false } = {}) => {
    if (!splitTab?.id || splitBusy || tabValue(splitTab) === null || !canControl(splitTab)) return;
    setSplitBusy(true);
    setSplitError("");
    try {
      // New-attempt entry path: intent comes from the visible form only.
      const count = Number(splitCount);
      const version = splitTab.tab_version ?? splitTab.version ?? 1;
      const payload = buildSplitPayload({ splitCount: count, sourceTabVersion: version });
      const out = await submitNewTabOperation({
        kind: "split",
        tenantId,
        sourceTabId: splitTab.id,
        outletId: splitTab.outlet_id || null,
        actorId,
        expectedVersion: version,
        payload,
        request: { source_tab_id: splitTab.id, split_count: count, target_table_names: [], source_tab_version: version },
        corrected,
        dispatch: (args) => window.api?.pos?.splitBillEvenly?.(args),
      });
      const message = applySplitOutcome(out);
      if (message) throw new Error(message);
    } catch (splitFailure) {
      setSplitError(splitFailure?.message || "Could not split this check.");
    } finally {
      setSplitBusy(false);
    }
  };

  const openTransfer = async (tab) => {
    if (!barOnly || !tab?.id || !canControl(tab)) return;
    setTransferTab(tab);
    setTransferTarget("");
    setTransferNotes("");
    setTransferError("");
    refreshTransferPending(tab);
    try {
      const attendance = (await window.api?.pos?.getBarActiveShifts?.()) || [];
      const choices = (await Promise.all(attendance.map(async (row) => {
        const shift = await window.api?.pos?.getStaffOpenShift?.(row.staff_user_id).catch(() => null);
        if (!shift?.id || String(shift.status || "").toLowerCase() !== "open") return null;
        if ((shift.outlet_id || null) !== (tab.outlet_id || null) || row.staff_user_id === tab.waiter_id) return null;
        return { ...row, pos_shift_id: shift.id, pos_shift: shift };
      }))).filter(Boolean);
      setTransferChoices(choices);
      if (!choices.length) setTransferError("No other waiter has a confirmed active attendance and Till shift for this outlet.");
    } catch (loadError) {
      setTransferError(loadError?.message || "Active waiter shifts could not be confirmed.");
    }
  };

  const applyTransferOutcome = (out) => {
    setTransferPending(out.envelope);
    refreshInbox();
    if (out.classification.outcome === TAB_RECOVERY_OUTCOMES.COMMITTED) {
      setTransferPending(null);
      setTransferTab(null);
      load({ quiet: true });
      return null;
    }
    return recoveryResultMessage('transfer', out.classification, out.result, out.envelope?.operationId);
  };

  const runTransfer = async ({ corrected = false } = {}) => {
    if (!transferTab?.id || !transferTarget || transferBusy || !canControl(transferTab)) return;
    const target = transferChoices.find((row) => row.staff_user_id === transferTarget);
    if (!target?.pos_shift_id) return;
    setTransferBusy(true);
    setTransferError("");
    try {
      // New-attempt entry path: intent comes from the visible form only.
      const version = transferTab.tab_version ?? 1;
      const notes = transferNotes.trim() || null;
      const payload = buildTransferPayload({
        targetWaiterId: target.staff_user_id,
        targetShiftId: target.pos_shift_id,
        expectedTabVersion: version,
        notes
      });
      const out = await submitNewTabOperation({
        kind: "transfer",
        tenantId,
        sourceTabId: transferTab.id,
        outletId: transferTab.outlet_id || null,
        actorId,
        expectedVersion: version,
        payload,
        request: {
          tab_id: transferTab.id,
          target_waiter_id: target.staff_user_id,
          target_shift_id: target.pos_shift_id,
          expected_tab_version: version,
          notes,
        },
        corrected,
        dispatch: (args) => window.api?.pos?.transferTabWaiter?.(args),
      });
      const message = applyTransferOutcome(out);
      if (message) throw new Error(message);
    } catch (transferFailure) {
      setTransferError(transferFailure?.message || "Could not confirm the waiter transfer.");
    } finally {
      setTransferBusy(false);
    }
  };

  // Replay entry path: see replaySplit. No target choices, tab cache, or
  // ownership state are consulted; the saved request goes out verbatim.
  const replayTransfer = async () => {
    if (!transferTab?.id || transferBusy) return;
    setTransferBusy(true);
    setTransferError("");
    try {
      const out = await replaySavedTabOperation({
        kind: "transfer",
        tenantId,
        sourceTabId: transferTab.id,
        actorId,
        actorRole,
        dispatch: (args) => window.api?.pos?.transferTabWaiter?.(args),
      });
      const message = applyTransferOutcome(out);
      if (message) throw new Error(message);
    } catch (transferFailure) {
      setTransferError(transferFailure?.message || "Could not check the transfer status.");
    } finally {
      setTransferBusy(false);
    }
  };

  const checkTransferStatus = () => replayTransfer();

  // Replay entry path: resubmits the SAVED operation verbatim (same request,
  // same key, is_replay). Reads storage fresh; never touches editable form
  // state, so a reopened default form cannot alter the replayed intent.
  const replaySplit = async () => {
    if (!splitTab?.id || splitBusy) return;
    setSplitBusy(true);
    setSplitError("");
    try {
      const out = await replaySavedTabOperation({
        kind: "split",
        tenantId,
        sourceTabId: splitTab.id,
        actorId,
        actorRole,
        dispatch: (args) => window.api?.pos?.splitBillEvenly?.(args),
      });
      const message = applySplitOutcome(out);
      if (message) throw new Error(message);
    } catch (splitFailure) {
      setSplitError(splitFailure?.message || "Could not check the split status.");
    } finally {
      setSplitBusy(false);
    }
  };

  const checkSplitStatus = () => replaySplit();

  const startCorrectedSplit = async () => {
    if (!splitTab?.id || splitBusy) return;
    await runSplit({ corrected: true });
  };

  const startCorrectedTransfer = async () => {
    if (!transferTab?.id || transferBusy) return;
    await runTransfer({ corrected: true });
  };

  // Pending-operation discovery independent of the active tab list: an
  // envelope survives tab closure, ownership change, and reload. Replay is
  // authorized per operation (originator or manager); the server enforces
  // the rest. Committed attempts are archived out of this list.
  const [inboxBusyKey, setInboxBusyKey] = useState(null);
  const replayInboxItem = async (row) => {
    if (!row?.envelope || inboxBusyKey) return;
    const key = `${row.kind}:${row.envelope.operationId}`;
    setInboxBusyKey(key);
    try {
      const out = await replaySavedTabOperation({
        kind: row.kind,
        tenantId,
        sourceTabId: row.envelope.sourceTabId,
        actorId,
        actorRole,
        dispatch: (args) => row.kind === 'split'
          ? window.api?.pos?.splitBillEvenly?.(args)
          : window.api?.pos?.transferTabWaiter?.(args),
      });
      if (out.classification.outcome === TAB_RECOVERY_OUTCOMES.COMMITTED) {
        await load({ quiet: true });
      }
    } catch {
      // Errors are reflected through the refreshed inbox record below.
    } finally {
      refreshInbox();
      if (splitTab?.id) refreshSplitPending(splitTab);
      if (transferTab?.id) refreshTransferPending(transferTab);
      setInboxBusyKey(null);
    }
  };

  return (
    <div className="hpos-page-frame hpos-service-checks">
      <HposPageHero
        eyebrow="Live service"
        title="Open tabs"
        description="See every running tab, who owns it, how long it has been open, and resume or split it safely."
        actions={
          <HposButton
            icon={RefreshCw}
            onClick={() => load()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </HposButton>
        }
      />
      <div className="hpos-summary-strip">
        <div>
          <span>Open now</span>
          <strong>{tabs.length}</strong>
        </div>
        <div>
          <span>Value on open tabs</span>
          <strong>
            {total === null ? 'Unavailable' : `${currency} ${total.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`}
          </strong>
        </div>
        <label>
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              barOnly
                ? "Search tabs, customers or operators"
                : "Search tables, tabs, customers or staff"
            }
          />
        </label>
        <label>
          <span className="hpos-visually-hidden">Sort open tabs</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            aria-label="Sort open tabs"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="highest">Highest value</option>
            <option value="lowest">Lowest value</option>
          </select>
        </label>
      </div>
      {error && <HposNotice tone="error">{error}</HposNotice>}
      {inbox.length > 0 && (
        <section className="hpos-service-inbox" data-testid="recovery-inbox" aria-live="polite">
          <h2>Unresolved operations ({inbox.length})</h2>
          <p className="hpos-service-dialog__hint">Saved split and transfer attempts that have not reached a confirmed outcome — including tabs that already closed or changed owner. Status check replays the saved operation under its original key without duplicating.</p>
          {inbox.map((row) => {
            const allowed = row.corrupt
              ? false
              : defaultCanReplayOperation({ envelope: row.envelope, actorId, actorRole });
            return (
              <div key={`${row.kind}:${row.envelope?.operationId || row.key}`} className="hpos-service-inbox__row">
                <div>
                  <strong>{row.kind === 'split' ? 'Split' : 'Waiter transfer'}</strong>
                  <span> · tab {String(row.envelope?.sourceTabId || '').slice(0, 8)}… · key {String(row.envelope?.operationId || '').slice(0, 8)}…</span>
                  <span> · status {row.corrupt ? 'needs review (unreadable record)' : row.envelope?.outcome}{row.envelope?.lastCode ? ` (${row.envelope.lastCode})` : ''}</span>
                  {row.legacy && <span> · legacy record</span>}
                </div>
                <HposButton
                  disabled={inboxBusyKey === `${row.kind}:${row.envelope?.operationId}` || !allowed}
                  onClick={() => replayInboxItem(row)}
                  title={allowed ? 'Replay the saved operation under its original key' : 'Only the originating operator or a manager can replay this operation'}
                >
                  {inboxBusyKey === `${row.kind}:${row.envelope?.operationId}` ? 'Checking…' : 'Check status'}
                </HposButton>
              </div>
            );
          })}
        </section>
      )}
      {loading ? (
        <div className="hpos-service-loading">
          <RefreshCw className="is-spinning" size={22} />
          <span>Loading open tabs…</span>
        </div>
      ) : (
        <section className="hpos-check-grid" aria-live="polite">
          {sorted.map((tab) => (
            <article key={tab.id} className="hpos-check-card">
              <div className="hpos-check-card-head">
                <span>{tab.table_name || tab.tab_name || "Open tab"}</span>
                <strong>
                  {tabValue(tab) === null ? 'Unavailable' : `${currency} ${tabValue(tab).toFixed(2)}`}
                </strong>
              </div>
              <p>
                {tab.customer_name ||
                  tab.tab_name ||
                  (barOnly ? "Walk-in tab" : "Table service")}
              </p>
              <div>
                <span>
                  <UserRound size={14} />
                  {tab.waiter_name || tab.opened_by_name || "Unassigned"}
                </span>
                <span>
                  <Clock3 size={14} />
                  {age(tab.updated_at || tab.created_at)}
                </span>
                <span>
                  <WalletCards size={14} />
                  {(tab.items || []).length} lines
                </span>
              </div>
              <footer>
                <button
                  type="button"
                  onClick={() => openSplit(tab)}
                  disabled={!canControl(tab) || (tab.items || []).length < 2 || tabValue(tab) === null}
                  title={!canControl(tab) ? ownerTitle(tab) : "Split this tab through the server-authoritative operation."}
                >
                  <Scissors size={14} />
                  Split
                </button>
                {barOnly && (
                  <button
                    type="button"
                    onClick={() => openTransfer(tab)}
                    disabled={!canControl(tab) || !tab.waiter_id}
                    title={!canControl(tab) ? ownerTitle(tab) : (!tab.waiter_id ? "An assigned waiter is required before transfer." : "Transfer to another waiter with an active same-outlet shift.")}
                  >
                    <UserRound size={14} />
                    Transfer waiter
                  </button>
                )}
                <button
                  type="button"
                  className="is-primary"
                  onClick={() => resume(tab)}
                  disabled={!canControl(tab)}
                  title={!canControl(tab) ? ownerTitle(tab) : "Resume this tab."}
                >
                  Resume tab →
                </button>
                <button
                  type="button"
                  onClick={() => settle(tab)}
                  disabled={!canControl(tab) || tabValue(tab) === null}
                  title={!canControl(tab) ? ownerTitle(tab) : (tabValue(tab) === null ? "The certified total is unavailable. Resume the tab instead." : "Resume this tab and open payment.")}
                >
                  Settle
                </button>
              </footer>
            </article>
          ))}
          {!sorted.length && (
            <HposEmptyState
              icon={WalletCards}
              title="No open tabs"
              description={
                query
                  ? "Nothing matches this search."
                  : "Held and running tabs will appear here automatically."
              }
            />
          )}
        </section>
      )}

      {splitTab && (
        <div className="hpos-modal-backdrop" role="presentation">
          <section
            className="hpos-service-dialog hpos-service-split-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="split-check-title"
          >
            <button
              type="button"
              className="hpos-service-dialog__close"
              onClick={() => setSplitTab(null)}
              disabled={splitBusy}
              aria-label="Close"
            >
              <X size={18} />
            </button>
            <p className="hpos-eyebrow">Open check control</p>
            <h2 id="split-check-title">
              Split {splitTab.table_name || splitTab.tab_name || "check"} evenly
            </h2>
            <p>
              Create equal checks using the single authoritative split
              operation. Item-by-item splitting is not offered here until its
              server contract is atomic.
            </p>
            <label className="hpos-service-split-count">
              Number of checks
              <input
                type="number"
                min="2"
                max="10"
                value={splitCount}
                onChange={(event) =>
                  setSplitCount(
                    Math.min(10, Math.max(2, Number(event.target.value) || 2)),
                  )
                }
              />
              <small>
                {tabValue(splitTab) === null
                  ? "Authoritative total unavailable; refresh before splitting."
                  : `${currency} ${(tabValue(splitTab) / Number(splitCount || 2)).toFixed(2)} per check before rounding`}
              </small>
            </label>
            {splitError && <HposNotice tone="error">{splitError}</HposNotice>}
            {splitQuarantine && <HposNotice tone="warning">A damaged local split record was quarantined ({splitQuarantine}). Outcome not confirmed: keep this record and ask support to inspect it before posting any correction.</HposNotice>}
            {splitPending?.operationId && (
              <div className="hpos-service-recovery" data-testid="split-recovery-panel">
                <p><strong>Original attempt:</strong> {describeRecoveryEnvelope(splitPending)} · status {splitPending.outcome}{splitPending.lastCode ? ` (${splitPending.lastCode})` : ""}</p>
                <p>Operation {String(splitPending.operationId).slice(0, 8)}… · tab {String(splitTab.id).slice(0, 8)}…{splitPending.lastCheckedAt ? ` · last checked ${new Date(splitPending.lastCheckedAt).toLocaleString()}` : ""}</p>
                {splitPending.outcome === TAB_RECOVERY_OUTCOMES.UNKNOWN && <p>Outcome not confirmed: the split may or may not have committed. Replaying uses the original key and never posts a duplicate.</p>}
                {splitPending.outcome === TAB_RECOVERY_OUTCOMES.REJECTED && <p>The server rejected this attempt, so nothing was posted. A deliberate correction needs a new key.</p>}
                {splitPending.outcome === TAB_RECOVERY_OUTCOMES.NEEDS_REVIEW && <p>This key conflicts with different details. Keep this record and ask support to inspect the original operation before correcting.</p>}
                <div className="hpos-service-dialog__actions">
                  <HposButton onClick={checkSplitStatus} disabled={splitBusy}>Check status</HposButton>
                  <HposButton onClick={replaySplit} disabled={splitBusy}>Retry original</HposButton>
                  {splitPending.outcome === TAB_RECOVERY_OUTCOMES.REJECTED && <HposButton tone="primary" onClick={startCorrectedSplit} disabled={splitBusy}>Start corrected attempt</HposButton>}
                </div>
                <p className="hpos-service-dialog__hint">Status check replays the saved operation under its original key. If the server never received it, this submits it exactly once; if it did, the server returns the stored result without duplicating.</p>
              </div>
            )}
            <footer>
              <HposButton
                onClick={() => setSplitTab(null)}
                disabled={splitBusy}
              >
                Cancel
              </HposButton>
              <HposButton
                tone="primary"
                icon={Scissors}
                onClick={() => runSplit({})}
                disabled={splitBusy || tabValue(splitTab) === null}
              >
                {splitBusy ? "Splitting…" : "Split checks"}
              </HposButton>
            </footer>
          </section>
        </div>
      )}

      {transferTab && (
        <div className="hpos-modal-backdrop" role="presentation">
          <section className="hpos-service-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-waiter-title">
            <button type="button" className="hpos-service-dialog__close" onClick={() => setTransferTab(null)} disabled={transferBusy} aria-label="Close"><X size={18} /></button>
            <h2 id="transfer-waiter-title">Transfer waiter</h2>
            <p className="hpos-service-dialog__hint">Tab: {transferTab.table_name || transferTab.tab_name || "Open tab"}. Only its currently assigned waiter (or verified Till operator) can confirm this transfer.</p>
            {transferError && <HposNotice tone="error">{transferError}</HposNotice>}
            {transferQuarantine && <HposNotice tone="warning">A damaged local transfer record was quarantined ({transferQuarantine}). Outcome not confirmed: keep this record and ask support to inspect it before posting any correction.</HposNotice>}
            {transferPending?.operationId && (
              <div className="hpos-service-recovery" data-testid="transfer-recovery-panel">
                <p><strong>Original attempt:</strong> {describeRecoveryEnvelope(transferPending)} · status {transferPending.outcome}{transferPending.lastCode ? ` (${transferPending.lastCode})` : ""}</p>
                <p>Operation {String(transferPending.operationId).slice(0, 8)}… · tab {String(transferTab.id).slice(0, 8)}…{transferPending.lastCheckedAt ? ` · last checked ${new Date(transferPending.lastCheckedAt).toLocaleString()}` : ""}</p>
                {transferPending.outcome === TAB_RECOVERY_OUTCOMES.UNKNOWN && <p>Outcome not confirmed: the transfer may or may not have committed. Replaying uses the original key and never posts a duplicate.</p>}
                {transferPending.outcome === TAB_RECOVERY_OUTCOMES.REJECTED && <p>The server rejected this attempt, so nothing was posted. A deliberate correction needs a new key.</p>}
                {transferPending.outcome === TAB_RECOVERY_OUTCOMES.NEEDS_REVIEW && <p>This key conflicts with different details. Keep this record and ask support to inspect the original operation before correcting.</p>}
                <div className="hpos-service-dialog__actions">
                  <HposButton onClick={checkTransferStatus} disabled={transferBusy}>Check status</HposButton>
                  <HposButton onClick={replayTransfer} disabled={transferBusy}>Retry original</HposButton>
                  {transferPending.outcome === TAB_RECOVERY_OUTCOMES.REJECTED && <HposButton tone="primary" onClick={startCorrectedTransfer} disabled={transferBusy || !transferTarget}>Start corrected attempt</HposButton>}
                </div>
                <p className="hpos-service-dialog__hint">Status check replays the saved operation under its original key. If the server never received it, this submits it exactly once; if it did, the server returns the stored result without duplicating.</p>
              </div>
            )}
            <label className="hpos-form-field"><span>Active waiter for this outlet</span><select value={transferTarget} onChange={(event) => setTransferTarget(event.target.value)} disabled={transferBusy || !transferChoices.length}><option value="">Choose waiter</option>{transferChoices.map((row) => <option key={`${row.staff_user_id}:${row.pos_shift_id}`} value={row.staff_user_id}>{row.staff_name || row.staff_user_id}</option>)}</select></label>
            <label className="hpos-form-field"><span>Note (optional)</span><textarea value={transferNotes} onChange={(event) => setTransferNotes(event.target.value.slice(0, 1000))} disabled={transferBusy} maxLength={1000} rows={3} placeholder="Reason or handover note" /></label>
            <div className="hpos-service-dialog__actions"><HposButton onClick={() => setTransferTab(null)} disabled={transferBusy}>Cancel</HposButton><HposButton tone="primary" onClick={() => runTransfer({})} disabled={transferBusy || !transferTarget}>{transferBusy ? "Transferring…" : "Transfer waiter"}</HposButton></div>
          </section>
        </div>
      )}
    </div>
  );
}
