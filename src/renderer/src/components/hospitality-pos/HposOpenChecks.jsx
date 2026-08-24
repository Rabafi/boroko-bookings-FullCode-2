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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [splitTab, setSplitTab] = useState(null);
  const [splitCount, setSplitCount] = useState(2);
  const [splitBusy, setSplitBusy] = useState(false);
  const [splitError, setSplitError] = useState("");
  const [transferTab, setTransferTab] = useState(null);
  const [transferChoices, setTransferChoices] = useState([]);
  const [transferTarget, setTransferTarget] = useState("");
  const [transferNotes, setTransferNotes] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [sharedTillOperatorId, setSharedTillOperatorId] = useState(null);

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
  }, [load]);

  const filtered = useMemo(
    () =>
      tabs.filter((tab) =>
        `${tab.table_name || ""} ${tab.tab_name || ""} ${tab.customer_name || ""} ${tab.waiter_name || ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [tabs, query],
  );
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
      },
    });
  };
  const openSplit = (tab) => {
    if (!canControl(tab)) return;
    setSplitTab(tab);
    setSplitCount(2);
    setSplitError("");
  };
  const runSplit = async () => {
    if (!splitTab?.id || splitBusy || tabValue(splitTab) === null || !canControl(splitTab)) return;
    setSplitBusy(true);
    setSplitError("");
    try {
      const keyName = `hpos:pending-split:${splitTab.id}`;
      const payloadFingerprint = JSON.stringify({ split_count: Number(splitCount), source_tab_version: splitTab.tab_version ?? splitTab.version ?? 1 });
      const saved = localStorage.getItem(keyName);
      const savedEnvelope = saved ? JSON.parse(saved) : null;
      if (savedEnvelope?.payloadFingerprint && savedEnvelope.payloadFingerprint !== payloadFingerprint) {
        throw new Error('A previous split attempt for this tab is unresolved. Refresh and resolve it before changing the split count.');
      }
      const operationKey = savedEnvelope?.operationKey || crypto.randomUUID();
      localStorage.setItem(keyName, JSON.stringify({ operationKey, payloadFingerprint }));
      const result = await window.api?.pos?.splitBillEvenly?.({
        source_tab_id: splitTab.id,
        split_count: Number(splitCount),
        target_table_names: [],
        source_tab_version: splitTab.tab_version ?? splitTab.version ?? 1,
        idempotency_key: operationKey,
      });
      if (!result?.success)
        throw new Error(result?.error || "Could not split this check.");
      localStorage.removeItem(keyName);
      setSplitTab(null);
      await load({ quiet: true });
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

  const runTransfer = async () => {
    if (!transferTab?.id || !transferTarget || transferBusy || !canControl(transferTab)) return;
    const target = transferChoices.find((row) => row.staff_user_id === transferTarget);
    if (!target?.pos_shift_id) return;
    setTransferBusy(true);
    setTransferError("");
    try {
      const keyName = `hpos:pending-waiter-transfer:${transferTab.id}`;
      const payloadFingerprint = JSON.stringify({ target_waiter_id: target.staff_user_id, target_shift_id: target.pos_shift_id, expected_tab_version: transferTab.tab_version ?? 1, notes: transferNotes.trim() || null });
      const saved = localStorage.getItem(keyName);
      const savedEnvelope = saved ? JSON.parse(saved) : null;
      if (savedEnvelope?.payloadFingerprint && savedEnvelope.payloadFingerprint !== payloadFingerprint) {
        throw new Error("A previous transfer attempt for this tab is unresolved. Retry it or refresh before choosing another waiter.");
      }
      const operationId = savedEnvelope?.operationId || crypto.randomUUID();
      localStorage.setItem(keyName, JSON.stringify({ operationId, payloadFingerprint }));
      const result = await window.api?.pos?.transferTabWaiter?.({
        tab_id: transferTab.id,
        target_waiter_id: target.staff_user_id,
        target_shift_id: target.pos_shift_id,
        expected_tab_version: transferTab.tab_version ?? 1,
        operation_id: operationId,
        notes: transferNotes.trim() || null,
      });
      if (!result?.success) throw new Error(result?.error || "The server rejected this waiter transfer.");
      localStorage.removeItem(keyName);
      setTransferTab(null);
      await load({ quiet: true });
    } catch (transferFailure) {
      setTransferError(transferFailure?.message || "Could not confirm the waiter transfer. Retry with the same transfer key.");
    } finally {
      setTransferBusy(false);
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
      </div>
      {error && <HposNotice tone="error">{error}</HposNotice>}
      {loading ? (
        <div className="hpos-service-loading">
          <RefreshCw className="is-spinning" size={22} />
          <span>Loading open tabs…</span>
        </div>
      ) : (
        <section className="hpos-check-grid" aria-live="polite">
          {filtered.map((tab) => (
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
              </footer>
            </article>
          ))}
          {!filtered.length && (
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
                onClick={runSplit}
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
            <label className="hpos-form-field"><span>Active waiter for this outlet</span><select value={transferTarget} onChange={(event) => setTransferTarget(event.target.value)} disabled={transferBusy || !transferChoices.length}><option value="">Choose waiter</option>{transferChoices.map((row) => <option key={`${row.staff_user_id}:${row.pos_shift_id}`} value={row.staff_user_id}>{row.staff_name || row.staff_user_id}</option>)}</select></label>
            <label className="hpos-form-field"><span>Note (optional)</span><textarea value={transferNotes} onChange={(event) => setTransferNotes(event.target.value.slice(0, 1000))} disabled={transferBusy} maxLength={1000} rows={3} placeholder="Reason or handover note" /></label>
            <div className="hpos-service-dialog__actions"><HposButton onClick={() => setTransferTab(null)} disabled={transferBusy}>Cancel</HposButton><HposButton tone="primary" onClick={runTransfer} disabled={transferBusy || !transferTarget}>{transferBusy ? "Transferring…" : "Transfer waiter"}</HposButton></div>
          </section>
        </div>
      )}
    </div>
  );
}
