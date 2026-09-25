import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
import { ErrorNotice } from "../shared/ErrorNotice";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import {
  Search,
  Plus,
  Minus,
  ShoppingCart,
  CreditCard,
  Banknote,
  Smartphone,
  Trash2,
  Star,
  Clock,
  Apple,
  Beer,
  CircleDot,
  Coffee,
  Cookie,
  CupSoda,
  IceCream,
  Martini,
  Package,
  Salad,
  Soup,
  UtensilsCrossed,
  Wine,
  AlertCircle,
  CheckCircle,
  ReceiptText,
  WalletCards,
  Keyboard,
  Delete,
  X,
} from "lucide-react";
import { useSettings, useAuth, useAccess } from "../../app-context";
import { isBarOnlyMode } from "../../../../shared/propertyTypes";
import {
  BAR_CATEGORY_VISUALS,
  getBarModeProfile,
  getDefaultHposServiceMode,
  getHposServiceModes,
  isPoolCategory,
  resolvePosServicePayload,
  resolveResumedTabPayment,
  shouldLoadTillTables,
} from "../../../../shared/barModeProfile";
import { isCommercialFeatureIncluded } from "../../../../shared/commercialAccess.js";
import { canAccessCapability } from "../../../../shared/accessControl.js";
import HposTillOperatorDialog from "./HposTillOperatorDialog";
import { POSReceipt } from "../shared/POSReceipt";
import {
  createBarcodeScannerDecoder,
  normalizeBarcode,
  isScannerEditableTarget,
} from "../../../../shared/barcodeScanner";
import {
  TILL_OPERATOR_MODES,
  getTillOperatorPolicy,
} from "../../../../shared/tillOperatorPolicy";
import { playTillBeep } from "../../../../shared/tillSound";
import { buildBarTenderBreakdown } from "../../../../shared/barTenderAllocation";
import {
  validateSaleModifierRequirements,
} from "../../../../shared/modifierRequirements";
import { getTillEntitlements } from "../../../../shared/tillEntitlements";
import {
  QUICK_CASH_AMOUNTS,
  basketDraftKey,
  computeCashTender,
  holdIntentKey,
  isDraftFresh,
  lastReceiptKey,
  readinessCacheKey,
  reconcileHoldIntent,
  resolveReadinessState,
  revalidateBasketLines,
  roundCash,
} from "../../../../shared/tillBasketRecovery";

const TERMINAL_OUTLET_STORAGE_PREFIX = "hpos-terminal-outlet:";
const FAVOURITES_STORAGE_PREFIX = "hpos-till-favourites:";
const MAX_FAVOURITES = 30;
// Touch-only Sell search: in-app keyboard rows (barcode scanners and
// physical keyboards still work through the focused input as before).
const SEARCH_KEYBOARD_ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];
const TOP_SELLER_POPULARITY = 80;
const FAVOURITES_CATEGORY = "★ Favourites";
const TOP_SELLERS_CATEGORY = "Top sellers";

// Unsent-basket drafts and hold intents are per terminal (localStorage),
// tenant, outlet, operator and shift. Anything else never restores. Keys
// come from the single canonical builders in tillBasketRecovery so writers
// and readers can never diverge.

function readJsonSetting(key) {
  try {
    const raw = window.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Returns false when the write did not land (quota/private mode). Callers
// guarding money-adjacent intents must treat false as blocking.
function writeJsonSetting(key, value) {
  try {
    if (value === null || value === undefined) window.localStorage?.removeItem(key);
    else window.localStorage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function favouritesStorageKey(lodgeId, outletId) {
  return `${FAVOURITES_STORAGE_PREFIX}${lodgeId || "nolid"}:${outletId || "nooutlet"}`;
}

function readTillFavourites(lodgeId, outletId) {
  try {
    const raw = window.localStorage?.getItem(favouritesStorageKey(lodgeId, outletId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

// Resolves BAR_CATEGORY_VISUALS icon keys to lucide components for Till
// product cards. Unknown keys fall back to the restaurant keyword chain.
const BAR_CATEGORY_ICON_COMPONENTS = {
  beer: Beer,
  apple: Apple,
  martini: Martini,
  cupSoda: CupSoda,
  wine: Wine,
  cookie: Cookie,
  utensils: UtensilsCrossed,
  package: Package,
  circleDot: CircleDot,
};

function terminalOutletStorageKey(lodgeId) {
  return lodgeId ? `${TERMINAL_OUTLET_STORAGE_PREFIX}${lodgeId}` : null;
}

function readTerminalOutletPreference(lodgeId) {
  const key = terminalOutletStorageKey(lodgeId);
  if (!key) return null;
  try {
    return window.localStorage?.getItem(key) || null;
  } catch {
    return null;
  }
}

function writeTerminalOutletPreference(lodgeId, outletId) {
  const key = terminalOutletStorageKey(lodgeId);
  if (!key) return;
  try {
    if (outletId) window.localStorage?.setItem(key, outletId);
    else window.localStorage?.removeItem(key);
  } catch {
    /* Local terminal preference is optional and must never block Till. */
  }
}

function ProductCard({ item, onAdd, onAddQty, onToggleFavourite, isFavourite = false, stockSetupRequired = false, statusUnknown = false, lowStock = null, finishedStock = false, syncBlocked = false, pendingSync = false, inBasketQty = 0 }) {
  const isSoldOut =
    item.is_available === false || item.available === false || item.sold_out;
  const blocked = isSoldOut || finishedStock || syncBlocked || stockSetupRequired || statusUnknown;
  const unavailableLabel = statusUnknown
    ? "Refresh required"
    : stockSetupRequired
      ? "Stock setup required"
      : finishedStock
        ? "Finished — out of stock"
        : syncBlocked
          ? "Syncing — sells after sync"
          : "Sold out";
  const normalizedCategory = String(item.category || "").toLowerCase();
  // Bar categories resolve to their own icon and tone first; the restaurant
  // keyword chain below stays the fallback for everything else.
  const barVisual = BAR_CATEGORY_VISUALS[normalizedCategory] || null;
  const CategoryIcon =
    (barVisual && BAR_CATEGORY_ICON_COMPONENTS[barVisual.icon]) ||
    (normalizedCategory.includes("drink") ||
    normalizedCategory.includes("juice") ||
    normalizedCategory.includes("bar")
      ? CupSoda
      : normalizedCategory.includes("coffee") ||
          normalizedCategory.includes("tea")
        ? Coffee
        : normalizedCategory.includes("dessert") ||
            normalizedCategory.includes("sweet")
          ? IceCream
          : normalizedCategory.includes("salad") ||
              normalizedCategory.includes("fresh") ||
              normalizedCategory.includes("starter")
            ? Salad
            : normalizedCategory.includes("soup") ||
                normalizedCategory.includes("bowl")
              ? Soup
              : UtensilsCrossed);
  const categoryTone =
    barVisual?.tone ||
    ({
      food: "#f3c981",
      drinks: "#c8dfd9",
      dessert: "#f2b5aa",
      desserts: "#f2b5aa",
      sides: "#e6be69",
      starter: "#d8dec0",
      starters: "#d8dec0",
    }[String(item.category || "").toLowerCase()] || "#efe2cf");
  const longPressFiredRef = useRef(false);
  const longPressTimerRef = useRef(null);
  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };
  return (
    <div
      style={{
        background: blocked ? "#f7f1e8" : categoryTone,
        border: `1px solid ${blocked ? "rgba(55,70,57,.08)" : "rgba(55,70,57,.12)"}`,
        borderRadius: "20px",
        padding: "18px",
        minHeight: "164px",
        textAlign: "left",
        transition:
          "transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        justifyContent: "space-between",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Full-card hit target. A native button (not role=button on a div)
          keeps keyboard activation free and lets the favourite star sit as a
          real sibling control instead of nesting buttons. Blocked cards stay
          discoverable via aria-disabled rather than disappearing. */}
      <button
        type="button"
        tabIndex={blocked ? -1 : 0}
        aria-disabled={blocked}
        aria-label={
          blocked
            ? `${item.name} (${unavailableLabel})`
            : inBasketQty > 0
              ? `Add another ${item.name} to order — ${inBasketQty} already in basket`
              : `Add ${item.name} to order`
        }
        onClick={() => {
          if (longPressFiredRef.current) {
            longPressFiredRef.current = false;
            return;
          }
          if (!blocked) onAdd(item);
        }}
        onPointerDown={() => {
          if (blocked) return;
          // Long-press opens a multi-add sheet for rounds (4 beers, etc.).
          // Suppress the subsequent click so one long-press never double-adds.
          longPressFiredRef.current = false;
          clearLongPress();
          longPressTimerRef.current = window.setTimeout(() => {
            longPressFiredRef.current = true;
            longPressTimerRef.current = null;
            onAddQty?.(item);
          }, 480);
        }}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
        onPointerLeave={clearLongPress}
        onContextMenu={(event) => {
          if (!blocked) event.preventDefault();
        }}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          width: "100%",
          height: "100%",
          padding: 0,
          margin: 0,
          border: "none",
          background: "transparent",
          borderRadius: "20px",
          cursor: blocked ? "not-allowed" : "pointer",
          touchAction: "manipulation",
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          right: -14,
          top: -16,
          width: 88,
          height: 88,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background: "rgba(255,253,248,.32)",
          color: "rgba(36,54,44,.48)",
          transform: "rotate(-8deg)",
          pointerEvents: "none",
        }}
      >
        <CategoryIcon size={35} strokeWidth={1.45} />
      </span>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          position: "relative",
          zIndex: 2,
          paddingRight: 42,
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            fontSize: "16px",
            fontWeight: 800,
            color: "var(--bb-text)",
            lineHeight: 1.2,
            flex: 1,
          }}
        >
          {item.name}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 2, marginTop: -8, marginRight: -8 }}>
          {Number(item.popularity || 0) > TOP_SELLER_POPULARITY && !isFavourite && (
            <Star size={11} color="#c95635" fill="#c95635" />
          )}
        </span>
      </div>
      <button
        type="button"
        aria-label={isFavourite ? `Remove ${item.name} from favourites` : `Pin ${item.name} to favourites`}
        aria-pressed={isFavourite === true}
        title={isFavourite ? "Remove from favourites" : "Pin to favourites"}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          onToggleFavourite?.(item.id);
        }}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 3,
          width: "44px",
          height: "44px",
          borderRadius: "10px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
        }}
      >
        <Star
          size={15}
          color={isFavourite ? "#c95635" : "#8a8f88"}
          fill={isFavourite ? "#c95635" : "transparent"}
        />
      </button>
      {inBasketQty > 0 && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 10,
            top: 10,
            zIndex: 3,
            minWidth: 30,
            height: 30,
            padding: "0 8px",
            borderRadius: 999,
            display: "grid",
            placeItems: "center",
            background: "var(--bb-accent, #c95635)",
            color: "#fffdf8",
            fontSize: "13px",
            fontWeight: 900,
            boxShadow: "0 6px 14px rgba(201,86,53,.28)",
            pointerEvents: "none",
          }}
        >
          {inBasketQty}
        </span>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          position: "relative",
          zIndex: 2,
          pointerEvents: "none",
        }}
      >
        <span style={{ fontSize: "17px", fontWeight: 800, color: "var(--bb-text)" }}>
          P{Number(item.price || 0).toFixed(2)}
        </span>
        {item.prep_time && (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "2px",
              fontSize: "10px",
              color: "var(--bb-text-muted)",
            }}
          >
            <Clock size={9} /> {item.prep_time}m
          </span>
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          position: "relative",
          zIndex: 2,
          pointerEvents: "none",
        }}
      >
        {lowStock && (
          <span
            style={{
              fontSize: "11px",
              fontWeight: 800,
              color: "#8d2f24",
              background: "rgba(191, 72, 45, 0.12)",
              padding: "3px 7px",
              borderRadius: "999px",
            }}
          >
            Only {lowStock.qty} {lowStock.unit} left
          </span>
        )}
        {pendingSync && (
          <span
            role="status"
            style={{
              fontSize: "11px",
              fontWeight: 800,
              color: "#7a5710",
              background: "rgba(166, 118, 42, 0.12)",
              padding: "3px 7px",
              borderRadius: "999px",
            }}
          >
            Pending sync — sells offline now
          </span>
        )}
        {item.category && (
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--bb-accent)",
              background: "rgba(255,253,248,.38)",
              padding: "3px 7px",
              borderRadius: "999px",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {item.category}
          </span>
        )}
        {item.template_kind === "bar_pack" && item.template_pack_size && (
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--bb-info)",
              background: "rgba(53,110,216,.12)",
              padding: "3px 7px",
              borderRadius: "999px",
            }}
          >
            {item.template_pack_size}-pack
          </span>
        )}
        {item.barcode && (
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--bb-text-soft)",
              background: "rgba(255,253,248,.5)",
              padding: "3px 7px",
              borderRadius: "999px",
            }}
          >
            #{item.barcode}
          </span>
        )}
      </div>
      {/* Single visible unavailable label — full-contrast text on the muted
          card (no opacity dimming), announced once via the button's
          aria-label rather than duplicated as a status pill plus footer. */}
      {blocked && (
        <span
          style={{
            position: "relative",
            zIndex: 2,
            pointerEvents: "none",
            fontSize: "12px",
            fontWeight: 700,
            color: "var(--bb-danger)",
            textTransform: "uppercase",
          }}
        >
          {unavailableLabel}
        </span>
      )}
    </div>
  );
}

function packBadgeLabel(line) {
  const size = Number(line?.template_pack_size || 0);
  if (line?.template_kind === "bar_pack" && Number.isFinite(size) && size > 1) {
    return size === 24 ? "Case 24" : `${size}-pack`;
  }
  // Only label singles when the line positively carries single-pack data;
  // unknown provenance renders no badge rather than a guessed one.
  if (line?.template_kind && line.template_kind !== "bar_pack") return "Single";
  if (line?.template_kind === "bar_pack") return "Single";
  return null;
}

function CartLine({ line, onUpdateQty, onSetQty, onRemove, onCustomize, currency, highlight = false, highlightFresh = false }) {
  const fmt = (n) => Number(n || 0).toFixed(2);
  const packLabel = packBadgeLabel(line);
  const isPoolLine = String(line.category || '').trim().toLowerCase() === 'pool';
  const unit = Number(line.unit_price) + Number(line.modifier_total || 0);
  return (
    <div
      ref={highlightFresh ? (el) => el?.scrollIntoView?.({ block: "nearest" }) : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "6px 8px",
        borderBottom: "1px solid rgba(55,70,57,.09)",
        background: highlight ? "rgba(201,86,53,.08)" : "transparent",
      }}
    >
      {/* Name block gets every spare pixel: the line total moved underneath
          (was its own column) and the name wraps to 2 lines instead of
          cutting off with an ellipsis on the wider 440px panel. */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          title={line.item_name}
          style={{
            fontSize: "13px",
            fontWeight: 700,
            color: "var(--bb-text)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            wordBreak: "break-word",
            lineHeight: 1.25,
          }}
        >
          {line.item_name}
          {packLabel && packLabel !== "Single" ? ` · ${packLabel}` : ""}
        </div>
        {line.modifiers?.length > 0 && (
          <div style={{ fontSize: "11px", color: "var(--bb-text-muted)", marginTop: "1px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {line.modifiers.join(", ")}
          </div>
        )}
        {/* Unit price stays visible under the name so the cashier can verify
            P-per-single against the line total without mental arithmetic
            (restores the approved Sell-screen contract). */}
        <div
          title={`Line total ${currency} ${fmt(unit * line.quantity)}`}
          style={{
            fontSize: "11px",
            color: "var(--bb-text-soft)",
            marginTop: "1px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {currency} {fmt(unit)} each · Total {currency} {fmt(unit * line.quantity)}
        </div>
      </div>

      {/* Qty Controls: 44px minimum targets for touch tills. One compact row so several items fit without scrolling. */}
      <button
        onClick={() => onUpdateQty(line.id, Number(line.quantity) - 1)}
        aria-label={`Decrease ${line.item_name} quantity`}
        style={{
          width: "44px",
          height: "44px",
          borderRadius: "10px",
          border: "1px solid rgba(55,70,57,.16)",
          background: "#fffdf8",
          color: "var(--bb-text)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Minus size={16} />
      </button>
      <input
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        value={line.quantity}
        aria-label={`Quantity for ${line.item_name}`}
        onChange={(event) => onSetQty(line.id, event.target.value)}
        style={{
          width: "54px",
          flexShrink: 0,
          height: "44px",
          textAlign: "center",
          fontSize: "15px",
          fontWeight: 700,
          color: "var(--bb-text)",
          borderRadius: "10px",
          border: "1px solid rgba(55,70,57,.16)",
          background: "#fffdf8",
        }}
      />
      <button
        onClick={() => onUpdateQty(line.id, Number(line.quantity) + 1)}
        aria-label={`Increase ${line.item_name} quantity`}
        style={{
          width: "44px",
          height: "44px",
          borderRadius: "10px",
          border: "1px solid rgba(55,70,57,.16)",
          background: "#fffdf8",
          color: "var(--bb-text)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Plus size={16} />
      </button>

      <button
        onClick={() => onRemove(line.id)}
        aria-label={`Remove ${line.item_name}`}
        style={{
          minWidth: "44px",
          height: "44px",
          borderRadius: "10px",
          border: "1px solid rgba(184,74,56,.25)",
          background: "transparent",
          color: "var(--bb-danger)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Trash2 size={16} />
      </button>
      {!isPoolLine && (
        <button
          onClick={() => onCustomize(line)}
          aria-label={`Options for ${line.item_name}`}
          title="Modifiers and options"
          className="hpos-service-line-options"
          style={{ flexShrink: 0, minHeight: "44px", padding: "0 8px" }}
        >
          ···
        </button>
      )}
    </div>
  );
}

function tenderLabel(method) {
  return {
    account: "Customer account",
    cash: "Cash",
    card: "Card",
    mobile_money: "Mobile money",
    voucher: "Voucher",
  }[method] || method;
}

export default function HposTerminal() {
  const location = useLocation();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { user } = useAuth();
  const access = useAccess();
  const { allowedOutletIds } = access;
  const lodgeId = settings?.lodge_id || user?.lodge_id || null;
  const sharedTerminalMode = [
    "manager",
    "admin",
    "supervisor",
    "super_admin",
  ].includes(String(user?.role || "").toLowerCase());
  const currency = settings?.currency || "P";
  const barOnly = isBarOnlyMode(settings);
  const commercialProductId = access?.entitlement?.product_id || null;
  const commercialPackageKey = access?.entitlement?.commercial_package_key || null;
  const commercialAddonKeys = Array.isArray(access?.entitlement?.enterprise_addons)
    ? access.entitlement.enterprise_addons
    : [];
  const commercialContextKnown = commercialProductId === "hospitality-pos" && Boolean(commercialPackageKey);
  const canUseBarCommercialFeature = (featureKey) => !barOnly || (
    commercialContextKnown && isCommercialFeatureIncluded(
      commercialProductId,
      commercialPackageKey,
      featureKey,
      commercialAddonKeys,
      access?.entitlement || null,
      access?.entitlement?.lodge_id || null
    )
  );
  const canUseVoucher = canUseBarCommercialFeature("vouchers");
  const canUseTips = canUseBarCommercialFeature("tips_payouts");
  const canUseRecipes = canUseBarCommercialFeature("recipes");
  // Customer-account and promotion capabilities gate their reads, controls
  // and submissions together (Growth add-ons in Bar-only; always on for
  // restaurant service, preserving established behavior there).
  const tillEntitlements = useMemo(
    () =>
      getTillEntitlements({
        productId: commercialProductId,
        packageKey: commercialPackageKey,
        addonKeys: commercialAddonKeys,
        entitlement: access?.entitlement || null,
        lodgeId: access?.entitlement?.lodge_id || null,
        barOnly,
      }),
    [commercialProductId, commercialPackageKey, commercialAddonKeys, access?.entitlement, barOnly],
  );
  const barProfile = useMemo(() => getBarModeProfile(settings), [settings]);
  const tillOperatorPolicy = useMemo(() => getTillOperatorPolicy(settings), [settings]);
  const serviceModeOptions = useMemo(
    () => getHposServiceModes(barOnly),
    [barOnly],
  );
  const [menuItems, setMenuItems] = useState([]);
  // Core-load failure is distinct from an empty catalogue: the grid must
  // never render "No items found" for a read that never succeeded.
  const [menuLoadFailed, setMenuLoadFailed] = useState(false);
  const [coreLoadNonce, setCoreLoadNonce] = useState(0);
  // In-app destructive confirms (Clear sale / switch table) instead of
  // window.confirm: styled, keyboard-dismissable, screen-reader announced.
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const [recipeMenuItemIds, setRecipeMenuItemIds] = useState(() => new Set());
  // Low-stock badges by inventory_item_id. Informational only: loaded idle
  // after the Till opens, capability-gated server-side (cashiers without
  // inventory.view simply see no badges), never blocking a sale.
  const [lowStockMap, setLowStockMap] = useState({});
  const [cart, setCart] = useState([]);
  const [lastAdded, setLastAdded] = useState(null);
  // One-level local undo for the most recent basket add (mis-taps only —
  // never touches a paid order). Snackbars auto-expire; no financial state.
  const [undoAdd, setUndoAdd] = useState(null);
  const [lastRemoved, setLastRemoved] = useState(null);
  const [favourites, setFavourites] = useState([]);
  const [openTabCount, setOpenTabCount] = useState(0);
  // Shared drawers reconcile every sale inside one open period. The domain
  // refuses sales without one; this pill says so before the operator builds
  // a basket. Personal outlets never show it.
  const [drawerGateNeeded, setDrawerGateNeeded] = useState(false);
  const [openTabsBrief, setOpenTabsBrief] = useState([]);
  const [resumedTabInfo, setResumedTabInfo] = useState(null);
  const [pendingRestore, setPendingRestore] = useState(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [outletReady, setOutletReady] = useState(false);
  const [cashReceived, setCashReceived] = useState("");
  const [lastReceipt, setLastReceipt] = useState(null);
  // Narrow viewports (tablets, small touch tills) turn the fixed basket
  // panel into an overlay drawer toggled from a totals bar, so the product
  // grid keeps usable columns. Payment always forces the drawer open so the
  // tender controls and totals stay reachable; keyboard and scanner
  // behavior are unchanged.
  const [narrowViewport, setNarrowViewport] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 1100px)").matches,
  );
  const [basketOpen, setBasketOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia("(max-width: 1100px)");
    const onChange = (event) => setNarrowViewport(event.matches);
    setNarrowViewport(query.matches);
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }
    return undefined;
  }, []);
  const restoreCheckedRef = useRef(false);
  const undoTimerRef = useRef(null);
  const [search, setSearch] = useState("");
  const [selectedOutlet, setSelectedOutlet] = useState(null);
  // Pinned Till favourites are per terminal outlet so each bar station keeps
  // its own fast picks. Plain menu ids, capped like the legacy POS list.
  useEffect(() => {
    setFavourites(readTillFavourites(lodgeId, selectedOutlet?.id));
  }, [lodgeId, selectedOutlet?.id]);

  useEffect(() => () => {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
  }, []);

  // The last-added highlight is transient: tint + scroll only while fresh.
  useEffect(() => {
    if (!lastAdded) return undefined;
    const timer = window.setTimeout(() => setLastAdded(null), 2500);
    return () => window.clearTimeout(timer);
  }, [lastAdded]);

  // Undo affordance expires so a stale snackbar never clears a later basket.
  // 2.5s: long enough to catch a mis-tap, short enough to never crowd the
  // payment footer during a fast round.
  useEffect(() => {
    if (!undoAdd) return undefined;
    const timer = window.setTimeout(() => setUndoAdd(null), 2500);
    return () => window.clearTimeout(timer);
  }, [undoAdd]);

  const toggleFavourite = useCallback((menuItemId) => {
    if (!menuItemId) return;
    setFavourites((prev) => {
      const next = prev.includes(menuItemId)
        ? prev.filter((id) => id !== menuItemId)
        : [...prev, menuItemId].slice(-MAX_FAVOURITES);
      try {
        window.localStorage?.setItem(
          favouritesStorageKey(lodgeId, selectedOutlet?.id),
          JSON.stringify(next),
        );
      } catch {
        /* Favourites are a local convenience and must never block Till. */
      }
      return next;
    });
  }, [lodgeId, selectedOutlet?.id]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [serviceMode, setServiceMode] = useState(() => {
    if (!location.state?.tabId) return getDefaultHposServiceMode(settings);
    // Bar tabs always carry table_name (= tab name), so a bar resume must
    // land on the tab mode. Otherwise the mode corrects to counter and the
    // payment records a counter sale without closing the tab.
    if (location.state?.tableName && !isBarOnlyMode(settings)) return "table";
    return "tab";
  });
  const [customers, setCustomers] = useState([]);
  const [modifierGroups, setModifierGroups] = useState([]);
  // Modifier applicability contract: loading (Hold/Pay wait), ready
  // (validated per line), failed (Hold/Pay blocked until refresh).
  const [modifiersReady, setModifiersReady] = useState("loading");
  // Server-authoritative stock readiness per sellable (outcome only, no
  // recipe disclosure). Base Till never infers from recipe membership.
  const [stockReadiness, setStockReadiness] = useState({ status: "loading", map: new Map(), counts: new Map() });
  const [modifierLineId, setModifierLineId] = useState(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [chargeToAccount, setChargeToAccount] = useState(false);
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherAmount, setVoucherAmount] = useState("");
  const [promotions, setPromotions] = useState([]);
  const [selectedPromotionId, setSelectedPromotionId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [splitCashAmount, setSplitCashAmount] = useState("");
  const [splitRemainderMethod, setSplitRemainderMethod] = useState("card");
  const [paymentReferences, setPaymentReferences] = useState({
    card: "",
    mobile_money: "",
  });
  const [tipAmount, setTipAmount] = useState("");
  const [showPayment, setShowPayment] = useState(false);
  // Derived AFTER all state above: reading any useState binding before its
  // declaration throws "Cannot access '...' before initialization" on every
  // render and lands the whole Till on the recovery screen (this line once
  // read showPayment from above its declaration). Do not move it back up.
  const basketVisible = !narrowViewport || basketOpen || showPayment;
  // Long-press multi-add: open a short qty sheet for rounds (2/3/4/6).
  const [multiAddItem, setMultiAddItem] = useState(null);
  const [multiAddQty, setMultiAddQty] = useState("2");
  // This shift's sold-item chips (device-local): max 12 unique product ids.
  const [recentSold, setRecentSold] = useState([]);
  const [shiftPaceItems, setShiftPaceItems] = useState(0);
  // Payment open too long with an untaken tender: soft nudge after 90s.
  const [paymentIdleNudge, setPaymentIdleNudge] = useState(false);
  const [loading, setLoading] = useState(true);
  // Staged core-load progress: menu/stock/team reads resolve together, then
  // options finish. The text below keeps the Till visibly working instead of
  // a silent skeleton while the shift roster arrives.
  const [loadingStage, setLoadingStage] = useState("menu, stock and team");
  const [outlets, setOutlets] = useState([]);
  const [tables, setTables] = useState([]);
  // Open-tab names for the Bar tab-name suggestions. Bar-only service has no
  // floor tables, so these come from the already-loaded tab list instead of
  // a separate floor-table read.
  const [openTabNames, setOpenTabNames] = useState([]);
  const [tableName, setTableName] = useState(
    () => location.state?.tableName || "",
  );
  const [tabName, setTabName] = useState(
    () => location.state?.tabName || location.state?.tableName || "",
  );
  const [currentShift, setCurrentShift] = useState(null);
  const [showShiftStart, setShowShiftStart] = useState(false);
  const [shiftFloat, setShiftFloat] = useState("");
  const [shiftBusy, setShiftBusy] = useState(false);
  const [holding, setHolding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  // Offline clutter guard (2026-09-24): the stale/local amber strip, the
  // unsent-sales green strips and the unlock green strip all auto-collapse to
  // a slim one-line chip after a few seconds so the basket and the payment
  // footer stay visible. Tapping the chip re-expands; a status change resets.
  const [stockNoticeMin, setStockNoticeMin] = useState(false);
  const [unsentNoticeMin, setUnsentNoticeMin] = useState(false);
  useEffect(() => {
    setStockNoticeMin(false);
  }, [stockReadiness.status, stockReadiness.cachedAt]);
  useEffect(() => {
    if (stockReadiness.status !== "stale" && stockReadiness.status !== "local") return undefined;
    const timer = window.setTimeout(() => setStockNoticeMin(true), 8000);
    return () => window.clearTimeout(timer);
  }, [stockReadiness.status, stockReadiness.cachedAt]);
  useEffect(() => {
    setUnsentNoticeMin(false);
  }, [stockReadiness.pendingOrders, stockReadiness.meshOrders, stockReadiness.meshDeliveries]);
  useEffect(() => {
    if (!(Number(stockReadiness.pendingOrders || 0) > 0 || Number(stockReadiness.meshOrders || 0) > 0 || Number(stockReadiness.meshDeliveries || 0) > 0)) return undefined;
    const timer = window.setTimeout(() => setUnsentNoticeMin(true), 8000);
    return () => window.clearTimeout(timer);
  }, [stockReadiness.pendingOrders, stockReadiness.meshOrders, stockReadiness.meshDeliveries]);
  // Green success (till unlock, shift open, basket restore) auto-dismisses so
  // it never parks above the payment footer. Errors never auto-dismiss.
  useEffect(() => {
    if (!successMessage) return undefined;
    const timer = window.setTimeout(() => setSuccessMessage(""), 6000);
    return () => window.clearTimeout(timer);
  }, [successMessage]);
  const [scannerFeedback, setScannerFeedback] = useState(null);
  const [lastNotFoundBarcode, setLastNotFoundBarcode] = useState(null);
  // Unknown-barcode creation is permission-gated: both catalog sides.
  const canCreateProduct =
    canAccessCapability(access, "pos.menu_manage") &&
    canAccessCapability(access, "inventory.manage");
  const [completedReceipt, setCompletedReceipt] = useState(null);
  const [serviceStaff, setServiceStaff] = useState([]);
  // Who is clocked in right now (staff_user_ids) + whether the terminal is
  // online, refreshed each time the unlock dialog opens. Both stay null when
  // unknown so the dialog fails open to today's full staff list.
  const [unlockActiveStaffIds, setUnlockActiveStaffIds] = useState(null);
  const [unlockIsOnline, setUnlockIsOnline] = useState(null);
  const [operatorStaffId, setOperatorStaffId] = useState("");
  const [operatorPin, setOperatorPin] = useState("");
  const [verifiedOperator, setVerifiedOperator] = useState(null);
  const [operatorLastActivityAt, setOperatorLastActivityAt] = useState(null);
  const [tillSessionOutletId, setTillSessionOutletId] = useState(null);
  const [tillSessionExpiresAt, setTillSessionExpiresAt] = useState(null);
  const [operatorBusy, setOperatorBusy] = useState(false);
  const [showOperatorUnlock, setShowOperatorUnlock] = useState(false);
  const searchRef = useRef(null);
  // In-app search keyboard for touch-only tills (no physical keyboard, no
  // OSK dependency). Non-modal: product taps and barcode-wedge focus stay live.
  const [showSearchKeyboard, setShowSearchKeyboard] = useState(false);
  const searchKeyboardRef = useRef(null);
  const searchKeyboardToggleRef = useRef(null);
  const searchClearRef = useRef(null);
  // Dialog a11y refs for the shift-start and modifier overlays (item 11):
  // focus enters on open, Tab stays inside, focus returns to the opener.
  const shiftDialogRef = useRef(null);
  const modifierDialogRef = useRef(null);
  const barcodeDecoderRef = useRef(null);
  const [scannerSettings, setScannerSettings] = useState({});
  const [terminalHardware, setTerminalHardware] = useState({});
  const [terminalSending, setTerminalSending] = useState(false);
  const [terminalMessage, setTerminalMessage] = useState('');
  const scannerIdleTimerRef = useRef(null);
  const scannerFeedbackTimerRef = useRef(null);
  const tillActivityLastSentAtRef = useRef(0);
  const submitEnvelopeRef = useRef(null);
  const [recoveredAttempt, setRecoveredAttempt] = useState(null)
  // The recovery banner collapses to one line (never dismissed: Pay stays
  // bound to the original attempt while one is unresolved). Collapse is
  // persisted per attempt so a remount does not re-expand what the operator
  // already minimized; a newly recovered attempt re-expands once.
  const recoveryCollapseKey = recoveredAttempt?.submitIntentId
    ? `hpos-recovery-collapsed:${recoveredAttempt.submitIntentId}`
    : null;
  const [recoveryCollapsed, setRecoveryCollapsed] = useState(false)
  useEffect(() => {
    if (!recoveredAttempt?.submitIntentId) return;
    try {
      setRecoveryCollapsed(window.localStorage?.getItem(`hpos-recovery-collapsed:${recoveredAttempt.submitIntentId}`) === "1");
    } catch {
      setRecoveryCollapsed(false);
    }
  }, [recoveredAttempt?.submitIntentId]);;
  const toggleRecoveryCollapsed = () => {
    setRecoveryCollapsed((current) => {
      const next = !current;
      try {
        if (recoveryCollapseKey) window.localStorage?.setItem(recoveryCollapseKey, next ? "1" : "0");
      } catch { /* collapse persistence is best-effort */ }
      return next;
    });
  };
  const [recoveryChecking, setRecoveryChecking] = useState(false)
  const [submitNotice, setSubmitNotice] = useState("");
  if (!barcodeDecoderRef.current)
    barcodeDecoderRef.current = createBarcodeScannerDecoder();

  useEffect(() => {
    let active = true;
    Promise.resolve(window.api?.pos?.getHardwareSettings?.()).then((settings) => {
      if (active && settings && typeof settings === "object") {
        setScannerSettings(settings);
        setTerminalHardware(settings);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const terminalBridgeReady = String(terminalHardware.payment_terminal_mode || 'manual').toLowerCase() !== 'manual'
    && Boolean(terminalHardware.payment_terminal_provider)
    && Boolean(terminalHardware.payment_terminal_bridge_url);

  // One steady bridge reference per card payment: a retry after an ambiguous
  // timeout reuses it instead of minting a fresh one, so the machine cannot
  // read the retry as a second charge. Thrown away when the payment ends or
  // the amount/method changes.
  const terminalRequestRef = useRef({ key: null, fingerprint: '' });
  useEffect(() => {
    if (!showPayment) terminalRequestRef.current = { key: null, fingerprint: '' };
  }, [showPayment]);

  const sendTotalToCardMachine = async (amount) => {
    const due = Number(amount);
    if (!Number.isFinite(due) || due <= 0) {
      setTerminalMessage('No amount due to send to the card machine.');
      return;
    }
    setTerminalSending(true);
    setTerminalMessage('');
    try {
      const fingerprint = [paymentMethod, due.toFixed(2), splitCashAmount || '', splitRemainderMethod || ''].join('|');
      let requestId = terminalRequestRef.current.fingerprint === fingerprint ? terminalRequestRef.current.key : null;
      if (!requestId) {
        requestId = window.crypto?.randomUUID
          ? window.crypto.randomUUID()
          : `pos-terminal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        terminalRequestRef.current = { key: requestId, fingerprint };
      }
      const result = await window.api?.pos?.sendPaymentTerminalTotal?.({ amount: due, request_id: requestId });
      if (result?.success) {
        const approval = result.approval_code || result.reference || '';
        if (approval) {
          setPaymentReferences((previous) => {
            const target = paymentMethod === 'split' ? splitRemainderMethod : paymentMethod;
            if (target !== 'card') return previous;
            return { ...previous, card: approval };
          });
        }
        setTerminalMessage(result.message || `Total sent to the card machine${approval ? ` — approval ${approval}` : ''}.`);
      } else {
        setTerminalMessage(result?.error || 'The card machine did not approve the amount.');
      }
    } catch (terminalError) {
      setTerminalMessage(terminalError?.message || 'Could not reach the card machine bridge.');
    } finally {
      setTerminalSending(false);
    }
  };

  useEffect(() => {
    let active = true;
    window.api?.pos?.getPendingPosSubmitAttempt?.()
      .then((attempt) => {
        if (!active) return;
        if (attempt?.success === false) {
          setSubmitError(attempt.error || "Sale recovery is unavailable. Do not create a new sale; contact a manager to reconcile the original attempt.");
          return;
        }
        if (attempt?.resolved) {
          setSubmitNotice(attempt.message || "The original sale was already recorded and has been safely recovered.");
          return;
        }
        if (!attempt?.submitIntentId) return;
        submitEnvelopeRef.current = {
          status: "pending",
          submitIntentId: attempt.submitIntentId,
          orderId: attempt.orderId,
          createdAtClient: attempt.createdAtClient,
          payload: attempt.payload,
        };
        setRecoveredAttempt(attempt);
      })
      .catch((error) => {
        if (active) setSubmitError(error?.message || "Sale recovery is unavailable. Do not create a new sale; contact a manager to reconcile the original attempt.");
      })
      .finally(() => {
        // Basket-restore waits for this: payment recovery always wins over
        // unsent drafts, so restoration must know the recovery outcome first.
        if (active) setRecoveryReady(true);
      });
    return () => { active = false; };
  }, []);

  // Manual re-check: the mount probe does one server lookup (auto-resolving
  // already-recorded sales). Definitive replay failures never reach this
  // banner anymore; this button lets the operator re-run that lookup after
  // checking Sales, clearing the banner without a retry when the server
  // proves there is nothing unresolved.
  const recheckRecovery = useCallback(async () => {
    if (recoveryChecking) return;
    setRecoveryChecking(true);
    try {
      const attempt = await window.api?.pos?.getPendingPosSubmitAttempt?.();
      if (attempt?.success === false) {
        setSubmitError(attempt.error || "Sale recovery is unavailable. Do not create a new sale; contact a manager to reconcile the original attempt.");
        return;
      }
      if (attempt?.resolved) {
        submitEnvelopeRef.current = null;
        setRecoveredAttempt(null);
        setSubmitNotice(attempt.message || "The original sale was already recorded and has been safely recovered.");
        return;
      }
      if (!attempt?.submitIntentId) {
        submitEnvelopeRef.current = null;
        setRecoveredAttempt(null);
        setSubmitNotice("Re-checked Sales: no unresolved earlier sale. You can continue selling.");
        return;
      }
      submitEnvelopeRef.current = {
        status: "pending",
        submitIntentId: attempt.submitIntentId,
        orderId: attempt.orderId,
        createdAtClient: attempt.createdAtClient,
        payload: attempt.payload,
      };
      setRecoveredAttempt(attempt);
    } catch (error) {
      setSubmitError(error?.message || "Sale recovery is unavailable. Do not create a new sale; contact a manager to reconcile the original attempt.");
    } finally {
      setRecoveryChecking(false);
    }
  }, [recoveryChecking]);

  const scannerOptions = useMemo(() => ({
    minLength: Number(scannerSettings.barcode_scanner_min_length) || 4,
    maxLength: Number(scannerSettings.barcode_scanner_max_length) || 128,
    interKeyMs: Number(scannerSettings.barcode_scanner_inter_key_ms) || 120,
    idleCompleteMs: Number(scannerSettings.barcode_scanner_idle_complete_ms) || 180,
    prefix: scannerSettings.barcode_scanner_prefix || "",
    suffix: scannerSettings.barcode_scanner_suffix || "",
    acceptEnter: scannerSettings.barcode_scanner_accept_enter !== false,
    acceptTab: scannerSettings.barcode_scanner_accept_tab !== false,
  }), [scannerSettings]);

  useEffect(() => {
    barcodeDecoderRef.current = createBarcodeScannerDecoder(scannerOptions);
  }, [scannerOptions]);

  const outletRestricted = Array.isArray(allowedOutletIds);
  const outletIsAllowed = useCallback(
    (outletId) =>
      !outletRestricted ||
      (Boolean(outletId) && allowedOutletIds.includes(outletId)),
    [allowedOutletIds, outletRestricted],
  );

  const reportScanner = useCallback((feedback) => {
    if (scannerFeedbackTimerRef.current)
      window.clearTimeout(scannerFeedbackTimerRef.current);
    setScannerFeedback(feedback || null);
    if (feedback) {
      scannerFeedbackTimerRef.current = window.setTimeout(
        () => setScannerFeedback(null),
        feedback.level === "success" ? 2200 : 4200,
      );
    }
  }, []);

  useEffect(
    () => () => {
      if (scannerFeedbackTimerRef.current)
        window.clearTimeout(scannerFeedbackTimerRef.current);
    },
    [],
  );

  const clearTillOperatorState = useCallback(
    ({ showUnlock = false, message = "", notifyMain = true } = {}) => {
      if (notifyMain) void window.api?.pos?.lockSharedTillOperator?.();
      setVerifiedOperator(null);
      setOperatorStaffId("");
      setOperatorPin("");
      setCurrentShift(null);
      setOperatorLastActivityAt(null);
      setTillSessionOutletId(null);
      setTillSessionExpiresAt(null);
      tillActivityLastSentAtRef.current = 0;
      if (message) setSubmitError(message);
      if (showUnlock) setShowOperatorUnlock(true);
    },
    [],
  );

  const registerTillActivity = useCallback(() => {
    if (
      !sharedTerminalMode ||
      !verifiedOperator?.id ||
      !currentShift?.id ||
      tillOperatorPolicy.mode !== TILL_OPERATOR_MODES.SHIFT ||
      showOperatorUnlock ||
      !selectedOutlet?.id
    ) return;
    const timestamp = Date.now();
    if (timestamp - tillActivityLastSentAtRef.current < 10000) return;
    tillActivityLastSentAtRef.current = timestamp;
    void Promise.resolve(window.api?.pos?.touchSharedTillOperator?.({
      outlet_id: selectedOutlet.id,
      staff_id: verifiedOperator.id,
      shift_id: currentShift?.id,
    })).then((result) => {
      if (result?.success && result.session) {
        setOperatorLastActivityAt(result.session.lastActivityAt || timestamp);
        setTillSessionExpiresAt(result.session.expiresAt || null);
        return;
      }
      clearTillOperatorState({
        showUnlock: true,
        message: result?.error || "Till locked. Verify the operator PIN to continue.",
      });
    }).catch((error) => {
      clearTillOperatorState({
        showUnlock: true,
        message: error?.message || "Till activity could not be confirmed. Verify the operator PIN again.",
      });
    });
  }, [clearTillOperatorState, currentShift?.id, selectedOutlet?.id, sharedTerminalMode, showOperatorUnlock, tillOperatorPolicy.mode, verifiedOperator?.id]);

  useEffect(() => {
    if (
      !sharedTerminalMode ||
      !verifiedOperator?.id ||
      tillOperatorPolicy.mode !== TILL_OPERATOR_MODES.SHIFT
    ) return undefined;
    const onActivity = () => registerTillActivity();
    const onVisibilityChange = () => {
      if (!document.hidden) registerTillActivity();
    };
    window.addEventListener("pointerdown", onActivity, true);
    window.addEventListener("touchstart", onActivity, true);
    window.addEventListener("keydown", onActivity, true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pointerdown", onActivity, true);
      window.removeEventListener("touchstart", onActivity, true);
      window.removeEventListener("keydown", onActivity, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [registerTillActivity, sharedTerminalMode, tillOperatorPolicy.mode, verifiedOperator?.id]);

  // Cash tendering is display-only until submit: received/changed amounts
  // never alter the sale allocation (see completeOrder validation).
  useEffect(() => {
    if (!showPayment) setCashReceived("");
  }, [showPayment]);

  // This terminal's last receipt for independent reprinting. Loaded per
  // outlet; historical receipts without tendering aids render allocation
  // only and are never back-filled.
  useEffect(() => {
    if (!selectedOutlet?.id) {
      setLastReceipt(null);
      return;
    }
    setLastReceipt(
      readJsonSetting(lastReceiptKey(lodgeId, selectedOutlet.id)),
    );
  }, [lodgeId, selectedOutlet?.id]);

  useEffect(() => {
    if (!tillEntitlements.canAccounts) setSelectedCustomerId("");
    if (!tillEntitlements.canPromos) setSelectedPromotionId("");
  }, [tillEntitlements]);

  const chooseTerminalOutlet = useCallback(
    (outletId) => {
      if (outletId && !outletIsAllowed(outletId)) {
        reportScanner({
          level: "error",
          code: "outlet_not_allowed",
          message: "You are not authorised to use that outlet.",
        });
        return;
      }
      const outlet =
        outlets.find(
          (row) =>
            row.id === outletId &&
            row.is_active !== false &&
            row.active !== false,
        ) || null;
      if (selectedOutlet?.id && selectedOutlet.id !== outlet?.id && verifiedOperator?.id) {
        clearTillOperatorState({
          message: "Outlet changed. Verify the operator PIN again for the new outlet.",
        });
      }
      setSelectedOutlet(outlet);
      writeTerminalOutletPreference(lodgeId, outlet?.id || null);
    },
    [clearTillOperatorState, lodgeId, outletIsAllowed, outlets, reportScanner, selectedOutlet?.id, verifiedOperator?.id],
  );

  // Keep service mode valid when hospitality mode flips (e.g. settings change).
  useEffect(() => {
    const allowed = new Set(serviceModeOptions.map((m) => m.id));
    if (!allowed.has(serviceMode)) {
      // A resumed tab prefers the tab mode when the package offers it, so a
      // bar resume never corrects to counter and orphans the open tab.
      setServiceMode(
        location.state?.tabId && allowed.has("tab")
          ? "tab"
          : getDefaultHposServiceMode(barOnly),
      );
    }
  }, [barOnly, serviceMode, serviceModeOptions]);

  useEffect(() => {
    if (!canUseVoucher) {
      setVoucherCode("");
      setVoucherAmount("");
    }
    if (!canUseTips) setTipAmount("");
  }, [canUseTips, canUseVoucher]);

  // Voucher entry is only offered for walk-up counter sales (see the tender
  // row render condition). Clear stale values when the sale moves somewhere
  // vouchers cannot apply, so a hidden code can never flow into the tender
  // breakdown on submit.
  useEffect(() => {
    if (
      serviceMode === "tab" ||
      serviceMode === "table" ||
      Boolean(selectedCustomerId)
    ) {
      setVoucherCode("");
      setVoucherAmount("");
    }
  }, [serviceMode, selectedCustomerId]);

  const draftOperatorId = verifiedOperator?.id || user?.id || null;
  // Recovery initialization must complete before draft persistence runs:
  // otherwise a mount with an empty cart deletes the very draft the restore
  // check is about to read. The write effect below waits for this flag.
  const [recoveryInitialized, setRecoveryInitialized] = useState(false);
  const [draftPersistFailed, setDraftPersistFailed] = useState(false);

  // Persist unsent baskets durably so an accidental navigation, crash or
  // reload can offer explicit restoration. Writes are scoped to
  // tenant/outlet/operator/shift; an empty basket removes its draft. Never
  // runs before recovery initialization (see above).
  useEffect(() => {
    if (loading || !recoveryInitialized || !selectedOutlet?.id || !draftOperatorId) return;
    const key = basketDraftKey(lodgeId, selectedOutlet.id, draftOperatorId, currentShift?.id);
    if (!cart.length) {
      writeJsonSetting(key, null);
      return;
    }
    if (!writeJsonSetting(key, {
      v: 1,
      savedAt: Date.now(),
      shiftId: currentShift?.id || null,
      serviceMode,
      tabName,
      tableName,
      customerId: selectedCustomerId || null,
      lines: cart,
    })) {
      setDraftPersistFailed(true);
    }
  }, [loading, recoveryInitialized, cart, serviceMode, tabName, tableName, selectedCustomerId, selectedOutlet?.id, draftOperatorId, currentShift?.id, lodgeId]);

  // One-shot crash reconciliation. Precedence is strict: a resumed tab wins
  // over everything, then pending payment recovery, then an unconsumed hold
  // intent (matched by server tab identity), and only then an unsent draft.
  useEffect(() => {
    if (loading || !recoveryReady || !outletReady || restoreCheckedRef.current) return;
    restoreCheckedRef.current = true;
    const finish = () => setRecoveryInitialized(true);
    if (location.state?.tabId) {
      finish();
      return;
    }
    if (recoveredAttempt || submitEnvelopeRef.current?.status === "pending") {
      finish();
      return;
    }
    if (!selectedOutlet?.id || !draftOperatorId) {
      finish();
      return;
    }
    const intentKey = holdIntentKey(lodgeId, selectedOutlet.id, draftOperatorId);
    const intent = readJsonSetting(intentKey);
    if (intent && intent.outletId === selectedOutlet.id) {
      const decision = reconcileHoldIntent(intent, openTabsBrief);
      if (decision.outcome === "confirmed") {
        writeJsonSetting(intentKey, null);
        setSuccessMessage(`“${decision.tab.name || "Open tab"}” was held before the interruption. Resume it from Open tabs.`);
        finish();
        return;
      }
      if (decision.outcome === "expired") {
        writeJsonSetting(intentKey, null);
      }
      // Unknown outcomes preserve the intent: the hold may still have
      // committed. Restoration below offers the draft without deleting the
      // intent, and a later mount reconciles by tab id again.
    }
    const scopeKey = basketDraftKey(lodgeId, selectedOutlet.id, draftOperatorId, currentShift?.id);
    const draft = readJsonSetting(scopeKey);
    if (!isDraftFresh(draft)) {
      if (draft) writeJsonSetting(scopeKey, null);
      finish();
      return;
    }
    setPendingRestore({ draft, scope: scopeKey, intentKey: intent ? intentKey : null });
    finish();
  }, [loading, recoveryReady, outletReady, selectedOutlet?.id, currentShift?.id, draftOperatorId, lodgeId, openTabsBrief, recoveredAttempt]);

  const discardRestore = useCallback(() => {
    // Explicit discard drops both the draft and any unconfirmed hold intent:
    // the operator has seen the state and chosen to let it go.
    if (pendingRestore?.scope) writeJsonSetting(pendingRestore.scope, null);
    if (pendingRestore?.intentKey) writeJsonSetting(pendingRestore.intentKey, null);
    setPendingRestore(null);
  }, [pendingRestore]);

  const applyRestore = useCallback(() => {
    if (!pendingRestore?.draft) return;
    const { draft, scope } = pendingRestore;
    const { lines, dropped, repriced } = revalidateBasketLines(draft.lines, menuItems);
    const allowedModes = new Set(serviceModeOptions.map((mode) => mode.id));
    setServiceMode(allowedModes.has(draft.serviceMode) ? draft.serviceMode : getDefaultHposServiceMode(barOnly));
    setTabName(typeof draft.tabName === "string" ? draft.tabName : "");
    setTableName(typeof draft.tableName === "string" ? draft.tableName : "");
    if (draft.customerId && customers.some((customer) => customer.id === draft.customerId)) {
      setSelectedCustomerId(draft.customerId);
    }
    setCart(lines);
    writeJsonSetting(scope, null);
    setPendingRestore(null);
    const notes = [];
    if (dropped > 0) notes.push(`${dropped} unavailable item${dropped === 1 ? " was" : "s were"} removed`);
    if (repriced > 0) notes.push("prices were refreshed to the current catalogue");
    setSuccessMessage(
      `Unsent basket restored.${notes.length ? ` Note: ${notes.join("; ")}.` : ""}`,
    );
  }, [pendingRestore, menuItems, serviceModeOptions, barOnly, customers]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setLoadingStage("menu, stock and team");
      setMenuLoadFailed(false);
      try {
        const [
          data,
          outletRows,
          customerRows,
          promotionRows,
          tabRows,
          recipeRows,
          staffRows,
          readinessResult,
        ] = await Promise.all([
          window.api?.pos?.getMenuItems?.() ?? [],
          window.api?.outlets?.getAll?.() ?? [],
          tillEntitlements.canAccounts ? (window.api?.pos?.getCustomers?.() ?? []) : [],
          tillEntitlements.canPromos ? (window.api?.pos?.getPromotions?.() ?? []) : [],
          // Same authoritative read as Open Tabs, Cash & close and the rail
          // badge: active-filtered server truth plus pending local estimates.
          // An unfiltered read would also merge non-pending local orphans and
          // inflate this count past what Open Tabs shows.
          window.api?.pos?.getTabs?.({ status: "active" }) ?? [],
          // Recipes are an entitled capability: base Bar loads server
          // readiness instead (outcome only, no disclosure).
          !barOnly || canUseRecipes ? (window.api?.pos?.getRecipes?.() ?? []) : [],
          window.api?.pos?.getStaff?.() ?? [],
          window.api?.pos?.getMenuStockReadiness?.() ?? { success: false },
        ]);
        if (!active) return;
        setMenuItems(Array.isArray(data) ? data : []);
        // Approved cached readiness: a failed read falls back to last
        // verified data (labeled stale); with no cache selling blocks.
        const readinessCache = readJsonSetting(readinessCacheKey(lodgeId));
        const resolved = resolveReadinessState(readinessResult, readinessCache);
        if (resolved.status === "ready") {
          writeJsonSetting(readinessCacheKey(lodgeId), {
            at: Date.now(),
            rows: Array.isArray(readinessResult.rows) ? readinessResult.rows : [],
          });
        }
        if (resolved.status === "ready" || resolved.status === "stale") {
          // Same unsent-sales adjustment as refreshReadiness: the other
          // till's mesh-imported sales count from the first paint.
          // Promise.resolve: if this IPC binding is ever missing, resolve
          // empty instead of throwing and trapping the Till in "loading".
          const base = { status: resolved.status, map: resolved.map, counts: resolved.counts, cachedAt: resolved.cachedAt || null };
          Promise.resolve(window.api?.pos?.getUnconfirmedPosUsage?.()).then((usageResult) => {
            if (!active) return;
            const usage = usageResult?.usage && typeof usageResult.usage === 'object' ? usageResult.usage : {};
            const orderCount = Number(usageResult?.orderCount || 0);
            const meshOrderCount = Number(usageResult?.meshOrderCount || 0);
            const meshDeliveryCount = Number(usageResult?.meshDeliveryCount || 0);
            if (!(orderCount > 0)) {
              setStockReadiness({ ...base, pendingOrders: 0, meshOrders: 0, meshDeliveries: 0 });
              return;
            }
            const counts = new Map();
            for (const [id, entry] of base.counts || []) {
              const used = Number(usage[id] || 0);
              counts.set(id, used ? { ...entry, qty: Number(entry?.qty || 0) - used } : entry);
            }
            setStockReadiness({ ...base, counts, pendingOrders: orderCount, meshOrders: meshOrderCount, meshDeliveries: meshDeliveryCount });
          }).catch(() => {
            if (active) setStockReadiness({ ...base, pendingOrders: 0, meshOrders: 0, meshDeliveries: 0 });
          });
        } else {
          // First paint with no verified data: same local fallback so the
          // bar can sell immediately instead of pausing on an empty check.
          const fallbackRows = Array.isArray(data) ? data : [];
          const fallbackRecipes = new Set(
            (Array.isArray(recipeRows) ? recipeRows : [])
              .filter((recipe) => recipe.menu_item_id && (recipe.ingredients || []).some((ingredient) => Number(ingredient.quantity || 0) > 0))
              .map((recipe) => recipe.menu_item_id),
          );
          const invResult = await Promise.resolve(window.api?.inventory?.getItems?.()).catch(() => []);
          const invRows = Array.isArray(invResult) ? invResult : (Array.isArray(invResult?.rows) ? invResult.rows : (Array.isArray(invResult?.items) ? invResult.items : []));
          const stockById = new Map();
          for (const row of invRows) {
            const qty = Number(row?.current_stock);
            if (row?.id && Number.isFinite(qty)) stockById.set(String(row.id), qty);
          }
          const fallbackMap = new Map();
          const fallbackCounts = new Map();
          for (const item of fallbackRows) {
            if (!item?.id) continue;
            if (String(item.stock_method || '').toLowerCase() === 'non_stock') { fallbackMap.set(item.id, 'non_stock'); continue; }
            if (fallbackRecipes.has(item.id)) { fallbackMap.set(item.id, 'recipe'); continue; }
            const stockId = String(item.inventory_item_id || '').trim();
            if (!stockId || !stockById.has(stockId)) continue;
            fallbackMap.set(item.id, 'direct');
            fallbackCounts.set(item.id, { qty: stockById.get(stockId) });
          }
          if (fallbackCounts.size > 0) {
            const base = { status: "local", map: fallbackMap, counts: fallbackCounts, cachedAt: null };
            const usageResult = await Promise.resolve(window.api?.pos?.getUnconfirmedPosUsage?.()).catch(() => null);
            if (!active) return;
            const usage = usageResult?.usage && typeof usageResult.usage === 'object' ? usageResult.usage : {};
            const adjusted = new Map();
            for (const [id, entry] of base.counts) {
              const used = Number(usage[id] || 0);
              adjusted.set(id, used ? { ...entry, qty: Number(entry?.qty || 0) - used } : entry);
            }
            setStockReadiness({
              ...base, counts: adjusted,
              pendingOrders: Number(usageResult?.orderCount || 0),
              meshOrders: Number(usageResult?.meshOrderCount || 0),
              meshDeliveries: Number(usageResult?.meshDeliveryCount || 0),
            });
          } else {
            if (!active) return;
            setStockReadiness({ status: "failed", map: new Map(), counts: new Map(), error: resolved.error || null, code: resolved.code || null });
          }
        }
        setRecipeMenuItemIds(
          new Set(
            (Array.isArray(recipeRows) ? recipeRows : [])
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
        const nextOutlets = Array.isArray(outletRows) ? outletRows : [];
        setOutlets(nextOutlets);
        const resumedTab = (Array.isArray(tabRows) ? tabRows : []).find(
          (tab) => tab.id === location.state?.tabId,
        );
        setOpenTabNames(
          Array.from(
            new Set(
              (Array.isArray(tabRows) ? tabRows : [])
                .map((tab) =>
                  String(
                    tab?.tab_name || tab?.table_name || tab?.customer_name || "",
                  ).trim(),
                )
                .filter(Boolean),
            ),
          ).slice(0, 50),
        );
        setOpenTabCount(
          (Array.isArray(tabRows) ? tabRows : []).filter(
            (tab) =>
              // Same explicit active set as the domain (open/running/ready/
              // delivered): rows with a missing/unknown status must not count
              // as open and resurrect the stale "10 tabs" pill.
              ["open", "running", "ready", "delivered"].includes(
                String(tab.status || "").toLowerCase(),
              ),
          ).length,
        );
        // Brief snapshots for crash reconciliation (matched by tab identity,
        // never by line contents) and outlet-scoped suggestions.
        setOpenTabsBrief(
          (Array.isArray(tabRows) ? tabRows : [])
            .filter(
              (tab) =>
                ["open", "running", "ready", "delivered"].includes(
                  String(tab.status || "").toLowerCase(),
                ),
            )
            .map((tab) => ({
              id: tab?.id || null,
              name: String(tab?.tab_name || tab?.table_name || tab?.customer_name || "").trim(),
              outlet_id: tab?.outlet_id || null,
              updated_at: tab?.updated_at || tab?.created_at || null,
            }))
            .filter((tab) => tab.id && tab.name),
        );
        const activeOutlets = nextOutlets.filter(
          (outlet) =>
            outlet.is_active !== false &&
            outlet.active !== false &&
            outletIsAllowed(outlet.id),
        );
        const resumedOutlet =
          activeOutlets.find((outlet) => outlet.id === resumedTab?.outlet_id) ||
          null;
        const preferredOutletId = readTerminalOutletPreference(lodgeId);
        const preferredOutlet =
          activeOutlets.find((outlet) => outlet.id === preferredOutletId) ||
          null;
        // A tab always opens in its recorded outlet. Otherwise this computer's
        // local preference removes a repetitive selection step without changing
        // another terminal or becoming a server-side business setting.
        setSelectedOutlet(
          resumedOutlet || preferredOutlet || activeOutlets[0] || null,
        );
        if (preferredOutletId && !preferredOutlet)
          writeTerminalOutletPreference(lodgeId, null);
        setCustomers(Array.isArray(customerRows) ? customerRows : []);
        setPromotions(Array.isArray(promotionRows) ? promotionRows : []);
        setServiceStaff(
          (Array.isArray(staffRows) ? staffRows : []).filter(
            (row) =>
              !["suspended", "inactive"].includes(
                String(row.status || "active").toLowerCase(),
              ),
          ),
        );
        if (resumedTab) {
          setTableName(resumedTab.table_name || "");
          setTabName(resumedTab.tab_name || resumedTab.customer_name || "");
          // Bar tabs always carry table_name, so only restaurant resumes use
          // the table mode. A bar resume must stay on tab or the payment
          // records a counter sale and leaves the tab open.
          setServiceMode(
            resumedTab.table_name && !barOnly ? "table" : "tab",
          );
          setSelectedCustomerId(resumedTab.customer_id || "");
          setCart(
            (Array.isArray(resumedTab.items) ? resumedTab.items : []).map(
              (item, index) => ({
                ...item,
                id: item.id || `${resumedTab.id}-${index}`,
                menu_item_id: item.menu_item_id || item.id || null,
                item_name: item.item_name || item.name || "Item",
                unit_price: Number(item.unit_price || item.price || 0),
                quantity: Number(item.quantity || 1),
                modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
                modifier_total: Number(item.modifier_total || 0),
                template_kind: item.template_kind || null,
                template_pack_size: item.template_pack_size || null,
              }),
            ),
          );
          // Identity header for the resumed tab. The version decides the
          // copy: a missing version means the tab changed underneath this
          // sale and must be re-opened; this never blocks by itself because
          // the payment path still fails closed through the domain.
          const resumedVersion = location.state?.tabVersion
            ?? resumedTab.tab_version
            ?? resumedTab.version
            ?? null;
          setResumedTabInfo({
            id: resumedTab.id || location.state?.tabId || null,
            name:
              resumedTab.tab_name ||
              resumedTab.table_name ||
              resumedTab.customer_name ||
              "Open tab",
            waiter: resumedTab.waiter_name || resumedTab.opened_by_name || null,
            found: true,
            versionOk:
              resumedVersion !== null &&
              resumedVersion !== undefined &&
              Number(resumedVersion) > 0,
          });
          if (
            location.state?.settle === true &&
            Array.isArray(resumedTab.items) &&
            resumedTab.items.length > 0
          ) {
            setShowPayment(true);
          }
          setSuccessMessage(
            `${resumedTab.table_name || resumedTab.tab_name || "Open check"} loaded.`,
          );
        } else if (location.state?.tabId) {
          // A resume link whose tab is no longer in the list: say so plainly
          // instead of rendering a silent counter sale.
          setResumedTabInfo({
            id: location.state.tabId,
            name: location.state?.tabName || location.state?.tableName || "Open tab",
            waiter: null,
            found: false,
            versionOk: false,
          });
        }
        if (active) setLoadingStage("sale options");
        const groups = (await window.api?.pos?.getModifierGroups?.()) ?? [];
        if (active) {
          setModifierGroups(Array.isArray(groups) ? groups : []);
          setModifiersReady("ready");
        }
      } catch (error) {
        if (active) {
          setMenuLoadFailed(true);
          setModifiersReady("failed");
          setStockReadiness({ status: "failed", map: new Map() });
          setSubmitError(
            "Could not load the POS service data. Please refresh.",
          );
        }
      }
      if (active) setLoading(false);
    };
    load();
    return () => {
      active = false;
    };
  }, [location.state?.tabId, outletIsAllowed, barOnly, canUseRecipes, tillEntitlements, coreLoadNonce]);

  const retryCoreLoad = useCallback(() => {
    setMenuLoadFailed(false);
    setSubmitError("");
    setLoading(true);
    setCoreLoadNonce((nonce) => nonce + 1);
  }, []);

  useEffect(() => {
    // The Till pill ("Open tabs · N") must never drift from Open Tabs: that
    // page re-reads every 15s, while this count was previously set once at
    // mount. Refresh the same active-filtered read on the same cadence (plus
    // on return to the tab) so a tab settled elsewhere stops counting here.
    // Count/brief/names use the exact predicates as the initial load above.
    let active = true;
    const isOpenTabRow = (tab) =>
      ["open", "running", "ready", "delivered"].includes(
        String(tab.status || "").toLowerCase(),
      );
    const refreshOpenTabs = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const rows = (await window.api?.pos?.getTabs?.({ status: "active" })) ?? [];
        if (!active || !Array.isArray(rows)) return;
        const open = rows.filter(isOpenTabRow);
        setOpenTabCount(open.length);
        setOpenTabsBrief(
          open
            .map((tab) => ({
              id: tab?.id || null,
              name: String(tab?.tab_name || tab?.table_name || tab?.customer_name || "").trim(),
              outlet_id: tab?.outlet_id || null,
              updated_at: tab?.updated_at || tab?.created_at || null,
            }))
            .filter((tab) => tab.id && tab.name),
        );
        setOpenTabNames(
          Array.from(
            new Set(
              open
                .map((tab) =>
                  String(tab?.tab_name || tab?.table_name || tab?.customer_name || "").trim(),
                )
                .filter(Boolean),
            ),
          ).slice(0, 50),
        );
      } catch {
        /* A failed refresh keeps the last-known count; Open Tabs owns loud errors. */
      }
    };
    const interval = setInterval(refreshOpenTabs, 15000);
    const handleVisible = () => {
      if (document.visibilityState === "visible") refreshOpenTabs();
    };
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, []);

  useEffect(() => {
    // Drawer gate pill: shared outlet with no open (or correction) period.
    // Same 15s + visibility cadence as the open-tabs pill. A failed read
    // hides the banner; the domain remains the backstop at Pay.
    let active = true;
    const refreshDrawerGate = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const outletId = selectedOutlet?.id || null;
        if (!outletId) {
          if (active) setDrawerGateNeeded(false);
          return;
        }
        const outlet = outlets.find(
          (row) => String(row?.id || "") === String(outletId),
        );
        if (outlet?.cash_model !== "shared_drawer") {
          if (active) setDrawerGateNeeded(false);
          return;
        }
        const state = await window.api?.pos?.getDrawerPeriodState?.(outletId);
        if (!active) return;
        const period = state?.period || null;
        setDrawerGateNeeded(
          !period || !["open", "rejected"].includes(String(period.status || "")),
        );
      } catch {
        /* A failed refresh hides the banner; the domain still refuses at Pay. */
      }
    };
    refreshDrawerGate();
    const interval = setInterval(refreshDrawerGate, 15000);
    const handleVisible = () => {
      if (document.visibilityState === "visible") refreshDrawerGate();
    };
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [selectedOutlet?.id, outlets]);

  useEffect(() => {
    // Low-stock badges load idle after opening, never in the critical path.
    // Denied or failed reads resolve to no badges; selling never waits.
    if (!barOnly) return;
    let active = true;
    const loadLowStock = async () => {
      try {
        const rows = await window.api?.inventory?.getLowStock?.() ?? [];
        if (!active || !Array.isArray(rows)) return;
        const map = {};
        rows.forEach((row) => {
          if (!row?.id) return;
          map[String(row.id)] = {
            qty: Number(row.current_stock || 0),
            unit: String(row.unit || "each"),
          };
        });
        if (active) setLowStockMap(map);
      } catch {
        /* Badges stay hidden; the Stock page remains the source of truth. */
      }
    };
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(() => loadLowStock(), { timeout: 4000 });
      return () => {
        active = false;
        window.cancelIdleCallback?.(handle);
      };
    }
    const timer = window.setTimeout(() => loadLowStock(), 1500);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [barOnly, selectedOutlet?.id, lodgeId]);

  useEffect(() => {
    if (!selectedOutlet?.id) {
      setTables([]);
      setCurrentShift(null);
      setOutletReady(true);
      return;
    }
    let active = true;
    const shiftCashierId = sharedTerminalMode && verifiedOperator?.id
      ? verifiedOperator.id
      : user?.id || null;
    // Bar-only service has no floor tables, so that read is skipped there to
    // keep Till startup fast. The current-shift read is independent and always
    // runs: Bar must still load the correct operator/outlet shift.
    const tablePromise = shouldLoadTillTables(barOnly)
      ? (window.api?.pos?.getTablesWithStatus?.(selectedOutlet.id) ?? [])
      : Promise.resolve([]);
    Promise.all([
      tablePromise,
      window.api?.pos?.getCurrentShift?.(selectedOutlet.id, shiftCashierId) ??
        null,
    ])
      .then(([tableRows, shift]) => {
        if (!active) return;
        setTables(Array.isArray(tableRows) ? tableRows : []);
        setCurrentShift(shift || null);
        setOutletReady(true);
      })
      .catch(() => {
        if (active) {
          setOutletReady(true);
          setSubmitError(
            barOnly
              ? "Could not load the current shift. Please refresh."
              : "Could not load tables or the current shift. Please refresh.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [selectedOutlet?.id, sharedTerminalMode, user?.id, verifiedOperator?.id, barOnly]);

  // The authoritative Shift-mode session lives in the main process, not in
  // this route component. Rehydrate its original expiry after navigation or
  // remount, using a read-only IPC path that never touches/extends the lease.
  useEffect(() => {
    if (
      !sharedTerminalMode ||
      !selectedOutlet?.id ||
      tillOperatorPolicy.mode !== TILL_OPERATOR_MODES.SHIFT
    ) return undefined;
    let active = true;
    Promise.resolve(window.api?.pos?.getSharedTillOperatorSession?.({
      outlet_id: selectedOutlet.id,
    }))
      .then((result) => {
        if (!active || !result?.success || !result.session) return;
        const session = result.session;
        setVerifiedOperator({ id: session.staffId, name: session.staffName || "Till operator" });
        setOperatorStaffId(session.staffId || "");
        if (result.shift?.id) setCurrentShift(result.shift);
        setTillSessionOutletId(session.outletId || null);
        setTillSessionExpiresAt(session.expiresAt || null);
        setOperatorLastActivityAt(session.lastActivityAt || null);
        setOperatorPin("");
        setShowOperatorUnlock(false);
      })
      .catch(() => {
        // A failed restore is intentionally silent here; the normal unlock
        // dialog remains the only recovery path and no lease is renewed.
      });
    return () => { active = false; };
  }, [selectedOutlet?.id, sharedTerminalMode, tillOperatorPolicy.mode]);

  useEffect(() => {
    if (!sharedTerminalMode || !verifiedOperator?.id || tillOperatorPolicy.mode !== TILL_OPERATOR_MODES.SHIFT || !tillSessionExpiresAt) return undefined;
    const remainingMs = Math.max(0, Number(tillSessionExpiresAt) - Date.now());
    const timer = window.setTimeout(() => {
      clearTillOperatorState({
        showUnlock: true,
        message: `Till locked after ${tillOperatorPolicy.inactivityMinutes} minutes of inactivity. Verify the operator PIN to continue.`,
      });
    }, remainingMs);
    return () => window.clearTimeout(timer);
  }, [clearTillOperatorState, sharedTerminalMode, tillOperatorPolicy.inactivityMinutes, tillOperatorPolicy.mode, tillSessionExpiresAt, verifiedOperator?.id]);

  useEffect(() => {
    if (
      verifiedOperator?.id &&
      tillSessionOutletId &&
      selectedOutlet?.id &&
      tillSessionOutletId !== selectedOutlet.id
    ) {
      clearTillOperatorState({
        message: "Outlet changed. Verify the operator PIN again for the new outlet.",
      });
    }
  }, [clearTillOperatorState, selectedOutlet?.id, tillSessionOutletId, verifiedOperator?.id]);

  const verifySharedOperator = async () => {
    if (!operatorStaffId || !operatorPin || !selectedOutlet?.id || operatorBusy)
      return;
    setOperatorBusy(true);
    setSubmitError("");
    try {
      const activated = await window.api?.pos?.activateSharedTillOperator?.({
        staff_id: operatorStaffId,
        outlet_id: selectedOutlet.id,
        pin: operatorPin,
        idempotency_key: crypto.randomUUID(),
      });
      if (!activated?.success)
        throw new Error(
          activated?.error || "Could not unlock Till for this staff member.",
        );
      const operator =
        activated.staff ||
        serviceStaff.find((row) => row.id === operatorStaffId) ||
        null;
      const shift = activated.shift || null;
      if (!shift?.id)
        throw new Error(
          "The staff Till shift could not be confirmed. Refresh Till and try again.",
        );
      const session = activated.session || {};
      setVerifiedOperator(operator);
      setCurrentShift(shift);
      setTillSessionOutletId(session.outletId || session.outlet_id || selectedOutlet.id);
      setTillSessionExpiresAt(session.expiresAt || session.expires_at || null);
      setOperatorLastActivityAt(session.lastActivityAt || session.last_activity_at || Date.now());
      tillActivityLastSentAtRef.current = 0;
      setOperatorPin("");
      setShowOperatorUnlock(false);
      setSuccessMessage(
        activated.offline
          ? `${operator?.name || "Staff member"} is verified from the local staff record. The Till shift is safely queued and sales remain provisional until sync.`
          : tillOperatorPolicy.mode === TILL_OPERATOR_MODES.SHIFT
          ? `${operator?.name || "Staff member"} is verified for this shift. Till will lock after ${tillOperatorPolicy.inactivityMinutes} minutes of inactivity.`
          : `${operator?.name || "Staff member"} is verified and ready to use Till for the next order.`,
      );
    } catch (error) {
      clearTillOperatorState({ notifyMain: false });
      setSubmitError(error?.message || "Could not activate this staff member.");
    } finally {
      setOperatorBusy(false);
    }
  };

  // Archived menu items remain in history only. They must never be offered,
  // scanned, or returned by a category filter at Till.
  const tillMenuItems = useMemo(
    () => menuItems.filter((item) => !item.archived_at),
    [menuItems],
  );
  // Provisional products (saved offline, not yet confirmed by the server)
  // sell at the Till while the server is unreachable, at their entered
  // price and clearly marked. Once the server is reachable again
  // (readiness fresh) they block with "Syncing" until the replay lands.
  const isProvisionalMenuItem = (item) =>
    String(item?.id || "").startsWith("pending:") || Boolean(item?._operation_key);
  const isProvisionalBlocked = useCallback((item) => {
    if (!isProvisionalMenuItem(item)) return false;
    return stockReadiness.status === "ready";
  }, [stockReadiness]);
  const hasStockSetupIssue = useCallback(
    (item) => {
      if (String(item?.stock_method || "").toLowerCase() === "non_stock") return false;
      const hasDirectStock = Boolean(item.inventory_item_id);
      const hasRecipeStock = recipeMenuItemIds.has(item.id);
      return hasDirectStock === hasRecipeStock;
    },
    [recipeMenuItemIds],
  );

  // Stock-readiness decision per sellable: ok | issue | unknown.
  // Bar-only trusts the server readiness map only (recipes are entitled and
  // often unloadable there); restaurant keeps the established
  // recipe-membership inference. Stale approved cache still decides (labeled
  // in the banner); unknown never renders as ready or sold out.
  // Provisional (offline-created, unconfirmed) rows report 'provisional':
  // callers sell them while the server is unreachable and block them with a
  // syncing message once readiness is fresh again.
  const getStockIssue = useCallback(
    (item) => {
      if (isProvisionalMenuItem(item)) return "provisional";
      if (String(item?.stock_method || "").toLowerCase() === "non_stock") return "ok";
      if (!barOnly) return hasStockSetupIssue(item) ? "issue" : "ok";
      if (stockReadiness.status !== "ready" && stockReadiness.status !== "stale" && stockReadiness.status !== "local") return "unknown";
      const readiness = stockReadiness.map.get(item?.id);
      if (readiness === "direct" || readiness === "recipe" || readiness === "non_stock") return "ok";
      if (readiness === "missing" || readiness === "conflict") return "issue";
      return "unknown";
    },
    [barOnly, hasStockSetupIssue, stockReadiness],
  );

  // Counted on-hand per sellable from readiness rows (direct items only).
  // Missing counts (old server, recipe, non-stock) keep today's behavior;
  // the server remains the backstop at Pay.
  const salesLeftForCount = useCallback((menuItemId, depletionQty) => {
    const entry = stockReadiness.counts?.get(menuItemId);
    if (!entry) return null;
    const qty = Number(entry.qty);
    const perSale = Number(depletionQty || 1);
    if (!Number.isFinite(qty) || !Number.isFinite(perSale) || perSale <= 0) return null;
    return Math.floor(qty / perSale + 1e-9);
  }, [stockReadiness]);
  const onHandRefusal = useCallback((menuItemId, depletionQty, itemName, newQty, category = null) => {
    // Pool tables are box cash, never counted stock — even a table product
    // created long ago with a stock link must keep selling. (Recreate it as
    // Pool/no-stock when convenient; the server path stays cash-only.)
    if (isPoolCategory(category)) return null;
    const left = salesLeftForCount(menuItemId, depletionQty);
    if (left === null) return null;
    if (left < 1) return `${itemName || "Product"} is finished — out of stock. Receive stock first.`;
    if (Number(newQty) > left) return `Only ${left} ${itemName || "product"} left in stock.`;
    return null;
  }, [salesLeftForCount]);
  const isFinishedStock = useCallback((item) => {
    if (isPoolCategory(item?.category)) return false;
    const left = salesLeftForCount(item?.id, item?.depletion_qty || 1);
    return left !== null && left < 1;
  }, [salesLeftForCount]);
  // Provisional rows (saved offline) sell while the server is unreachable.
  // Once readiness is fresh the server is back and the replay owns them, so
  // new taps wait for the sync instead of failing at Pay.
  const provisionalBlock = useCallback((item) => {
    if (getStockIssue(item) !== "provisional") return null;
    if (stockReadiness.status === "ready") {
      return `${item?.name || "Product"} is still syncing. Sell it after the sync lands.`;
    }
    return null;
  }, [getStockIssue, stockReadiness]);

  // Unsent sales on this computer — own queued sales plus sales imported
  // from the other till over mesh — are subtracted from the counts so two
  // tills selling the last bottles fail closed early ("Finished") instead of
  // over-selling. Server-confirmed sales are never double-counted: success
  // removes queue rows, and the Pay-time server check remains the backstop.
  const applyPendingUsage = useCallback(async (base) => {
    try {
      const usageResult = await Promise.resolve(window.api?.pos?.getUnconfirmedPosUsage?.()).catch(() => null);
      const usage = usageResult?.usage && typeof usageResult.usage === 'object' ? usageResult.usage : {};
      const orderCount = Number(usageResult?.orderCount || 0);
      const meshOrderCount = Number(usageResult?.meshOrderCount || 0);
      const meshDeliveryCount = Number(usageResult?.meshDeliveryCount || 0);
      if (!(orderCount > 0)) {
        setStockReadiness({ ...base, pendingOrders: 0, meshOrders: 0, meshDeliveries: 0 });
        return;
      }
      const counts = new Map();
      for (const [id, entry] of base.counts || []) {
        const used = Number(usage[id] || 0);
        counts.set(id, used ? { ...entry, qty: Number(entry?.qty || 0) - used } : entry);
      }
      setStockReadiness({ ...base, counts, pendingOrders: orderCount, meshOrders: meshOrderCount, meshDeliveries: meshDeliveryCount });
    } catch {
      setStockReadiness({ ...base, pendingOrders: 0, meshOrders: 0, meshDeliveries: 0 });
    }
  }, []);

  // Last-known stock from this computer when the server check fails: the
  // inventory cache is server-seeded and locally adjusted by own + mesh
  // sales, deliveries, and counts. Labeled "local", never verified — but the
  // bar keeps selling on it instead of pausing. Unknown items stay out of the
  // map so their cards ask for Refresh rather than guessing.
  const buildLocalFallback = useCallback(async (menuList, recipeIds) => {
    try {
      const invResult = await Promise.resolve(window.api?.inventory?.getItems?.()).catch(() => []);
      const invRows = Array.isArray(invResult)
        ? invResult
        : (Array.isArray(invResult?.rows) ? invResult.rows : (Array.isArray(invResult?.items) ? invResult.items : []));
      if (invRows.length === 0) return null;
      const stockById = new Map();
      for (const row of invRows) {
        const qty = Number(row?.current_stock);
        if (row?.id && Number.isFinite(qty)) stockById.set(String(row.id), qty);
      }
      if (stockById.size === 0) return null;
      const map = new Map();
      const counts = new Map();
      for (const item of menuList || []) {
        if (!item?.id) continue;
        if (String(item.stock_method || '').toLowerCase() === 'non_stock') { map.set(item.id, 'non_stock'); continue; }
        if (recipeIds && recipeIds.has && recipeIds.has(item.id)) { map.set(item.id, 'recipe'); continue; }
        const stockId = String(item.inventory_item_id || '').trim();
        if (!stockId || !stockById.has(stockId)) continue;
        map.set(item.id, 'direct');
        counts.set(item.id, { qty: stockById.get(stockId) });
      }
      if (counts.size === 0) return null;
      return { map, counts };
    } catch {
      return null;
    }
  }, []);

  // Safety net: the Till must never sit in "loading" forever with no
  // recourse. If the first check hasn't resolved in 20s, fail loudly so the
  // Refresh button appears instead of a frozen screen.
  useEffect(() => {
    if (stockReadiness.status !== "loading") return undefined;
    const timer = window.setTimeout(() => {
      setStockReadiness((current) => current.status === "loading"
        ? { status: "failed", map: new Map(), counts: new Map(), pendingOrders: 0, meshOrders: 0, meshDeliveries: 0, error: "Stock check timed out. Press Refresh.", code: "timeout" }
        : current);
    }, 20000);
    return () => window.clearTimeout(timer);
  }, [stockReadiness.status]);

  const refreshReadiness = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setStockReadiness((current) => ({ status: "loading", map: new Map(), counts: new Map(), cachedAt: null }));
    if (!silent) setSubmitError("");
    try {
      const result = await window.api?.pos?.getMenuStockReadiness?.();
      const resolved = resolveReadinessState(result, readJsonSetting(readinessCacheKey(lodgeId)));
      if (resolved.status === "ready") {
        writeJsonSetting(readinessCacheKey(lodgeId), {
          at: Date.now(),
          rows: Array.isArray(result.rows) ? result.rows : [],
        });
        await applyPendingUsage({ status: "ready", map: resolved.map, counts: resolved.counts, cachedAt: null });
      } else if (resolved.status === "stale") {
        await applyPendingUsage({ status: "stale", map: resolved.map, counts: resolved.counts, cachedAt: resolved.cachedAt });
      } else {
        // Server check failed: fall back to this till's last-known stock so
        // the bar keeps selling, clearly labeled. Only a truly empty
        // computer (no stock data at all) still pauses selling.
        const fallback = await buildLocalFallback(menuItems, recipeMenuItemIds);
        if (fallback) {
          await applyPendingUsage({ status: "local", map: fallback.map, counts: fallback.counts, cachedAt: null });
        } else if (!silent) {
          setStockReadiness({ status: "failed", map: new Map(), counts: new Map(), error: resolved.error || null, code: resolved.code || null });
          setSubmitError(
            resolved.code === "backend-update-required" && resolved.error
              ? resolved.error
              : result?.error || "Stock status could not be verified. Refresh before selling.",
          );
        }
      }
    } catch (error) {
      if (silent) return;
      setStockReadiness({ status: "failed", map: new Map(), counts: new Map() });
      setSubmitError(error?.message || "Stock status could not be verified. Refresh before selling.");
    }
  }, [applyPendingUsage, buildLocalFallback, lodgeId, menuItems, recipeMenuItemIds]);

  // The other till's sales arrive over mesh between sync polls. When a merge
  // lands, re-read readiness quietly so the counts include it — gated strictly
  // on the merge marker so ordinary status traffic never triggers server reads.
  const lastMeshMergeRef = useRef(null);
  useEffect(() => {
    const off = window.api?.sync?.onStatusChanged?.((next) => {
      const marker = next?.mesh?.lastQueueMergeAt || null;
      if (!marker || marker === lastMeshMergeRef.current) return;
      lastMeshMergeRef.current = marker;
      refreshReadiness({ silent: true }).catch(() => {});
    });
    Promise.resolve(window.api?.sync?.getStatus?.()).then((status) => {
      if (status?.mesh?.lastQueueMergeAt) lastMeshMergeRef.current = status.mesh.lastQueueMergeAt;
    }).catch(() => {});
    return () => off?.();
  }, [refreshReadiness]);
  // Category order is operator-driven (pins + measured sellers first), never
  // hardcoded per drink type: every business gets its own fast picks.
  const favouriteIdSet = useMemo(() => new Set(favourites), [favourites]);
  const hasTopSellers = useMemo(
    () => tillMenuItems.some((item) => Number(item.popularity || 0) > TOP_SELLER_POPULARITY),
    [tillMenuItems],
  );
  const categories = useMemo(() => {
    const rest = Array.from(
      new Set(tillMenuItems.map((item) => item.category).filter(Boolean)),
    ).sort();
    return [
      "All",
      ...(favourites.length ? [FAVOURITES_CATEGORY] : []),
      ...(hasTopSellers ? [TOP_SELLERS_CATEGORY] : []),
      ...rest,
    ];
  }, [tillMenuItems, favourites.length, hasTopSellers]);
  // Live product counts per chip so the operator can judge a category
  // before scrolling into it (All always shows the full sellable set).
  const categoryCounts = useMemo(() => {
    const counts = { All: tillMenuItems.length };
    for (const item of tillMenuItems) {
      const key = item.category;
      if (key) counts[key] = (counts[key] || 0) + 1;
    }
    if (favourites.length) counts[FAVOURITES_CATEGORY] = favourites.length;
    if (hasTopSellers) {
      counts[TOP_SELLERS_CATEGORY] = tillMenuItems.filter(
        (item) => Number(item.popularity || 0) > TOP_SELLER_POPULARITY,
      ).length;
    }
    return counts;
  }, [favourites.length, hasTopSellers, tillMenuItems]);
  // Basket qty per product id for in-card badges (no need to open the panel).
  const cartQtyByItem = useMemo(() => {
    const map = new Map();
    for (const line of cart) {
      map.set(
        line.menu_item_id,
        (map.get(line.menu_item_id) || 0) + Number(line.quantity || 0),
      );
    }
    return map;
  }, [cart]);
  // A special filter with nothing left in it (e.g. last pin removed) falls
  // back to All instead of rendering an empty grid.
  useEffect(() => {
    if (activeCategory === FAVOURITES_CATEGORY && favourites.length === 0) {
      setActiveCategory("All");
    }
  }, [activeCategory, favourites.length]);
  const searchLower = search.trim().toLowerCase();
  const filtered = tillMenuItems
    .filter((item) => {
      if (activeCategory === FAVOURITES_CATEGORY) return favouriteIdSet.has(item.id);
      if (activeCategory === TOP_SELLERS_CATEGORY) {
        return Number(item.popularity || 0) > TOP_SELLER_POPULARITY;
      }
      return activeCategory === "All" || item.category === activeCategory;
    })
    .filter(
      (item) =>
        !searchLower ||
        item.name?.toLowerCase().includes(searchLower) ||
        String(item.barcode || "")
          .toLowerCase()
          .includes(searchLower) ||
        String(item.template_kind || "")
          .toLowerCase()
          .includes(searchLower),
    )
    .sort((a, b) =>
      activeCategory === TOP_SELLERS_CATEGORY
        ? Number(b.popularity || 0) - Number(a.popularity || 0)
        : 0,
    );

  const addToCart = useCallback(
    (item) => {
      // A completed sale is acknowledged until the operator begins the next one.
      registerTillActivity();
      setSuccessMessage("");
      // Fresh input retires a stale sale error (e.g. a server stock refusal
      // from an earlier Pay): the next Pay revalidates from scratch instead
      // of leaving the old message to block the new basket. Uncertain-attempt
      // recovery state is separate and never cleared here.
      setSubmitError("");
      // Fail closed on stock state: unknown renders as Refresh-required and
      // setup issues never reach the basket (the server would reject them).
      const issue = getStockIssue(item);
      if (issue === "unknown") {
        setSubmitError("Stock status is unavailable. Refresh before selling.");
        return;
      }
      if (issue === "issue") {
        setSubmitError(`${item.name || "Product"} needs stock setup before it can be sold.`);
        return;
      }
      const syncBlock = provisionalBlock(item);
      if (syncBlock) {
        setSubmitError(syncBlock);
        return;
      }
      setLastAdded({ key: item.id, at: Date.now() });
      // Automatic sold-out: never let the basket exceed the counted stock.
      // The server re-checks at Pay regardless; this stops the extra taps
      // before they reach the error stage.
      const existing = cart.find((c) => c.menu_item_id === item.id);
      const existingQty = existing
        ? Number(existing.quantity || 0)
        : 0;
      const onHandBlock = onHandRefusal(item.id, item.depletion_qty || 1, item.name, existingQty + 1, item.category);
      if (onHandBlock) {
        setSubmitError(onHandBlock);
        return;
      }
      const lineId = existing ? existing.id : Date.now();
      setUndoAdd({ menuItemId: item.id, lineId, name: item.name, at: Date.now() });
      setCart((prev) => {
        const current = prev.find((c) => c.menu_item_id === item.id);
        if (current) {
          return prev.map((c) =>
            c.menu_item_id === item.id ? { ...c, quantity: c.quantity + 1 } : c,
          );
        }
        return [
          ...prev,
          {
            id: lineId,
            menu_item_id: item.id,
            item_name: item.name,
            unit_price: Number(item.price || 0),
            quantity: 1,
            modifiers: [],
            modifier_total: 0,
            inventory_item_id: item.inventory_item_id || null,
            depletion_qty: Number(item.depletion_qty || 1),
            kitchen_station_id: item.kitchen_station_id || null,
            category: item.category || null,
            template_kind: item.template_kind || null,
            template_pack_size: item.template_pack_size || null,
            barcode: item.barcode || null,
          },
        ];
      });
      playTillBeep();
    },
    [cart, location.state?.tabId, onHandRefusal, provisionalBlock, registerTillActivity, getStockIssue],
  );

  const outletName = useCallback(
    (outletId) =>
      outlets.find((outlet) => outlet.id === outletId)?.name ||
      "another outlet",
    [outlets],
  );

  /** Resolve an exact barcode against the currently selected Till outlet. */
  const resolveBarcodeScan = useCallback(
    (query) => {
      const barcode = normalizeBarcode(query);
      if (!barcode) return { success: false, code: "empty_scan" };
      if (!selectedOutlet?.id)
        return {
          success: false,
          code: "select_outlet_first",
          message: "Select an outlet before scanning a product.",
        };
      const matches = tillMenuItems.filter(
        (item) => String(item.barcode || "").trim() === barcode,
      );
      if (matches.length === 0)
        return {
          success: false,
          code: "barcode_not_found",
          barcode,
          message: `Barcode not found: ${barcode}`,
        };
      const eligible = matches.filter(
        (item) => !item.outlet_id || item.outlet_id === selectedOutlet.id,
      );
      if (eligible.length === 0) {
        const firstOutlet = matches.find((item) => item.outlet_id)?.outlet_id;
        return {
          success: false,
          code: "wrong_outlet",
          barcode,
          message: `This barcode belongs to ${outletName(firstOutlet)}.`,
        };
      }
      const availableEligible = eligible.filter(
        (item) => item.is_available !== false && item.available !== false && !item.sold_out,
      );
      if (availableEligible.length > 1)
        return {
          success: false,
          code: "duplicate_barcode",
          barcode,
          message: "Two active products share this barcode. Manager setup is required.",
        };
      const match = availableEligible[0] || eligible[0];
      if (!match || match.is_available === false || match.available === false || match.sold_out)
        return {
          success: false,
          code: "product_unavailable",
          barcode,
          message: `${match.name || "Product"} is unavailable or sold out.`,
        };
      const stockIssue = getStockIssue(match);
      if (stockIssue === "unknown")
        return {
          success: false,
          code: "stock_status_unavailable",
          barcode,
          message: "Stock status is unavailable. Refresh before selling.",
        };
      if (stockIssue === "issue")
        return {
          success: false,
          code: "stock_setup_required",
          barcode,
          message: `${match.name || "Product"} needs stock setup before it can be sold.`,
        };
      if (isFinishedStock(match))
        return {
          success: false,
          code: "product_finished",
          barcode,
          message: `${match.name || "Product"} is finished — out of stock. Receive stock first.`,
        };
      {
        const syncBlock = provisionalBlock(match);
        if (syncBlock) {
          return { success: false, code: "product_syncing", barcode, message: syncBlock };
        }
      }
      return { success: true, barcode, item: match };
    },
    [getStockIssue, isFinishedStock, outletName, provisionalBlock, selectedOutlet?.id, tillMenuItems],
  );

  const handleCompletedScan = useCallback(
    (result) => {
      registerTillActivity();
      if (!result?.success) {
        if (result?.code === "scan_too_short") return;
        reportScanner({
          level: "error",
          code: result?.code || "scan_failed",
          message:
            result?.message ||
            (result?.code === "scan_too_long"
              ? "Scanner input was too long. Check the scanner configuration."
              : "Scanner input could not be read."),
        });
        return;
      }
      const resolved = resolveBarcodeScan(result.barcode);
      if (!resolved.success) {
        if (resolved.code === "barcode_not_found") {
          setLastNotFoundBarcode(resolved.barcode || result.barcode || null);
        }
        reportScanner({
          level: "error",
          code: resolved.code,
          message: resolved.message || "Barcode could not be added.",
        });
        return;
      }
      setLastNotFoundBarcode(null);
      addToCart(resolved.item);
      reportScanner({
        level: "success",
        code: "scan_added",
        message: `${resolved.item.name || "Product"} added.`,
      });
      setSearch("");
    },
    [addToCart, registerTillActivity, reportScanner, resolveBarcodeScan],
  );

  // A wedge scanner is a keyboard, so capture fast keystrokes at page level
  // when Till controls have focus. Editable payment/PIN fields suspend it.
  useEffect(() => {
    const decoder = barcodeDecoderRef.current;
    const suspended = () =>
      showPayment ||
      showShiftStart ||
      showOperatorUnlock ||
      modifierLineId != null ||
      Boolean(completedReceipt);
    const clearIdleTimer = () => {
      if (scannerIdleTimerRef.current) {
        window.clearTimeout(scannerIdleTimerRef.current);
        scannerIdleTimerRef.current = null;
      }
    };
    const onKeyDown = (event) => {
      if (scannerSettings.barcode_scanner_enabled === false) {
        decoder.reset();
        clearIdleTimer();
        return;
      }
      if (suspended()) {
        decoder.reset();
        clearIdleTimer();
        return;
      }
      // The search input has its own exact-match Enter handling. Other
      // editable fields are deliberately excluded to prevent scan text from
      // entering payment, tab, customer or PIN fields.
      if (event.target === searchRef.current || isScannerEditableTarget(event.target)) return;
      const outcome = decoder.consumeKey(event);
      if (outcome.type === "buffered") {
        if (event.key?.length === 1) event.preventDefault();
        clearIdleTimer();
        scannerIdleTimerRef.current = window.setTimeout(() => {
          const idleResult = decoder.flush("idle");
          if (idleResult.type === "completed") handleCompletedScan(idleResult.result);
        }, decoder.getOptions().idleCompleteMs);
        return;
      }
      if (outcome.type === "completed") {
        event.preventDefault();
        event.stopPropagation();
        clearIdleTimer();
        handleCompletedScan(outcome.result);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      clearIdleTimer();
      decoder.reset();
    };
  }, [completedReceipt, handleCompletedScan, modifierLineId, scannerSettings.barcode_scanner_enabled, showOperatorUnlock, showPayment, showShiftStart, scannerOptions]);

  // Barcode / exact name search: Enter completes a manual search or a scan
  // that happened while the search field was focused.
  const tryAddBySearch = useCallback(
    (query) => {
      const q = String(query || "").trim();
      if (!q) return false;
      const barcodeResult = resolveBarcodeScan(q);
      if (barcodeResult.success) {
        addToCart(barcodeResult.item);
        setSearch("");
        reportScanner({
          level: "success",
          code: "scan_added",
          message: `${barcodeResult.item.name || "Product"} added.`,
        });
        return true;
      }
      if (barcodeResult.code !== "barcode_not_found") {
        reportScanner({
          level: "error",
          code: barcodeResult.code,
          message: barcodeResult.message || "Barcode could not be added.",
        });
        return true;
      }
      const lower = q.toLowerCase();
      const byName = tillMenuItems.find(
        (item) => String(item.name || "").toLowerCase() === lower,
      );
      const match = byName;
      if (!match || match.is_available === false || match.available === false) {
        setLastNotFoundBarcode(/^[0-9]+$/.test(q) ? q : null);
        reportScanner({
          level: "error",
          code: "barcode_not_found",
          message: `Barcode or product not found: ${q}`,
        });
        return false;
      }
      setLastNotFoundBarcode(null);
      addToCart(match);
      setSearch("");
      return true;
    },
    [addToCart, reportScanner, resolveBarcodeScan, tillMenuItems],
  );

  const updateQty = useCallback((id, qty) => {
    registerTillActivity();
    setSubmitError("");
    if (Number(qty) > 0) {
      const line = cart.find((c) => c.id === id);
      const block = line
        ? onHandRefusal(line.menu_item_id, line.depletion_qty || 1, line.item_name, qty, line.category)
        : null;
      if (block) {
        setSubmitError(block);
        return;
      }
    }
    if (qty <= 0) {
      setCart((prev) => prev.filter((c) => c.id !== id));
    } else {
      setCart((prev) =>
        prev.map((c) => (c.id === id ? { ...c, quantity: qty } : c)),
      );
    }
  }, [cart, onHandRefusal, registerTillActivity]);

  // Direct quantity entry preserves Till behavior: any positive quantity is
  // accepted (per-caller integer rules are enforced downstream, never here),
  // zero/negative removes the line, non-numeric input is ignored.
  const setQty = useCallback((id, raw) => {
    registerTillActivity();
    setSubmitError("");
    const qty = Number(raw);
    if (!Number.isFinite(qty)) return;
    if (qty > 0) {
      const line = cart.find((c) => c.id === id);
      const block = line
        ? onHandRefusal(line.menu_item_id, line.depletion_qty || 1, line.item_name, qty, line.category)
        : null;
      if (block) {
        setSubmitError(block);
        return;
      }
    }
    if (qty <= 0) {
      setCart((prev) => prev.filter((c) => c.id !== id));
    } else {
      setCart((prev) =>
        prev.map((c) => (c.id === id ? { ...c, quantity: qty } : c)),
      );
    }
  }, [cart, onHandRefusal, registerTillActivity]);

  const removeLine = useCallback((id) => {
    registerTillActivity();
    setSubmitError("");
    setCart((prev) => {
      const index = prev.findIndex((c) => c.id === id);
      if (index < 0) return prev;
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = window.setTimeout(() => setLastRemoved(null), 6000);
      setLastRemoved({ line: prev[index], index });
      return prev.filter((c) => c.id !== id);
    });
  }, [registerTillActivity]);

  const undoRemove = useCallback(() => {
    if (!lastRemoved) return;
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    const { line, index } = lastRemoved;
    setLastRemoved(null);
    setCart((prev) => {
      if (prev.some((c) => c.id === line.id)) return prev;
      const next = [...prev];
      next.splice(Math.min(index, next.length), 0, line);
      return next;
    });
  }, [lastRemoved]);

  const clearCart = useCallback(() => {
    registerTillActivity();
    setPendingConfirm("clear");
  }, [registerTillActivity]);

  const applyClearCart = useCallback(() => {
    setPendingConfirm(null);
    setSubmitError("");
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    setLastRemoved(null);
    setUndoAdd(null);
    setCart([]);
    // Next customer: put the caret back in search so they can scan or type.
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  // Payment open with a tender still untaken → soft role=status nudge after
  // 90s. Any tender/method change restarts the clock; closing payment clears it.
  useEffect(() => {
    if (!showPayment) {
      setPaymentIdleNudge(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setPaymentIdleNudge(true), 90000);
    return () => window.clearTimeout(timer);
  }, [showPayment, paymentMethod, cashReceived, tipAmount, splitCashAmount, voucherAmount]);

  // Successful payment: record recent sold chips + local shift-pace items
  // (device-local estimate only — never a financial report).
  const noteSaleForShift = useCallback((lines) => {
    const ids = [];
    for (const line of lines || []) {
      const id = String(line?.menu_item_id || line?.id || "");
      if (id && !ids.includes(id)) ids.push(id);
    }
    setRecentSold((prev) => {
      const next = ids.filter((id) => !prev.includes(id)).concat(prev);
      return next.slice(0, 12);
    });
    setShiftPaceItems((n) => n + (lines || []).reduce((sum, l) => sum + (Number(l?.quantity) || 0), 0));
  }, []);

  // Multi-add sheet: rounds of 2/3/4/6 without leaving the grid.
  const applyMultiAdd = useCallback(() => {
    if (!multiAddItem) return;
    const qty = Math.max(1, Math.min(99, Number(multiAddQty) || 1));
    for (let i = 0; i < qty; i += 1) addToCart(multiAddItem);
    setMultiAddItem(null);
    setMultiAddQty("2");
  }, [addToCart, multiAddItem, multiAddQty]);

  // One-level local undo for the most recent basket add (mis-taps only —
  // never touches a paid order). Reverses exactly that +1 or new line.
  const undoLastAdd = useCallback(() => {
    if (!undoAdd) return;
    registerTillActivity();
    setSubmitError("");
    setCart((prev) => {
      const next = [];
      for (const line of prev) {
        if (line.menu_item_id === undoAdd.menuItemId && line.id === undoAdd.lineId) {
          if (Number(line.quantity || 0) > 1) {
            next.push({ ...line, quantity: Number(line.quantity || 0) - 1 });
          }
          continue;
        }
        next.push(line);
      }
      return next;
    });
    setUndoAdd(null);
    setLastAdded(null);
  }, [registerTillActivity, undoAdd]);

  // Same again: one tap rebuilds the previous sale from the live catalog
  // (fresh prices). Missing, unavailable or stock-blocked lines are skipped
  // and reported instead of failing the whole round. Pay revalidates.
  const reorderLastSale = useCallback(() => {
    registerTillActivity();
    setSubmitError("");
    setSuccessMessage("");
    const entries = Array.isArray(lastReceipt?.pos_order_items) ? lastReceipt.pos_order_items : [];
    if (entries.length === 0) {
      setSubmitError("No previous sale on this terminal yet.");
      return;
    }
    let skipped = 0;
    const lines = [];
    entries.forEach((entry, index) => {
      const qty = Number(entry?.quantity || 0);
      if (!Number.isFinite(qty) || qty <= 0) {
        skipped += 1;
        return;
      }
      const idKey = String(entry?.menu_item_id || entry?.product_id || entry?.item_id || "");
      const nameKey = String(entry?.item_name || entry?.name || "").toLowerCase();
      const menu = (tillMenuItems || []).find((row) => String(row.id) === idKey)
        || (tillMenuItems || []).find((row) => String(row.name || "").toLowerCase() === nameKey);
      if (!menu) {
        skipped += 1;
        return;
      }
      if (menu.is_available === false || menu.available === false || menu.sold_out) {
        skipped += 1;
        return;
      }
      const issue = getStockIssue(menu);
      if (issue === "unknown" || issue === "issue") {
        skipped += 1;
        return;
      }
      // Finished, short or still-syncing stock never re-enters through Same again.
      if (onHandRefusal(menu.id, menu.depletion_qty || 1, menu.name, qty, menu.category)) {
        skipped += 1;
        return;
      }
      if (provisionalBlock(menu)) {
        skipped += 1;
        return;
      }
      const modifiers = (Array.isArray(entry?.modifiers) ? entry.modifiers : []).map((modifier) => ({
        id: modifier?.id || modifier?.name || `mod-${index}`,
        group_id: modifier?.group_id || null,
        name: modifier?.name || "Option",
        price_delta: Number(modifier?.price_delta || 0),
      }));
      lines.push({
        id: `${Date.now()}-${menu.id}-${lines.length}`,
        menu_item_id: menu.id,
        item_name: menu.name,
        unit_price: Number(menu.price || 0),
        quantity: qty,
        modifiers,
        modifier_total: modifiers.reduce((sum, modifier) => sum + Number(modifier.price_delta || 0), 0),
        inventory_item_id: menu.inventory_item_id || null,
        depletion_qty: Number(menu.depletion_qty || 1),
        kitchen_station_id: menu.kitchen_station_id || null,
        category: menu.category || null,
        template_kind: menu.template_kind || null,
        template_pack_size: menu.template_pack_size || null,
        barcode: menu.barcode || null,
      });
    });
    if (lines.length === 0) {
      setSubmitError("Last sale items are unavailable now. Pick from the menu instead.");
      return;
    }
    setCart(lines);
    setLastAdded({ key: lines[lines.length - 1].menu_item_id, at: Date.now() });
    setSuccessMessage(
      skipped > 0
        ? `Same again added. ${skipped} unavailable ${skipped === 1 ? "line" : "lines"} skipped.`
        : "Same again added.",
    );
  }, [getStockIssue, lastReceipt, onHandRefusal, provisionalBlock, registerTillActivity, tillMenuItems]);

  // Reprint the last receipt (lost slip): reopens the recorded sale in the
  // receipt modal, where Print / Save as PDF run again without re-charging.
  const reprintLastReceipt = useCallback(() => {
    if (!lastReceipt) return;
    setCompletedReceipt({ order: lastReceipt, autoPrint: false });
  }, [lastReceipt]);

  // Pool night: one tap adds every table product (quantity 1). The cashier
  // then types each table-box cash as its quantity and pays once.
  const poolNightProducts = useMemo(() => {
    if (!barOnly) return [];
    return (tillMenuItems || []).filter((item) => {
      if (String(item.category || "").trim().toLowerCase() !== "pool") return false;
      if (item.is_available === false || item.available === false || item.sold_out) return false;
      if (item.outlet_id && selectedOutlet?.id && item.outlet_id !== selectedOutlet.id) return false;
      return true;
    });
  }, [barOnly, tillMenuItems, selectedOutlet?.id]);
  const startPoolNight = useCallback(() => {
    registerTillActivity();
    if (poolNightProducts.length === 0) {
      setSubmitError("No pool tables found. Add Pool Table 1 in Products first.");
      return;
    }
    poolNightProducts.forEach((item) => addToCart(item));
    if (narrowViewport) setBasketOpen(true);
  }, [addToCart, narrowViewport, poolNightProducts, registerTillActivity]);

  const toggleModifier = (line, option, group) => {
    registerTillActivity();
    setCart((previous) =>
      previous.map((entry) => {
        if (entry.id !== line.id) return entry;
        const selected = entry.modifiers || [];
        const exists = selected.some(
          (modifier) =>
            modifier.name === option.name && modifier.group_id === group.id,
        );
        const groupSelected = selected.filter(
          (modifier) => modifier.group_id === group.id,
        );
        if (
          !exists &&
          Number(group.max_selections || 0) > 0 &&
          groupSelected.length >= Number(group.max_selections)
        )
          return entry;
        const modifiers = exists
          ? selected.filter(
              (modifier) =>
                !(
                  modifier.name === option.name &&
                  modifier.group_id === group.id
                ),
            )
          : [
              ...selected,
              {
                id: option.id || option.name,
                group_id: group.id,
                name: option.name,
                price_delta: Number(option.price_delta || 0),
              },
            ];
        return {
          ...entry,
          modifiers,
          modifier_total: modifiers.reduce(
            (sum, modifier) => sum + Number(modifier.price_delta || 0),
            0,
          ),
        };
      }),
    );
  };

  const updateLineNotes = (lineId, value) => {
    registerTillActivity();
    setCart((previous) =>
      previous.map((entry) =>
        entry.id === lineId ? { ...entry, item_notes: value } : entry,
      ),
    );
  };

  const selectedCustomer =
    customers.find((customer) => customer.id === selectedCustomerId) || null;
  const subtotal = cart.reduce(
    (sum, c) =>
      sum + (Number(c.unit_price) + Number(c.modifier_total || 0)) * c.quantity,
    0,
  );
  const now = Date.now();
  const eligiblePromotions = promotions.filter((promotion) => {
    if (promotion.active === false) return false;
    if (promotion.starts_at && new Date(promotion.starts_at).getTime() > now)
      return false;
    if (promotion.ends_at && new Date(promotion.ends_at).getTime() < now)
      return false;
    if (subtotal < Number(promotion.minimum_spend || 0)) return false;
    if (
      promotion.customer_segment &&
      String(promotion.customer_segment).toLowerCase() !==
        String(
          selectedCustomer?.segment || selectedCustomer?.customer_segment || "",
        ).toLowerCase()
    )
      return false;
    const category = String(
      promotion.applies_to_category || "All",
    ).toLowerCase();
    return (
      category === "all" ||
      cart.some(
        (line) => String(line.category || "").toLowerCase() === category,
      )
    );
  });
  const selectedPromotion =
    eligiblePromotions.find(
      (promotion) => promotion.id === selectedPromotionId,
    ) || null;
  const promotionBase =
    selectedPromotion &&
    String(selectedPromotion.applies_to_category || "All").toLowerCase() !==
      "all"
      ? cart
          .filter(
            (line) =>
              String(line.category || "").toLowerCase() ===
              String(selectedPromotion.applies_to_category).toLowerCase(),
          )
          .reduce(
            (sum, line) =>
              sum +
              (Number(line.unit_price) + Number(line.modifier_total || 0)) *
                line.quantity,
            0,
          )
      : subtotal;
  const promotionDiscount = selectedPromotion
    ? Math.min(
        promotionBase,
        selectedPromotion.discount_type === "percent"
          ? (promotionBase * Number(selectedPromotion.discount_value || 0)) /
              100
          : Number(selectedPromotion.discount_value || 0),
      )
    : 0;
  const taxRate =
    settings?.vat_enabled === true ? Number(settings?.vat_rate || 0) / 100 : 0;
  const tax = (subtotal - promotionDiscount) * taxRate;
  const tipTotal = Math.max(0, Number(tipAmount || 0));
  const total = subtotal - promotionDiscount + tax + tipTotal;

  // Feed the guest-facing screen live: the Bar Till previously never pushed
  // its basket, so the customer display sat on Welcome all sale. Same local
  // snapshot contract the lodge terminal already uses. Placed here (not near
  // the other effects) because the totals below must exist first.
  useEffect(() => {
    if (!selectedOutlet?.id) return;
    window.api?.pos?.updateCustomerDisplay?.({
      outlet_id: selectedOutlet.id,
      table_name: tabName?.trim() || tableName?.trim() || null,
      staff_name: (verifiedOperator || user)?.name || (verifiedOperator || user)?.email || null,
      items: cart.map((line) => ({
        item_name: line.item_name,
        quantity: Number(line.quantity || 0),
        unit_price: Number(line.unit_price || 0) + Number(line.modifier_total || 0),
        modifiers: line.modifiers || [],
        item_notes: line.item_notes?.trim() || null,
      })),
      subtotal,
      discount_total: promotionDiscount,
      tax_total: tax,
      tip_total: tipTotal,
      total,
    }).catch(() => {});
  }, [cart, promotionDiscount, selectedOutlet?.id, subtotal, tabName, tableName, tax, tipTotal, total, user, verifiedOperator]);

  const tenderBreakdownResult = useMemo(
    () =>
      buildBarTenderBreakdown({
        total,
        chargeToAccount,
        selectedCustomerId,
        paymentMethod,
        splitCashAmount,
        splitRemainderMethod,
        voucherCode,
        voucherAmount,
        paymentReferences,
      }),
    [
      chargeToAccount,
      paymentMethod,
      paymentReferences,
      selectedCustomerId,
      splitCashAmount,
      splitRemainderMethod,
      total,
      voucherAmount,
      voucherCode,
    ],
  );
  const itemCount = cart.reduce((sum, c) => sum + c.quantity, 0);
  // Pool-table daily cash is box cash: card, mobile money, split and account
  // charge must never be offered for a basket holding Pool lines.
  const hasPoolLines = useMemo(
    () => cart.some((line) => String(line.category || '').trim().toLowerCase() === 'pool'),
    [cart],
  );
  useEffect(() => {
    if (hasPoolLines) {
      setChargeToAccount(false);
      setPaymentMethod('cash');
    }
  }, [hasPoolLines]);
  const selectedTable =
    tables.find(
      (table) => String(table.name || table.table_number || "") === tableName,
    ) || null;
  const selectedOpenTab = selectedTable?.tab || null;

  const fmt = (n) =>
    Number(n || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const applyTableSwitch = (nextTableName) => {
    const table = tables.find(
      (row) => String(row.name || row.table_number || "") === nextTableName,
    );
    const openTab = table?.tab || null;
    setTableName(nextTableName);
    setShowPayment(false);
    setSubmitError("");
    if (openTab && Array.isArray(openTab.items)) {
      setCart(
        openTab.items.map((item, index) => ({
          ...item,
          id: item.id || `${openTab.id || nextTableName}-${index}`,
          menu_item_id: item.menu_item_id || item.id || null,
          item_name: item.item_name || item.name || "Item",
          unit_price: Number(item.unit_price || item.price || 0),
          quantity: Number(item.quantity || 1),
          modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
          modifier_total: Number(item.modifier_total || 0),
          template_kind: item.template_kind || null,
          template_pack_size: item.template_pack_size || null,
        })),
      );
      setSuccessMessage(`${nextTableName} open check loaded.`);
    } else if (nextTableName !== tableName) {
      setCart([]);
      setSuccessMessage("");
    }
  };

  const selectTable = (nextTableName) => {
    if (cart.length > 0 && nextTableName !== tableName) {
      // The <select> stays controlled by tableName, so it snaps back until
      // the operator confirms the replacement in the in-app dialog.
      setPendingConfirm({ type: "table", name: nextTableName });
      return;
    }
    applyTableSwitch(nextTableName);
  };

  const openShift = async () => {
    if (!selectedOutlet?.id || shiftBusy) return;
    // The outlet is remembered, but the float is explicit every shift: an
    // empty float never defaults (not even to zero).
    if (String(shiftFloat ?? "").trim() === "") {
      setSubmitError("Enter the opening cash float to start the shift.");
      return;
    }
    setShiftBusy(true);
    setSubmitError("");
    try {
      const result = await window.api?.pos?.openShift?.({
        outlet_id: selectedOutlet.id,
        cashier_id: user?.id || null,
        cashier_name: user?.name || user?.email || null,
        opening_float: Number(shiftFloat || 0),
      });
      if (!result?.success)
        throw new Error(result?.error || "Could not start the shift.");
      const shift = await window.api?.pos?.getCurrentShift?.(
        selectedOutlet.id,
        user?.id || null,
      );
      setCurrentShift(shift || result.shift || result.row || null);
      setShiftFloat("");
      setShowShiftStart(false);
      setSuccessMessage(result?.offline ? "Shift saved on this device. You can take payments offline; figures remain provisional until sync." : "Shift opened. You can now take payments.");
    } catch (error) {
      setSubmitError(error?.message || "Could not start the shift.");
    } finally {
      setShiftBusy(false);
    }
  };

  const holdCheck = async () => {
    if (!cart.length || holding || !selectedOutlet?.id) return;
    if (sharedTerminalMode && !verifiedOperator?.id) {
      setSubmitError(
        `Choose the ${barOnly ? "bartender or cashier" : "waiter or bartender"} and verify their Staff PIN before holding an open check.`,
      );
      return;
    }
    if (!currentShift?.id) {
      setSubmitError(
        "Start your shift before holding an open check so it is assigned to the right staff member and cash-up.",
      );
      setShowShiftStart(true);
      return;
    }
    const servicePayload = resolvePosServicePayload(serviceMode, {
      tableName,
      tabName,
    });
    if (!["table", "tab"].includes(serviceMode)) return;
    if (servicePayload.requiresTableOrTab && !servicePayload.table_name) {
      setSubmitError(
        serviceMode === "tab"
          ? "Enter a tab name before holding this check."
          : "Select a table before holding this check.",
      );
      return;
    }
    // Required modifier choices are validated on Hold as well as Pay: a
    // sale that never opened Options must still complete its minimums.
    // Unknown applicability blocks until verified (never guessed).
    const holdModifierCheck = validateSaleModifierRequirements(cart, modifierGroups, modifiersReady === "ready");
    if (!holdModifierCheck.ok) {
      setSubmitError(holdModifierCheck.error);
      return;
    }
    // Durable hold intent BEFORE dispatch, carrying the same tab id that is
    // submitted below: reconciliation matches by server tab identity, never
    // by name or timestamp. A failed write blocks dispatch — an unrecorded
    // hold must never leave this terminal.
    const holdOperatorId = (verifiedOperator || user)?.id || null;
    const holdKey = crypto.randomUUID();
    const holdTabId = location.state?.tabId || selectedOpenTab?.id || holdKey;
    if (!writeJsonSetting(holdIntentKey(lodgeId, selectedOutlet.id, holdOperatorId), {
      key: holdKey,
      tabId: holdTabId,
      tabName: servicePayload.tab_name || tableName.trim() || tabName.trim() || null,
      at: Date.now(),
      shiftId: currentShift.id,
      outletId: selectedOutlet.id,
      operatorId: holdOperatorId,
    })) {
      setSubmitError("The hold could not be stored safely on this device. Nothing was held; check storage and retry.");
      return;
    }
    setHolding(true);
    setSubmitError("");
    setSuccessMessage("");
    try {
      const result = await window.api?.pos?.saveTab?.({
        id: holdTabId,
        expected_version: location.state?.tabVersion ?? selectedOpenTab?.tab_version ?? undefined,
        // Keep the loaded server version on the payload as well as the
        // optimistic expected_version guard. The domain uses this field when
        // retaining the local tab snapshot, so a reopened Bar tab must never
        // be rewritten as version 1 before the RPC response arrives.
        tab_version: location.state?.tabVersion ?? selectedOpenTab?.tab_version ?? undefined,
        outlet_id: selectedOutlet.id,
        table_name: serviceMode === "table" ? tableName.trim() || null : null,
        service_mode: servicePayload.service_mode,
        tab_name: servicePayload.tab_name || tableName.trim() || tabName.trim(),
        customer_name: selectedCustomer?.name || null,
        customer_id: selectedCustomerId || null,
        waiter_name:
          (verifiedOperator || user)?.name ||
          (verifiedOperator || user)?.email ||
          null,
        waiter_id: (verifiedOperator || user)?.id || null,
        shift_id: currentShift.id,
        items: cart.map((line) => ({
          menu_item_id: line.menu_item_id,
          item_name: line.item_name,
          category: line.category,
          unit_price:
            Number(line.unit_price || 0) + Number(line.modifier_total || 0),
          base_unit_price: Number(line.unit_price || 0),
          quantity: Number(line.quantity || 0),
          modifiers: line.modifiers || [],
          item_notes: line.item_notes?.trim() || null,
          inventory_item_id: line.inventory_item_id,
          depletion_qty: line.depletion_qty,
          kitchen_station_id: line.kitchen_station_id,
        })),
        status: serviceMode === "table" ? "running" : "open",
      });
      if (result?.already_open && result?.tab)
        throw new Error(
          result.error ||
            "That table already has a running check. Resume it from Open Checks.",
        );
      if (!result?.success) {
        if (String(result?.code || "").startsWith("till_operator_") || result?.code === "till_shift_closed" || result?.code === "shift_not_open") {
          clearTillOperatorState({ showUnlock: true, message: result?.error || "Verify the operator PIN again." });
        }
        throw new Error(result?.error || "Could not hold this check.");
      }
      setCart([]);
      setShowPayment(false);
      writeJsonSetting(
        holdIntentKey(lodgeId, selectedOutlet.id, (verifiedOperator || user)?.id || null),
        null,
      );
      if (sharedTerminalMode) {
        if (tillOperatorPolicy.mode === TILL_OPERATOR_MODES.STRICT) {
          clearTillOperatorState({ notifyMain: true });
        } else {
          const session = result?.till_session;
          setOperatorLastActivityAt(session?.lastActivityAt || Date.now());
          setTillSessionExpiresAt(session?.expiresAt || tillSessionExpiresAt);
        }
      }
      setSuccessMessage(
        `${tableName || tabName || "Check"} held. Resume it from Open Checks.${result?.offline === true ? " Will send when online." : ""}`,
      );
      if (shouldLoadTillTables(barOnly)) {
        const latestTables = await Promise.resolve(
          window.api?.pos?.getTablesWithStatus?.(selectedOutlet.id),
        ).catch(() => null);
        if (Array.isArray(latestTables)) setTables(latestTables);
      }
    } catch (error) {
      setSubmitError(
        error?.message || "Could not hold this check. Nothing was cleared.",
      );
    } finally {
      setHolding(false);
    }
  };

  // Keyboard shortcuts — guarded by focus target and open overlays so a
  // keystroke aimed at an input or modal never hijacks the till (item 12).
  useEffect(() => {
    const handler = (e) => {
      const target = e.target;
      const tag = target?.tagName;
      const isEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable === true;
      if (e.key === "Escape") {
        // ConfirmDialog owns its own Escape while open.
        if (pendingConfirm != null) return;
        if (showShiftStart) {
          if (!shiftBusy) setShowShiftStart(false);
          return;
        }
        if (modifierLineId != null) {
          setModifierLineId(null);
          return;
        }
        // The operator-unlock dialog stays in charge of its own dismissal.
        if (showOperatorUnlock) return;
        if (showPayment) {
          setShowPayment(false);
          return;
        }
        // Close the on-screen search keyboard before touching the field value.
        if (showSearchKeyboard) {
          setShowSearchKeyboard(false);
          return;
        }
        // Escape inside a non-search field must never clear the search or
        // fight the field's own editing; inside the search box it clears it.
        if (target === searchRef.current) {
          setSearch("");
          return;
        }
        if (!isEditable) setSearch("");
        return;
      }
      if (e.key === "F2" && cart.length > 0) {
        if (isEditable) return;
        if (
          pendingConfirm != null ||
          showShiftStart ||
          showOperatorUnlock ||
          modifierLineId != null
        ) {
          return;
        }
        e.preventDefault();
        setShowPayment(true);
      }
      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        document.activeElement?.tagName !== "INPUT"
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    cart.length,
    modifierLineId,
    pendingConfirm,
    showOperatorUnlock,
    showPayment,
    showSearchKeyboard,
    showShiftStart,
    shiftBusy,
  ]);

  // The on-screen keyboard never outlives a blocking overlay (payment,
  // shift start, operator unlock, modifier, confirm) — those own focus.
  useEffect(() => {
    if (
      showPayment ||
      showShiftStart ||
      showOperatorUnlock ||
      modifierLineId != null ||
      pendingConfirm != null ||
      multiAddItem != null
    ) {
      setShowSearchKeyboard(false);
    }
  }, [
    modifierLineId,
    multiAddItem,
    pendingConfirm,
    showOperatorUnlock,
    showPayment,
    showShiftStart,
  ]);

  // Tapping outside the floating keyboard (product grid, basket, chrome)
  // dismisses it. The search field, its clear/toggle buttons, and the
  // keyboard itself stay live so typing and barcode focus keep working.
  useEffect(() => {
    if (!showSearchKeyboard) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (searchKeyboardRef.current?.contains(target)) return;
      if (target === searchRef.current) return;
      if (searchKeyboardToggleRef.current?.contains(target)) return;
      if (searchClearRef.current?.contains(target)) return;
      setShowSearchKeyboard(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [showSearchKeyboard]);

  // Focus trap for the shift-start and modifier overlays — same contract as
  // HposLayout's PIN dialog and HposTillOperatorDialog.
  useEffect(() => {
    const dialogRef = showShiftStart
      ? shiftDialogRef
      : modifierLineId != null
        ? modifierDialogRef
        : null;
    if (!dialogRef) return undefined;
    const returnFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const raf = requestAnimationFrame(() => {
      const node = dialogRef.current;
      const focusTarget = node?.querySelector(
        'input:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusTarget?.focus?.();
    });
    const trapTab = (event) => {
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((node) => node.offsetParent !== null || node === document.activeElement);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapTab, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", trapTab, true);
      if (returnFocusTo && typeof returnFocusTo.focus === "function") {
        requestAnimationFrame(() => {
          try {
            returnFocusTo.focus();
          } catch {
            /* opener may have unmounted */
          }
        });
      }
    };
  }, [showShiftStart, modifierLineId]);

  const completeOrder = useCallback(async () => {
    const pendingEnvelope = submitEnvelopeRef.current;
    const retryingSubmit = pendingEnvelope?.status === "pending";
    if (submitting) return;
    if (cart.length === 0 && !retryingSubmit) return;
    if (retryingSubmit && !pendingEnvelope?.payload) return;
    if (!retryingSubmit) {
      if (!selectedOutlet?.id) {
        setSubmitError("Select an outlet before taking payment.");
        return;
      }
      if (sharedTerminalMode && !verifiedOperator?.id) {
        setSubmitError(
          `Choose the ${barOnly ? "bartender or cashier" : "waiter or bartender"} and verify their Staff PIN before taking payment.`,
        );
        return;
      }
      if (!currentShift?.id) {
        setSubmitError(
          "Start your shift before taking payment so this sale is included in cash-up.",
        );
        setShowShiftStart(true);
        return;
      }
      // Same fail-closed gate as the disabled Pay button: a shared outlet
      // with no open drawer period must never reach the domain refusal
      // without a plain-language reason first.
      if (drawerGateNeeded) {
        setSubmitError(
          "Open the cash drawer in Staff shift close before taking payment.",
        );
        return;
      }
    }
    const voucherAmountInput = String(voucherAmount ?? "").trim();
    const hasVoucherInput =
      String(voucherCode || "").trim() ||
      (voucherAmountInput && Number(voucherAmount) !== 0);
    if (!retryingSubmit && barOnly && !canUseVoucher && hasVoucherInput) {
      setSubmitError("Voucher tender is not included in the current Bar POS package.");
      return;
    }
    if (!retryingSubmit && barOnly && !canUseTips && Number(tipTotal) !== 0) {
      setSubmitError("Tip tender is not included in the current Bar POS package.");
      return;
    }
    const paymentBreakdown = tenderBreakdownResult.ok
      ? tenderBreakdownResult.breakdown
      : [];
    // Keep this final envelope-level check alongside the pure allocator. The
    // helper rejects overlong provider references before rows are emitted;
    // this guard protects the submit boundary if a future caller enriches the
    // rows after allocation, while references remain optional.
    const missingReferences = paymentBreakdown.filter(
      (tender) =>
        ["card", "mobile_money"].includes(tender.method) &&
        String(tender.reference || "").trim().length > 120,
    );
    if (!retryingSubmit && missingReferences.length > 0) {
      const methodLabels = missingReferences
        .map((tender) =>
          tender.method === "mobile_money" ? "mobile money" : "card",
        )
        .join(" and ");
      setSubmitError(
        `The ${methodLabels} reference must be 120 characters or fewer.`,
      );
      return;
    }
    if (!retryingSubmit && !tenderBreakdownResult.ok) {
      setSubmitError(tenderBreakdownResult.error);
      return;
    }
    if (!retryingSubmit) {
      const payModifierCheck = validateSaleModifierRequirements(cart, modifierGroups, modifiersReady === "ready");
      if (!payModifierCheck.ok) {
        setSubmitError(payModifierCheck.error);
        return;
      }
    }
    // Entitlement gates mirror the hidden controls: without the Growth
    // add-ons these submissions fail closed instead of charging silently.
    if (!retryingSubmit && chargeToAccount && !tillEntitlements.canAccounts) {
      setSubmitError("Customer account charging is not included in the current Bar POS package.");
      return;
    }
    if (!retryingSubmit && selectedPromotion && !tillEntitlements.canPromos) {
      setSubmitError("Promotions are not included in the current Bar POS package.");
      return;
    }

    // Cash received/change never alter the sale allocation: the cash tender
    // stays exactly the amount due, excess is change (never revenue or tip).
    // These are tendering aids recorded on the receipt, not ledger fields.
    let cashTenderMeta = null;
    if (!retryingSubmit && !chargeToAccount && paymentMethod === "cash") {
      // Bar sales must record what the customer handed over: a blank
      // received box blocks Pay so every cash receipt carries received/change.
      if (barOnly && String(cashReceived ?? "").trim() === "") {
        setSubmitError("Enter the cash received before taking payment — tap Exact, P20, P50, P100, P200, or type the amount.");
        return;
      }
      const tenderCheck = computeCashTender(cashReceived, tenderBreakdownResult.total);
      if (!tenderCheck.ok) {
        setSubmitError(
          tenderCheck.received != null && tenderCheck.due != null
            ? `Cash received ${currency} ${fmt(tenderCheck.received)} is less than ${currency} ${fmt(tenderCheck.due)} due.`
            : tenderCheck.error,
        );
        return;
      }
      cashTenderMeta = tenderCheck.cashTender;
    } else if (retryingSubmit) {
      // A retried attempt reuses its original tendering aids; across a full
      // restart they are unavailable and the receipt shows allocation only
      // (received/change are never fabricated).
      cashTenderMeta = pendingEnvelope?.cashTender || null;
    }

    const servicePayload = resolvePosServicePayload(serviceMode, {
      tableName,
      tabName,
    });
    if (!retryingSubmit && servicePayload.requiresTableOrTab && !servicePayload.table_name) {
      setSubmitError(
        serviceMode === "tab"
          ? "Enter a tab name before taking payment."
          : "Select a table before taking payment.",
      );
      return;
    }

    // Two tills, one tab: hold an advisory mesh lock while settling so the
    // other till waits instead of charging twice. The server still refuses
    // genuine double settlements; this only stops the confusing attempt.
    // Released below when Pay finishes, and expires on its own regardless.
    let tabLockId = null;
    const settlingTabId = servicePayload.openSession
      ? (resumedTabInfo?.id || location.state?.tabId || null)
      : null;
    if (!retryingSubmit && settlingTabId) {
      const operatorLabel = (verifiedOperator || user)?.name || (verifiedOperator || user)?.email || 'Till';
      const lock = await Promise.resolve(window.api?.mesh?.lockTab?.(settlingTabId, operatorLabel)).catch(() => null);
      if (lock?.held) {
        setSubmitError(`This tab is being settled on the other till${lock.heldBy ? ` by ${lock.heldBy}` : ''} — wait a moment, then check Open tabs.`);
        return;
      }
      if (lock?.acquired && lock?.lockId) tabLockId = lock.lockId;
    }

    setSubmitting(true);
    setSubmitError("");
    setSuccessMessage("");
    setSubmitNotice("");
    let orderPayload = null;
    let orderItems = [];
    if (retryingSubmit) {
      // Reuse the exact original sale attempt. The outcome of the previous
      // submission is uncertain (timeout, lost response or interruption), so
      // retrying must never mint a new id or timestamp or honour a changed
      // cart: the server idempotency contract replays the original sale.
      orderPayload = pendingEnvelope.payload;
      orderItems = Array.isArray(orderPayload.items) ? orderPayload.items : [];
      setSubmitNotice(
        "Retrying uses the original operation key. If it was never recorded, this action may complete that older sale now.",
      );
    } else {
      orderItems = cart.map((line) => {
        const qty = Number(line.quantity || 0);
        const unit = Number(line.unit_price || 0) + Number(line.modifier_total || 0);
        return {
          menu_item_id: line.menu_item_id,
          item_name: line.item_name,
          category: line.category,
          unit_price: unit,
          base_unit_price: Number(line.unit_price || 0),
          quantity: qty,
          subtotal: qty * unit,
          net_subtotal: qty * unit,
          gross_subtotal: qty * unit,
          modifiers: line.modifiers || [],
          item_notes: line.item_notes?.trim() || null,
          inventory_item_id: line.inventory_item_id,
          depletion_qty: line.depletion_qty,
          kitchen_station_id: line.kitchen_station_id,
        };
      });
    }

    try {
      let postOrderNotice = "";
      // Pointer/keyboard activity renews the Shift-mode Till proof in the
      // background, but payment must not race that renewal. Confirm the
      // server-side proof at the financial boundary before minting a fresh
      // order envelope. Recovered attempts deliberately skip this preflight:
      // create_pos_order_v3 must be allowed to replay a committed operation
      // under its original key even if the proof has since expired.
      if (
        !retryingSubmit &&
        sharedTerminalMode &&
        tillOperatorPolicy.mode === TILL_OPERATOR_MODES.SHIFT
      ) {
        const renewed = await window.api?.pos?.touchSharedTillOperator?.({
          outlet_id: selectedOutlet.id,
          staff_id: verifiedOperator.id,
          shift_id: currentShift.id,
        });
        if (!renewed?.success) {
          clearTillOperatorState({
            showUnlock: true,
            message:
              renewed?.error ||
              "Till proof renewal failed. Verify the operator PIN again before taking payment.",
          });
          return;
        }
        if (renewed.session) {
          setOperatorLastActivityAt(
            renewed.session.lastActivityAt || Date.now(),
          );
          setTillSessionExpiresAt(renewed.session.expiresAt || null);
        }
      }
      if (!retryingSubmit) {
        // Tab payments resolve and close through create_pos_order_v3 in a
        // single authorized call: the server locks the resumed tab (or
        // creates one from the tab name), records the order, and closes the
        // tab in the same transaction. A separate openTableSession call here
        // would consume a second Strict Till authorization and fail the
        // payment, so only the resumed tab id is forwarded when known.
        // A sale opened from an existing tab must retain that exact tab_id:
        // anything else (lost link, changed check, counter mode) fails
        // closed here, before anything is journalled or sent.
        const tabPayment = resolveResumedTabPayment({
          resumeIntent: location.state?.resumeIntent === true,
          resumeTabId: location.state?.tabId || null,
          resumeTabVersion: location.state?.tabVersion ?? null,
          selectedTab: selectedOpenTab
            ? { id: selectedOpenTab.id, tab_version: selectedOpenTab.tab_version }
            : null,
          settlesTab: servicePayload.openSession,
        });
        if (!tabPayment.ok) {
          setSubmitError(tabPayment.error);
          return;
        }
        const tabId = tabPayment.tabId;
        const resolvedTabName = servicePayload.tab_name;

        const walkInName =
          selectedCustomer?.name ||
          (servicePayload.service_mode === "delivery"
            ? "Delivery"
            : servicePayload.service_mode === "takeaway"
              ? "Takeaway"
              : servicePayload.service_mode === "counter"
                ? "Counter"
                : serviceMode === "tab"
                  ? resolvedTabName || "Tab"
                  : "Walk-in");

        const submitIntentId = crypto.randomUUID();
        const createdAtClient = new Date().toISOString();
        orderPayload = {
          id: submitIntentId,
          submit_intent_id: submitIntentId,
          created_at_client: createdAtClient,
          room_id: null,
          booking_id: null,
          event_booking_id: null,
          walk_in_name: walkInName,
          customer_id: selectedCustomerId || null,
          items: orderItems,
          notes: null,
          payment_method: chargeToAccount ? "account" : paymentMethod,
          payment_breakdown: paymentBreakdown,
          gross_total: subtotal,
          discount_total: 0,
          tax_rate: taxRate * 100,
          tax_total: tax,
          tip_total: tipTotal,
          total: tenderBreakdownResult.total,
          service_mode: servicePayload.service_mode,
          table_name: servicePayload.table_name,
          delivery_address:
            serviceMode === "delivery" ? deliveryAddress.trim() || null : null,
          delivery_notes:
            serviceMode === "delivery" ? deliveryNotes.trim() || null : null,
          customer_account_charge:
            chargeToAccount && selectedCustomerId
              ? { customer_id: selectedCustomerId, amount: tenderBreakdownResult.total }
              : null,
          tab_name: resolvedTabName,
          waiter_name: servicePayload.openSession
            ? (verifiedOperator || user)?.name ||
              (verifiedOperator || user)?.email ||
              null
            : null,
          waiter_id: servicePayload.openSession
            ? (verifiedOperator || user)?.id || null
            : null,
          cashier_id: (verifiedOperator || user)?.id || null,
          cashier_name:
            (verifiedOperator || user)?.name ||
            (verifiedOperator || user)?.email ||
            null,
          tab_id: tabId,
          expected_tab_version: tabPayment.expectedVersion,
          resolve_tab: servicePayload.openSession,
          shift_id: currentShift?.id || null,
          outlet_id: selectedOutlet.id,
          outlet_name: selectedOutlet.name,
          promotion_id: selectedPromotion?.id || null,
          customer_segment:
            selectedCustomer?.segment ||
            selectedCustomer?.customer_segment ||
            null,
          manual_discount: null,
        };
        submitEnvelopeRef.current = {
          status: "pending",
          submitIntentId,
          orderId: submitIntentId,
          createdAtClient,
          payload: orderPayload,
          cashTender: cashTenderMeta,
        };
      }
      const result = await window.api.pos.createOrder(orderPayload);
      if (!result?.success) {
        if (result?.code === "catalog_refresh_required" || /immutable catalog snapshot/i.test(result?.error || "")) {
          // The menu changed under this basket: a new or edited product is
          // not in the published Till catalog yet. The server rejects before
          // recording anything, so the basket is safe to rebuild after a
          // refresh — never re-collect payment for this attempt.
          submitEnvelopeRef.current = null;
          setRecoveredAttempt(null);
          setSubmitNotice("");
          setSubmitError("The menu changed while selling — this item is not in the Till menu yet. Refresh the Till to load the latest menu, rebuild the basket, and take payment again. Nothing was charged.");
          return;
        }
        if (String(result?.code || "").startsWith("till_operator_") || result?.code === "till_shift_closed" || result?.code === "shift_not_open") {
          // Till/PIN gates must not settle the attempt: the sale may already
          // be recorded server-side. Keep the envelope so the retry after PIN
          // re-verification checks the original sale instead of opening a new
          // one with fresh keys.
          clearTillOperatorState({ showUnlock: true, message: result?.error || "Verify the operator PIN again." });
          setSubmitError(result?.error || "The order was not accepted.");
          return;
        }
        // The server answered definitively, so the outcome is no longer
        // uncertain. A corrected cart is a new sale and must get a new
        // envelope; the old attempt must not be replayed with new keys.
        submitEnvelopeRef.current = null;
        setRecoveredAttempt(null);
        setSubmitNotice("");
        setSubmitError(result?.error || "The order was not accepted.");
        return;
      }
      submitEnvelopeRef.current = null;
      setRecoveredAttempt(null);
      setSubmitNotice("");
      if (servicePayload.openSession) {
        // The paid tab is closed server-side. Drop the resume state so a
        // follow-up sale resolves a fresh tab instead of reusing a closed
        // id. This applies to recovered replays too: replaying the stored
        // receipt must not leave a stale resume behind.
        navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
      }
      const hardware = await window.api?.pos
        ?.getHardwareSettings?.()
        .catch(() => null);
      const provisional = result.offline === true || result.provisional === true;
      // Offline receipts must still carry a receipt number and real line
      // prices: the main process returns a provisional TILL- number, and each
      // line gets authoritative-looking subtotals from qty × unit price so the
      // customer copy never shows "UNAVAILABLE".
      const receiptLines = (Array.isArray(orderItems) ? orderItems : []).map((item) => {
        const qty = Number(item?.quantity || 0);
        const unit = Number(item?.unit_price || 0);
        const lineTotal = qty * unit;
        return {
          ...item,
          quantity: qty,
          unit_price: unit,
          subtotal: item?.subtotal ?? lineTotal,
          net_subtotal: item?.net_subtotal ?? item?.subtotal ?? lineTotal,
          gross_subtotal: item?.gross_subtotal ?? item?.subtotal ?? lineTotal,
        };
      });
      const receiptOrder = provisional
        ? {
            ...orderPayload,
            _pending_sync: true,
            provisional: true,
            receipt_number: result?.receipt_number || result?.order?.receipt_number || orderPayload?.receipt_number || null,
            pos_order_items: receiptLines,
          }
        : {
            ...result,
            receipt_number: result.receipt_number || null,
            created_at: result.server_received_at || result.created_at,
            pos_order_items: Array.isArray(result.items) ? result.items : [],
          };
      // Display-only tendering aids for this terminal's reprints. Separate
      // fields from the ledger allocation by construction.
      const receiptWithCash =
        cashTenderMeta && cashTenderMeta.cash_received != null
          ? {
              ...receiptOrder,
              cash_received: cashTenderMeta.cash_received,
              change_due: cashTenderMeta.change_due,
            }
          : receiptOrder;
      // This terminal's last receipt for independent reprinting (print
      // failure never re-submits payment). Keyed per outlet; absent
      // received/change simply renders allocation-only.
      writeJsonSetting(
        lastReceiptKey(lodgeId, selectedOutlet.id),
        receiptWithCash,
      );
      setLastReceipt(receiptWithCash);
      setCompletedReceipt({
        order: {
          ...receiptWithCash,
          _open_drawer_on_print:
            Array.isArray(receiptOrder.payment_breakdown) &&
            receiptOrder.payment_breakdown.some((row) => row.method === "cash") &&
            hardware?.cash_drawer_open_on_cash === true,
        },
        autoPrint: hardware?.auto_print_receipts === true,
      });
      // Leave the guest screen on the finished sale with the change due, so
      // the customer sees it without crowding the till. The next basket
      // replaces it automatically via the live feed above.
      if (cashTenderMeta && cashTenderMeta.change_due != null && selectedOutlet?.id) {
        window.api?.pos?.updateCustomerDisplay?.({
          outlet_id: selectedOutlet.id,
          table_name: tabName?.trim() || tableName?.trim() || null,
          staff_name: (verifiedOperator || user)?.name || (verifiedOperator || user)?.email || null,
          items: orderItems.map((item) => ({
            item_name: item.item_name,
            quantity: Number(item.quantity || 0),
            unit_price: Number(item.unit_price || 0),
            modifiers: item.modifiers || [],
            item_notes: item.item_notes || null,
          })),
          subtotal: Number(result.total ?? total),
          discount_total: 0,
          tax_total: 0,
          tip_total: 0,
          total: Number(result.total ?? total),
          cash_received: cashTenderMeta.cash_received,
          change_due: cashTenderMeta.change_due,
          message: 'Thank you — please take your change.',
        }).catch(() => {});
      }
      if (!retryingSubmit && selectedCustomerId && !result.offline && tillEntitlements.canAccounts) {
        // Loyalty is a post-sale repair path, so it may only use the
        // server-confirmed sale total. Never derive points from the client cart.
        const points = Number.isFinite(Number(result.total)) ? Math.floor(Number(result.total) / 10) : 0;
        if (points > 0) {
          const loyaltyResult = await Promise.resolve(
            window.api?.pos?.awardLoyalty?.({
              customerId: selectedCustomerId,
              orderId: result.id,
              points,
              description: `Order ${result.receipt_number || result.id || ""}`,
            }),
          ).catch((error) => ({ success: false, error: error.message }));
          if (loyaltyResult?.success === false) {
            const repair = await window.api?.pos?.queueLoyaltyRepair?.({
              customerId: selectedCustomerId,
              orderId: result.id,
              points,
              operationId: `loyalty:${result.id}:${selectedCustomerId}`,
              description: `Repair loyalty award for ${result.receipt_number || result.id}`,
            }).catch((repairError) => ({ success: false, error: repairError?.message || "repair queue unavailable" }));
            postOrderNotice = repair?.success
              ? ` Order recorded; loyalty repair ${repair.repair_id || "queued"} is pending.`
              : ` Order recorded; loyalty needs follow-up and was not queued: ${repair?.error || loyaltyResult.error || "award failed."}`;
          }
        }
      }
      // The payment stands even when the follow-up tab close fails (e.g. the
      // tab belongs to another waiter). Surface it so the open tab is not a
      // silent surprise in Open Tabs.
      if (result?.tab_close_warning) {
        postOrderNotice += ` Payment recorded, but the tab did not close and is still open: ${result.tab_close_warning}`;
      }
      playTillBeep();
      noteSaleForShift(cart);
      setCart([]);
      setSelectedCustomerId("");
      setDeliveryAddress("");
      setDeliveryNotes("");
      setChargeToAccount(false);
      setVoucherCode("");
      setVoucherAmount("");
      setTipAmount("");
      setSplitCashAmount("");
      setCashReceived("");
      setPaymentReferences({ card: "", mobile_money: "" });
      setShowPayment(false);
      if (sharedTerminalMode) {
        if (tillOperatorPolicy.mode === TILL_OPERATOR_MODES.STRICT) {
          clearTillOperatorState({ notifyMain: true });
        } else {
          const session = result?.till_session;
          setOperatorLastActivityAt(session?.lastActivityAt || Date.now());
          setTillSessionExpiresAt(session?.expiresAt || tillSessionExpiresAt);
        }
      }
      setSuccessMessage(
        (retryingSubmit
          ? "The original operation completed or replayed under its existing key. Check the receipt and Reports before taking another payment."
          : result.offline === true
            ? "Order saved locally and waiting to sync."
            : "Order sent and payment recorded.") + postOrderNotice,
      );
      if (shouldLoadTillTables(barOnly)) {
        const latestTables = await Promise.resolve(
          window.api?.pos?.getTablesWithStatus?.(selectedOutlet.id),
        ).catch(() => null);
        if (Array.isArray(latestTables)) setTables(latestTables);
      }
      // Counts just moved on the server: re-read readiness quietly so newly
      // finished items grey out without another sale failing first. Silent
      // failures keep the current badges; the manual Refresh path still
      // reports errors loudly.
      refreshReadiness({ silent: true }).catch(() => {});
    } catch (error) {
      setSubmitError(
        error?.message || "Could not complete this order. Nothing was cleared.",
      );
    } finally {
      if (tabLockId) {
        Promise.resolve(window.api?.mesh?.unlockTab?.(tabLockId)).catch(() => {});
        tabLockId = null;
      }
      setSubmitting(false);
    }
  }, [
    cart,
    barOnly,
    canUseTips,
    canUseVoucher,
    chargeToAccount,
    clearTillOperatorState,
    currentShift?.id,
    deliveryAddress,
    deliveryNotes,
    drawerGateNeeded,
    modifierGroups,
    modifiersReady,
    noteSaleForShift,
    paymentMethod,
    paymentReferences,
    refreshReadiness,
    splitCashAmount,
    splitRemainderMethod,
    sharedTerminalMode,
    tillOperatorPolicy,
    tillEntitlements,
    tipTotal,
    selectedCustomer?.name,
    selectedCustomerId,
    selectedOutlet,
    selectedPromotion?.id,
    serviceMode,
    submitting,
    subtotal,
    tableName,
    tabName,
    tax,
    taxRate,
    tenderBreakdownResult,
    tillSessionExpiresAt,
    total,
    user?.email,
    user?.id,
    user?.name,
    verifiedOperator,
    voucherAmount,
    voucherCode,
    cashReceived,
    resumedTabInfo?.id,
    location.state?.tabId,
  ]);

  return (
    <>
      <div
        className="hpos-terminal"
        style={{ display: "flex", height: "100%", overflow: "hidden" }}
      >
        {/* Left: Product Grid */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Top Bar: compact so the grid + basket own the pixels. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 12px",
              borderBottom: "1px solid rgba(55,70,57,.10)",
              background: "#fffdf8",
              flexShrink: 0,
            }}
          >
            <div style={{ minWidth: 44 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 900,
                  color: "#a83c26",
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                }}
              >
                {barOnly ? "Bar sales" : "Till"}
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--bb-text)" }}>
                {barOnly ? "Sell" : "New check"}
              </div>
            </div>
            <div style={{ position: "relative", flex: 1, maxWidth: "360px" }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: "10px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--bb-text-muted)",
                }}
              />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!tryAddBySearch(search)) {
                      // keep filtered list when no exact barcode/name match
                    }
                  }
                }}
                placeholder={barProfile.searchPlaceholder}
                aria-label={barProfile.searchPlaceholder}
                style={{
                  width: "100%",
                  minHeight: "44px",
                  padding: search ? "10px 92px 10px 32px" : "10px 48px 10px 32px",
                  borderRadius: "8px",
                  border: "1px solid rgba(55,70,57,.16)",
                  background: "var(--bb-surface)",
                  color: "var(--bb-text)",
                  fontSize: "13px",
                  outline: "none",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  right: "2px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  display: "flex",
                  alignItems: "center",
                  gap: "2px",
                }}
              >
                {search ? (
                  <button
                    type="button"
                    ref={searchClearRef}
                    onClick={() => {
                      setSearch("");
                      searchRef.current?.focus();
                    }}
                    aria-label="Clear search"
                    title="Clear search"
                    style={{
                      width: "44px",
                      height: "44px",
                      display: "grid",
                      placeItems: "center",
                      border: "none",
                      borderRadius: "8px",
                      background: "transparent",
                      color: "var(--bb-text-muted)",
                      cursor: "pointer",
                    }}
                  >
                    <X size={16} />
                  </button>
                ) : null}
                <button
                  type="button"
                  ref={searchKeyboardToggleRef}
                  onClick={() => setShowSearchKeyboard((open) => !open)}
                  aria-label={
                    showSearchKeyboard
                      ? "Hide on-screen search keyboard"
                      : "Show on-screen search keyboard"
                  }
                  aria-expanded={showSearchKeyboard}
                  aria-controls="hpos-search-keyboard"
                  title="On-screen keyboard"
                  style={{
                    width: "44px",
                    height: "44px",
                    display: "grid",
                    placeItems: "center",
                    border: "none",
                    borderRadius: "8px",
                    background: showSearchKeyboard
                      ? "var(--bb-accent)"
                      : "transparent",
                    color: showSearchKeyboard ? "#fff" : "var(--bb-text-muted)",
                    cursor: "pointer",
                  }}
                >
                  <Keyboard size={18} />
                </button>
              </div>
              <div
                aria-live="polite"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: "calc(100% + 4px)",
                  zIndex: 4,
                  pointerEvents: "none",
                }}
              >
                {scannerFeedback && (
                  <div
                    role={scannerFeedback.level === "error" ? "alert" : "status"}
                    style={{
                      padding: "7px 9px",
                      borderRadius: "8px",
                      fontSize: "11px",
                      fontWeight: 700,
                      color:
                        scannerFeedback.level === "error" ? "#9f2f1f" : "#176447",
                      background:
                        scannerFeedback.level === "error" ? "#fff1ed" : "#edfbf3",
                      border:
                        scannerFeedback.level === "error"
                          ? "1px solid #f3c0b4"
                          : "1px solid #b5e4c9",
                    }}
                  >
                    {scannerFeedback.message}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {serviceModeOptions.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setServiceMode(mode.id)}
                  aria-pressed={serviceMode === mode.id}
                  style={{
                    minHeight: "44px",
                    padding: "10px 14px",
                    borderRadius: "10px",
                    border: "1px solid",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                    borderColor:
                      serviceMode === mode.id
                        ? "var(--bb-accent)"
                        : "rgba(55,70,57,.14)",
                    background: serviceMode === mode.id ? "var(--bb-accent)" : "#fffdf8",
                    color: serviceMode === mode.id ? "#fff" : "var(--bb-text)",
                  }}
                >
                  {mode.emoji ? `${mode.emoji} ${mode.label}` : mode.label}
                </button>
              ))}
            </div>
            <div
              role="status"
              title={
                scannerSettings.barcode_scanner_enabled === false
                  ? "Barcode scanner is turned off in System Health › Devices."
                  : showPayment
                    ? "Scanner paused because the payment panel is open — scans would type into the cash/approval fields. Close or finish payment to scan again."
                    : showShiftStart
                      ? "Scanner paused because the Start shift dialog is open. Start or cancel the shift to scan again."
                      : showOperatorUnlock
                        ? "Scanner paused because Till is locked — unlock with the operator PIN first so scans land in the right shift."
                        : modifierLineId != null
                          ? "Scanner paused while customizing an item. Close the modifier sheet to scan again."
                          : Boolean(completedReceipt)
                            ? "Scanner paused while the receipt is open. Close or start a new sale to scan again."
                            : "USB/Bluetooth keyboard-wedge scanners are verified by successful input, not by a permanent connection signal."
              }
              style={{
                marginLeft: "auto",
                padding: "5px 8px",
                borderRadius: "999px",
                whiteSpace: "nowrap",
                fontSize: "10px",
                fontWeight: 800,
                  color:
                    scannerSettings.barcode_scanner_enabled === false
                      ? "#7b6d72"
                      : showPayment || showShiftStart || showOperatorUnlock || modifierLineId != null || Boolean(completedReceipt)
                      ? "#8b5a11"
                      : "#176447",
                  background:
                    scannerSettings.barcode_scanner_enabled === false
                      ? "#f1ece8"
                      : showPayment || showShiftStart || showOperatorUnlock || modifierLineId != null || Boolean(completedReceipt)
                      ? "#fff6df"
                      : "#edfbf3",
                }}
              >
              {scannerSettings.barcode_scanner_enabled === false
                ? "Scanner disabled"
                : showPayment || showShiftStart || showOperatorUnlock || modifierLineId != null || Boolean(completedReceipt)
                ? "Scanner paused"
                : "Scanner ready"}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
              padding: "6px 12px",
              borderBottom: "1px solid rgba(55,70,57,.08)",
              background: "#f6efe5",
              flexShrink: 0,
            }}
          >
            {lastNotFoundBarcode && (
              <div
                role="status"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flex: "1 1 100%",
                  padding: "8px 10px",
                  borderRadius: "9px",
                  background: "#fff8ea",
                  border: "1px solid rgba(166, 118, 42, 0.35)",
                  color: "#6b4a0b",
                  fontSize: "12px",
                  fontWeight: 700,
                }}
              >
                <span style={{ flex: 1 }}>
                  Barcode {lastNotFoundBarcode} isn&apos;t a product yet.
                </span>
                {canCreateProduct && (
                  <button
                    type="button"
                    onClick={() => {
                      const code = lastNotFoundBarcode;
                      setLastNotFoundBarcode(null);
                      navigate("/hpos/menu", {
                        state: { createBarcode: code },
                      });
                    }}
                    style={{
                      minHeight: "44px",
                      padding: "0 12px",
                      borderRadius: "8px",
                      border: "1px solid rgba(166, 118, 42, 0.45)",
                      background: "#fff",
                      color: "#6b4a0b",
                      fontSize: "12px",
                      fontWeight: 800,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Create product
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Dismiss unknown barcode"
                  onClick={() => setLastNotFoundBarcode(null)}
                  style={{
                    minWidth: "44px",
                    minHeight: "44px",
                    borderRadius: "8px",
                    border: "none",
                    background: "transparent",
                    color: "#6b4a0b",
                    fontSize: "16px",
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
              </div>
            )}
            <select
              value={selectedOutlet?.id || ""}
              onChange={(event) => chooseTerminalOutlet(event.target.value)}
              aria-label="Outlet for this Till"
              title="Saved on this computer only"
              style={{
                minWidth: "150px",
                padding: "8px 10px",
                borderRadius: "9px",
                border: "1px solid rgba(55,70,57,.16)",
                background: "#fffdf8",
                color: "var(--bb-text)",
                fontSize: "12px",
              }}
            >
              <option value="">Select outlet</option>
              {outlets
                .filter(
                  (outlet) =>
                    outlet.is_active !== false && outlet.active !== false,
                )
                .filter((outlet) => outletIsAllowed(outlet.id))
                .map((outlet) => (
                  <option key={outlet.id} value={outlet.id}>
                    {outlet.name}
                  </option>
                ))}
            </select>
            {serviceMode === "table" && (
              <select
                value={tableName}
                onChange={(event) => selectTable(event.target.value)}
                style={{
                  minWidth: "160px",
                  padding: "8px 10px",
                  borderRadius: "9px",
                  border: "1px solid rgba(55,70,57,.16)",
                  background: "#fffdf8",
                  color: "var(--bb-text)",
                  fontSize: "12px",
                }}
              >
                <option value="">Select table</option>
                {tables
                  .filter((table) => table.active !== false)
                  .map((table) => (
                    <option key={table.id || table.name} value={table.name}>
                      {table.name}
                      {table.tab ? " · Open check" : ""}
                    </option>
                  ))}
              </select>
            )}
            {serviceMode === "tab" && (
              <input
                value={tabName}
                onChange={(event) => setTabName(event.target.value)}
                placeholder="Tab name (e.g. Thabo, Corner)"
                list="hpos-open-tab-suggestions"
                style={{
                  minWidth: "180px",
                  padding: "8px 10px",
                  borderRadius: "9px",
                  border: "1px solid rgba(55,70,57,.16)",
                  background: "#fffdf8",
                  color: "var(--bb-text)",
                  fontSize: "12px",
                }}
              />
            )}
            {serviceMode === "tab" && (
              <datalist id="hpos-open-tab-suggestions">
                {barOnly
                  ? openTabNames.map((name) => (
                      <option key={name} value={name} />
                    ))
                  : tables
                      .filter((table) => table.active !== false)
                      .map((table) => (
                        <option
                          key={table.id || table.name}
                          value={table.name || table.tab_name || ""}
                        />
                      ))}
              </datalist>
            )}
            {(serviceMode === "takeaway" ||
              serviceMode === "delivery" ||
              serviceMode === "counter") &&
              tillEntitlements.canAccounts && (
              <select
                value={selectedCustomerId}
                onChange={(event) => {
                  setSelectedCustomerId(event.target.value);
                  setChargeToAccount(false);
                }}
                style={{
                  minWidth: "170px",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  border: "1px solid rgba(55,70,57,.14)",
                  background: "#fffdf8",
                  color: "var(--bb-text)",
                  fontSize: "12px",
                }}
              >
                <option value="">
                  {serviceMode === "counter"
                    ? "Walk-up customer"
                    : "Walk-in customer"}
                </option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                    {customer.loyalty_points
                      ? ` · ${customer.loyalty_points} pts`
                      : ""}
                  </option>
                ))}
              </select>
            )}
            {sharedTerminalMode && (
              <button
                type="button"
                className={
                  verifiedOperator
                    ? "hpos-till-operator-trigger is-active"
                    : "hpos-till-operator-trigger"
                }
                onClick={() => {
                  if (verifiedOperator) {
                    clearTillOperatorState({ showUnlock: true });
                  } else {
                    setShowOperatorUnlock(true);
                    // Fresh attendance for the unlock list; failures fail open.
                    setUnlockActiveStaffIds(null);
                    setUnlockIsOnline(null);
                    Promise.resolve(window.api?.pos?.getActiveShifts?.()).then((rows) => {
                      setUnlockActiveStaffIds((Array.isArray(rows) ? rows : []).map((row) => row.staff_user_id));
                    }).catch(() => setUnlockActiveStaffIds(null));
                    Promise.resolve(window.api?.sync?.getStatus?.()).then((status) => {
                      setUnlockIsOnline(status?.isOnline !== false);
                    }).catch(() => setUnlockIsOnline(null));
                  }
                }}
              >
                {verifiedOperator
                  ? `Serving as ${verifiedOperator.name || verifiedOperator.email}`
                  : "Unlock Till"}
              </button>
            )}
            {sharedTerminalMode && verifiedOperator && (
              <button
                type="button"
                className="hpos-till-operator-trigger"
                onClick={() => navigate("/hpos/my-sales")}
              >
                <ReceiptText size={15} /> My sales
              </button>
            )}
            {currentShift ? (
              <span
                style={{
                  alignSelf: "center",
                  color: "var(--bb-success)",
                  background: "rgba(72,125,87,.09)",
                  border: "1px solid rgba(72,125,87,.18)",
                  borderRadius: 999,
                  padding: "5px 9px",
                  fontSize: "11px",
                  fontWeight: 800,
                }}
              >
                Shift open
                {shiftPaceItems > 0 ? ` · ${shiftPaceItems} sold` : ""}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setShowShiftStart(true)}
                style={{
                  alignSelf: "center",
                  color: "#a9442f",
                  background: "#fff1ea",
                  border: "1px solid rgba(169,68,47,.22)",
                  borderRadius: 999,
                  padding: "6px 10px",
                  fontSize: "11px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Start shift
              </button>
            )}
          </div>
          {selectedOpenTab && serviceMode === "table" && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                padding: "8px 16px",
                background: "#fff4d8",
                borderBottom: "1px solid rgba(201,86,53,.14)",
                color: "#7c4b25",
                fontSize: 11,
              }}
            >
              <strong>{tableName} has an open check</strong>
              <span>
                {Array.isArray(selectedOpenTab.items)
                  ? `${selectedOpenTab.items.length} line(s)`
                  : "Running"}{" "}
                · {selectedOpenTab.waiter_name || "Current operator"}
              </span>
            </div>
          )}
          {serviceMode === "delivery" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 1fr",
                gap: 8,
                padding: "10px 16px",
                background: "#edf3f7",
                borderBottom: "1px solid rgba(55,70,57,.08)",
              }}
            >
              <input
                value={deliveryAddress}
                onChange={(event) => setDeliveryAddress(event.target.value)}
                placeholder="Delivery address"
                style={{
                  padding: "9px 11px",
                  borderRadius: 9,
                  border: "1px solid rgba(55,70,57,.14)",
                  background: "#fff",
                  fontSize: 12,
                }}
              />
              <input
                value={deliveryNotes}
                onChange={(event) => setDeliveryNotes(event.target.value)}
                placeholder="Driver notes (optional)"
                style={{
                  padding: "9px 11px",
                  borderRadius: 9,
                  border: "1px solid rgba(55,70,57,.14)",
                  background: "#fff",
                  fontSize: 12,
                }}
              />
            </div>
          )}
          {canUseVoucher &&
            serviceMode !== "table" &&
            serviceMode !== "tab" &&
            !selectedCustomer && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "9px 16px",
                  background: "var(--bb-surface)",
                  borderBottom: "1px solid rgba(55,70,57,.08)",
                }}
              >
                <input
                  value={voucherCode}
                  onChange={(event) =>
                    setVoucherCode(event.target.value.toUpperCase())
                  }
                  placeholder="Voucher code"
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(55,70,57,.14)",
                    background: "#fff",
                    fontSize: 12,
                  }}
                />
                <input
                  value={voucherAmount}
                  onChange={(event) => setVoucherAmount(event.target.value)}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Amount"
                  style={{
                    width: 100,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(55,70,57,.14)",
                    background: "#fff",
                    fontSize: 12,
                  }}
                />
              </div>
            )}

          <div
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              padding: "12px 16px",
              borderBottom: "1px solid rgba(55,70,57,.08)",
              background: "var(--bb-surface)",
              flexShrink: 0,
            }}
          >
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                aria-pressed={activeCategory === category}
                style={{
                  whiteSpace: "nowrap",
                  minHeight: "44px",
                  padding: "12px 18px",
                  borderRadius: 999,
                  border: `1px solid ${activeCategory === category ? "var(--bb-accent)" : "rgba(55,70,57,.14)"}`,
                  background:
                    activeCategory === category ? "var(--bb-accent)" : "#fffdf8",
                  color: activeCategory === category ? "#fff" : "var(--bb-text)",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
                >
                  {category}
                  {typeof categoryCounts[category] === "number" && (
                    <span
                      aria-hidden="true"
                      style={{
                        display: "inline-block",
                        marginLeft: 8,
                        minWidth: 22,
                        padding: "2px 6px",
                        borderRadius: 999,
                        fontSize: "11px",
                        fontWeight: 800,
                        lineHeight: 1.3,
                        color:
                          activeCategory === category
                            ? "rgba(255,255,255,.92)"
                            : "var(--bb-text-muted)",
                        background:
                          activeCategory === category
                            ? "rgba(255,255,255,.22)"
                            : "rgba(55,70,57,.08)",
                      }}
                    >
                      {categoryCounts[category]}
                    </span>
                  )}
                </button>
            ))}
          </div>

          {/* Recently sold this shift — device-local chips for one-tap repeat. */}
          {recentSold.length > 0 && (
            <div
              role="list"
              aria-label="Recently sold this shift"
              style={{
                display: "flex",
                gap: 8,
                overflowX: "auto",
                padding: "8px 16px",
                borderBottom: "1px solid rgba(55,70,57,.08)",
                background: "var(--bb-surface)",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  alignSelf: "center",
                  whiteSpace: "nowrap",
                  fontSize: 11,
                  fontWeight: 800,
                  color: "var(--bb-text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                }}
              >
                Just sold
              </span>
              {recentSold.map((id) => {
                const menu = (tillMenuItems || []).find((row) => String(row.id) === id);
                if (!menu) return null;
                const issue = getStockIssue(menu);
                const blocked =
                  issue === "unknown" ||
                  issue === "issue" ||
                  menu.is_available === false ||
                  menu.available === false ||
                  menu.sold_out ||
                  isFinishedStock(menu);
                return (
                  <button
                    key={id}
                    type="button"
                    role="listitem"
                    disabled={blocked}
                    aria-label={`Add ${menu.name} again`}
                    onClick={() => {
                      if (blocked) return;
                      addToCart(menu);
                      playTillBeep();
                    }}
                    style={{
                      whiteSpace: "nowrap",
                      minHeight: 44,
                      padding: "8px 14px",
                      borderRadius: 999,
                      border: "1px solid rgba(55,70,57,.14)",
                      background: blocked ? "#f7f1e8" : "#fffdf8",
                      color: blocked ? "var(--bb-text-muted)" : "var(--bb-text)",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: blocked ? "not-allowed" : "pointer",
                      opacity: blocked ? 0.7 : 1,
                    }}
                  >
                    {menu.name}
                  </button>
                );
              })}
            </div>
          )}

          {/* Product Grid */}
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: "16px 18px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              gap: "12px",
              alignContent: "start",
            }}
          >
            {loading ? (
              <>
                <div
                  role="status"
                  style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    padding: 0,
                    margin: -1,
                    overflow: "hidden",
                    clip: "rect(0, 0, 0, 0)",
                    whiteSpace: "nowrap",
                    border: 0,
                  }}
                >
                  {barOnly ? `Loading drinks (${loadingStage})…` : `Loading menu (${loadingStage})…`}
                </div>
                {Array.from({ length: 10 }, (_, index) => (
                  <div key={index} className="hpos-skeleton" aria-hidden="true" />
                ))}
              </>
            ) : filtered.length === 0 ? (
              <div
                style={{
                  gridColumn: "1 / -1",
                  padding: "48px 24px",
                  textAlign: "center",
                  color: "var(--bb-text-muted)",
                  fontSize: "13px",
                }}
              >
                <p style={{ margin: 0, fontSize: "14px", fontWeight: 800, color: "var(--bb-text)" }}>
                  {menuLoadFailed ? "Products could not load" : "No items found"}
                </p>
                <p style={{ margin: "6px 0 0", lineHeight: 1.5 }}>
                  {menuLoadFailed
                    ? "The catalogue read failed — do not assume the menu is empty. Retry when the connection is back."
                    : search || activeCategory !== "All"
                      ? "Nothing matches the current search and category."
                      : "No products are linked for this outlet yet."}
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    justifyContent: "center",
                    flexWrap: "wrap",
                    marginTop: 14,
                  }}
                >
                  {menuLoadFailed && (
                    <button
                      type="button"
                      onClick={retryCoreLoad}
                      style={{
                        minHeight: 44,
                        padding: "10px 16px",
                        borderRadius: 10,
                        border: "1px solid rgba(201,86,53,.35)",
                        background: "var(--bb-accent)",
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      Retry loading products
                    </button>
                  )}
                  {!menuLoadFailed && (search || activeCategory !== "All") && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch("");
                        setActiveCategory("All");
                      }}
                      style={{
                        minHeight: 44,
                        padding: "10px 16px",
                        borderRadius: 10,
                        border: "1px solid rgba(55,70,57,.16)",
                        background: "#fffdf8",
                        color: "var(--bb-text)",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Clear search and show all
                    </button>
                  )}
                  {!menuLoadFailed && (search || activeCategory !== "All") && (
                    <>
                      {hasTopSellers && (
                        <button
                          type="button"
                          onClick={() => {
                            setSearch("");
                            setActiveCategory(TOP_SELLERS_CATEGORY);
                          }}
                          style={{
                            minHeight: 44,
                            padding: "10px 16px",
                            borderRadius: 10,
                            border: "1px solid rgba(55,70,57,.16)",
                            background: "#fffdf8",
                            color: "var(--bb-text)",
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          Show top sellers
                        </button>
                      )}
                      {favourites.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setSearch("");
                            setActiveCategory(FAVOURITES_CATEGORY);
                          }}
                          style={{
                            minHeight: 44,
                            padding: "10px 16px",
                            borderRadius: 10,
                            border: "1px solid rgba(55,70,57,.16)",
                            background: "#fffdf8",
                            color: "var(--bb-text)",
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          Show favourites
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              filtered.map((item) => {
                const issue = getStockIssue(item);
                const provisionalSyncing = issue === "provisional" && stockReadiness.status === "ready";
                return (
                  <ProductCard
                    key={item.id}
                    item={item}
                    onAdd={addToCart}
                    onAddQty={(item) => {
                      setMultiAddItem(item);
                      setMultiAddQty("2");
                    }}
                    onToggleFavourite={toggleFavourite}
                    isFavourite={favouriteIdSet.has(item.id)}
                    stockSetupRequired={issue === "issue"}
                    statusUnknown={issue === "unknown"}
                    lowStock={lowStockMap[item.inventory_item_id] || null}
                    finishedStock={isFinishedStock(item)}
                    syncBlocked={provisionalSyncing}
                    pendingSync={issue === "provisional" && !provisionalSyncing}
                    inBasketQty={cartQtyByItem.get(item.id) || 0}
                  />
                );
              })
            )}
          </div>
          {narrowViewport && (
          <button
            type="button"
            onClick={() => setBasketOpen((open) => !open)}
            aria-expanded={basketVisible}
            aria-label={basketOpen ? "Hide sale basket" : "Show sale basket"}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "12px 16px",
              minHeight: "56px",
              borderTop: "1px solid rgba(55,70,57,.14)",
              background: "var(--bb-text)",
              color: "#fffdf8",
              fontSize: "15px",
              fontWeight: 800,
              cursor: "pointer",
              borderLeft: "none",
              borderRight: "none",
              borderBottom: "none",
              width: "100%",
            }}
          >
            <span>
              {serviceMode === "tab" ? "Tab" : barOnly ? "Sale" : "Order"} · {currency} {fmt(total)}
              {itemCount > 0 ? ` · ${itemCount} item${itemCount === 1 ? "" : "s"}` : ""}
            </span>
            <span aria-hidden="true">{basketOpen ? "▾" : "▴"}</span>
          </button>
          )}
        </div>
        {/* Right: Order Panel. minHeight 0 + hidden overflow keeps the flex
            column constrained so ONLY the cart list scrolls (flex 1,
            minHeight 0) — the payment footer never scrolls and Record payment
            stays on screen. Panel widened 372->440 so item names read fully. */}
        <div
          style={
            narrowViewport
              ? {
                  position: "fixed",
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: "min(460px, 94vw)",
                  zIndex: 1500,
                  transform: basketVisible ? "none" : "translateX(105%)",
                  transition: "transform 180ms ease",
                  background: "rgba(255,250,242,.98)",
                  borderLeft: "1px solid rgba(55,70,57,.14)",
                  boxShadow: "-16px 0 48px rgba(47,58,47,.22)",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                  overflow: "hidden",
                }
              : {
                  width: "440px",
                  flexShrink: 0,
                  background: "rgba(255,250,242,.96)",
                  borderLeft: "1px solid rgba(55,70,57,.14)",
                  boxShadow: "-12px 0 32px rgba(47,58,47,.08)",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                  overflow: "hidden",
                }
          }
        >
          {narrowViewport && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px 0",
              }}
            >
              <span style={{ fontSize: "12px", fontWeight: 800, color: "#526157" }}>
                Sale basket
              </span>
              <button
                type="button"
                onClick={() => setBasketOpen(false)}
                aria-label="Hide sale basket"
                style={{
                  minWidth: "44px",
                  minHeight: "44px",
                  borderRadius: "10px",
                  border: "1px solid rgba(55,70,57,.2)",
                  background: "#fffdf8",
                  color: "var(--bb-text)",
                  fontSize: "16px",
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>
          )}
          {/* Order Header */}
          {draftPersistFailed && (
            <ErrorNotice
              style={{
                margin: "12px 16px 0",
                padding: "10px 12px",
                borderRadius: "10px",
                background: "rgba(191, 72, 45, 0.12)",
                border: "1px solid rgba(191, 72, 45, 0.32)",
                color: "#8d2f24",
                fontSize: "13px",
                fontWeight: 700,
              }}
            >
              This terminal cannot store the unsent basket. Complete, hold, or
              pay for this sale promptly — it will not survive a restart.
            </ErrorNotice>
          )}
          {barOnly && (Number(stockReadiness.meshOrders || 0) > 0 || Number(stockReadiness.meshDeliveries || 0) > 0 || (!(Number(stockReadiness.meshOrders || 0) > 0) && Number(stockReadiness.pendingOrders || 0) > 0)) && (
            <div
              role="status"
              style={{
                margin: "8px 16px 0",
                padding: unsentNoticeMin ? "4px 10px" : "6px 10px",
                borderRadius: "999px",
                background: "#edfbf3",
                border: "1px solid #b5e4c9",
                color: "#176447",
                fontSize: "12px",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span>
                {unsentNoticeMin
                  ? `Unsent sales included (${Number(stockReadiness.meshOrders || 0) + Number(stockReadiness.pendingOrders || 0)})`
                  : (Number(stockReadiness.meshOrders || 0) > 0 || Number(stockReadiness.meshDeliveries || 0) > 0
                    ? `Includes unsent work from the other till${Number(stockReadiness.meshOrders || 0) > 0 ? ` (${stockReadiness.meshOrders} sale${stockReadiness.meshOrders === 1 ? "" : "s"})` : ""}${Number(stockReadiness.meshDeliveries || 0) > 0 ? " plus stock it received" : ""} — counts play it safe until they send.`
                    : "Includes your unsent sales — counts play it safe until they send.")}
              </span>
              <button
                type="button"
                onClick={() => setUnsentNoticeMin((min) => !min)}
                aria-label={unsentNoticeMin ? "Show unsent sales details" : "Collapse unsent sales notice"}
                style={{ minWidth: "32px", minHeight: "32px", borderRadius: "999px", border: "1px solid #b5e4c9", background: "#fff", color: "#176447", fontWeight: 800, cursor: "pointer" }}
              >
                {unsentNoticeMin ? "+" : "–"}
              </button>
            </div>
          )}
          {barOnly && (stockReadiness.status === "stale" || stockReadiness.status === "local") && (
            <div
              role="status"
              style={{
                margin: "8px 16px 0",
                padding: stockNoticeMin ? "4px 10px" : "6px 10px",
                borderRadius: "999px",
                background: "#fff8ea",
                border: "1px solid rgba(166, 118, 42, 0.35)",
                color: "#7a5710",
                fontSize: "12px",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span>
                {stockNoticeMin
                  ? "Offline stock — tap + for details"
                  : (stockReadiness.status === "local"
                    ? "Selling on this till's last known stock — counts may be behind. Refresh when online."
                    : <>Stock status from{" "}
                  {stockReadiness.cachedAt
                    ? new Date(stockReadiness.cachedAt).toLocaleString()
                    : "an earlier check"}{" "}
                  — refresh when online.</>)}
              </span>
              <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {!stockNoticeMin && (
                  <button
                    type="button"
                    onClick={refreshReadiness}
                    style={{
                      minHeight: "32px",
                      padding: "0 12px",
                      borderRadius: "999px",
                      border: "1px solid rgba(166, 118, 42, 0.45)",
                      background: "#fff",
                      color: "#6b4a0b",
                      fontSize: "12px",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    Refresh
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setStockNoticeMin((min) => !min)}
                  aria-label={stockNoticeMin ? "Show offline stock details" : "Collapse offline stock notice"}
                  style={{ minWidth: "32px", minHeight: "32px", borderRadius: "999px", border: "1px solid rgba(166, 118, 42, 0.45)", background: "#fff", color: "#6b4a0b", fontWeight: 800, cursor: "pointer" }}
                >
                  {stockNoticeMin ? "+" : "–"}
                </button>
              </span>
            </div>
          )}
          {barOnly && stockReadiness.status === "failed" && (
            <ErrorNotice
              style={{
                margin: "12px 16px 0",
                padding: "10px 12px",
                borderRadius: "10px",
                background: "rgba(191, 72, 45, 0.12)",
                border: "1px solid rgba(191, 72, 45, 0.32)",
                color: "#8d2f24",
                fontSize: "13px",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <span>Stock status unavailable — selling is paused.</span>
              <button
                type="button"
                onClick={refreshReadiness}
                style={{
                  minHeight: "44px",
                  padding: "0 14px",
                  borderRadius: "9px",
                  border: "1px solid rgba(191, 72, 45, 0.4)",
                  background: "#fff",
                  color: "#8d2f24",
                  fontSize: "13px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Refresh
              </button>
            </ErrorNotice>
          )}
          {resumedTabInfo && (
            <div
              role="status"
              style={{
                margin: "12px 16px 0",
                padding: "10px 12px",
                borderRadius: "10px",
                background:
                  resumedTabInfo.found && resumedTabInfo.versionOk
                    ? "rgba(47, 107, 66, 0.10)"
                    : "rgba(191, 72, 45, 0.12)",
                border:
                  resumedTabInfo.found && resumedTabInfo.versionOk
                    ? "1px solid rgba(47, 107, 66, 0.30)"
                    : "1px solid rgba(191, 72, 45, 0.32)",
                color:
                  resumedTabInfo.found && resumedTabInfo.versionOk
                    ? "var(--bb-success)"
                    : "#8d2f24",
                fontSize: "13px",
                fontWeight: 700,
                lineHeight: 1.4,
              }}
            >
              {resumedTabInfo.found && resumedTabInfo.versionOk ? (
                <span>
                  Ready to continue — {resumedTabInfo.name}
                  {resumedTabInfo.waiter ? ` · ${resumedTabInfo.waiter}` : ""}
                </span>
              ) : (
                <span>
                  Tab changed — refresh required. Re-open it from Open tabs
                  before taking payment.
                </span>
              )}
            </div>
          )}
          {pendingRestore && cart.length === 0 && (
            <div
              role="status"
              style={{
                margin: "12px 16px 0",
                padding: "12px",
                borderRadius: "10px",
                background: "linear-gradient(135deg, #fdf3e3, #fffaf0)",
                border: "1px solid rgba(166, 118, 42, 0.35)",
                color: "#7a5710",
                fontSize: "13px",
                fontWeight: 700,
                lineHeight: 1.4,
              }}
            >
              <span>
                The power may have gone off — your unfinished sale from{" "}
                {pendingRestore.draft?.savedAt
                  ? new Date(pendingRestore.draft.savedAt).toLocaleString()
                  : "earlier"}{" "}
                is still here on this terminal. Restore it or discard it.
              </span>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={applyRestore}
                  style={{
                    minHeight: "44px",
                    padding: "0 14px",
                    borderRadius: "9px",
                    border: "1px solid rgba(166, 118, 42, 0.45)",
                    background: "#fff8ea",
                    color: "#6b4a0b",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Restore basket
                </button>
                <button
                  type="button"
                  onClick={discardRestore}
                  style={{
                    minHeight: "44px",
                    padding: "0 14px",
                    borderRadius: "9px",
                    border: "1px solid rgba(55,70,57,.2)",
                    background: "#fff",
                    color: "#526157",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          )}
          {lastRemoved && (
            <div
              role="status"
              style={{
                margin: "12px 16px 0",
                padding: "10px 12px",
                borderRadius: "10px",
                background: "rgba(55,70,57,.07)",
                border: "1px solid rgba(55,70,57,.16)",
                color: "var(--bb-text)",
                fontSize: "13px",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <span>Removed {lastRemoved.line.item_name}</span>
              <button
                type="button"
                onClick={undoRemove}
                style={{
                  minHeight: "44px",
                  padding: "0 14px",
                  borderRadius: "9px",
                  border: "1px solid rgba(55,70,57,.25)",
                  background: "#fffdf8",
                  color: "var(--bb-text)",
                  fontSize: "13px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Undo
              </button>
            </div>
          )}
          <div
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid rgba(55,70,57,.11)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <ShoppingCart size={16} color="#c95635" />
              <span
                style={{ fontSize: "14px", fontWeight: 700, color: "var(--bb-text)" }}
              >
                {serviceMode === "tab" ? "Tab" : barOnly ? "Sale" : "Order"}
              </span>
              {itemCount > 0 && (
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: "999px",
                    background: "rgba(245, 158, 11, 0.12)",
                    color: "var(--bb-accent)",
                  }}
                >
                  {itemCount}
                </span>
              )}
              {openTabCount > 0 && (
                <button
                  type="button"
                  onClick={() => navigate("/hpos/checks")}
                  aria-label={`${openTabCount} open tabs. Review open tabs.`}
                  style={{
                    fontSize: "11px",
                    fontWeight: 800,
                    minHeight: "44px",
                    padding: "0 10px",
                    borderRadius: "999px",
                    border: "1px solid rgba(53,110,216,.3)",
                    background: "rgba(53,110,216,.08)",
                    color: "var(--bb-info)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Open tabs · {openTabCount}
                </button>
              )}
              {drawerGateNeeded && (
                <button
                  type="button"
                  onClick={() => navigate("/hpos/shift-close")}
                  aria-label="Drawer is not open. Open the drawer in Staff shift close before selling."
                  style={{
                    fontSize: "11px",
                    fontWeight: 800,
                    minHeight: "44px",
                    padding: "0 10px",
                    borderRadius: "999px",
                    border: "1px solid rgba(184,74,56,.4)",
                    background: "rgba(184,74,56,.1)",
                    color: "var(--bb-danger)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Drawer not open
                </button>
              )}
            </div>
            {cart.length > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                {poolNightProducts.length > 0 && !hasPoolLines && (
                  <button
                    type="button"
                    onClick={startPoolNight}
                    aria-label="Add all pool tables for the night entry"
                    title="Add every pool table, then type each box cash as quantity"
                    style={{
                      fontSize: "12px",
                      minHeight: "44px",
                      padding: "0 12px",
                      color: "var(--bb-success)",
                      background: "rgba(47, 107, 66, 0.08)",
                      border: "1px solid rgba(47, 107, 66, 0.25)",
                      borderRadius: "10px",
                      cursor: "pointer",
                      fontWeight: 800,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Pool night
                  </button>
                )}
                <button
                  onClick={clearCart}
                  style={{
                    fontSize: "13px",
                    minHeight: "44px",
                    padding: "0 12px",
                    color: "var(--bb-danger)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Clear
                </button>
              </span>
            )}
          </div>

          {/* Reprint lives only in the empty-basket placeholder below: showing
              it mid-sale crowds the basket and hides the payment footer. */}

          {/* Cart Lines: minHeight 0 lets the list shrink so the payment
              footer (Take payment) always stays on screen instead of being
              pushed out of the basket column. */}
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {cart.length === 0 ? (
              <div
                style={{
                  padding: "54px 22px",
                  textAlign: "center",
                  color: "var(--bb-text-muted)",
                  fontSize: "12px",
                }}
              >
                <div
                  style={{
                    width: 58,
                    height: 58,
                    margin: "0 auto 14px",
                    borderRadius: 19,
                    display: "grid",
                    placeItems: "center",
                    background: "#f2e5d8",
                    color: "var(--bb-accent)",
                    boxShadow: "0 10px 22px rgba(47,58,47,.08)",
                  }}
                >
                  <ShoppingCart size={26} strokeWidth={1.7} />
                </div>
                <p
                  style={{
                    margin: 0,
                    color: "var(--bb-text)",
                    fontSize: 14,
                    fontWeight: 800,
                  }}
                >
                  {barOnly ? "Start this sale" : "Start this check"}
                </p>
                <p
                  style={{
                    margin: "6px auto 0",
                    maxWidth: 205,
                    lineHeight: 1.5,
                  }}
                >
                  {barOnly
                    ? "Counter sells pay immediately. Open tab holds drinks under a name. Scan a barcode or tap a drink."
                    : "Choose a table or service mode, then tap menu items to build the order."}
                </p>
                {lastReceipt && !showPayment && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "14px" }}>
                    <button
                      type="button"
                      onClick={reorderLastSale}
                      aria-label="Add the last sale items again"
                      style={{
                        minHeight: "48px",
                        padding: "0 18px",
                        borderRadius: "10px",
                        border: "none",
                        background: "var(--bb-accent)",
                        color: "#fffdf8",
                        fontSize: "14px",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      Same again
                    </button>
                    {poolNightProducts.length > 0 && (
                      <button
                        type="button"
                        onClick={startPoolNight}
                        aria-label="Add all pool tables for the night entry"
                        style={{
                          minHeight: "48px",
                          padding: "0 18px",
                          borderRadius: "10px",
                          border: "1px solid rgba(47, 107, 66, 0.3)",
                          background: "rgba(47, 107, 66, 0.08)",
                          color: "var(--bb-success)",
                          fontSize: "14px",
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        Pool night
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={reprintLastReceipt}
                      aria-label="Reprint the last receipt, for example when a customer lost their slip"
                      style={{
                        minHeight: "56px",
                        padding: "0 18px",
                        borderRadius: "12px",
                        border: "none",
                        // NB: the gradient accent token does not exist in the Bar
                        // theme, so it rendered transparent with white text
                        // (invisible button). Use the solid accent that the
                        // neighbouring Same-again button already proves visible.
                        background: "var(--bb-accent)",
                        color: "#fffdf8",
                        fontSize: "15px",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      🧾 Reprint last receipt (lost slip?)
                    </button>
                  </div>
                )}
              </div>
            ) : (
              cart.map((line) => (
                <CartLine
                  key={line.id}
                  line={line}
                  onUpdateQty={updateQty}
                  onSetQty={setQty}
                  onRemove={removeLine}
                  onCustomize={(entry) => setModifierLineId(entry.id)}
                  currency={currency}
                  highlight={lastAdded?.key != null && line.menu_item_id === lastAdded.key}
                  highlightFresh={
                    lastAdded?.key != null &&
                    line.menu_item_id === lastAdded.key &&
                    Date.now() - Number(lastAdded.at || 0) < 1500
                  }
                />
              ))
            )}
          </div>

          {cart.some((line) => String(line.category || '').trim().toLowerCase() === 'pool') && (
            <div
              role="status"
              style={{
                margin: '10px 16px 0',
                padding: '10px 14px',
                borderRadius: '12px',
                background: '#eef6f3',
                border: '1px solid rgba(55,70,57,.14)',
                color: '#24362c',
                fontSize: '13px',
                fontWeight: 600,
                lineHeight: 1.4,
              }}
            >
              Pool tables: quantity means pula collected. Example Table 1 quantity 80 = P80. Type the cash from each table box, then Pay once.
            </div>
          )}

          {(submitNotice || recoveredAttempt) && (
            <div
              role="status"
              aria-live="polite"
              style={{
                margin: "10px 16px 0",
                minHeight: 52,
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                borderRadius: "12px",
                background: "linear-gradient(135deg, #fdf3e3, #fffaf0)",
                border: "1px solid rgba(166, 118, 42, 0.35)",
                color: "#7a5710",
                fontSize: "14px",
                fontWeight: 700,
                lineHeight: 1.35,
              }}
            >
              <AlertCircle size={21} aria-hidden="true" />
              {recoveredAttempt ? (
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span>{Number(recoveredAttempt.pendingCount || 0) > 1 ? `${Number(recoveredAttempt.pendingCount)} earlier sales need checking — tap for details.` : "Earlier sale needs checking — tap for details."}</span>
                    <button
                      type="button"
                      onClick={toggleRecoveryCollapsed}
                      aria-expanded={!recoveryCollapsed}
                      aria-label={recoveryCollapsed ? "Show earlier sale details" : "Hide earlier sale details"}
                      style={{
                        minWidth: "44px",
                        minHeight: "44px",
                        borderRadius: 10,
                        border: "1px solid rgba(166, 118, 42, 0.45)",
                        background: "#fff8ea",
                        color: "#6b4a0b",
                        fontWeight: 800,
                        fontSize: "16px",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      {recoveryCollapsed ? "+" : "–"}
                    </button>
                  </div>
                  {!recoveryCollapsed && (
                    <>
                      <span>
                        An earlier sale attempt from {recoveredAttempt.createdAtClient ? new Date(recoveredAttempt.createdAtClient).toLocaleString() : "an unknown time"} is still unresolved. Retry uses its original operation key: if the server already recorded it, the original result is returned; if it was not recorded, retry may complete that older sale now. Check Sales first and do not retry if you already entered a replacement sale.
                      </span>
                      {Array.isArray(recoveredAttempt?.payload?.items) && <small style={{ display: "block", marginTop: 6 }}>
                        Attempt details: {recoveredAttempt.payload.items.map((item) => `${Number(item.quantity || 0)} × ${item.item_name || "item"}`).join(", ")} · submitted tender {currency} {fmt(recoveredAttempt.payload.payment_breakdown?.reduce((sum, tender) => sum + Number(tender.amount || 0), 0) || 0)}
                      </small>}
                      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={completeOrder}
                          disabled={submitting}
                          style={{
                            padding: "8px 14px",
                            borderRadius: 10,
                            border: "1px solid rgba(166, 118, 42, 0.45)",
                            background: "#fff8ea",
                            color: "#6b4a0b",
                            fontWeight: 800,
                            cursor: submitting ? "wait" : "pointer",
                          }}
                        >
                          Retry this exact attempt
                        </button>
                        <button
                          type="button"
                          onClick={recheckRecovery}
                          disabled={recoveryChecking || submitting}
                          aria-label="Re-check whether the earlier sale was recorded"
                          style={{
                            padding: "8px 14px",
                            borderRadius: 10,
                            border: "1px solid rgba(166, 118, 42, 0.45)",
                            background: "transparent",
                            color: "#6b4a0b",
                            fontWeight: 800,
                            cursor: recoveryChecking || submitting ? "wait" : "pointer",
                          }}
                        >
                          {recoveryChecking ? "Checking…" : "Re-check Sales"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <span>{submitNotice}</span>
              )}
            </div>
          )}

          {(submitError || successMessage) && (
            <div
              role={submitError ? "alert" : "status"}
              aria-live={submitError ? "assertive" : "polite"}
              style={{
                margin: "10px 16px 0",
                minHeight: 52,
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                borderRadius: "12px",
                background: submitError
                  ? "rgba(191, 72, 45, 0.14)"
                  : "linear-gradient(135deg, #e5f6e9, #f3fbf4)",
                border: submitError
                  ? "1px solid rgba(191, 72, 45, 0.32)"
                  : "1px solid rgba(47, 107, 66, 0.30)",
                color: submitError ? "#8d2f24" : "var(--bb-success)",
                fontSize: "14px",
                fontWeight: 800,
                lineHeight: 1.35,
                boxShadow: submitError
                  ? "none"
                  : "0 8px 20px rgba(47, 107, 66, 0.12)",
              }}
            >
              {submitError ? (
                <AlertCircle size={21} aria-hidden="true" />
              ) : (
                <CheckCircle size={22} aria-hidden="true" />
              )}
              <span style={{ flex: 1 }}>
                {submitError || successMessage}
              </span>
            </div>
          )}

          {/* Undo-add is a slim one-line pill (never the tall success card) so
              it never hides the cart or the payment footer. */}
          {!submitError && !successMessage && undoAdd && (
            <div
              role="status"
              aria-live="polite"
              style={{
                margin: "8px 16px 0",
                minHeight: 32,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 6px 4px 10px",
                borderRadius: "999px",
                background: "#fff7ef",
                border: "1px solid rgba(201, 86, 53, 0.28)",
                color: "var(--bb-text)",
                fontSize: "12px",
                fontWeight: 700,
                lineHeight: 1.3,
              }}
            >
              <ShoppingCart size={14} aria-hidden="true" />
              <span style={{ flex: 1 }}>
                {`${undoAdd.name} added`}
              </span>
              <button
                type="button"
                onClick={undoLastAdd}
                style={{
                  minHeight: 32,
                  padding: "0 12px",
                  borderRadius: "999px",
                  border: "1px solid rgba(201,86,53,.35)",
                  background: "#fff",
                  color: "var(--bb-accent, #c95635)",
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Undo
              </button>
            </div>
          )}

          {/* Totals + Payment */}
          {/* Compact, never scrolling: ONLY the cart list above scrolls. The
              footer is flexShrink 0 with tight paddings so Record payment
              stays on screen as the basket grows. */}
          {cart.length > 0 && (
            <div style={{ borderTop: "1px solid rgba(55,70,57,.11)", flexShrink: 0 }}>
              <div style={{ padding: "8px 12px 4px" }}>
                {eligiblePromotions.length > 0 && tillEntitlements.canPromos && (
                  <label
                    style={{
                      display: "block",
                      marginBottom: 10,
                      color: "#526157",
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    Offer
                    <select
                      value={selectedPromotionId}
                      onChange={(event) =>
                        setSelectedPromotionId(event.target.value)
                      }
                      style={{
                        width: "100%",
                        marginTop: 4,
                        padding: "8px 9px",
                        borderRadius: 8,
                        border: "1px solid rgba(55,70,57,.16)",
                        background: "#fff",
                      }}
                    >
                      <option value="">No offer</option>
                      {eligiblePromotions.map((promotion) => (
                        <option key={promotion.id} value={promotion.id}>
                          {promotion.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "12px",
                    color: "var(--bb-text-soft)",
                    marginBottom: "4px",
                  }}
                >
                  <span>Subtotal</span>
                  <span>
                    {currency} {fmt(subtotal)}
                  </span>
                </div>
                {taxRate > 0 && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "12px",
                      color: "var(--bb-text-soft)",
                      marginBottom: "4px",
                    }}
                  >
                    <span>VAT ({(taxRate * 100).toFixed(0)}%)</span>
                    <span>
                      {currency} {fmt(tax)}
                    </span>
                  </div>
                )}
                {promotionDiscount > 0 && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                      color: "#a83c26",
                      marginBottom: 4,
                    }}
                  >
                    <span>{selectedPromotion?.name}</span>
                    <span>
                      -{currency} {fmt(promotionDiscount)}
                    </span>
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "16px",
                    fontWeight: 850,
                    color: "var(--bb-text)",
                    paddingTop: "6px",
                    borderTop: "1px solid rgba(55,70,57,.11)",
                  }}
                >
                  <span>Total</span>
                  <span>
                    {currency} {fmt(total)}
                  </span>
                </div>
              </div>

              {["table", "tab"].includes(serviceMode) && !showPayment && (
                <div className="hpos-service-hold-action">
                  <button
                    type="button"
                    onClick={holdCheck}
                    disabled={holding || submitting}
                  >
                    <Clock size={16} />
                    <span>
                      <strong>
                        {holding ? "Holding check…" : "Hold check"}
                      </strong>
                      <small>Keep it open and finish payment later</small>
                    </span>
                  </button>
                </div>
              )}

              {/* Payment Methods: 56px targets kept (touch contract); tighter
                  padding/gap so the chooser costs one row, never a scroll. */}
              {!showPayment ? (
                <div
                  style={{
                    padding: "6px 12px 10px",
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: "6px",
                  }}
                >
                  {hasPoolLines && (
                    <div role="status" style={{ gridColumn: "1 / -1", padding: "6px 10px", borderRadius: "8px", background: "#eef6f3", border: "1px solid rgba(55,70,57,.14)", color: "var(--bb-text)", fontSize: "12px", fontWeight: 700 }}>
                      Pool tables pay Cash only. Card, mobile money, split and account are disabled for this sale.
                    </div>
                  )}
                  {selectedCustomer &&
                    selectedCustomer.account_status === "active" &&
                    Number(selectedCustomer.available_credit || 0) >= Number(total || 0) && (
                      <button
                        disabled={hasPoolLines}
                        aria-disabled={hasPoolLines}
                        title={hasPoolLines ? "Pool tables pay Cash only for this sale." : undefined}
                        onClick={() => {
                          if (hasPoolLines) return;
                          setChargeToAccount(true);
                          setShowPayment(true);
                        }}
                        style={{
                          gridColumn: "1 / -1",
                          minHeight: "44px",
                          padding: "10px 11px",
                          borderRadius: 9,
                          border: "1px solid rgba(53,110,216,.22)",
                          background: "rgba(53,110,216,.08)",
                          color: "var(--bb-info)",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: hasPoolLines ? "not-allowed" : "pointer",
                          opacity: hasPoolLines ? 0.55 : 1,
                          textAlign: "left",
                        }}
                      >
                        Charge {currency} {fmt(total)} to{" "}
                        {selectedCustomer.name}
                        's account · outstanding {currency}{" "}
                        {fmt(selectedCustomer.outstanding_balance)} · available {currency}{" "}
                        {fmt(selectedCustomer.available_credit)}
                      </button>
                    )}
                  {[
                    {
                      id: "cash",
                      label: "Cash",
                      icon: Banknote,
                      color: "#356676",
                    },
                    {
                      id: "card",
                      label: "Card",
                      icon: CreditCard,
                      // NB: keep a hex color here, not var(--bb-info): the tile
                      // builds its border/background as `${color}20` / `${color}08`
                      // (hex + alpha). A var() value makes both declarations
                      // invalid, so the Card square loses its box and looks gone.
                      // #356ed8 matches --bb-info.
                      color: "#356ed8",
                    },
                    {
                      id: "mobile_money",
                      label: "Mobile money",
                      icon: Smartphone,
                      color: "#8a5d3b",
                    },
                  ].map((pm) => {
                    const poolBlocked = hasPoolLines && pm.id !== "cash";
                    return (
                    <button
                      key={pm.id}
                      disabled={poolBlocked}
                      aria-disabled={poolBlocked}
                      title={poolBlocked ? "Pool tables pay Cash only for this sale." : undefined}
                      onClick={() => {
                        if (poolBlocked) return;
                        setChargeToAccount(false);
                        setPaymentMethod(pm.id);
                        setShowPayment(true);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        minHeight: "56px",
                        padding: "10px 8px",
                        borderRadius: "10px",
                        border: `1px solid ${pm.color}20`,
                        background: `${pm.color}08`,
                        color: pm.color,
                        fontSize: "14px",
                        fontWeight: 700,
                        cursor: poolBlocked ? "not-allowed" : "pointer",
                        opacity: poolBlocked ? 0.55 : 1,
                      }}
                    >
                      <pm.icon size={18} />
                      {pm.label}
                    </button>
                    );
                  })}
                  <button
                    disabled={hasPoolLines}
                    aria-disabled={hasPoolLines}
                    title={hasPoolLines ? "Pool tables pay Cash only for this sale." : undefined}
                    onClick={() => {
                      if (hasPoolLines) return;
                      setChargeToAccount(false);
                      setPaymentMethod("split");
                      setSplitCashAmount("");
                      setShowPayment(true);
                    }}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", minHeight: "56px", padding: "10px 8px", borderRadius: "10px", border: "1px solid rgba(109,76,130,.18)", background: "rgba(109,76,130,.06)", color: "#6d4c82", fontSize: "14px", fontWeight: 700, cursor: hasPoolLines ? "not-allowed" : "pointer", opacity: hasPoolLines ? 0.55 : 1 }}
                  >
                    <WalletCards size={18} /> Split payment
                  </button>
                </div>
              ) : (
                <div style={{ padding: "6px 12px 10px" }}>
                  {paymentIdleNudge && (
                    <div
                      role="status"
                      style={{
                        marginBottom: "6px",
                        padding: "6px 10px",
                        borderRadius: "8px",
                        background: "#fff6df",
                        border: "1px solid rgba(139,90,17,.22)",
                        color: "#8b5a11",
                        fontSize: "12px",
                        fontWeight: 700,
                      }}
                    >
                      Payment still open — take tender or press Esc to close.
                    </div>
                  )}
                  {/* Quick cash only tenders the sale: the cash allocation
                      stays exactly the amount due; received/change are
                      operator tendering aids recorded on the receipt, never
                      revenue or tips. */}
                  {!chargeToAccount && paymentMethod === "cash" && (
                    <div style={{ marginBottom: "6px" }}>
                      <div
                        style={{
                          fontSize: "12px",
                          fontWeight: 700,
                          color: "#5d4b52",
                          marginBottom: "4px",
                        }}
                      >
                        Cash received{barOnly ? " (required)" : ""}
                      </div>
                      <div
                        style={{
                          display: "grid",
                          // auto-fit keeps Exact + every QUICK_CASH_AMOUNT on
                          // one row as the shared list grows (a fixed 4-col
                          // grid orphaned P20 onto a second row).
                          gridTemplateColumns: "repeat(auto-fit, minmax(60px, 1fr))",
                          gap: "6px",
                          marginBottom: "6px",
                        }}
                      >
                        {[
                          { label: "Exact", value: total },
                          ...QUICK_CASH_AMOUNTS.map((amount) => ({
                            label: `P${amount}`,
                            value: amount,
                          })),
                        ].map((option) => (
                          <button
                            key={option.label}
                            type="button"
                            onClick={() => setCashReceived(String(roundCash(option.value)))}
                            style={{
                              minHeight: "44px",
                              borderRadius: "8px",
                              border: "1px solid rgba(55,70,57,.18)",
                              background: "#fff",
                              color: "var(--bb-text)",
                              fontSize: "13px",
                              fontWeight: 800,
                              cursor: "pointer",
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={cashReceived}
                        onChange={(event) => setCashReceived(event.target.value)}
                        placeholder="Or enter amount received"
                        aria-label="Cash amount received"
                        style={{
                          display: "block",
                          boxSizing: "border-box",
                          width: "100%",
                          border: "1px solid rgba(55,70,57,.18)",
                          borderRadius: "8px",
                          padding: "9px 10px",
                          minHeight: "44px",
                          fontSize: "14px",
                          background: "#fff",
                        }}
                      />
                      {String(cashReceived).trim() !== "" &&
                        Number.isFinite(Number(cashReceived)) && (
                          <div
                            role="status"
                            style={{
                              marginTop: "6px",
                              fontSize: "13px",
                              fontWeight: 800,
                              color:
                                roundCash(Number(cashReceived) - total) < 0
                                  ? "#8d2f24"
                                  : "var(--bb-success)",
                            }}
                          >
                            {roundCash(Number(cashReceived) - total) < 0
                              ? `Still due ${currency} ${fmt(total - roundCash(Number(cashReceived)))}`
                              : `Change due ${currency} ${fmt(roundCash(Number(cashReceived) - total))}`}
                          </div>
                        )}
                    </div>
                  )}
                  {canUseTips && <label
                    style={{
                      display: "block",
                      marginBottom: "6px",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#5d4b52",
                    }}
                  >
                    Tip for{" "}
                    {["table", "tab"].includes(serviceMode)
                      ? barOnly
                        ? "serving bartender"
                        : "serving waiter"
                      : "current cashier"}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={tipAmount}
                      onChange={(event) => setTipAmount(event.target.value)}
                      placeholder="0.00"
                      style={{
                        display: "block",
                        boxSizing: "border-box",
                        width: "100%",
                        marginTop: "4px",
                        border: "1px solid rgba(55,70,57,.18)",
                        borderRadius: "8px",
                        padding: "8px 10px",
                        fontSize: "13px",
                      }}
                    />
                  </label>}
                  {paymentMethod === "split" && !chargeToAccount && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "6px" }}>
                      <label style={{ fontSize: "12px", fontWeight: 700, color: "#5d4b52" }}>
                        Cash amount
                        <input type="number" min="0.01" max={Math.max(0, total - 0.01)} step="0.01" value={splitCashAmount} onChange={(event) => setSplitCashAmount(event.target.value)} placeholder="0.00" style={{ display: "block", boxSizing: "border-box", width: "100%", marginTop: "4px", border: "1px solid rgba(55,70,57,.18)", borderRadius: "8px", padding: "8px 10px", fontSize: "13px" }} />
                      </label>
                      <label style={{ fontSize: "12px", fontWeight: 700, color: "#5d4b52" }}>
                        Balance method
                        <select value={splitRemainderMethod} onChange={(event) => setSplitRemainderMethod(event.target.value)} style={{ display: "block", boxSizing: "border-box", width: "100%", marginTop: "4px", border: "1px solid rgba(55,70,57,.18)", borderRadius: "8px", padding: "8px 10px", fontSize: "13px", background: "white" }}>
                          <option value="card">Card</option>
                          <option value="mobile_money">Mobile money</option>
                        </select>
                      </label>
                      <label style={{ gridColumn: "1 / -1", fontSize: "12px", fontWeight: 700, color: "#5d4b52" }}>
                        {splitRemainderMethod === "mobile_money" ? "Mobile money reference (optional)" : "Card approval/reference (optional)"}
                        <input
                          type="text"
                          maxLength={120}
                          value={paymentReferences[splitRemainderMethod] || ""}
                          onChange={(event) =>
                            setPaymentReferences((previous) => ({
                              ...previous,
                              [splitRemainderMethod]: event.target.value,
                            }))
                          }
                          placeholder={splitRemainderMethod === "mobile_money" ? "Transaction ID" : "Terminal approval code"}
                          style={{ display: "block", boxSizing: "border-box", width: "100%", marginTop: "4px", border: "1px solid rgba(55,70,57,.18)", borderRadius: "8px", padding: "8px 10px", fontSize: "13px" }}
                        />
                      </label>
                    </div>
                  )}
                  {!chargeToAccount && paymentMethod !== "cash" && paymentMethod !== "split" && (
                    <>
                      <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: 700, color: "#5d4b52" }}>
                        {paymentMethod === "mobile_money" ? "Mobile money reference (optional)" : "Card approval/reference (optional)"}
                        <input
                          type="text"
                          maxLength={120}
                          value={paymentReferences[paymentMethod] || ""}
                          onChange={(event) =>
                            setPaymentReferences((previous) => ({
                              ...previous,
                              [paymentMethod]: event.target.value,
                            }))
                          }
                          placeholder={paymentMethod === "mobile_money" ? "Transaction ID" : "Terminal approval code"}
                          style={{ display: "block", boxSizing: "border-box", width: "100%", marginTop: "4px", border: "1px solid rgba(55,70,57,.18)", borderRadius: "8px", padding: "8px 10px", fontSize: "13px" }}
                        />
                      </label>
                      {paymentMethod === "card" && (
                        <div style={{ marginBottom: "6px" }}>
                          {terminalBridgeReady ? (
                            <button
                              type="button"
                              onClick={() => sendTotalToCardMachine(total)}
                              disabled={terminalSending}
                              style={{ width: "100%", minHeight: "44px", borderRadius: "8px", border: "1px solid rgba(55,70,57,.18)", background: "#fff", color: "var(--bb-text)", fontSize: "13px", fontWeight: 800, cursor: "pointer" }}
                            >
                              {terminalSending ? "Sending to card machine…" : `Send ${currency} ${fmt(total)} to card machine`}
                            </button>
                          ) : (
                            <p style={{ margin: 0, fontSize: "12px", color: "#5d4b52" }}>
                              Manual card machine: charge {currency} {fmt(total)} on the machine, then enter the approval code above (optional). Set up a bridge in System Health › Devices to send the total automatically.
                            </p>
                          )}
                          {terminalMessage && (
                            <p role="status" style={{ margin: "6px 0 0", fontSize: "12px", fontWeight: 700, color: "#5d4b52" }}>{terminalMessage}</p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {!chargeToAccount && paymentMethod === "split" && splitRemainderMethod === "card" && (
                    <div style={{ marginBottom: "6px" }}>
                      {terminalBridgeReady ? (
                        <button
                          type="button"
                          onClick={() => sendTotalToCardMachine(total - Number(splitCashAmount || 0))}
                          disabled={terminalSending}
                          style={{ width: "100%", minHeight: "44px", borderRadius: "8px", border: "1px solid rgba(55,70,57,.18)", background: "#fff", color: "var(--bb-text)", fontSize: "13px", fontWeight: 800, cursor: "pointer" }}
                        >
                          {terminalSending ? "Sending to card machine…" : "Send card balance to card machine"}
                        </button>
                      ) : null}
                      {terminalMessage && (
                        <p role="status" style={{ margin: "6px 0 0", fontSize: "12px", fontWeight: 700, color: "#5d4b52" }}>{terminalMessage}</p>
                      )}
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                      padding: "6px 10px",
                      borderRadius: "8px",
                      background: "rgba(245, 158, 11, 0.06)",
                      border: "1px solid rgba(245, 158, 11, 0.12)",
                    }}
                  >
                    <span style={{ fontSize: "12px", fontWeight: 800, color: "var(--bb-text-muted)" }}>
                      {chargeToAccount
                        ? `Charge ${selectedCustomer?.name || "customer"} account`
                        : paymentMethod === "split"
                          ? `Cash + ${splitRemainderMethod === "card" ? "Card" : "Mobile money"}`
                          : paymentMethod === "cash"
                            ? "Collect Cash"
                            : paymentMethod === "mobile_money"
                              ? "Confirm mobile money"
                              : "Process Card"}
                    </span>
                    <strong
                      style={{
                        fontSize: "16px",
                        fontWeight: 800,
                        color: "var(--bb-accent)",
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {currency} {fmt(total)}
                    </strong>
                  </div>
                  {(!tenderBreakdownResult.ok || chargeToAccount || (tenderBreakdownResult.ok && tenderBreakdownResult.breakdown.length > 1)) && (
                  <div
                    aria-label="Tender breakdown"
                    style={{
                      marginTop: 6,
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: "rgba(255,255,255,.76)",
                      border: "1px solid rgba(55,70,57,.12)",
                      fontSize: 12,
                    }}
                  >
                    <div
                      style={{
                        color: "#526157",
                        fontSize: 11,
                        fontWeight: 800,
                        marginBottom: 5,
                      }}
                    >
                      Recorded tender breakdown
                    </div>
                    {tenderBreakdownResult.ok ? (
                      tenderBreakdownResult.breakdown.map((tender, index) => (
                        <div
                          key={`${tender.method}-${index}`}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 10,
                            color: "var(--bb-text)",
                            padding: "2px 0",
                          }}
                        >
                          <span>
                            {tenderLabel(tender.method)}
                            {tender.code ? ` · ${tender.code}` : ""}
                            {tender.reference ? ` · Ref ${tender.reference}` : ""}
                          </span>
                          <strong>{currency} {fmt(tender.amount)}</strong>
                        </div>
                      ))
                    ) : (
                      <span style={{ color: "#8d2f24" }}>
                        {tenderBreakdownResult.error}
                      </span>
                    )}
                  </div>
                  )}
                  {/* Drawer gate: fails closed in the UI the same way the
                      domain fails closed at Pay — the button is disabled with
                      a visible reason instead of letting the operator tap into
                      a server refusal. Uncertain-attempt retries keep their own
                      banner action and are never gated here. */}
                  {drawerGateNeeded && !recoveredAttempt && (
                    <p
                      role="status"
                      style={{
                        margin: "6px 0 0",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#7a5710",
                        background: "#fdf3e3",
                        border: "1px solid rgba(166, 118, 42, 0.35)",
                        borderRadius: "8px",
                        padding: "6px 10px",
                      }}
                    >
                      Drawer not open — open it in Staff shift close before taking payment.
                    </p>
                  )}
                  <button
                    onClick={completeOrder}
                    disabled={
                      submitting ||
                      !tenderBreakdownResult.ok ||
                      (drawerGateNeeded && !recoveredAttempt)
                    }
                    style={{
                      width: "100%",
                      minHeight: "60px",
                      padding: "12px 12px",
                      marginTop: "6px",
                      borderRadius: "12px",
                      border: "none",
                      background: "var(--hpos-accent-gradient, linear-gradient(135deg, #c95635, #a83c26))",
                      color: "#fffdf8",
                      fontSize: "16px",
                      fontWeight: 800,
                      cursor: "pointer",
                      boxShadow: "0 8px 22px rgba(201, 86, 53, 0.28)",
                    }}
                  >
                    {submitting
                      ? "Recording order…"
                      : serviceMode === "table"
                        ? "Record payment & close check"
                        : serviceMode === "tab"
                          ? "Record payment & close tab"
                          : "Take payment"}
                  </button>
                  <button
                    onClick={() => setShowPayment(false)}
                    style={{
                      width: "100%",
                      padding: "6px",
                      marginTop: "4px",
                      borderRadius: "8px",
                      border: "1px solid rgba(55,70,57,.16)",
                      background: "#fffdf8",
                      color: "var(--bb-text-muted)",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Back
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {showShiftStart && (
          <div
            role="presentation"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 2200,
              display: "grid",
              placeItems: "center",
              padding: 20,
              background: "rgba(36,54,44,.42)",
            }}
          >
            <div
              ref={shiftDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="hpos-shift-start-title"
              style={{
                width: "min(390px,100%)",
                padding: 24,
                borderRadius: 20,
                background: "#fffdf8",
                boxShadow: "0 24px 70px rgba(36,54,44,.28)",
              }}
            >
              <p
                style={{
                  margin: 0,
                  color: "#a83c26",
                  fontSize: 10,
                  fontWeight: 900,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                }}
              >
                Before the first sale
              </p>
              <h3 id="hpos-shift-start-title" style={{ margin: "5px 0 4px", color: "var(--bb-text)" }}>
                Start your shift
              </h3>
              <p
                style={{
                  margin: "0 0 16px",
                  color: "var(--bb-text-muted)",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                Choose the opening cash float. Sales from this terminal will
                then be included in your cash-up. Enter 0.00 explicitly when
                you start with no cash.
              </p>
              <label
                style={{
                  display: "block",
                  color: "#526157",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                Opening float ({currency})
                <input
                  autoFocus
                  type="number"
                  min="0"
                  step="0.01"
                  value={shiftFloat}
                  onChange={(event) => setShiftFloat(event.target.value)}
                  placeholder="0.00"
                  style={{
                    boxSizing: "border-box",
                    width: "100%",
                    marginTop: 6,
                    padding: "11px 12px",
                    border: "1px solid rgba(55,70,57,.2)",
                    borderRadius: 10,
                    background: "#fff",
                  }}
                />
              </label>
              {submitError && (
                <p
                  style={{ margin: "10px 0 0", color: "#a9442f", fontSize: 12 }}
                >
                  {submitError}
                </p>
              )}
              <div
                style={{
                  display: "flex",
                  justifyContent: "end",
                  gap: 8,
                  marginTop: 20,
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowShiftStart(false)}
                  style={{
                    padding: "9px 13px",
                    border: "1px solid rgba(55,70,57,.2)",
                    borderRadius: 9,
                    background: "#fff",
                    color: "#526157",
                    fontWeight: 700,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={shiftBusy || !selectedOutlet?.id || String(shiftFloat ?? "").trim() === ""}
                  onClick={openShift}
                  style={{
                    padding: "9px 14px",
                    border: 0,
                    borderRadius: 9,
                    background: "var(--bb-accent)",
                    color: "#fff",
                    fontWeight: 800,
                    opacity: shiftBusy || !selectedOutlet?.id ? 0.55 : 1,
                  }}
                >
                  {shiftBusy ? "Starting…" : "Start shift"}
                </button>
              </div>
            </div>
          </div>
        )}
        {modifierLineId != null &&
          (() => {
            const line = cart.find((entry) => entry.id === modifierLineId);
            const relevant = modifierGroups.filter(
              (group) =>
                group.active !== false &&
                (!Array.isArray(group.applies_to_categories) ||
                  group.applies_to_categories.length === 0 ||
                  group.applies_to_categories.some(
                    (category) =>
                      String(category).toLowerCase() === "all" ||
                      String(category).toLowerCase() ===
                        String(line?.category || "").toLowerCase(),
                  )),
            );
            const unmetGroups = relevant.filter((group) => {
              const selectedCount = (line?.modifiers || []).filter(
                (modifier) => modifier.group_id === group.id,
              ).length;
              return selectedCount < Number(group.min_selections || 0);
            });
            return (
              <div
                role="presentation"
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 2100,
                  display: "grid",
                  placeItems: "center",
                  padding: 20,
                  background: "rgba(36,54,44,.38)",
                }}
              >
                <div
                  ref={modifierDialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="hpos-modifier-dialog-title"
                  style={{
                    width: "min(500px,100%)",
                    maxHeight: "80vh",
                    overflow: "auto",
                    background: "#fffdf8",
                    borderRadius: 20,
                    padding: 24,
                  }}
                >
                  <h3 id="hpos-modifier-dialog-title" style={{ margin: 0, color: "var(--bb-text)" }}>
                    Customise {line?.item_name}
                  </h3>
                  {relevant.map((group) => (
                    <section key={group.id} style={{ marginTop: 18 }}>
                      <div
                        style={{
                          color: "#526157",
                          fontSize: 12,
                          fontWeight: 800,
                        }}
                      >
                        {group.name}
                        {group.min_selections
                          ? ` · choose at least ${group.min_selections}`
                          : ""}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 8,
                          marginTop: 8,
                        }}
                      >
                        {(group.options || []).map((option) => {
                          const selected = line?.modifiers?.some(
                            (modifier) =>
                              modifier.name === option.name &&
                              modifier.group_id === group.id,
                          );
                          return (
                            <button
                              key={option.id || option.name}
                              onClick={() =>
                                toggleModifier(line, option, group)
                              }
                              style={{
                                padding: "8px 10px",
                                borderRadius: 9,
                                border: `1px solid ${selected ? "var(--bb-accent)" : "rgba(55,70,57,.16)"}`,
                                background: selected ? "#fff0eb" : "#fff",
                                color: selected ? "#a83c26" : "#526157",
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              {option.name}
                              {Number(option.price_delta || 0)
                                ? ` +${currency}${fmt(option.price_delta)}`
                                : ""}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                  {relevant.length === 0 && (
                    <p style={{ color: "var(--bb-text-muted)" }}>
                      No modifier groups apply to this item.
                    </p>
                  )}
                  <label className="hpos-service-item-note">
                    {barOnly ? 'Bar preparation note' : 'Kitchen or bar instruction'} <span>optional</span>
                    <textarea
                      rows="3"
                      value={line?.item_notes || ""}
                      onChange={(event) =>
                        updateLineNotes(line.id, event.target.value)
                      }
                      placeholder={barOnly ? 'For example: no ice' : 'For example: sauce on the side'}
                    />
                  </label>
                  {unmetGroups.length > 0 && (
                    <p className="hpos-service-modifier-warning">
                      Complete required choices:{" "}
                      {unmetGroups.map((group) => group.name).join(", ")}
                    </p>
                  )}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "end",
                      marginTop: 24,
                    }}
                  >
                    <button
                      onClick={() => {
                        if (!unmetGroups.length) setModifierLineId(null);
                      }}
                      disabled={unmetGroups.length > 0}
                      style={{
                        padding: "10px 14px",
                        border: 0,
                        borderRadius: 9,
                        background: "var(--bb-accent)",
                        color: "#fff",
                        fontWeight: 800,
                        opacity: unmetGroups.length > 0 ? 0.5 : 1,
                      }}
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        {sharedTerminalMode && showOperatorUnlock && (
          <HposTillOperatorDialog
            staff={serviceStaff}
            activeStaffIds={unlockActiveStaffIds}
            isOnline={unlockIsOnline}
            staffId={operatorStaffId}
            pin={operatorPin}
            error={submitError}
            busy={operatorBusy}
            onStaff={(id) => {
              if (verifiedOperator?.id) clearTillOperatorState({ notifyMain: true });
              setOperatorStaffId(id);
              setVerifiedOperator(null);
              setCurrentShift(null);
              setSubmitError("");
            }}
            onPin={(value) => {
              setOperatorPin(value);
              setSubmitError("");
            }}
            onConfirm={verifySharedOperator}
            onClose={() => setShowOperatorUnlock(false)}
          />
        )}{" "}
        {showSearchKeyboard && (
          <div
            id="hpos-search-keyboard"
            ref={searchKeyboardRef}
            role="dialog"
            aria-label="On-screen search keyboard"
            style={{
              position: "fixed",
              left: "auto",
              right: "16px",
              bottom: "16px",
              width: "min(460px, calc(100vw - 32px))",
              maxHeight: "min(72vh, 640px)",
              overflow: "auto",
              zIndex: 1600,
              padding: "12px 12px calc(12px + env(safe-area-inset-bottom, 0px))",
              background: "#fffdf8",
              border: "1px solid rgba(55,70,57,.14)",
              borderRadius: "18px",
              boxShadow: "0 18px 60px rgba(47,58,47,.28)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: "var(--bb-text-muted)",
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                }}
              >
                Search keyboard
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    if (!tryAddBySearch(search)) {
                      // keep filtered list when no exact match
                    }
                  }}
                  style={{
                    minHeight: "44px",
                    padding: "0 16px",
                    borderRadius: 10,
                    border: "none",
                    background: "var(--bb-accent, #c95635)",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setShowSearchKeyboard(false)}
                  aria-label="Close on-screen search keyboard"
                  style={{
                    minHeight: "44px",
                    minWidth: "44px",
                    padding: "0 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(55,70,57,.16)",
                    background: "#fff",
                    color: "var(--bb-text)",
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gap: 6,
                justifyItems: "center",
              }}
            >
              {SEARCH_KEYBOARD_ROWS.map((row) => (
                <div
                  key={row.join("-")}
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`,
                    gap: 6,
                    width: "100%",
                  }}
                >
                  {row.map((key) => (
                    <button
                      key={key}
                      type="button"
                      // Keep focus in the search input so barcode-wedge
                      // scans and physical Enter keep working unchanged.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setSearch((prev) => `${prev}${key}`)}
                      style={{
                        minHeight: "44px",
                        minWidth: 0,
                        borderRadius: 8,
                        border: "1px solid rgba(55,70,57,.14)",
                        background: "#fff",
                        color: "var(--bb-text)",
                        fontSize: 16,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {key}
                    </button>
                  ))}
                </div>
              ))}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1.4fr 1fr",
                  gap: 6,
                  width: "100%",
                }}
              >
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setSearch((prev) => `${prev} `)}
                  style={{
                    minHeight: "44px",
                    borderRadius: 8,
                    border: "1px solid rgba(55,70,57,.14)",
                    background: "#fff",
                    color: "var(--bb-text)",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Space
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => searchRef.current?.focus()}
                  style={{
                    minHeight: "44px",
                    borderRadius: 8,
                    border: "1px solid rgba(55,70,57,.14)",
                    background: "#f4efe8",
                    color: "var(--bb-text)",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Type / scan here
                </button>
                <button
                  type="button"
                  aria-label="Backspace"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    setSearch((prev) => prev.slice(0, Math.max(0, prev.length - 1)))
                  }
                  style={{
                    minHeight: "44px",
                    borderRadius: 8,
                    border: "1px solid rgba(55,70,57,.14)",
                    background: "#fff1e9",
                    color: "var(--bb-danger, #b84a38)",
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                  }}
                >
                  <Delete size={18} />
                </button>
              </div>
            </div>
          </div>
        )}
        <ConfirmDialog
          open={pendingConfirm != null}
          title={pendingConfirm === "clear" ? "Clear this sale?" : "Switch tables?"}
          message={
            pendingConfirm === "clear"
              ? "All unpaid lines will be removed."
              : "Switch tables and replace the order currently on screen?"
          }
          confirmLabel={pendingConfirm === "clear" ? "Clear sale" : "Switch table"}
          cancelLabel={pendingConfirm === "clear" ? "Keep sale" : "Stay here"}
          tone="danger"
          onConfirm={() => {
            if (pendingConfirm === "clear") {
              applyClearCart();
              return;
            }
            if (pendingConfirm && pendingConfirm.type === "table") {
              const nextTableName = pendingConfirm.name;
              setPendingConfirm(null);
              applyTableSwitch(nextTableName);
            }
          }}
          onCancel={() => setPendingConfirm(null)}
        />
        {multiAddItem && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Add multiple ${multiAddItem.name}`}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
              background: "rgba(47,38,30,.45)",
              display: "grid",
              placeItems: "center",
              padding: 16,
            }}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                setMultiAddItem(null);
              }
            }}
          >
            <div
              style={{
                width: "min(360px, calc(100vw - 32px))",
                background: "var(--bb-surface)",
                borderRadius: 16,
                border: "1px solid rgba(55,70,57,.14)",
                padding: 18,
                boxShadow: "0 18px 40px rgba(47,38,30,.22)",
              }}
            >
              <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 800, color: "var(--bb-text)" }}>
                Add multiple · {multiAddItem.name}
              </p>
              <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--bb-text-muted)" }}>
                Hold a product card to open this. Tap a round size or enter a quantity.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                {["2", "3", "4", "6"].map((qty) => (
                  <button
                    key={qty}
                    type="button"
                    onClick={() => setMultiAddQty(qty)}
                    aria-pressed={multiAddQty === qty}
                    style={{
                      minHeight: 48,
                      borderRadius: 10,
                      border: `1px solid ${multiAddQty === qty ? "var(--bb-accent)" : "rgba(55,70,57,.16)"}`,
                      background: multiAddQty === qty ? "var(--bb-accent)" : "#fff",
                      color: multiAddQty === qty ? "#fff" : "var(--bb-text)",
                      fontSize: 15,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    {qty}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min="1"
                max="99"
                inputMode="numeric"
                value={multiAddQty}
                onChange={(event) => setMultiAddQty(event.target.value)}
                aria-label="Quantity to add"
                style={{
                  display: "block",
                  boxSizing: "border-box",
                  width: "100%",
                  minHeight: 44,
                  borderRadius: 10,
                  border: "1px solid rgba(55,70,57,.16)",
                  padding: "8px 10px",
                  fontSize: 14,
                  background: "#fff",
                  marginBottom: 12,
                }}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => {
                    setMultiAddItem(null);
                    setMultiAddQty("2");
                  }}
                  style={{
                    minHeight: 44,
                    padding: "0 14px",
                    borderRadius: 10,
                    border: "1px solid rgba(55,70,57,.16)",
                    background: "#fff",
                    color: "var(--bb-text)",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={applyMultiAdd}
                  style={{
                    minHeight: 44,
                    padding: "0 16px",
                    borderRadius: 10,
                    border: "none",
                    background: "var(--bb-accent)",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Add {multiAddQty || "1"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {completedReceipt && (
        <POSReceipt
          order={completedReceipt.order}
          autoPrint={completedReceipt.autoPrint}
          onClose={() => {
            setCompletedReceipt(null);
            requestAnimationFrame(() => searchRef.current?.focus());
          }}
          onNewSale={() => {
            setCompletedReceipt(null);
            setSuccessMessage("");
            requestAnimationFrame(() => searchRef.current?.focus());
          }}
          onRepeatSale={() => {
            setCompletedReceipt(null);
            setSuccessMessage("");
            reorderLastSale();
            requestAnimationFrame(() => searchRef.current?.focus());
          }}
        />
      )}
    </>
  );
}
