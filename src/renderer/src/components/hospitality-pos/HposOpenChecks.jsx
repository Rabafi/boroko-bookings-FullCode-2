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
import { useSettings } from "../../app-context";
import { isBarOnlyMode } from "../../../../shared/propertyTypes";
import { HposButton, HposEmptyState, HposNotice, HposPageHero } from "./HposUi";

const age = (value) => {
  const mins = Math.max(
    0,
    Math.floor((Date.now() - new Date(value || Date.now()).getTime()) / 60000),
  );
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

const tabValue = (tab) =>
  (tab.items || []).reduce(
    (sum, item) =>
      sum +
      Number(item.unit_price || item.price || 0) * Number(item.quantity || 1),
    0,
  );

export default function HposOpenChecks() {
  const navigate = useNavigate();
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
  const total = tabs.reduce((sum, tab) => sum + tabValue(tab), 0);
  const resume = (tab) =>
    navigate("/hpos/pos", {
      state: {
        tableName: tab.table_name || "",
        tabName: tab.tab_name || tab.customer_name || "",
        tabId: tab.id,
      },
    });
  const openSplit = (tab) => {
    setSplitTab(tab);
    setSplitCount(2);
    setSplitError("");
  };
  const runSplit = async () => {
    if (!splitTab?.id || splitBusy) return;
    setSplitBusy(true);
    setSplitError("");
    try {
      const result = await window.api?.pos?.splitBillEvenly?.({
        source_tab_id: splitTab.id,
        split_count: Number(splitCount),
        target_table_names: [],
        idempotency_key: crypto.randomUUID(),
      });
      if (!result?.success)
        throw new Error(result?.error || "Could not split this check.");
      setSplitTab(null);
      await load({ quiet: true });
    } catch (splitFailure) {
      setSplitError(splitFailure?.message || "Could not split this check.");
    } finally {
      setSplitBusy(false);
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
            {currency}{" "}
            {total.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
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
                  {currency} {tabValue(tab).toFixed(2)}
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
                  disabled={(tab.items || []).length < 2}
                >
                  <Scissors size={14} />
                  Split
                </button>
                <button
                  type="button"
                  className="is-primary"
                  onClick={() => resume(tab)}
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
                {currency}{" "}
                {(tabValue(splitTab) / Number(splitCount || 2)).toFixed(2)} per
                check before rounding
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
                disabled={splitBusy}
              >
                {splitBusy ? "Splitting…" : "Split checks"}
              </HposButton>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
