// @ts-check
/**
 * Pure product-save orchestration (no Electron, no window): persist-once,
 * verbatim retry, overwrite rejection, verified writes, single-flight, and
 * definitive-vs-unknown outcome handling. The desktop domain supplies real
 * storage/RPC/queue dependencies; tests supply fakes and execute the real
 * logic, including concurrent clicks and crash-recovery replays.
 *
 * Request lifecycle: unsent -> queued|unknown|pending-upgrade -> committed
 * (terminal success) | rejected (terminal business refusal). Unknown outcomes
 * stay retryable under the identical key and bytes; only committed and
 * rejected are terminal.
 */

import {
  canonicalJson,
  isMissingRpcError,
  isSameProductRequest,
  normalizeProductSaveRequest,
} from "./productRequest.js";

/** @type {Set<unknown>} */
const ACTIONABLE_STATES = new Set(["unsent", "queued", "unknown", "failed"]);

/** @typedef {Record<string, unknown>} ProductFlowRecord */
/** @typedef {ProductFlowRecord & {operation_key?: unknown, payload?: unknown, state?: unknown, result?: unknown, error?: unknown, entity_ids?: unknown}} StoredProductRequest */
/** @typedef {StoredProductRequest & {operation_key: string}} FreshProductRequest */

/**
 * @param {object} deps
 * @param {(key: string) => unknown} deps.readRequest - persisted JSON remains unvalidated
 * @param {() => unknown} deps.listRequests
 * @param {(entry: StoredProductRequest) => void} deps.writeRequest - must throw on failure
 * @param {(entry: string) => void} deps.removeRequest
 * @param {(entry: StoredProductRequest) => Promise<unknown>} deps.queueOffline
 * @param {(payload: unknown) => Promise<unknown>} deps.dispatchOnline
 * @param {(entry: StoredProductRequest, result: unknown) => Promise<{ publication?: unknown }>} deps.finalizeCommitted
 * @param {() => boolean} deps.isOnline
 * @param {(id?: string) => string} deps.newId
 */
export function createProductSaveFlow(deps) {
  /** @type {Map<string, Promise<unknown>>} */
  const inflight = new Map();

  /** @param {string} operationKey @param {() => Promise<unknown>} run */
  const withSingleFlight = (operationKey, run) => {
    const pending = inflight.get(operationKey);
    if (pending) return pending;
    const task = run().finally(() => {
      if (inflight.get(operationKey) === task) inflight.delete(operationKey);
    });
    inflight.set(operationKey, task);
    return task;
  };

  /** @param {FreshProductRequest} entry */
  const persistVerified = (entry) => {
    try {
      deps.writeRequest(entry);
    } catch (error) {
      throw new Error(
        "The product save could not be stored safely on this device. Nothing was sent; retry once storage is available.",
      );
    }
    const roundTrip = /** @type {StoredProductRequest|null|undefined} */ (deps.readRequest(entry.operation_key));
    if (!roundTrip || canonicalJson(roundTrip.payload) !== canonicalJson(entry.payload)) {
      throw new Error(
        "The product save could not be stored safely on this device. Nothing was sent; retry once storage is available.",
      );
    }
  };

  /** @param {StoredProductRequest} entry */
  const dispatchStored = async (entry) => {
    if (!deps.isOnline()) {
      await deps.queueOffline(entry);
      deps.writeRequest({ ...entry, state: "queued" });
      return {
        success: true,
        offline: true,
        queued: true,
        operation_key: entry.operation_key,
        menu_item_id: (/** @type {ProductFlowRecord|null|undefined} */ (entry.entity_ids))?.menu_item_id || null,
        inventory_item_id: (/** @type {ProductFlowRecord|null|undefined} */ (entry.entity_ids))?.inventory_item_id || null,
        publication: "pending",
      };
    }
    /** @type {ProductFlowRecord|null|undefined} */
    let outcome;
    try {
      outcome = /** @type {ProductFlowRecord|null|undefined} */ (await deps.dispatchOnline(entry.payload));
    } catch (error) {
      deps.writeRequest({
        ...entry,
        state: "unknown",
          // Read the expected message view at its original location; errors
          // remain unvalidated and any getter is observed with the same count.
          error: (/** @type {{message?: unknown}|null|undefined} */ (error))?.message || "Save outcome unknown",
      });
      throw new Error(
          `${(/** @type {{message?: unknown}|null|undefined} */ (error))?.message || "Save outcome unknown."} Nothing was confirmed; retrying reuses the original save.`,
      );
    }
    if (outcome?.missing) {
      deps.writeRequest({
        ...entry,
        state: "pending-upgrade",
        error: "Saving products needs the latest till update. Entries are preserved — update, then retry this save.",
      });
      throw new Error(
        "Saving products needs the latest till update. Your entries are preserved — update, then retry this save.",
      );
    }
    if (outcome?.rejected || (/** @type {ProductFlowRecord|null|undefined} */ (outcome?.result))?.success === false) {
      const message =
        (/** @type {ProductFlowRecord|null|undefined} */ (outcome?.result))?.error ||
        (/** @type {ProductFlowRecord|null|undefined} */ (outcome?.error))?.message ||
        "Could not save this product.";
      deps.writeRequest({ ...entry, state: "rejected", error: message });
      // RPC values are JSON-compatible; String preserves Error's existing
      // ToString behavior for those values without claiming shape validation.
      throw new Error(String(message));
    }
    // Commit is recorded before side effects so a crash between commit and
    // publication still replays as committed (never a duplicate effect).
    // Side effects (movement, publication sweep) are idempotent and resume
    // from the committed record.
    // outcome is read directly here just as before: a missing adapter result
    // still fails at this point instead of being converted into a success.
    const completedOutcome = /** @type {ProductFlowRecord} */ (outcome)
    const committed = /** @type {StoredProductRequest} */ ({
      ...entry,
      state: "committed",
      result: completedOutcome.result,
      entity_ids: {
        menu_item_id: (/** @type {ProductFlowRecord|null|undefined} */ (completedOutcome.result))?.menu_item_id || (/** @type {ProductFlowRecord|null|undefined} */ (entry.entity_ids))?.menu_item_id || null,
        inventory_item_id: (/** @type {ProductFlowRecord|null|undefined} */ (completedOutcome.result))?.inventory_item_id || (/** @type {ProductFlowRecord|null|undefined} */ (entry.entity_ids))?.inventory_item_id || null,
      },
    });
    deps.writeRequest(committed);
    const finalized = await deps.finalizeCommitted(committed, completedOutcome.result);
    return { ...(completedOutcome.result || {}), success: true, publication: finalized?.publication || "pending" };
  };

  /**
   * Save (or resume) a product under a stable operation key. The first call
   * persists the normalized request once; every later call with the same
   * key reuses those exact bytes. A different payload under a reused key is
   * rejected, never merged or overwritten.
   */
  /** @param {import('./productRequest.js').ProductSaveForm} [data] @param {unknown} [lodgeId] @param {import('./productRequest.js').MintedProductIds} [minted] */
  const save = (data = {}, lodgeId = null, minted = {}) =>
    withSingleFlight(String(data?.operation_key || minted.operationKey || ""), async () => {
      const keyHint = String(data?.operation_key || minted.operationKey || "").trim();
      if (!keyHint) throw new Error("A stable operation key is required before a product save can be persisted.");
      const existing = /** @type {StoredProductRequest|null|undefined} */ (deps.readRequest(keyHint));
      if (existing) {
        if (existing.state === "committed") {
          return { ...(existing.result || {}), success: true, replayed: true };
        }
        if (existing.state === "rejected") {
          throw new Error(String(
            existing.error || "This product save was definitively rejected. Correct the values and save as a new product."
          ));
        }
        // Unresolved earlier attempt: overlay stored identities so the
        // comparison is business-values only, then reuse stored bytes.
        const candidate = normalizeProductSaveRequest(
          {
            ...(data || {}),
            inventory_item_id: (/** @type {ProductFlowRecord|null|undefined} */ (existing.entity_ids))?.inventory_item_id || data?.inventory_item_id,
            menu_item_id: (/** @type {ProductFlowRecord|null|undefined} */ (existing.entity_ids))?.menu_item_id ?? data?.menu_item_id ?? null,
          },
          lodgeId,
          {},
        );
        if (!isSameProductRequest(existing.payload, candidate.payload)) {
          throw new Error(
            "This save key is already in use with different values. Continue the original save or start a new product.",
          );
        }
        return dispatchStored(existing);
      }
      const normalized = normalizeProductSaveRequest(
        data,
        lodgeId,
        {
          inventoryItemId: String(data?.inventory_item_id || "").trim() || deps.newId(),
        },
      );
      const entry = /** @type {FreshProductRequest} */ ({
        operation_key: normalized.operationKey,
        payload: normalized.payload,
        entity_ids: normalized.entityIds,
        state: "unsent",
        created_at: new Date().toISOString(),
      });
      persistVerified(entry);
      return withSingleFlight(normalized.operationKey, () => dispatchStored(entry));
    });

  /** Explicit retry of a stored request (used by recovery and the UI). */
  /** @param {string} operationKey */
  const retry = (operationKey) =>
    withSingleFlight(String(operationKey || ""), async () => {
      const existing = /** @type {StoredProductRequest|null|undefined} */ (deps.readRequest(String(operationKey || "")));
      if (!existing) throw new Error("No saved product request matches this save.");
      if (existing.state === "committed") {
        return { ...(existing.result || {}), success: true, replayed: true };
      }
      if (existing.state === "rejected") {
          throw new Error(String(
            existing.error || "This product save was definitively rejected. Correct the values and save as a new product."
          ));
      }
      return dispatchStored(existing);
    });

  /** Discard a terminally rejected (or superseded) request so its key can be retired. */
  /** @param {string} operationKey */
  const discard = (operationKey) => {
    deps.removeRequest(String(operationKey || ""));
  };

  /** Crash/startup recovery: re-dispatch every actionable stored request. */
  const recover = async () => {
    const acted = [];
    // The production producer returns the persisted request array. Keep its
    // existing iteration/failure behavior for malformed dependency values;
    // this expected-data view does not validate cache contents or rows.
    const stored = /** @type {StoredProductRequest[]} */ (
      typeof deps.listRequests === "function" ? deps.listRequests() : []
    );
    for (const entry of stored) {
      const key = entry?.operation_key;
      if (!key || !ACTIONABLE_STATES.has(entry?.state)) continue;
      try {
        const outcome = /** @type {ProductFlowRecord|null|undefined} */ (await retry(/** @type {string} */ (key)));
        acted.push({ operation_key: key, ok: true, publication: outcome?.publication || null });
      } catch (error) {
          acted.push({
            operation_key: key,
            ok: false,
            error: (/** @type {{message?: unknown}|null|undefined} */ (error))?.message || "Recovery failed",
          });
      }
    }
    return acted;
  };

  /** @param {string} operationKey */
  const status = (operationKey) => deps.readRequest(String(operationKey || "")) || null;

  const list = () => (typeof deps.listRequests === "function" ? deps.listRequests() : []);

  return { save, retry, discard, recover, status, list, ACTIONABLE_STATES };
}
