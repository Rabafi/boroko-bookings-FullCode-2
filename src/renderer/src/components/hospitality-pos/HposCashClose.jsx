import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  CreditCard,
  RefreshCw,
  Scale,
  ShieldCheck,
  WalletCards,
  XCircle,
} from "lucide-react";
import { useAccess, useSettings } from "../../app-context";
import { canAccessCapability } from "../../../../shared/accessControl";
import { HposButton, HposNotice, HposPageHero } from "./HposUi";

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => window.setTimeout(() => resolve(fallback), ms)),
  ]);
}

export default function HposCashClose() {
  const { settings } = useSettings();
  const access = useAccess();
  const canCloseCashup = canAccessCapability(access, "pos.cashup");
  const currency = settings?.currency || "P";
  const [drawer, setDrawer] = useState(null);
  const [cashSummary, setCashSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [floatAmount, setFloatAmount] = useState("");
  const [declaredCash, setDeclaredCash] = useState("");
  const [cashMovement, setCashMovement] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [pendingCashups, setPendingCashups] = useState([]);
  const [reviewDraft, setReviewDraft] = useState(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [managerPin, setManagerPin] = useState("");

  const refreshDrawer = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setActionError("");
    try {
      const [data, pending] = await Promise.all([
        withTimeout(window.api?.pos?.getOpenCashDrawer?.() ?? null, 8000, null),
        withTimeout(
          window.api?.pos?.getPendingCashupSubmissions?.().catch(() => null),
          8000,
          null,
        ),
      ]);
      if (pending?.success !== false)
        setPendingCashups(pending?.submissions || []);
      setDrawer(data || null);
      if (!data) {
        setCashSummary(null);
        setCashMovement("");
        return;
      }
      const summary = await window.api?.pos?.getCashupSummary?.({
        date:
          data.business_date ||
          data.opened_at?.slice(0, 10) ||
          new Date().toISOString().slice(0, 10),
        outlet_id: data.outlet_id || null,
        opening_float: Number(data.opening_float || 0),
      });
      if (summary?.success === false)
        throw new Error(
          summary.error || "The cash movement estimate could not be loaded.",
        );
      setCashSummary(summary || null);
      setCashMovement((current) =>
        current === ""
          ? String(Number(summary?.expected_cash_sales || 0).toFixed(2))
          : current,
      );
    } catch (error) {
      setActionError(
        error?.message || "The cash drawer could not be refreshed.",
      );
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshDrawer();
  }, [refreshDrawer]);

  const fmt = (value) =>
    Number(value || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const expectedCash = drawer
    ? Number(drawer.opening_float || 0) + Number(cashMovement || 0)
    : 0;
  const hasDeclaration =
    declaredCash !== "" && Number.isFinite(Number(declaredCash));
  const variance = hasDeclaration ? Number(declaredCash) - expectedCash : 0;

  const openDrawer = async () => {
    if (Number(floatAmount || 0) < 0) {
      setActionError("Opening float cannot be negative.");
      return;
    }
    setBusy(true);
    setActionError("");
    setActionNotice("");
    try {
      const result = await window.api?.pos?.openCashDrawerSession?.({
        openingFloat: Number(floatAmount) || 0,
      });
      if (!result?.success)
        throw new Error(result?.error || "Could not open the cash drawer.");
      setFloatAmount("");
      setActionNotice("Cash drawer opened and ready for service.");
      await refreshDrawer({ quiet: true });
    } catch (error) {
      setActionError(error?.message || "Could not open the cash drawer.");
    } finally {
      setBusy(false);
    }
  };

  const closeDrawer = async () => {
    if (!drawer?.id || busy) return;
    if (
      !hasDeclaration ||
      Number(declaredCash) < 0 ||
      cashMovement === "" ||
      Number(cashMovement) < 0
    ) {
      setActionError(
        "Enter the POS cash movement and the cash physically counted in the drawer before closing.",
      );
      return;
    }
    if (
      !window.confirm(
        `Close this drawer with declared cash of ${currency} ${fmt(declaredCash)}? This completes the reconciliation.`,
      )
    )
      return;
    setBusy(true);
    setActionError("");
    setActionNotice("");
    try {
      const result = await window.api?.pos?.closeCashDrawerSession?.({
        sessionId: drawer.id,
        closingTotal: Number(cashMovement),
        declaredTotal: Number(declaredCash),
        notes: closeNotes.trim() || null,
      });
      if (!result?.success)
        throw new Error(result?.error || "Could not close the cash drawer.");
      setDeclaredCash("");
      setCashMovement("");
      setCloseNotes("");
      setActionNotice(
        `Drawer closed. Final variance: ${currency} ${Number(result?.variance ?? variance) > 0 ? "+" : ""}${fmt(result?.variance ?? variance)}.`,
      );
      await refreshDrawer({ quiet: true });
    } catch (error) {
      setActionError(error?.message || "Could not close the cash drawer.");
    } finally {
      setBusy(false);
    }
  };

  const beginReview = (submission, decision) => {
    if (busy) return;
    setActionError("");
    setReviewNotes("");
    setManagerPin("");
    setReviewDraft({ submission, decision });
  };

  const reviewSubmission = async (
    legacySubmission = null,
    legacyDecision = null,
  ) => {
    const submission = reviewDraft?.submission || legacySubmission;
    const decision = reviewDraft?.decision || legacyDecision;
    if (!submission || !decision || busy) return;
    if (!reviewDraft) {
      beginReview(submission, decision);
      return;
    }
    const notes = reviewNotes.trim();
    if (decision === "reject" && !notes) {
      setActionError(
        "Enter a return-for-correction note so the staff member knows what to fix.",
      );
      return;
    }
    setBusy(true);
    setActionError("");
    setActionNotice("");
    try {
      const result = await window.api?.pos?.reviewCashupSubmission?.({
        submission_id: submission.id,
        decision,
        notes: notes || null,
        manager_pin: managerPin,
      });
      if (!result?.success)
        throw new Error(result?.error || "Could not review cash-up.");
      setActionNotice(
        decision === "approve"
          ? "Cash-up approved and the shift is closed."
          : "Cash-up returned to the cashier for correction.",
      );
      setReviewDraft(null);
      setReviewNotes("");
      setManagerPin("");
      await refreshDrawer({ quiet: true });
    } catch (error) {
      setActionError(error?.message || "Could not review cash-up.");
    } finally {
      setBusy(false);
    }
  };

  if (!canCloseCashup)
    return (
      <div className="hpos-page-frame hpos-service-cash">
        <HposPageHero
          eyebrow="Money control"
          title="Cash & close"
          description="Cashiers submit their own count in My Cash-up. A supervisor or manager reviews and closes the shift."
        />
        <HposNotice tone="warning">
          Use My Cash-up to submit your physical count for review. You do not
          have permission to finalise a shift.
        </HposNotice>
      </div>
    );
  return (
    <div className="hpos-page-frame hpos-service-cash">
      <HposPageHero
        eyebrow="Money control"
        title="Cash & close"
        description="Reconcile the physical drawer with the payments recorded in this outlet."
        actions={
          <div className="hpos-service-hero-actions">
            <div
              className={`hpos-service-drawer-status ${drawer ? "is-open" : ""}`}
            >
              <WalletCards size={17} />
              <span>{drawer ? "Drawer open" : "Drawer closed"}</span>
            </div>
            <HposButton
              icon={RefreshCw}
              onClick={() => refreshDrawer()}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </HposButton>
          </div>
        }
      />
      {actionError && <HposNotice tone="error">{actionError}</HposNotice>}
      {actionNotice && (
        <div className="hpos-inline-notice">
          <CheckCircle2 size={17} />
          {actionNotice}
        </div>
      )}
      {reviewDraft && (
        <section className="hpos-cashup-review">
          <div>
            <p className="hpos-eyebrow">Confirm manager decision</p>
            <h2>
              {reviewDraft.decision === "reject"
                ? "Return cash-up for correction"
                : "Approve and close shift"}
            </h2>
            <p>
              {reviewDraft.submission.cashier_name || "This team member"} ·{" "}
              {reviewDraft.submission.outlet_name || "Service outlet"}
            </p>
          </div>
          <div className="hpos-cashup-review-list">
            <article>
              <label className="hpos-my-cashup-notes">
                <span>
                  {reviewDraft.decision === "reject"
                    ? "Correction note"
                    : "Approval note"}{" "}
                  {reviewDraft.decision === "reject" && <em>required</em>}
                </span>
                <textarea
                  autoFocus
                  rows="3"
                  value={reviewNotes}
                  onChange={(event) => setReviewNotes(event.target.value)}
                  placeholder={
                    reviewDraft.decision === "reject"
                      ? "Explain what the till operator must correct"
                      : "Optional approval note"
                  }
                  disabled={busy}
                />
              </label>
              <label className="hpos-cashup-review-pin">
                <span>
                  <ShieldCheck size={17} /> Manager PIN <em>required</em>
                </span>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={managerPin}
                  onChange={(event) =>
                    setManagerPin(
                      event.target.value.replace(/\D/g, "").slice(0, 6),
                    )
                  }
                  placeholder="Enter your manager PIN"
                  disabled={busy}
                />
                <small>
                  Your PIN authorises this decision on the shared terminal.
                </small>
              </label>
              <footer>
                <HposButton
                  onClick={() => {
                    setReviewDraft(null);
                    setReviewNotes("");
                    setManagerPin("");
                  }}
                  disabled={busy}
                >
                  Cancel
                </HposButton>
                <HposButton
                  tone="primary"
                  icon={
                    reviewDraft.decision === "reject" ? XCircle : CheckCircle2
                  }
                  onClick={reviewSubmission}
                  disabled={
                    busy ||
                    !managerPin ||
                    (reviewDraft.decision === "reject" && !reviewNotes.trim())
                  }
                >
                  {busy
                    ? "Saving…"
                    : reviewDraft.decision === "reject"
                      ? "Return for correction"
                      : "Approve & close shift"}
                </HposButton>
              </footer>
            </article>
          </div>
        </section>
      )}
      {loading ? (
        <div className="hpos-service-loading">
          <RefreshCw className="is-spinning" size={22} />
          <span>Checking the cash drawer…</span>
        </div>
      ) : (
        <>
          {pendingCashups.length > 0 && (
            <section className="hpos-cashup-review">
              <div>
                <p className="hpos-eyebrow">Supervisor review</p>
                <h2>
                  {pendingCashups.length} cash-up
                  {pendingCashups.length === 1 ? "" : "s"} awaiting a decision
                </h2>
                <p>
                  Compare the physical count with the server-calculated shift
                  total. Approval permanently closes that team member’s shift.
                </p>
              </div>
              <div className="hpos-cashup-review-list">
                {pendingCashups.map((submission) => {
                  const counted = Number(
                    submission.counted_by_method?.cash || 0,
                  );
                  const expected = Number(submission.expected_cash_drawer || 0);
                  const retainedCashTips = Number(
                    submission.cash_tips_retained || 0,
                  );
                  const variance = counted - expected;
                  return (
                    <article key={submission.id}>
                      <header>
                        <div>
                          <strong>
                            {submission.cashier_name || "Team member"}
                          </strong>
                          <span>
                            {submission.outlet_name || "Service outlet"} ·{" "}
                            {new Date(submission.submitted_at).toLocaleString()}
                          </span>
                        </div>
                        <span
                          className={
                            Math.abs(variance) < 0.01
                              ? "is-balanced"
                              : "is-variance"
                          }
                        >
                          {Math.abs(variance) < 0.01
                            ? "Balanced"
                            : `${variance > 0 ? "Over" : "Short"} ${currency} ${fmt(Math.abs(variance))}`}
                        </span>
                      </header>
                      <div className="hpos-cashup-review-values">
                        <span>
                          Expected cash
                          <strong>
                            {currency} {fmt(expected)}
                          </strong>
                        </span>
                        {retainedCashTips > 0 && (
                          <span>
                            Cash tips retained
                            <strong>
                              {currency} {fmt(retainedCashTips)}
                            </strong>
                          </span>
                        )}
                        <span>
                          Counted cash
                          <strong>
                            {currency} {fmt(counted)}
                          </strong>
                        </span>
                      </div>
                      {retainedCashTips > 0 && (
                        <p className="hpos-cashup-review-note">
                          The retained cash tip is recorded against the sale and
                          is excluded from the expected drawer cash.
                        </p>
                      )}
                      {submission.notes && (
                        <p className="hpos-cashup-review-note">
                          Cashier note: {submission.notes}
                        </p>
                      )}
                      <footer>
                        <HposButton
                          icon={XCircle}
                          onClick={() => reviewSubmission(submission, "reject")}
                          disabled={busy}
                        >
                          Return for correction
                        </HposButton>
                        <HposButton
                          tone="primary"
                          icon={CheckCircle2}
                          onClick={() =>
                            reviewSubmission(submission, "approve")
                          }
                          disabled={busy}
                        >
                          Approve & close shift
                        </HposButton>
                      </footer>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          {!drawer ? (
            <section className="hpos-service-cash-open">
              <div className="hpos-service-cash-open__icon">
                <WalletCards size={26} />
              </div>
              <p className="hpos-eyebrow">Before taking cash</p>
              <h2>Open the drawer</h2>
              <p>
                Record the physical cash float placed in the till. The figure
                becomes the starting point for this reconciliation.
              </p>
              <label>
                Opening float ({currency})
                <input
                  autoFocus
                  type="number"
                  min="0"
                  step="0.01"
                  value={floatAmount}
                  onChange={(event) => setFloatAmount(event.target.value)}
                  placeholder="0.00"
                />
              </label>
              <button
                type="button"
                className="hpos-primary-action"
                onClick={openDrawer}
                disabled={busy}
              >
                {busy ? "Opening drawer…" : "Open cash drawer"}
              </button>
            </section>
          ) : (
            <>
              <section className="hpos-service-cash-kpis">
                {[
                  {
                    label: "Opening float",
                    value: drawer.opening_float,
                    icon: WalletCards,
                  },
                  {
                    label: "Cash movement",
                    value: cashSummary?.expected_cash_sales || 0,
                    icon: Banknote,
                  },
                  {
                    label: "Card sales",
                    value: cashSummary?.by_method?.card || 0,
                    icon: CreditCard,
                  },
                  {
                    label: "Net sales",
                    value: cashSummary?.net_sales || 0,
                    icon: Scale,
                  },
                ].map(({ label, value, icon: Icon }) => (
                  <article key={label}>
                    <span>
                      <Icon size={18} />
                    </span>
                    <small>{label}</small>
                    <strong>
                      {currency} {fmt(value)}
                    </strong>
                  </article>
                ))}
              </section>
              <section className="hpos-service-reconcile">
                <div className="hpos-service-reconcile__summary">
                  <p className="hpos-eyebrow">Physical reconciliation</p>
                  <h2>Count and close the drawer</h2>
                  <p>
                    Use the POS estimate as a starting point, confirm the actual
                    cash movement for this drawer, then enter the physical
                    count.
                  </p>
                  <div>
                    <span>
                      Opening float
                      <strong>
                        {currency} {fmt(drawer.opening_float)}
                      </strong>
                    </span>
                    <span>
                      POS cash estimate
                      <strong>
                        {currency} {fmt(cashSummary?.expected_cash_sales)}
                      </strong>
                    </span>
                    <span>
                      Returns included
                      <strong>
                        {currency} {fmt(cashSummary?.returns_total)}
                      </strong>
                    </span>
                    <span className="is-total">
                      Expected cash
                      <strong>
                        {currency} {fmt(expectedCash)}
                      </strong>
                    </span>
                  </div>
                </div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    closeDrawer();
                  }}
                >
                  <label>
                    POS cash movement ({currency})
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cashMovement}
                      onChange={(event) => setCashMovement(event.target.value)}
                      placeholder="Cash sales less cash refunds"
                    />
                    <small>
                      Pre-filled from the outlet POS estimate. Correct it if
                      this drawer session differs.
                    </small>
                  </label>
                  <label>
                    Declared cash ({currency})
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={declaredCash}
                      onChange={(event) => setDeclaredCash(event.target.value)}
                      placeholder="Enter the amount counted"
                    />
                  </label>
                  {hasDeclaration && (
                    <div
                      className={`hpos-service-variance ${Math.abs(variance) < 0.01 ? "is-balanced" : "is-different"}`}
                    >
                      {Math.abs(variance) < 0.01 ? (
                        <>
                          <CheckCircle2 size={18} />
                          Balanced
                        </>
                      ) : (
                        <>
                          <AlertTriangle size={18} />
                          {variance > 0 ? "Over" : "Short"} by {currency}{" "}
                          {fmt(Math.abs(variance))}
                        </>
                      )}
                    </div>
                  )}
                  <label>
                    Close notes <span>optional</span>
                    <textarea
                      rows="3"
                      value={closeNotes}
                      onChange={(event) => setCloseNotes(event.target.value)}
                      placeholder="Variance reason or shift handover note"
                    />
                  </label>
                  <button
                    type="submit"
                    className="hpos-primary-action"
                    disabled={busy || !hasDeclaration || cashMovement === ""}
                  >
                    {busy ? "Closing drawer…" : "Close & reconcile"}
                  </button>
                  <small>
                    Closing is an audited money-control action and cannot be
                    completed offline.
                  </small>
                </form>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
