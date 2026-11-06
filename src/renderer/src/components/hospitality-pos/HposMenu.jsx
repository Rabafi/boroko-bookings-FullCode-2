// @ts-check
import { useState, useEffect, useMemo, useRef } from "react";
import { ErrorNotice } from "../shared/ErrorNotice";
import { useLocation, useNavigate } from "react-router";
import {
  Archive,
  Boxes,
  CheckCircle2,
  CookingPot,
  Edit2,
  Eye,
  EyeOff,
  Plus,
  ScanLine,
  Search,
  Tag,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { useAccess, useSettings } from "../../app-context";
import { canAccessCapability } from "../../../../shared/accessControl";
import { isBarOnlyMode } from "../../../../shared/propertyTypes";
import {
  BAR_PACK_SIZES,
  getBarModeProfile,
} from "../../../../shared/barModeProfile";
import { getCommercialFeatureSet } from "../../../../shared/commercialAccess";
import { createBarcodeScannerDecoder } from "../../../../shared/barcodeScanner";
import HposProductWizard from "./HposProductWizard";
import BarLocalModifierManager from "./BarLocalModifierManager.jsx";

/** @typedef {{id: string, name: string, category: string, price: number|string|null, tax_rate?: number|string|null, is_available?: boolean, available?: boolean, archived_at?: string|null, barcode?: string|null, inventory_item_id?: string|null, depletion_qty?: number|string|null, stock_method?: string|null, outlet_id?: string|null, dietary_flags?: unknown[], prep_time_minutes?: number|string, is_popular?: boolean, kitchen_station_id?: string|null, cost_price?: number|string|null, product_version?: number, availability_version?: number, track_stock?: boolean, sku?: string, template_kind?: string|null, template_pack_size?: number|string|null, template_parent_product_id?: string|null, _pending_sync?: boolean, _operation_key?: string, _sync_state?: string, updated_at?: string|null}} HposMenuItemExpectedView */
/** @typedef {{_available?: boolean, _error?: string}} HposMenuUnavailableExpectedView */
/** @typedef {(HposMenuItemExpectedView[] & HposMenuUnavailableExpectedView) | HposMenuUnavailableExpectedView} HposMenuReadExpectedView */
/** @typedef {{id: string, name: string, barcode?: string|null, current_stock?: number|string|null, unit?: string|null, reorder_level?: number|string|null, is_active?: boolean, outlet_id?: string|null, type?: string|null, latest_unit_cost?: number|string|null, selling_price?: number|string|null, updated_at?: string|null}} HposInventoryItemExpectedView */
/** @typedef {{id: string, name?: string, is_active?: boolean, type?: string|null}} HposOutletExpectedView */
/** @typedef {{id: string, name: string, applies_to_categories: string[], min_selections: number, max_selections: number, options: {name: string, price_delta: number}[], active?: boolean}} HposModifierGroupExpectedView */
/** @typedef {{menu_item_id: string, ingredients?: {quantity: number|string|null}[]}} HposRecipeExpectedView */
/** @typedef {{operation_key: string, name: string, state: string, publication?: string|null, error?: string|null, outlet_id?: string|null, saved_at?: string|null}} HposPendingProductRequestExpectedView */
/** @typedef {{name: string, category: string, price: string, barcode: string, inventory_item_id: string, depletion_qty: string, stock_method: string, pack6: boolean, pack12: boolean, pack24: boolean, pack6Barcode: string, pack12Barcode: string, pack24Barcode: string, [field: string]: string|boolean}} HposLegacyDraftExpectedView */
/** @typedef {{pack6: boolean, pack12: boolean, pack24: boolean, pack6Barcode: string, pack12Barcode: string, pack24Barcode: string}} HposPackFlagsExpectedView */
/** @typedef {{initialBarcode: string, initialProduct?: HposMenuItemExpectedView|null, initialStock?: HposInventoryItemExpectedView|null, initialPacks?: HposPackFlagsExpectedView, initialAvailable?: boolean, hasRecipe?: boolean}} HposWizardExpectedView */
/** The literal new-entry sentinel keeps direct property reads matching their original JavaScript behavior. */
/** @typedef {HposMenuItemExpectedView | ('new' & {id?: string, inventory_item_id?: string|null})} HposEditingExpectedView */
/** @typedef {{qty: number, unit: string, reorder: number}} HposStockQuantityExpectedView */
/** @typedef {'direct'|'recipe'|'non_stock'|'conflict'|'missing'} HposStockMethodExpectedView */
/** @typedef {{product_id?: string|null, commercial_package_key?: string|null, enterprise_addons?: string[]|null, lodge_id?: string|null}} HposEntitlementExpectedView */
/** @typedef {{success: true, id?: string, publication?: string, replayed?: boolean}|{success: false, error?: string}} HposMenuMutationExpectedView */
/** @typedef {HposMenuMutationExpectedView|undefined} HposProductRequestRetryExpectedView */
/** @typedef {{success: true, soft_deleted?: boolean, stock_delisted?: boolean}|{success: false, error?: string}} HposMenuDeleteExpectedView */
/** @typedef {{success: true, requests: HposPendingProductRequestExpectedView[]}|{success: false, error?: string, requests?: HposPendingProductRequestExpectedView[]}} HposProductRequestStatusExpectedView */
/** @typedef {HposProductRequestStatusExpectedView|undefined} HposProductRequestStatusResultExpectedView */
/** @typedef {{success: true, purged?: {menu?: number, stock?: number}}|{success: false, error?: string}} HposProductRequestDiscardExpectedView */
/** @typedef {HposProductRequestDiscardExpectedView|undefined} HposProductRequestDiscardResultExpectedView */
/** @typedef {{success: true}|{success: false, error?: string}} HposModifierMutationExpectedView */
/** @typedef {{name: string, options: string, min_selections: string, max_selections: string, applies_to_categories: string}} HposModifierDraftExpectedView */
/** @typedef {{name: string, category: string, price: number, barcode: string|null, stock_method: string, is_available: boolean, depletion_qty: number|null, inventory_item_id?: string}} HposMenuSavePayloadExpectedView */

const RESTAURANT_MENU_SECTIONS = [
  "Breakfast",
  "Starters",
  "Mains",
  "Sides",
  "Desserts",
  "Drinks",
  "Cocktails",
  "Other",
];
const RECIPE_REQUIRED_SECTIONS = new Set([
  "breakfast",
  "starters",
  "mains",
  "sides",
  "desserts",
  "cocktails",
  "food",
]);
const DEFAULT_RECIPE_DEEP_LINK = '/restaurant/menu-production?tab=recipes';
/** @param {string} category */
const categoryRequiresRecipe = (category) =>
  RECIPE_REQUIRED_SECTIONS.has(String(category || "").trim().toLowerCase());
// Every available item must have one stock method: a direct stock link or a recipe.

/** @param {{item: HposMenuItemExpectedView, onEdit: (item: HposMenuItemExpectedView) => void, onDelete: (item: HposMenuItemExpectedView) => void, onReceive?: (item: HposMenuItemExpectedView) => void, onToggleAvailability: (item: HposMenuItemExpectedView) => void, availabilityBusy: boolean, barOnly: boolean, stockMethod: HposStockMethodExpectedView, stockQty: HposStockQuantityExpectedView|null, canEdit?: boolean}} props */
function MenuItemCard({
  item,
  onEdit,
  onDelete,
  onReceive,
  onToggleAvailability,
  availabilityBusy,
  barOnly,
  stockMethod,
  stockQty,
  canEdit = true,
}) {
  const packLabel =
    item.template_kind === "bar_pack" && item.template_pack_size
      ? `${item.template_pack_size}-pack`
      : item.template_kind === "bar_single"
        ? "Single"
        : null;
  const isAvailable = item.available !== false && item.is_available !== false;
  const isArchived = Boolean(item.archived_at);
  const needsStockSetup =
    !isArchived &&
    !isAvailable &&
    ["missing", "conflict"].includes(stockMethod);
  const rawDepletionQty = Number(item.depletion_qty);
  const depletionQty =
    Number.isFinite(rawDepletionQty) && rawDepletionQty > 0
      ? rawDepletionQty
      : 1;
  // Counted stock behind this product (direct links only). Non-stock and
  // recipe items show no badge — the Till is the source of truth there.
  const countedQty = stockQty && Number.isFinite(Number(stockQty.qty)) ? Number(stockQty.qty) : null;
  const outOfStock = countedQty !== null && countedQty <= 0;
  const lowStock =
    countedQty !== null &&
    countedQty > 0 &&
    Number(stockQty.reorder) > 0 &&
    countedQty <= Number(stockQty.reorder);

  return (
    <article
      className={`hpos-service-menu-card ${isArchived ? "is-archived" : needsStockSetup ? "is-needs-setup" : isAvailable ? "is-available" : "is-sold-out"}`}
    >
      <div className="hpos-service-menu-card__top">
        <div>
          <h3>{item.name}</h3>
          <div className="hpos-service-menu-tags">
            {item.category && (
              <span>
                <Tag size={11} />
                {item.category}
              </span>
            )}
            {packLabel && <span className="is-info">{packLabel}</span>}
            {item.barcode && <span>#{item.barcode}</span>}
            {stockMethod === "direct" && (
              <span>
                <Boxes size={11} />
                Stock-linked{barOnly ? " · packs configurable" : ""}
              </span>
            )}
            {stockMethod === "recipe" && (
              <span className="is-info">
                <CookingPot size={11} />
                Recipe-linked
              </span>
            )}
            {stockMethod === "non_stock" && (
              <span className="is-info">Non-stock service</span>
            )}
            {stockMethod === "conflict" && (
              <span className="is-info">Choose stock method</span>
            )}
            {stockMethod === "missing" && (
              <span className="is-info">Stock setup required</span>
            )}
            {item._pending_sync === true && item._operation_key && (
              <span
                role="status"
                style={{
                  background: "rgba(166, 118, 42, 0.12)",
                  color: "#7a5710",
                  fontWeight: 800,
                }}
              >
                Pending sync — sells offline now
              </span>
            )}
            {outOfStock && (
              <span
                role="status"
                style={{
                  background: "rgba(191, 72, 45, 0.14)",
                  color: "#8d2f24",
                  fontWeight: 800,
                }}
              >
                Out of stock
              </span>
            )}
            {!outOfStock && lowStock && (
              <span
                role="status"
                style={{
                  background: "rgba(166, 118, 42, 0.12)",
                  color: "#7a5710",
                  fontWeight: 800,
                }}
              >
                Only {countedQty} {stockQty.unit} left
              </span>
            )}
          </div>
        </div>
        <div className="hpos-service-row-actions">
          <button
            type="button"
            aria-label={`Edit ${item.name}`}
            onClick={() => onEdit(item)}
            disabled={!canEdit}
            title={canEdit ? undefined : "Needs manager PIN"}
          >
            <Edit2 size={14} /> Edit
          </button>
          {barOnly && stockMethod === "direct" && item.inventory_item_id && (
            <button
              type="button"
              aria-label={`Receive stock for ${item.name}`}
              onClick={() => onReceive?.(item)}
              title="Receive a delivery for the linked stock item"
            >
              <Boxes size={14} /> Receive
            </button>
          )}
          {!(barOnly && item.template_kind === 'bar_pack') && <button
            type="button"
            className="is-danger"
            aria-label={`Delete ${item.name}`}
            onClick={() => onDelete(item)}
          >
            <Trash2 size={14} /> Delete
          </button>}
        </div>
      </div>
      <div className="hpos-service-menu-price">
        <strong>
          {item.price != null ? `P${Number(item.price).toFixed(2)}` : "—"}
        </strong>
        {item.cost_price != null && (
          <span>Cost P{Number(item.cost_price).toFixed(2)}</span>
        )}
      </div>
      {barOnly && stockMethod === "direct" && item.inventory_item_id && (
        <div className="hpos-service-menu-archive">
          <Boxes size={14} />
          Uses {depletionQty.toLocaleString(undefined, { maximumFractionDigits: 6 })} stock unit{depletionQty === 1 ? "" : "s"} per sale
          {countedQty !== null && ` · ${countedQty} ${stockQty.unit} on hand`}
        </div>
      )}
      {isArchived ? (
        <div className="hpos-service-menu-archive">
          <Archive size={14} />
          Archived · retained for sales history · not shown at Till
        </div>
      ) : needsStockSetup ? (
        <div className="hpos-service-menu-archive">
          <Boxes size={14} />
          <span>
            <strong>Stock setup required — not sold out.</strong>
            <br />
            {stockMethod === "missing"
              ? barOnly
                ? "Select a Direct stock link in Edit. For simple food, create a prepared-portion stock item and link it here."
                : "For packaged items, select a Direct stock link in Edit. For prepared food, create a recipe with ingredients in Menu & Production → Recipes & Costing, then make it available."
              : "This item has both a direct stock link and a recipe. In Edit, keep the direct link for packaged goods, or remove it and use the recipe for prepared food."}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className={`hpos-service-availability ${isAvailable ? "" : "is-sold-out"}`}
          onClick={() => onToggleAvailability(item)}
          disabled={availabilityBusy}
        >
          {availabilityBusy ? (
            "Saving…"
          ) : isAvailable ? (
            <>
              <EyeOff size={14} />
              Mark sold out
            </>
          ) : (
            <>
              <Eye size={14} />
              Make available
            </>
          )}
        </button>
      )}
    </article>
  );
}

const emptyDraft = () => ({
  name: "",
  category: "",
  price: "",
  barcode: "",
  inventory_item_id: "",
  depletion_qty: "1",
  stock_method: "direct",
  pack6: false,
  pack12: false,
  pack24: false,
  pack6Barcode: "",
  pack12Barcode: "",
  pack24Barcode: "",
});

export default function HposMenu({ recipeRoute = '/restaurant/menu-production' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { settings } = useSettings();
  // The app access provider exposes unknown data; this expected view describes
  // the properties read below and does not validate the value.
  const access = /** @type {{entitlement?: HposEntitlementExpectedView|null}|null|undefined} */ (/** @type {unknown} */ (useAccess()));
  const barOnly = isBarOnlyMode(settings);
  const localAuthority = settings?.authority_mode === 'bar_local';
  // Server enforces pos.menu_manage on every menu mutation (src/main/index.js).
  // Gate Edit up front so staff without the capability see why instead of a
  // late save error.
  const canManageMenu = canAccessCapability(access, 'pos.menu_manage');
  const profile = useMemo(() => getBarModeProfile(settings), [settings]);
  const commercialFeatures = useMemo(
    () =>
      getCommercialFeatureSet(
        access?.entitlement?.product_id || "hospitality-pos",
        access?.entitlement?.commercial_package_key,
        access?.entitlement?.enterprise_addons || [],
        access?.entitlement,
        access?.entitlement?.lodge_id || null
      ),
    [access?.entitlement],
  );
  // Recipes are an optional Bar Stock & Purchasing Pro capability. Keep the
  // UI fail-closed when entitlement data is missing or stale; the server RPC
  // remains the final authority for the saved stock method.
  const recipesEnabled = !barOnly || commercialFeatures.has("recipes");
  const defaultCategory = barOnly ? "Beer" : "Mains";

  const [items, setItems] = useState(/** @type {HposMenuItemExpectedView[]} */ ([]));
  const [inventoryItems, setInventoryItems] = useState(/** @type {HposInventoryItemExpectedView[]} */ ([]));
  const [outlets, setOutlets] = useState(/** @type {HposOutletExpectedView[]} */ ([]));
  const [recipeMenuItemIds, setRecipeMenuItemIds] = useState(() => /** @type {Set<string>} */ (new Set()));
  const [categories, setCategories] = useState(/** @type {string[]} */ ([]));
  const [activeCategory, setActiveCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(/** @type {HposEditingExpectedView|null} */ (null));
  const [draft, setDraft] = useState(/** @type {HposLegacyDraftExpectedView} */ (emptyDraft()));
  const [saveError, setSaveError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [packBusy, setPackBusy] = useState(false);
  const [barcodeCaptureActive, setBarcodeCaptureActive] = useState(false);
  const [barcodeCaptureTarget, setBarcodeCaptureTarget] = useState("menu");
  const [barcodeScanStatus, setBarcodeScanStatus] = useState("");
  const [barcodeTouched, setBarcodeTouched] = useState(false);
  const barcodeInputRef = useRef(null);
  const packBarcodeInputRefs = useRef(/** @type {Record<string, HTMLInputElement|null>} */ ({}));
  const [availabilityBusyId, setAvailabilityBusyId] = useState(/** @type {string|null} */ (null));
  // Unified wizard (Bar): same flow as Stock. Legacy editor stays for
  // restaurant mode.
  const [wizard, setWizard] = useState(/** @type {HposWizardExpectedView|null} */ (null));

  // Till unknown-barcode entry: open the wizard with the scanned code.
  useEffect(() => {
    if (barOnly && location.state?.createBarcode && !wizard) {
      setWizard({ initialBarcode: String(location.state.createBarcode) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barOnly, location.state?.createBarcode]);

  const closeWizard = () => {
    setWizard(null);
    if (location.state?.createBarcode) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  };

  /** @param {HposMenuItemExpectedView|null} [product] */
  const openWizardFor = (product = null) => {
    const wizardProduct = product?.template_kind === 'bar_pack' && product.template_parent_product_id
      ? items.find((row) => row.id === product.template_parent_product_id) || product
      : product;
    const stock = wizardProduct?.inventory_item_id
      ? inventoryItems.find((row) => String(row.id) === String(wizardProduct.inventory_item_id)) || null
      : null;
    // Hydrate existing packs, barcodes and availability so unchanged edits
    // preserve the current configuration instead of resetting it.
    const packs = { pack6: false, pack12: false, pack24: false, pack6Barcode: "", pack12Barcode: "", pack24Barcode: "" };
    if (wizardProduct?.inventory_item_id) {
      for (const row of items) {
        if (row.template_parent_product_id === wizardProduct.id && row.template_kind === "bar_pack") {
          if (Number(row.template_pack_size) === 6) {
            packs.pack6 = true;
            packs.pack6Barcode = row.barcode || "";
          }
          if (Number(row.template_pack_size) === 12) {
            packs.pack12 = true;
            packs.pack12Barcode = row.barcode || "";
          }
          if (Number(row.template_pack_size) === 24) {
            packs.pack24 = true;
            packs.pack24Barcode = row.barcode || "";
          }
        }
      }
    }
    setWizard({
      initialBarcode: "",
      initialProduct: wizardProduct,
      initialStock: stock,
      initialPacks: packs,
      initialAvailable: wizardProduct ? wizardProduct.is_available !== false && wizardProduct.available !== false : true,
      hasRecipe: wizardProduct ? recipeMenuItemIds.has(wizardProduct.id) : false,
    });
  };

  // Interrupted product saves and pending publications stay recoverable
  // after the wizard closes (per-operation retry, never a blind resubmit).
  const [pendingRequests, setPendingRequests] = useState(/** @type {HposPendingProductRequestExpectedView[]} */ ([]));
  const [requestFilter, setRequestFilter] = useState("all");
  const rejectedRequestCount = pendingRequests.filter((request) => request?.state === "rejected").length;
  const retryableRequestCount = pendingRequests.length - rejectedRequestCount;
  const visibleRequests = requestFilter === "rejected"
    ? pendingRequests.filter((request) => request?.state === "rejected")
    : requestFilter === "retryable"
      ? pendingRequests.filter((request) => request?.state !== "rejected")
      : pendingRequests;
  const refreshPendingRequests = async () => {
    if (localAuthority) {
      try {
        const intents = await window.api.barLocal.getOpenIntents();
        setPendingRequests((Array.isArray(intents) ? intents : [])
          .filter((intent) => ['catalogue.bar_product.save', 'catalogue.stock_item.save'].includes(intent?.command))
          .map((intent) => ({ operation_key: String(intent.operation_id), name: 'Bar product save', state: String(intent.state || 'outcome_unknown') })));
      } catch { setPendingRequests([]); }
      return;
    }
    try {
      const result = /** @type {HposProductRequestStatusResultExpectedView} */ (/** @type {unknown} */ (await window.api?.pos?.getProductRequestStatus?.()));
      setPendingRequests(Array.isArray(result?.requests) ? result.requests : []);
    } catch {
      setPendingRequests([]);
    }
  };
  useEffect(() => {
    if (barOnly) refreshPendingRequests();
  }, [barOnly, localAuthority]);
  /** @param {string} operationKey */
  const retryRequest = async (operationKey) => {
    setSaveError("");
    try {
      const result = localAuthority
        ? /** @type {HposProductRequestRetryExpectedView} */ (/** @type {unknown} */ (await window.api.barLocal.retryHposBarProduct(operationKey)))
        : /** @type {HposProductRequestRetryExpectedView} */ (/** @type {unknown} */ (await window.api?.pos?.retryProductRequest?.(operationKey)));
      if (!result?.success) throw new Error(result?.error || "Retry did not complete.");
      setActionNotice("Save replayed under its original key.");
      await loadMenu();
      await refreshPendingRequests();
    } catch (error) {
      setSaveError(error?.message || "Retry did not complete.");
      await refreshPendingRequests();
    }
  };
  /** @param {HposPendingProductRequestExpectedView} request */
  const discardRequest = async (request) => {
    setSaveError("");
    try {
      const okToDiscard = window.confirm(
        `Discard the rejected save "${request?.name || "Product"}"? Its pending menu and stock rows are removed from this computer. The server is untouched — rejected saves never reached it. Discard anyway?`,
      );
      if (!okToDiscard) return;
      const result = /** @type {HposProductRequestDiscardResultExpectedView} */ (/** @type {unknown} */ (await window.api?.pos?.discardProductRequest?.(request?.operation_key)));
      if (!result?.success) throw new Error(result?.error || "Discard did not complete.");
      const purged = result?.purged || {};
      setActionNotice(`Rejected save discarded (menu rows cleared: ${purged.menu ?? 0}, stock rows cleared: ${purged.stock ?? 0}).`);
      await loadMenu();
      await refreshPendingRequests();
    } catch (error) {
      setSaveError(error?.message || "Discard did not complete.");
      await refreshPendingRequests();
    }
  };
  const [showArchived, setShowArchived] = useState(false);
  const [showModifiers, setShowModifiers] = useState(false);
  const [modifierGroups, setModifierGroups] = useState(/** @type {HposModifierGroupExpectedView[]} */ ([]));
  const [localModifierConfig, setLocalModifierConfig] = useState(/** @type {Record<string, unknown>|null} */ (null));
  const [localModifierPending, setLocalModifierPending] = useState(/** @type {{operationId:string,command:string,payload?:Record<string,unknown>}|null} */ (null));
  const [modifierBusy, setModifierBusy] = useState(false);
  const [modifierError, setModifierError] = useState("");
  const [modifierDraft, setModifierDraft] = useState(/** @type {HposModifierDraftExpectedView} */ ({
    name: "",
    options: "",
    min_selections: "0",
    max_selections: "1",
    applies_to_categories: "All",
  }));

  const selectedInventoryItem = useMemo(
    () => inventoryItems.find((item) => String(item.id) === String(draft.inventory_item_id || "")) || null,
    [inventoryItems, draft.inventory_item_id],
  );
  const selectedInventoryIsBar = Boolean(
    selectedInventoryItem?.outlet_id &&
      outlets.some(
        (outlet) =>
          String(outlet.id) === String(selectedInventoryItem.outlet_id) &&
          outlet.is_active !== false &&
          outlet.type === "beverage",
      ),
  );

  // Product setup uses the same keyboard-wedge decoder as Till and stock
  // setup. Capture is explicitly armed so manual typing remains unaffected.
  useEffect(() => {
    if (!editing || !barcodeCaptureActive) return undefined;
    const decoder = createBarcodeScannerDecoder();
    let idleTimer = /** @type {ReturnType<typeof setTimeout>|null} */ (null);
    /** @param {import('../../../../shared/barcodeScanner.js').BarcodeScanSuccess|import('../../../../shared/barcodeScanner.js').BarcodeScanFailure} result */
    const completeScan = (result = /** @type {import('../../../../shared/barcodeScanner.js').BarcodeScanFailure} */ ({})) => {
      setBarcodeCaptureActive(false);
      if (!result.success) {
        setBarcodeScanStatus(`Barcode scan failed: ${result.code || "invalid_scan"}.`);
        return;
      }
      const field = barcodeCaptureTarget === "menu" ? "barcode" : `pack${barcodeCaptureTarget}Barcode`;
      setDraft((current) => ({ ...current, [field]: result.barcode }));
      setBarcodeTouched(true);
      setBarcodeScanStatus(`Barcode captured: ${result.barcode}`);
    };
    /** @param {KeyboardEvent} event */
    const onKeyDown = (event) => {
      const key = String(event.key || "");
      if (!(key.length === 1 || key === "Enter" || key === "NumpadEnter" || key === "Tab")) return;
      const outcome = decoder.consumeKey(event);
      if (outcome.type === "buffered" || outcome.type === "completed") event.preventDefault();
      if (outcome.type === "buffered") {
        clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (idleTimer));
        idleTimer = setTimeout(() => {
          const flushed = decoder.flush();
          if (flushed.type === "completed") completeScan(flushed.result);
        }, decoder.getOptions().idleCompleteMs);
        return;
      }
      if (outcome.type === "completed") completeScan(outcome.result);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => { clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (idleTimer)); window.removeEventListener("keydown", onKeyDown, true); };
  }, [editing, barcodeCaptureActive, barcodeCaptureTarget]);

  const loadMenu = async () => {
    try {
      const [localResult, localStockResult, localModifierResult] = localAuthority
        ? await Promise.all([
          window.api.barLocal.readHposMenu('menu'), window.api.barLocal.readHposMenu('stock'),
          canManageMenu ? window.api.barLocal.readHposMenu('modifiers') : Promise.resolve(null)
        ])
        : [null, null, null];
      if (localAuthority && localResult?.complete !== true) throw new Error('The local Bar menu read was incomplete. Refresh before selling.');
      if (localAuthority && localStockResult?.complete !== true) throw new Error('The local Bar stock read was incomplete. Refresh before linking products.');
      if (localAuthority && localModifierResult?.complete === true && localResult?.snapshot !== localModifierResult.snapshot) throw new Error('The local Bar menu changed while its recipe links were being checked. Refresh before editing.');
      const menuData = /** @type {HposMenuReadExpectedView} */ (/** @type {unknown} */ (localAuthority ? localResult.rows : ((await window.api?.pos?.getMenuItems?.()) ?? [])));
      if (menuData?._available === false) throw new Error(menuData._error || 'The product catalogue could not be verified. Refresh before selling.');
      const rows = /** @type {HposMenuItemExpectedView[]} */ (Array.isArray(menuData) ? menuData : []);
      setItems(rows);
      if (localModifierResult?.complete === true) {
        setLocalModifierConfig(localModifierResult.config || null);
        setModifierGroups(/** @type {HposModifierGroupExpectedView[]} */ (/** @type {unknown} */ (localModifierResult.groups || [])));
        setRecipeMenuItemIds(new Set((Array.isArray(localModifierResult.recipes) ? localModifierResult.recipes : [])
          .filter((recipe) => recipe?.menu_item_id && Array.isArray(recipe.ingredients) && recipe.ingredients.some((line) => Number(line.quantity || 0) > 0))
          .map((recipe) => recipe.menu_item_id)));
      }
      // Stock counts refresh with the catalogue so out-of-stock badges never
      // go stale after a save; failures keep the last counts silently.
      const inventoryRows = /** @type {HposInventoryItemExpectedView[]|null|undefined} */ (/** @type {unknown} */ (localAuthority
        ? localStockResult?.rows
        : (await window.api?.inventory?.getItems?.().catch(() => null))));
      if (Array.isArray(inventoryRows)) {
        setInventoryItems(inventoryRows.filter((row) => row?.is_active !== false));
      }
      setLoadError("");
      setCategories([...new Set(rows.map((item) => item.category).filter(Boolean))]);
    } catch (error) {
      setLoadError(error?.message || "The catalogue could not be verified. Refresh before selling.");
    }
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const localResults = localAuthority ? await Promise.all([
          window.api.barLocal.readHposMenu('menu'), window.api.barLocal.readHposMenu('stock'),
          canManageMenu ? window.api.barLocal.readHposMenu('modifiers') : Promise.resolve({ groups: [], recipes: [], config: null, complete: true }),
          window.api.barLocal.readHposMenu('outlets')
        ]) : null;
        if (localAuthority && localResults.some((result) => result?.complete !== true)) throw new Error('The local Bar Menu data is incomplete. Refresh before editing or selling.');
        if (localAuthority && canManageMenu && localResults[0].snapshot !== localResults[2].snapshot) throw new Error('The local Bar menu changed while its recipe links were being checked. Refresh before editing.');
        const [menuResult, inventoryResult, modifierResult, recipeResult, outletResult] = localAuthority
          ? [localResults[0].rows, localResults[1].rows, localResults[2].groups, localResults[2].recipes, localResults[3].rows]
          : await Promise.all([
            window.api?.pos?.getMenuItems?.() ?? [],
            window.api?.inventory?.getItems?.() ?? [],
            window.api?.pos?.getModifierGroups?.() ?? [],
            window.api?.pos?.getRecipes?.() ?? [],
            window.api?.outlets?.getAll?.() ?? [],
          ]);
        if (!active) return;
        const menuData = /** @type {HposMenuReadExpectedView} */ (/** @type {unknown} */ (menuResult));
        const inventoryRows = /** @type {HposInventoryItemExpectedView[]} */ (/** @type {unknown} */ (inventoryResult));
        const modifierRows = /** @type {HposModifierGroupExpectedView[]} */ (/** @type {unknown} */ (modifierResult));
        const recipeRows = /** @type {HposRecipeExpectedView[]} */ (/** @type {unknown} */ (recipeResult));
        const outletRows = /** @type {HposOutletExpectedView[]} */ (/** @type {unknown} */ (outletResult));
        if (menuData?._available === false) throw new Error(menuData._error || 'The product catalogue could not be verified. Refresh before selling.');
        const menuRows = /** @type {HposMenuItemExpectedView[]} */ (Array.isArray(menuData) ? menuData : []);
        setItems(menuRows);
        // Delisted stock (product deleted, nothing else references it) stays
        // out of link/edit pickers; its rows and history remain server-side.
        setInventoryItems(
          (/** @type {HposInventoryItemExpectedView[]} */ (Array.isArray(inventoryRows) ? inventoryRows : [])).filter(
            (row) => row?.is_active !== false,
          ),
        );
        setOutlets(/** @type {HposOutletExpectedView[]} */ (Array.isArray(outletRows) ? outletRows : []));
        setModifierGroups(/** @type {HposModifierGroupExpectedView[]} */ (Array.isArray(modifierRows) ? modifierRows : []));
        if (localAuthority) {
          const localResultsView = /** @type {Array<{config?:Record<string,unknown>}>} */ (/** @type {unknown} */ (localResults));
          setLocalModifierConfig(localResultsView[2]?.config || null);
          if (canManageMenu) {
            const openIntents = await window.api.barLocal.getOpenIntents();
            const modifierCommands = new Set(['catalogue.modifier_group.upsert','catalogue.modifier_option.upsert','catalogue.product_modifier.set','catalogue.recipe.set','promotion.upsert']);
            const pendingModifier = Array.isArray(openIntents) ? openIntents.find((intent) => modifierCommands.has(String(intent?.command))) : null;
            setLocalModifierPending(pendingModifier ? { operationId: String(pendingModifier.operation_id), command: String(pendingModifier.command) } : null);
          } else {
            setLocalModifierPending(null);
          }
        }
        setRecipeMenuItemIds(
          new Set(
            (/** @type {HposRecipeExpectedView[]} */ (Array.isArray(recipeRows) ? recipeRows : []))
              .filter(
                (recipe) =>
                  recipe.menu_item_id &&
                  (recipe.ingredients || []).some(
                    (ingredient) => Number(ingredient.quantity || 0) > 0,
                  ),
              )
              .map((recipe) => recipe.menu_item_id),
          ),
        );
        setCategories([
          ...new Set(
            menuRows
              .map((item) => item.category)
              .filter(Boolean),
          ),
        ]);
      } catch (error) {
        if (active) setLoadError(error?.message || "The catalogue could not be verified. Refresh before selling.");
      }
      if (active) setLoading(false);
    };
    load();
    return () => {
      active = false;
    };
  }, [canManageMenu, localAuthority]);

  const openCreate = () => {
    if (barOnly) {
      setSaveError("");
      setWizard({ initialBarcode: "" });
      return;
    }
    setSaveError("");
    setBarcodeScanStatus("");
    setBarcodeCaptureActive(false);
    setBarcodeCaptureTarget("menu");
    setBarcodeTouched(false);
    setEditing("new");
    setDraft(emptyDraft());
  };

  /** @param {HposMenuItemExpectedView} item */
  const openEdit = (item) => {
    if (barOnly) {
      setSaveError("");
      openWizardFor(item);
      return;
    }
    setSaveError("");
    setBarcodeScanStatus("");
    setBarcodeCaptureActive(false);
    setBarcodeCaptureTarget("menu");
    setBarcodeTouched(false);
    setEditing(item);
    const invId = item.inventory_item_id || "";
    const packFlags = { pack6: false, pack12: false, pack24: false, pack6Barcode: "", pack12Barcode: "", pack24Barcode: "" };
    if (invId) {
      for (const row of items) {
        if (
          row.inventory_item_id === invId &&
          row.template_kind === "bar_pack"
        ) {
          if (Number(row.template_pack_size) === 6) packFlags.pack6 = true;
          if (Number(row.template_pack_size) === 12) packFlags.pack12 = true;
          if (Number(row.template_pack_size) === 24) packFlags.pack24 = true;
          if (Number(row.template_pack_size) === 6) packFlags.pack6Barcode = row.barcode || "";
          if (Number(row.template_pack_size) === 12) packFlags.pack12Barcode = row.barcode || "";
          if (Number(row.template_pack_size) === 24) packFlags.pack24Barcode = row.barcode || "";
        }
      }
    }
    setDraft({
      name: item.name || "",
      category: item.category || "",
      price: String(item.price ?? ""),
      barcode: item.barcode || "",
      inventory_item_id: invId,
      depletion_qty: invId ? String(item.depletion_qty ?? "1") : "1",
      stock_method: item.stock_method || (invId ? "direct" : recipeMenuItemIds.has(item.id) ? "recipe" : "direct"),
      ...packFlags,
    });
  };

  /** @param {string|null|undefined} inventoryItemId @param {HposLegacyDraftExpectedView} flags */
  const applyPackTemplates = async (inventoryItemId, flags) => {
    if (!inventoryItemId || !window.api?.pos?.setBarPackTemplate) return;
    const map = [
      [6, flags.pack6],
      [12, flags.pack12],
      [24, flags.pack24],
    ];
    for (const [size, enabled] of map) {
      // Always send desired state so disabling packs is supported.
      await window.api.pos.setBarPackTemplate({
        inventory_item_id: inventoryItemId,
        pack_size: size,
        enabled: enabled === true,
        barcode: flags[`pack${size}Barcode`] || null,
      });
    }
  };

  const saveItem = async () => {
    if (!draft.name.trim() || !draft.category.trim() || draft.price === "" || Number(draft.price) <= 0) {
      setSaveError(
        "Enter a name, choose a menu section, and set a price greater than P0.00 before setting up stock or a recipe.",
      );
      return;
    }
    const depletionQty = Number(draft.depletion_qty);
    if (draft.stock_method === "direct" && (!Number.isFinite(depletionQty) || depletionQty <= 0)) {
      setSaveError("Enter the positive stock quantity consumed by one sale. Use a decimal for measured pours, for example 0.05.");
      return;
    }
    if (draft.stock_method === "recipe" && !recipesEnabled) {
      setSaveError("Recipes are Included with Stock add-on (Stock & Purchasing Pro). Enable that add-on before using the recipe stock method.");
      return;
    }
    if (draft.stock_method === "direct" && !draft.inventory_item_id) {
      setSaveError("Choose the stock item sold for this packaged product.");
      return;
    }
    // The save form only renders while editing is non-null; this view narrows
    // that existing UI state without adding a runtime guard.
    const editingProduct = /** @type {HposEditingExpectedView} */ (editing);
    setPackBusy(true);
    try {
      const isDirect = draft.stock_method === "direct";
      const isRecipe = draft.stock_method === "recipe";
      const payload = /** @type {HposMenuSavePayloadExpectedView} */ ({
        name: draft.name.trim(),
        category: draft.category.trim(),
        price: Number(draft.price),
        barcode: draft.barcode.trim() || null,
        stock_method: draft.stock_method,
        is_available: isRecipe ? false : isDirect ? Boolean(draft.inventory_item_id) : true,
        depletion_qty: isDirect ? depletionQty : null,
      });
      if (isDirect && draft.inventory_item_id)
        payload.inventory_item_id = draft.inventory_item_id;

      /** @type {HposMenuMutationExpectedView} */
      let saved;
      const invId = isDirect ? (draft.inventory_item_id || (/** @type {HposEditingExpectedView|null} */ (editing))?.inventory_item_id) : null;
      if (isDirect && barOnly && window.api?.pos?.saveBarProductWithPacks) {
        const operationStorageKey = `hpos:pending-bar-product:${editingProduct === "new" ? "new" : editingProduct.id}`;
        const operationKey = localStorage.getItem(operationStorageKey) || crypto.randomUUID();
        localStorage.setItem(operationStorageKey, operationKey);
        saved = /** @type {HposMenuMutationExpectedView} */ (/** @type {unknown} */ (await window.api.pos.saveBarProductWithPacks({
          ...payload,
          menu_item_id: editingProduct === "new" ? null : editingProduct.id,
          inventory_item_id: invId,
          operation_key: operationKey,
          pack6: draft.pack6 === true,
          pack12: draft.pack12 === true,
          pack24: draft.pack24 === true,
          pack6Barcode: draft.pack6Barcode || null,
          pack12Barcode: draft.pack12Barcode || null,
          pack24Barcode: draft.pack24Barcode || null,
        })));
        if (!saved?.success) throw new Error(saved?.error || "Could not save this Bar product.");
        localStorage.removeItem(operationStorageKey);
      } else {
        saved = editingProduct === "new"
          ? /** @type {HposMenuMutationExpectedView} */ (/** @type {unknown} */ (await window.api.pos.createMenuItem(payload)))
          : /** @type {HposMenuMutationExpectedView} */ (/** @type {unknown} */ (await window.api.pos.updateMenuItem(editingProduct.id, payload)));
      }
      const menuItemId = editingProduct === "new" ? saved?.id : editingProduct.id;

      if (invId && barOnly && !(isDirect && window.api?.pos?.saveBarProductWithPacks)) {
        await applyPackTemplates(invId, draft);
      }

      setEditing(null);
      await loadMenu();
      if (isRecipe && menuItemId) {
        const recipeBase = recipeRoute === '/restaurant/menu-production' ? DEFAULT_RECIPE_DEEP_LINK : `${recipeRoute}?tab=recipes`;
        navigate(`${recipeBase}&menu_item_id=${encodeURIComponent(menuItemId)}&recipe_name=${encodeURIComponent(draft.name.trim())}`);
      }
    } catch (error) {
      setSaveError(error?.message || "Could not save this product.");
    } finally {
      setPackBusy(false);
    }
  };

  /** @param {string} slot @param {string} command @param {Record<string, unknown>} payload */
  const sendLocalMenuCommand = async (slot, command, payload) => {
    const storageKey = `hpos:bar-local-menu:${slot}`;
    const operationId = localStorage.getItem(storageKey) || crypto.randomUUID();
    localStorage.setItem(storageKey, operationId);
    const result = await window.api.barLocal.command({ command, payload, operation_id: operationId });
    if (result?.outcome === 'committed_local') {
      localStorage.removeItem(storageKey);
      return result;
    }
    const error = result?.error?.message || 'The local Bar service refused this menu change.';
    if (result?.outcome !== 'unknown') localStorage.removeItem(storageKey);
    throw new Error(result?.outcome === 'unknown'
      ? `${error} The outcome is unknown; retry this exact action before making another change.`
      : error);
  };

  const reloadLocalModifierConfig = async () => {
    const result = await window.api.barLocal.readHposMenu('modifiers');
    if (result?.complete !== true) throw new Error('Local modifier settings could not be verified. Refresh before editing.');
    setLocalModifierConfig(result.config || null);
    setModifierGroups(/** @type {HposModifierGroupExpectedView[]} */ (/** @type {unknown} */ (result.groups || [])));
    setRecipeMenuItemIds(new Set((Array.isArray(result.recipes) ? result.recipes : [])
      .filter((recipe) => recipe?.menu_item_id && Array.isArray(recipe.ingredients) && recipe.ingredients.some((line) => Number(line.quantity || 0) > 0))
      .map((recipe) => recipe.menu_item_id)));
  };

  const sendLocalModifierCommand = async (command, payload) => {
    if (localModifierPending) {
      setModifierError(`Resolve saved local operation ${localModifierPending.operationId} before starting another modifier change.`);
      return { outcome: 'unknown' };
    }
    const operationId = crypto.randomUUID();
    setLocalModifierPending({ operationId, command, payload });
    setModifierBusy(true);
    setModifierError('');
    try {
      const result = await window.api.barLocal.command({ command, payload, operation_id: operationId });
      if (result?.outcome === 'committed_local') {
        setLocalModifierPending(null);
        setModifierError('');
        try {
          await reloadLocalModifierConfig();
          await loadMenu();
        } catch (refreshError) {
          setModifierError(`The local change committed, but the follow-up refresh failed: ${refreshError?.message || 'refresh unavailable'}. Refresh before continuing.`);
        }
        return result;
      }
      if (result?.outcome === 'unknown') {
        setModifierError(`${result.error?.message || 'The local result is unknown.'} Retry the saved operation below before making another change.`);
        return result;
      }
      setLocalModifierPending(null);
      setModifierError(result?.error?.message || 'The local Bar authority refused this modifier change. Nothing was committed.');
      return result;
    } catch (error) {
      setModifierError(`${error?.message || 'The modifier change could not be confirmed.'} Check its saved operation before retrying.`);
      return { outcome: 'unknown' };
    } finally { setModifierBusy(false); }
  };

  const retryLocalModifierCommand = async () => {
    if (!localModifierPending || modifierBusy) return;
    setModifierBusy(true);
    setModifierError('');
    try {
      const result = await window.api.barLocal.retryOperation(localModifierPending.operationId);
      if (result?.outcome === 'committed_local') {
        setLocalModifierPending(null);
        try {
          await reloadLocalModifierConfig();
          await loadMenu();
          setModifierError('');
        } catch (refreshError) {
          setModifierError(`The saved change is committed, but the follow-up refresh failed: ${refreshError?.message || 'refresh unavailable'}. Refresh before continuing.`);
        }
        return;
      }
      if (result?.outcome !== 'unknown') setLocalModifierPending(null);
      setModifierError(result?.outcome === 'unknown'
        ? `${result.error?.message || 'The local result remains unknown.'} Retry this same saved operation.`
        : result?.error?.message || 'The local Bar authority refused the saved modifier change.');
    } catch (error) {
      setModifierError(`${error?.message || 'The saved modifier change could not be confirmed.'} Retry the same operation ID.`);
    } finally { setModifierBusy(false); }
  };

  /** @param {HposMenuItemExpectedView} item */
  const deleteItem = async (item) => {
    if (
      !window.confirm(
        `Delete ${item.name}? Items with completed sale history will be archived instead to protect reports.`,
      )
    )
      return;
    setActionNotice("");
    try {
      if (localAuthority) {
        await sendLocalMenuCommand(`archive:${item.id}`, 'catalogue.upsert', {
          product_id: item.id, expected_version: Number(item.product_version || 0),
          sku: item.sku, name: item.name, category: item.category || defaultCategory,
          price: String(item.price ?? '0'), tax_rate: String(item.tax_rate ?? '0'),
          track_stock: item.track_stock === true, active: false
        });
        setActionNotice('Product archived locally. Sales, stock and audit history remain preserved.');
        await loadMenu();
        return;
      }
      const result = /** @type {HposMenuDeleteExpectedView} */ (/** @type {unknown} */ (await window.api.pos.deleteMenuItem(item.id)));
      setActionNotice(
        result?.soft_deleted
          ? "Item archived because it has sale history."
          : result?.stock_delisted
            ? "Product deleted and its stock item delisted. Movement history is preserved for audit."
            : "Item deleted.",
      );
      await loadMenu();
    } catch (error) {
      setSaveError(error?.message || "Could not remove this product.");
    }
  };

  /** @param {HposMenuItemExpectedView} item */
  const toggleAvailability = async (item) => {
    const isAvailable = item.available !== false && item.is_available !== false;
    setSaveError("");
    setAvailabilityBusyId(item.id);
    try {
      if (localAuthority) {
        await sendLocalMenuCommand(`availability:${item.id}`, 'catalogue.availability.set', {
          product_id: item.id, available: !isAvailable,
          expected_version: Number(item.availability_version || 0)
        });
        setItems((current) => current.map((row) => row.id === item.id
          ? { ...row, is_available: !isAvailable, available: !isAvailable }
          : row));
        return;
      }
      const result = /** @type {HposMenuMutationExpectedView} */ (/** @type {unknown} */ (await window.api.pos.updateMenuItem(item.id, {
        name: item.name,
        category: item.category || defaultCategory,
        price: Number(item.price || 0),
        barcode: item.barcode || null,
        inventory_item_id: item.inventory_item_id || null,
        depletion_qty: item.depletion_qty,
        outlet_id: item.outlet_id,
        dietary_flags: item.dietary_flags || [],
        prep_time_minutes: item.prep_time_minutes || 0,
        is_popular: item.is_popular === true,
        kitchen_station_id: item.kitchen_station_id || null,
        is_available: !isAvailable,
      })));
      if (!result?.success) {
        throw new Error(result?.error || "Could not update item availability.");
      }
      setItems((current) =>
        current.map((row) =>
          row.id === item.id
            ? { ...row, is_available: !isAvailable, available: !isAvailable }
            : row,
        ),
      );
    } catch (error) {
      setSaveError(error?.message || "Could not update item availability.");
    } finally {
      setAvailabilityBusyId(null);
    }
  };

  const saveModifierGroup = async () => {
    const options = modifierDraft.options
      .split("\n")
      .map((line) => {
        const [name, price] = line.split("|");
        return {
          name: String(name || "").trim(),
          price_delta: Number(price || 0),
        };
      })
      .filter((option) => option.name);
    if (!modifierDraft.name.trim() || !options.length) {
      setModifierError("Enter a group name and at least one option.");
      return;
    }
    const min = Number(modifierDraft.min_selections || 0);
    const max = Number(modifierDraft.max_selections || 0);
    if (min < 0 || max < 0 || (max > 0 && min > max)) {
      setModifierError("Minimum choices cannot be higher than the maximum.");
      return;
    }
    setModifierBusy(true);
    setModifierError("");
    try {
      if (localAuthority) throw new Error('Modifier editing is not yet available through the local Bar menu command. No cloud request was sent.');
      const result = /** @type {HposModifierMutationExpectedView} */ (/** @type {unknown} */ (await window.api?.pos?.saveModifierGroup?.({
        name: modifierDraft.name.trim(),
        options,
        min_selections: min,
        max_selections: max,
        applies_to_categories: modifierDraft.applies_to_categories
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      })));
      if (!result?.success)
        throw new Error(result?.error || "Could not save modifier group.");
      const groups = /** @type {HposModifierGroupExpectedView[]} */ (/** @type {unknown} */ ((await window.api?.pos?.getModifierGroups?.()) ?? []));
      setModifierGroups(Array.isArray(groups) ? groups : []);
      setModifierDraft({
        name: "",
        options: "",
        min_selections: "0",
        max_selections: "1",
        applies_to_categories: "All",
      });
    } catch (error) {
      setModifierError(error?.message || "Could not save modifier group.");
    } finally {
      setModifierBusy(false);
    }
  };

  const searchLower = search.trim().toLowerCase();
  const archivedCount = items.filter((item) => item.archived_at).length;
  const filtered = items
    .filter((item) => showArchived || !item.archived_at)
    .filter((i) => activeCategory === "all" || i.category === activeCategory)
    .filter(
      (i) =>
        !searchLower ||
        i.name?.toLowerCase().includes(searchLower) ||
        String(i.barcode || "")
          .toLowerCase()
          .includes(searchLower),
    );

  const title = profile.productListLabel;
  const categorySuggestions = barOnly
    ? profile.defaultProductCategories
    : [...new Set([...RESTAURANT_MENU_SECTIONS, ...categories])];

  const availableCount = items.filter(
    (item) =>
      !item.archived_at &&
      item.is_available !== false &&
      item.available !== false,
  ).length;
  /** @param {HposMenuItemExpectedView} item @returns {HposStockMethodExpectedView} */
  const stockMethodFor = (item) =>
    item.stock_method === "non_stock"
      ? "non_stock"
      : item.inventory_item_id && recipeMenuItemIds.has(item.id)
      ? "conflict"
      : item.inventory_item_id
        ? "direct"
        : recipeMenuItemIds.has(item.id)
          ? "recipe"
          : "missing";
  const setupRequiredCount = items.filter(
    (item) =>
      !item.archived_at &&
      ["missing", "conflict"].includes(stockMethodFor(item)),
  ).length;
  const soldOutCount = items.filter(
    (item) =>
      !item.archived_at &&
      (item.is_available === false || item.available === false) &&
      !["missing", "conflict"].includes(stockMethodFor(item)),
  ).length;
  // Counted out-of-stock behind direct links (informational: the Till greys
  // these out automatically, this page names them for receiving).
  /** @param {HposMenuItemExpectedView|null|undefined} item @returns {HposStockQuantityExpectedView|null} */
  const stockQtyFor = (item) => {
    if (!item?.inventory_item_id || stockMethodFor(item) !== "direct") return null;
    const row = (inventoryItems || []).find((entry) => String(entry.id) === String(item.inventory_item_id));
    if (!row || !Number.isFinite(Number(row.current_stock))) return null;
    return {
      qty: Number(row.current_stock),
      unit: String(row.unit || "each"),
      reorder: Number(row.reorder_level || 0),
    };
  };
  const outOfStockCount = items.filter(
    (item) => {
      if (item.archived_at) return false;
      const stock = stockQtyFor(item);
      return stock !== null && stock.qty <= 0;
    },
  ).length;
  const editingStockMethod = editing ? draft.stock_method || (editing !== "new" ? stockMethodFor(editing) : "direct") : null;

  return (
    <div className="hpos-page-frame hpos-service-menu">
      <header className="hpos-service-dark-hero">
        <div>
          <p className="hpos-eyebrow">Sellable catalogue</p>
          <h1>{title}</h1>
          <p>
            {barOnly
              ? "Control singles, packs, barcodes and service availability from one product list."
              : "Keep the service menu clear, correctly priced and ready for the kitchen."}
          </p>
        </div>
        <div className="hpos-service-dark-actions">
          <button
            type="button"
            onClick={() => {
              setModifierError("");
              setShowModifiers(true);
            }}
          >
            <UtensilsCrossed size={17} />
            Modifiers <span>{modifierGroups.length}</span>
          </button>
          <button
            type="button"
            className="hpos-primary-action"
            onClick={openCreate}
          >
            <Plus size={17} />
            {barOnly ? "Add product" : "Add menu item"}
          </button>
        </div>
        <div className="hpos-service-dark-summary">
          <div>
            <span>Total items</span>
            <strong>{items.length}</strong>
          </div>
          <div>
            <span>Available</span>
            <strong>{availableCount}</strong>
          </div>
          <div className={soldOutCount ? "is-warning" : ""}>
            <span>Sold out</span>
            <strong>{soldOutCount}</strong>
          </div>
          <div className={outOfStockCount ? "is-warning" : ""}>
            <span>Out of stock</span>
            <strong>{outOfStockCount}</strong>
          </div>
          <div className={setupRequiredCount ? "is-warning" : ""}>
            <span>Needs stock setup</span>
            <strong>{setupRequiredCount}</strong>
          </div>
          <div>
            <span>Archived</span>
            <strong>{archivedCount}</strong>
          </div>
        </div>
      </header>

      {loadError && <ErrorNotice className="hpos-inline-error">{loadError} No catalogue read is treated as an empty or sellable catalogue.</ErrorNotice>}

      <section className="hpos-service-catalogue-tools">
        <label className="hpos-service-search">
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              barOnly
                ? "Search drinks or scan a barcode…"
                : "Search name or barcode…"
            }
          />
        </label>
        {archivedCount > 0 && (
          <button
            type="button"
            className={showArchived ? "is-active" : ""}
            onClick={() => setShowArchived((current) => !current)}
          >
            {showArchived ? <EyeOff size={15} /> : <Archive size={15} />}{" "}
            {showArchived
              ? "Hide archived items"
              : `Show archived items (${archivedCount})`}
          </button>
        )}
      </section>
      <nav
        className="hpos-service-filter-pills hpos-service-menu-categories"
        aria-label="Menu section"
      >
        <button
          type="button"
          className={activeCategory === "all" ? "is-active" : ""}
          onClick={() => setActiveCategory("all")}
        >
          All <span>{items.length}</span>
        </button>
        {categories.map((category) => (
          <button
            type="button"
            key={category.name || category}
            className={
              activeCategory === (category.name || category) ? "is-active" : ""
            }
            onClick={() => setActiveCategory(category.name || category)}
          >
            {category.name || category}
          </button>
        ))}
      </nav>
      {actionNotice && (
        <div className="hpos-inline-notice">
          <CheckCircle2 size={16} />
          {actionNotice}
        </div>
      )}
      {barOnly && pendingRequests.length > 0 && (
        <div className="hpos-inline-notice" role="status">
          <strong>
            {pendingRequests.length} interrupted save{pendingRequests.length === 1 ? "" : "s"} waiting
          </strong>{" "}
          — retry replays the original save under its own key, never a duplicate. Rejected saves can be discarded once reviewed; discarding also clears their pending rows.
          <span style={{ display: "block", marginTop: 8 }} role="group" aria-label="Filter interrupted saves">
            {[
              ["all", `All (${pendingRequests.length})`],
              ["retryable", `Needs retry (${retryableRequestCount})`],
              ["rejected", `Rejected (${rejectedRequestCount})`],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setRequestFilter(value)}
                aria-pressed={requestFilter === value}
                style={{ fontWeight: requestFilter === value ? 800 : 500, textDecoration: requestFilter === value ? "underline" : "none", marginRight: 10 }}
              >
                {label}
              </button>
            ))}
          </span>
          {visibleRequests.map((request) => (
            <span key={request.operation_key} style={{ display: "block", marginTop: 6 }}>
              {request.name} · {request.state}
              {request.publication && request.publication !== "published" ? ` · publication ${request.publication}` : ""}
              {request.error ? ` · ${request.error}` : ""}{" "}
              {request.state === "rejected" ? (
                localAuthority
                  ? <span role="status">This local operation is retained in the journal for recovery.</span>
                  : <button type="button" onClick={() => discardRequest(request)}>Discard rejected save</button>
              ) : (
                <button
                  type="button"
                  onClick={() => retryRequest(request.operation_key)}
                >
                  Retry this save
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {saveError && !editing && (
        <ErrorNotice className="hpos-inline-error">{saveError}</ErrorNotice>
      )}
      {setupRequiredCount > 0 && (
        <ErrorNotice className="hpos-inline-error">
          <strong>
            {setupRequiredCount} menu item{setupRequiredCount === 1 ? "" : "s"}{" "}
            need stock setup — they are not sold out.
          </strong>{" "}
          {barOnly ? <>Choose its <strong>Direct stock link</strong> in Edit. Simple food should link to a counted prepared-portion stock item.</> : <>To repair a packaged item, choose its <strong>Direct stock link</strong> in Edit. For prepared food, leave the direct link blank, create a recipe with stock ingredients in <strong>Menu &amp; Production → Recipes &amp; Costing</strong>, then return here and make it available.</>}
        </ErrorNotice>
      )}
      {loading ? (
        <div className="hpos-service-loading">
          <span>{barOnly ? "Loading products…" : "Loading menu…"}</span>
        </div>
      ) : !filtered.length ? (
        <div className="hpos-empty-state">
          <UtensilsCrossed size={28} />
          <h2>No matching menu items</h2>
          <p>Change the search or section, or add a new item.</p>
        </div>
      ) : (
        <section className="hpos-service-menu-grid">
          {filtered.map((item) => (
            <MenuItemCard
              key={item.id}
              item={item}
              onEdit={openEdit}
              onDelete={deleteItem}
              onReceive={(entry) => {
                if (entry?.inventory_item_id) {
                  navigate("/hpos/stock", { state: { receiveStockId: entry.inventory_item_id } });
                }
              }}
              onToggleAvailability={toggleAvailability}
              availabilityBusy={availabilityBusyId === item.id}
              barOnly={barOnly}
              stockMethod={stockMethodFor(item)}
              stockQty={stockQtyFor(item)}
              canEdit={canManageMenu}
            />
          ))}
        </section>
      )}

      {wizard && barOnly && (
        <HposProductWizard
          initialBarcode={wizard.initialBarcode || ""}
          initialProduct={wizard.initialProduct || null}
          initialStock={wizard.initialStock || null}
          initialPacks={wizard.initialPacks || null}
          initialAvailable={wizard.initialAvailable !== false}
          hasRecipe={wizard.hasRecipe === true}
          modifierGroups={modifierGroups}
          onManageModifiers={() => {
            setModifierError("");
            setShowModifiers(true);
          }}
          onEditExisting={(duplicate) => openWizardFor(duplicate)}
          onClose={closeWizard}
          onSaved={() => {
            loadMenu();
            refreshPendingRequests();
          }}
        />
      )}

      {editing && (
        <div className="hpos-modal-backdrop" role="presentation">
          <section
            className="hpos-service-dialog hpos-service-menu-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="menu-item-dialog-title"
          >
            <button
              type="button"
              className="hpos-service-dialog__close"
              onClick={() => { setBarcodeCaptureActive(false); setBarcodeScanStatus(""); setEditing(null); }}
              disabled={packBusy}
              aria-label="Close"
            >
              <X size={18} />
            </button>
            <p className="hpos-eyebrow">
              {editing === "new" ? "New sellable item" : "Edit sellable item"}
            </p>
            <h2 id="menu-item-dialog-title">
              {editing === "new"
                ? barOnly
                  ? "Add product"
                  : "Add menu item"
                : `Edit ${editing.name}`}
            </h2>
            <p>
              {barOnly ? 'Available items must link to the exact packaged product or counted prepared portion they consume.' : 'Available items must use one stock method: direct stock for packaged products, or recipe ingredients for prepared food.'}
            </p>
            {editingStockMethod === "recipe" && (
              <div className="hpos-inline-notice">
                <CookingPot size={16} />
                <span>
                  <strong>Recipe stock method active.</strong> This item has no
                  direct stock link because its saved recipe consumes inventory
                  ingredients. Keep the direct link blank to avoid counting
                  stock twice.
                </span>
              </div>
            )}
            {editingStockMethod === "direct" && (
              <div className="hpos-inline-notice">
                <Boxes size={16} />
                <span>
                  <strong>Direct stock method active.</strong> This packaged
                  item depletes the selected inventory item.
                </span>
              </div>
            )}
            {editingStockMethod === "conflict" && (
              <ErrorNotice className="hpos-inline-error">
                <strong>Choose one stock method.</strong> Keep the direct link
                for packaged goods, or remove it and use the recipe for prepared
                food.
              </ErrorNotice>
            )}
            <div className="hpos-service-form hpos-service-form--two">
              <label className="is-wide">
                Name
                <input
                  autoFocus
                  type="text"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                  placeholder="Item name"
                />
              </label>
              <label>
                Menu section
                <input
                  type="text"
                  list="hpos-menu-categories"
                  value={draft.category}
                  onChange={(event) => {
                    const category = event.target.value;
                    const normalized = category.trim().toLowerCase();
                    setDraft({ ...draft, category, stock_method: !barOnly && categoryRequiresRecipe(category) ? "recipe" : normalized === "drinks" ? "direct" : draft.stock_method });
                  }}
                  placeholder="Choose a section"
                />
                <datalist id="hpos-menu-categories">
                  {categorySuggestions.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
                <small>
                  {barOnly
                    ? "Choose a bar product section or type a custom one."
                    : "Choose a standard section or type a custom one."}
                </small>
              </label>
              <label>
                Price ({settings?.currency || "P"})
                <input
                  type="number"
                  min="0.01"
                  required
                  step="0.01"
                  value={draft.price}
                  onChange={(event) =>
                    setDraft({ ...draft, price: event.target.value })
                  }
                />
              </label>
              <label>
                Barcode
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    ref={barcodeInputRef}
                    type="text"
                    value={draft.barcode}
                    onChange={(event) => {
                      setBarcodeTouched(true);
                      setBarcodeScanStatus("");
                      setDraft({ ...draft, barcode: event.target.value });
                    }}
                    placeholder="Scan or enter barcode"
                    inputMode="text"
                    autoComplete="off"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setBarcodeCaptureActive(true);
                      setBarcodeScanStatus("Waiting for scanner…");
                      requestAnimationFrame(() => barcodeInputRef.current?.focus());
                    }}
                    disabled={packBusy}
                    aria-label="Scan product barcode"
                  >
                    <ScanLine size={14} /> {barcodeCaptureActive && barcodeCaptureTarget === "menu" ? "Scanning…" : "Scan"}
                  </button>
                  {draft.barcode && <button type="button" onClick={() => { setDraft({ ...draft, barcode: "" }); setBarcodeTouched(true); setBarcodeScanStatus("Barcode cleared"); }} disabled={packBusy} aria-label="Clear product barcode"><X size={14} /></button>}
                </div>
                <small>Leading zeroes are preserved. Singles and physical packs may use different barcodes.</small>
                {barcodeScanStatus && barcodeCaptureTarget === "menu" && <span role="status" style={{ display: "block", marginTop: 4, color: barcodeCaptureActive ? "#79551e" : "#28624d", fontSize: 11 }}>{barcodeScanStatus}</span>}
              </label>
              <label>
                How is this sold?
                <select
                  value={draft.stock_method}
                  disabled={!barOnly && categoryRequiresRecipe(draft.category)}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      stock_method: event.target.value,
                      inventory_item_id: event.target.value === "direct" ? draft.inventory_item_id : "",
                    })
                  }
                >
                  <option value="direct">Packaged / pre-made item — direct stock</option>
                  {(recipesEnabled || draft.stock_method === "recipe") && (
                    <option value="recipe">
                      {recipesEnabled
                        ? "Prepared food or cocktail — recipe required (Included with Stock add-on)"
                        : "Recipe method — Included with Stock add-on (Stock & Purchasing Pro required)"}
                    </option>
                  )}
                  <option value="non_stock">Non-stock service — no inventory</option>
                </select>
                <small>
                  {barOnly ? "Packaged products link to the exact bottle, can or packet. Simple food links to a prepared-portion stock item so each sale removes one counted portion." : "Drinks start as packaged stock. Food and Cocktails are recipe-required so their ingredients and cost remain accurate."}
                </small>
              </label>
              {editingStockMethod === "recipe" ? (
                <div className="hpos-inline-notice is-wide">
                  <CookingPot size={16} />
                  <span><strong>Recipe required before Till.</strong> Save this menu item, then add its ingredients and quantities in Recipes &amp; Costing. It will remain unavailable until the recipe is complete.</span>
                </div>
              ) : editingStockMethod === "non_stock" ? (
                <div className="hpos-inline-notice is-wide">
                  <span><strong>Non-stock service.</strong> Use only for something that genuinely consumes no stock, such as a cover charge or delivery fee.</span>
                </div>
              ) : (
                <>
                  <label>
                    Direct stock link
                    <select
                      value={draft.inventory_item_id}
                      onChange={(event) => {
                        const inventoryItemId = event.target.value;
                        const stockItem = inventoryItems.find((row) => row.id === inventoryItemId);
                        setDraft({
                          ...draft,
                          inventory_item_id: inventoryItemId,
                          // A direct stock barcode is a safe default for a
                          // newly linked single; never overwrite a manager's
                          // explicit menu/package barcode.
                          barcode: draft.barcode.trim() ? draft.barcode : (stockItem?.barcode || ""),
                        });
                      }}
                    >
                      <option value="">
                        No direct link — save as {recipesEnabled ? "recipe draft" : "unlinked draft"}
                      </option>
                      {inventoryItems.map((stockItem) => (
                        <option key={stockItem.id} value={stockItem.id}>
                          {stockItem.name} · {Number(stockItem.current_stock || 0)}{" "}
                          {stockItem.unit || "each"}
                        </option>
                      ))}
                    </select>
                    <small>
                      Choose the exact purchased item the Till should deplete, for example Heineken 330ml or Coca-Cola 330ml.
                    </small>
                  </label>
                  {barOnly && (
                    <label>
                      Stock units consumed per sale
                      <input
                        type="number"
                        min="0.000001"
                        step="any"
                        inputMode="decimal"
                        required
                        value={draft.depletion_qty}
                        onChange={(event) =>
                          setDraft({ ...draft, depletion_qty: event.target.value })
                        }
                      />
                      <small>
                        Use 1 for one bottle/can, or a decimal for measured pours such as 0.05 litres. Pack templates keep their own 6/12/24-unit depletion.
                      </small>
                    </label>
                  )}
                </>
              )}
            </div>
            {barOnly && draft.inventory_item_id && selectedInventoryIsBar && (
              <section className="hpos-service-pack-options">
                <strong>Pack / case sell templates</strong>
                <p>
                  Create sellable packs that use the existing bar-pack depletion
                  contract. Scan each physical package barcode separately; a
                  pack barcode must never be reused for a single bottle.
                </p>
                <div style={{ display: "grid", gap: 10 }}>
                  {BAR_PACK_SIZES.map((size) => {
                    const key = `pack${size}`;
                    const barcodeKey = `${key}Barcode`;
                    return (
                      <div key={size} style={{ display: "grid", gap: 5 }}>
                        <label>
                          <input
                            type="checkbox"
                            checked={draft[key] === true}
                            onChange={(event) =>
                              setDraft({ ...draft, [key]: event.target.checked })
                            }
                          />
                          {size === 24 ? "Case 24" : `${size}-pack`}
                        </label>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            ref={(node) => { packBarcodeInputRefs.current[size] = node; }}
                            type="text"
                            value={draft[barcodeKey] || ""}
                            onChange={(event) => {
                              setBarcodeTouched(true);
                              setBarcodeScanStatus("");
                              setDraft({ ...draft, [barcodeKey]: event.target.value });
                            }}
                            placeholder={`${size === 24 ? "Case 24" : `${size}-pack`} barcode (optional)`}
                            inputMode="text"
                            autoComplete="off"
                            style={{ flex: 1 }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setBarcodeCaptureTarget(String(size));
                              setBarcodeCaptureActive(true);
                              setBarcodeScanStatus(`Waiting for ${size === 24 ? "case 24" : `${size}-pack`} scanner input…`);
                              requestAnimationFrame(() => packBarcodeInputRefs.current[size]?.focus());
                            }}
                            disabled={packBusy}
                            aria-label={`Scan ${size === 24 ? "case 24" : `${size}-pack`} barcode`}
                          >
                            <ScanLine size={14} /> {barcodeCaptureActive && barcodeCaptureTarget === String(size) ? "Scanning…" : "Scan"}
                          </button>
                          {draft[barcodeKey] && <button type="button" onClick={() => { setDraft({ ...draft, [barcodeKey]: "" }); setBarcodeTouched(true); setBarcodeScanStatus("Pack barcode cleared"); }} disabled={packBusy} aria-label={`Clear ${size === 24 ? "case 24" : `${size}-pack`} barcode`}><X size={14} /></button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {barcodeScanStatus && barcodeCaptureTarget !== "menu" && <div role="status" className="hpos-inline-notice">{barcodeScanStatus}</div>}
              </section>
            )}
            {barOnly && draft.inventory_item_id && !selectedInventoryIsBar && (
              <div className="hpos-inline-notice">
                This stock item can be sold individually. To create 6-packs,
                12-packs or cases, assign the stock item to an active Bar outlet
                in Stock first; pack templates are not valid for unassigned or
                non-Bar stock.
              </div>
            )}
            {saveError && <ErrorNotice className="hpos-inline-error">{saveError}</ErrorNotice>}
            <footer>
              <button
                type="button"
                className="hpos-secondary-action"
                onClick={() => { setBarcodeCaptureActive(false); setBarcodeScanStatus(""); setEditing(null); }}
                disabled={packBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="hpos-primary-action"
                onClick={saveItem}
                disabled={packBusy}
              >
                {packBusy
                  ? "Saving item…"
                  : editing !== "new"
                    ? "Save changes"
                    : draft.inventory_item_id
                      ? "Save & make available"
                      : "Save as draft"}
              </button>
            </footer>
          </section>
        </div>
      )}
      {showModifiers && localAuthority && (
        <div className="hpos-modal-backdrop" role="presentation">
          <section className="hpos-service-dialog" role="dialog" aria-modal="true" aria-labelledby="modifier-dialog-title">
            <button type="button" className="hpos-service-dialog__close" onClick={() => setShowModifiers(false)} disabled={modifierBusy} aria-label="Close"><X size={18} /></button>
            <p className="hpos-eyebrow">Local Bar configuration</p>
            <h2 id="modifier-dialog-title">Modifiers, recipes and promotions</h2>
            {modifierError && <ErrorNotice className="hpos-inline-error">{modifierError}</ErrorNotice>}
            {localModifierPending && <div role="status" className="mt-3 rounded border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">
              Saved local operation {localModifierPending.operationId} ({localModifierPending.command}) needs confirmation.
              <button type="button" onClick={() => void retryLocalModifierCommand()} disabled={modifierBusy} className="ml-3 rounded bg-amber-700 px-3 py-1 font-semibold text-white">Retry same operation</button>
            </div>}
            {!localModifierConfig ? <p className="mt-4">Local modifier settings are unavailable. Refresh the Menu before editing.</p> : <BarLocalModifierManager
              config={localModifierConfig}
              busy={modifierBusy}
              blocked={Boolean(localModifierPending)}
              onCommand={sendLocalModifierCommand}
            />}
          </section>
        </div>
      )}
      {showModifiers && !localAuthority && (
        <div className="hpos-modal-backdrop" role="presentation">
          <section
            className="hpos-service-dialog hpos-service-modifier-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modifier-dialog-title"
          >
            <button
              type="button"
              className="hpos-service-dialog__close"
              onClick={() => setShowModifiers(false)}
              disabled={modifierBusy}
              aria-label="Close"
            >
              <X size={18} />
            </button>
            <p className="hpos-eyebrow">Service choices</p>
            <h2 id="modifier-dialog-title">Modifier groups</h2>
            <p>
              Create choices such as steak temperature, sides, extras or mixer
              options. They appear from the Options button on a sell line.
            </p>
            {modifierGroups.length > 0 && (
              <div className="hpos-service-modifier-list">
                {modifierGroups.map((group) => (
                  <article key={group.id}>
                    <div>
                      <strong>{group.name}</strong>
                      <span>
                        {(group.options || []).length} options ·{" "}
                        {group.min_selections
                          ? `min ${group.min_selections}`
                          : "optional"}
                        {group.max_selections
                          ? ` · max ${group.max_selections}`
                          : ""}
                      </span>
                    </div>
                    <small>
                      {(group.applies_to_categories || []).join(", ") ||
                        "All menu sections"}
                    </small>
                  </article>
                ))}
              </div>
            )}
            <div className="hpos-service-modifier-create">
              <h3>Add a modifier group</h3>
              <div className="hpos-service-form hpos-service-form--two">
                <label className="is-wide">
                  Group name
                  <input
                    type="text"
                    value={modifierDraft.name}
                    onChange={(event) =>
                      setModifierDraft({
                        ...modifierDraft,
                        name: event.target.value,
                      })
                    }
                    placeholder="For example, Steak temperature"
                  />
                </label>
                <label className="is-wide">
                  Options <span>one per line; price after |</span>
                  <textarea
                    rows="4"
                    value={modifierDraft.options}
                    onChange={(event) =>
                      setModifierDraft({
                        ...modifierDraft,
                        options: event.target.value,
                      })
                    }
                    placeholder={"Medium rare|0\nPepper sauce|15"}
                  />
                </label>
                <label>
                  Minimum choices
                  <input
                    type="number"
                    min="0"
                    value={modifierDraft.min_selections}
                    onChange={(event) =>
                      setModifierDraft({
                        ...modifierDraft,
                        min_selections: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Maximum choices
                  <input
                    type="number"
                    min="0"
                    value={modifierDraft.max_selections}
                    onChange={(event) =>
                      setModifierDraft({
                        ...modifierDraft,
                        max_selections: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="is-wide">
                  Menu sections <span>comma separated</span>
                  <input
                    type="text"
                    value={modifierDraft.applies_to_categories}
                    onChange={(event) =>
                      setModifierDraft({
                        ...modifierDraft,
                        applies_to_categories: event.target.value,
                      })
                    }
                    placeholder="Mains, Drinks"
                  />
                </label>
              </div>
              {modifierError && (
                <ErrorNotice className="hpos-inline-error">{modifierError}</ErrorNotice>
              )}
            </div>
            <footer>
              <button
                type="button"
                className="hpos-secondary-action"
                onClick={() => setShowModifiers(false)}
                disabled={modifierBusy}
              >
                Done
              </button>
              <button
                type="button"
                className="hpos-primary-action"
                onClick={saveModifierGroup}
                disabled={modifierBusy}
              >
                {modifierBusy ? "Saving group…" : "Save modifier group"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
