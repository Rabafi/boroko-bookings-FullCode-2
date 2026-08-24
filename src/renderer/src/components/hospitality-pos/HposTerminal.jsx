import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
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
  Coffee,
  CupSoda,
  IceCream,
  Salad,
  Soup,
  UtensilsCrossed,
  AlertCircle,
  CheckCircle,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import { useSettings, useAuth, useAccess } from "../../app-context";
import { isBarOnlyMode } from "../../../../shared/propertyTypes";
import {
  getBarModeProfile,
  getDefaultHposServiceMode,
  getHposServiceModes,
  resolvePosServicePayload,
} from "../../../../shared/barModeProfile";
import { isCommercialFeatureIncluded } from "../../../../shared/commercialAccess.js";
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

const TERMINAL_OUTLET_STORAGE_PREFIX = "hpos-terminal-outlet:";

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

function ProductCard({ item, onAdd, stockSetupRequired = false }) {
  const isSoldOut =
    item.is_available === false || item.available === false || item.sold_out;
  const unavailableLabel = stockSetupRequired
    ? "Stock setup required"
    : "Sold out";
  const normalizedCategory = String(item.category || "").toLowerCase();
  const CategoryIcon =
    normalizedCategory.includes("drink") ||
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
              : UtensilsCrossed;
  const categoryTone =
    {
      food: "#f3c981",
      drinks: "#c8dfd9",
      dessert: "#f2b5aa",
      desserts: "#f2b5aa",
      sides: "#e6be69",
      starter: "#d8dec0",
      starters: "#d8dec0",
    }[String(item.category || "").toLowerCase()] || "#efe2cf";
  return (
    <button
      disabled={isSoldOut}
      onClick={() => onAdd(item)}
      style={{
        background: isSoldOut ? "#f7f1e8" : categoryTone,
        border: `1px solid ${isSoldOut ? "rgba(55,70,57,.08)" : "rgba(55,70,57,.12)"}`,
        borderRadius: "20px",
        padding: "18px",
        minHeight: "164px",
        cursor: isSoldOut ? "not-allowed" : "pointer",
        opacity: isSoldOut ? 0.4 : 1,
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
      onMouseEnter={(e) => {
        if (!isSoldOut) {
          e.currentTarget.style.borderColor = "rgba(245, 158, 11, 0.2)";
          e.currentTarget.style.boxShadow = "0 16px 30px rgba(65,74,57,.16)";
          e.currentTarget.style.transform = "translateY(-3px)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isSoldOut) {
          e.currentTarget.style.borderColor = "rgba(55,70,57,.12)";
          e.currentTarget.style.boxShadow = "none";
          e.currentTarget.style.transform = "translateY(0)";
        }
      }}
    >
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
          zIndex: 1,
          paddingRight: 42,
        }}
      >
        <span
          style={{
            fontSize: "16px",
            fontWeight: 800,
            color: "#24362c",
            lineHeight: 1.2,
            flex: 1,
          }}
        >
          {item.name}
        </span>
        {item.popularity > 80 && (
          <Star size={11} color="#c95635" fill="#c95635" />
        )}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          position: "relative",
          zIndex: 1,
        }}
      >
        <span style={{ fontSize: "17px", fontWeight: 800, color: "#24362c" }}>
          P{Number(item.price || 0).toFixed(2)}
        </span>
        {item.prep_time && (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "2px",
              fontSize: "10px",
              color: "#7b7a70",
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
          zIndex: 1,
        }}
      >
        {item.category && (
          <span
            style={{
              fontSize: "9px",
              fontWeight: 600,
              color: "#c95635",
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
              fontSize: "9px",
              fontWeight: 700,
              color: "#356ed8",
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
              fontSize: "9px",
              fontWeight: 600,
              color: "#647066",
              background: "rgba(255,253,248,.5)",
              padding: "3px 7px",
              borderRadius: "999px",
            }}
          >
            #{item.barcode}
          </span>
        )}
      </div>
      {isSoldOut && (
        <span
          style={{
            fontSize: "9px",
            fontWeight: 700,
            color: "#b84a38",
            textTransform: "uppercase",
          }}
        >
          {unavailableLabel}
        </span>
      )}
    </button>
  );
}

function CartLine({ line, onUpdateQty, onRemove, onCustomize, currency }) {
  const fmt = (n) => Number(n || 0).toFixed(2);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 14px",
        borderBottom: "1px solid rgba(55,70,57,.09)",
        transition: "background 100ms",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "rgba(201,86,53,.045)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "12px",
            fontWeight: 700,
            color: "#24362c",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {line.item_name}
        </div>
        {line.modifiers?.length > 0 && (
          <div style={{ fontSize: "10px", color: "#7b7a70", marginTop: "2px" }}>
            {line.modifiers.join(", ")}
          </div>
        )}
        <div style={{ fontSize: "11px", color: "#647066", marginTop: "2px" }}>
          {currency}{" "}
          {fmt(Number(line.unit_price) + Number(line.modifier_total || 0))} each
        </div>
      </div>

      {/* Qty Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
        <button
          onClick={() => onUpdateQty(line.id, line.quantity - 1)}
          style={{
            width: "26px",
            height: "26px",
            borderRadius: "6px",
            border: "1px solid rgba(55,70,57,.16)",
            background: "#fffdf8",
            color: "#647066",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Minus size={12} />
        </button>
        <span
          style={{
            width: "28px",
            textAlign: "center",
            fontSize: "13px",
            fontWeight: 700,
            color: "#24362c",
          }}
        >
          {line.quantity}
        </span>
        <button
          onClick={() => onUpdateQty(line.id, line.quantity + 1)}
          style={{
            width: "26px",
            height: "26px",
            borderRadius: "6px",
            border: "1px solid rgba(55,70,57,.16)",
            background: "#fffdf8",
            color: "#647066",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Plus size={12} />
        </button>
      </div>

      <span
        style={{
          fontSize: "13px",
          fontWeight: 700,
          color: "#24362c",
          minWidth: "64px",
          textAlign: "right",
        }}
      >
        {currency}{" "}
        {fmt(
          (Number(line.unit_price) + Number(line.modifier_total || 0)) *
            line.quantity,
        )}
      </span>

      <button
        onClick={() => onRemove(line.id)}
        style={{
          width: "24px",
          height: "24px",
          borderRadius: "6px",
          border: "none",
          background: "transparent",
          color: "#b84a38",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.5,
          transition: "opacity 100ms",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
      >
        <Trash2 size={13} />
      </button>
      <button
        onClick={() => onCustomize(line)}
        aria-label={`Options for ${line.item_name}`}
        title="Modifiers and options"
        className="hpos-service-line-options"
      >
        Options
      </button>
    </div>
  );
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
    )
  );
  const canUseVoucher = canUseBarCommercialFeature("vouchers");
  const canUseTips = canUseBarCommercialFeature("tips_payouts");
  const barProfile = useMemo(() => getBarModeProfile(settings), [settings]);
  const tillOperatorPolicy = useMemo(() => getTillOperatorPolicy(settings), [settings]);
  const serviceModeOptions = useMemo(
    () => getHposServiceModes(barOnly),
    [barOnly],
  );
  const [menuItems, setMenuItems] = useState([]);
  const [recipeMenuItemIds, setRecipeMenuItemIds] = useState(() => new Set());
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [serviceMode, setServiceMode] = useState(() =>
    location.state?.tabId
      ? location.state?.tableName
        ? "table"
        : "tab"
      : getDefaultHposServiceMode(settings),
  );
  const [customers, setCustomers] = useState([]);
  const [modifierGroups, setModifierGroups] = useState([]);
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
  const [loading, setLoading] = useState(true);
  const [outlets, setOutlets] = useState([]);
  const [selectedOutlet, setSelectedOutlet] = useState(null);
  const [tables, setTables] = useState([]);
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
  const [scannerFeedback, setScannerFeedback] = useState(null);
  const [completedReceipt, setCompletedReceipt] = useState(null);
  const [serviceStaff, setServiceStaff] = useState([]);
  const [operatorStaffId, setOperatorStaffId] = useState("");
  const [operatorPin, setOperatorPin] = useState("");
  const [verifiedOperator, setVerifiedOperator] = useState(null);
  const [operatorLastActivityAt, setOperatorLastActivityAt] = useState(null);
  const [tillSessionOutletId, setTillSessionOutletId] = useState(null);
  const [tillSessionExpiresAt, setTillSessionExpiresAt] = useState(null);
  const [operatorBusy, setOperatorBusy] = useState(false);
  const [showOperatorUnlock, setShowOperatorUnlock] = useState(false);
  const searchRef = useRef(null);
  const barcodeDecoderRef = useRef(null);
  const [scannerSettings, setScannerSettings] = useState({});
  const scannerIdleTimerRef = useRef(null);
  const scannerFeedbackTimerRef = useRef(null);
  const tillActivityLastSentAtRef = useRef(0);
  const submitEnvelopeRef = useRef(null);
  const [recoveredAttempt, setRecoveredAttempt] = useState(null);
  const [submitNotice, setSubmitNotice] = useState("");
  if (!barcodeDecoderRef.current)
    barcodeDecoderRef.current = createBarcodeScannerDecoder();

  useEffect(() => {
    let active = true;
    window.api?.pos?.getHardwareSettings?.().then((settings) => {
      if (active && settings && typeof settings === "object") setScannerSettings(settings);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

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
      });
    return () => { active = false; };
  }, []);

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
      setServiceMode(getDefaultHposServiceMode(barOnly));
    }
  }, [barOnly, serviceMode, serviceModeOptions]);

  useEffect(() => {
    if (!canUseVoucher) {
      setVoucherCode("");
      setVoucherAmount("");
    }
    if (!canUseTips) setTipAmount("");
  }, [canUseTips, canUseVoucher]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [
          data,
          outletRows,
          customerRows,
          promotionRows,
          tabRows,
          recipeRows,
          staffRows,
        ] = await Promise.all([
          window.api?.pos?.getMenuItems?.() ?? [],
          window.api?.outlets?.getAll?.() ?? [],
          window.api?.pos?.getCustomers?.() ?? [],
          window.api?.pos?.getPromotions?.() ?? [],
          window.api?.pos?.getTabs?.() ?? [],
          window.api?.pos?.getRecipes?.() ?? [],
          window.api?.pos?.getStaff?.() ?? [],
        ]);
        if (!active) return;
        setMenuItems(Array.isArray(data) ? data : []);
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
          setServiceMode(
            resumedTab.table_name ? "table" : resumedTab.service_mode || "tab",
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
              }),
            ),
          );
          setSuccessMessage(
            `${resumedTab.table_name || resumedTab.tab_name || "Open check"} loaded.`,
          );
        }
        const groups = (await window.api?.pos?.getModifierGroups?.()) ?? [];
        if (active) setModifierGroups(Array.isArray(groups) ? groups : []);
      } catch (error) {
        if (active)
          setSubmitError(
            "Could not load the POS service data. Please refresh.",
          );
      }
      if (active) setLoading(false);
    };
    load();
    return () => {
      active = false;
    };
  }, [location.state?.tabId, outletIsAllowed]);

  useEffect(() => {
    if (!selectedOutlet?.id) {
      setTables([]);
      setCurrentShift(null);
      return;
    }
    let active = true;
    const shiftCashierId = sharedTerminalMode && verifiedOperator?.id
      ? verifiedOperator.id
      : user?.id || null;
    Promise.all([
      window.api?.pos?.getTablesWithStatus?.(selectedOutlet.id) ?? [],
      window.api?.pos?.getCurrentShift?.(selectedOutlet.id, shiftCashierId) ??
        null,
    ])
      .then(([tableRows, shift]) => {
        if (!active) return;
        setTables(Array.isArray(tableRows) ? tableRows : []);
        setCurrentShift(shift || null);
      })
      .catch(() => {
        if (active)
          setSubmitError(
            "Could not load tables or the current shift. Please refresh.",
          );
      });
    return () => {
      active = false;
    };
  }, [selectedOutlet?.id, sharedTerminalMode, user?.id, verifiedOperator?.id]);

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
  const hasStockSetupIssue = useCallback(
    (item) => {
      if (String(item?.stock_method || "").toLowerCase() === "non_stock") return false;
      const hasDirectStock = Boolean(item.inventory_item_id);
      const hasRecipeStock = recipeMenuItemIds.has(item.id);
      return hasDirectStock === hasRecipeStock;
    },
    [recipeMenuItemIds],
  );
  const categories = [
    "All",
    ...Array.from(
      new Set(tillMenuItems.map((item) => item.category).filter(Boolean)),
    ).sort(),
  ];
  const searchLower = search.trim().toLowerCase();
  const filtered = tillMenuItems.filter(
    (item) =>
      (!searchLower ||
        item.name?.toLowerCase().includes(searchLower) ||
        String(item.barcode || "")
          .toLowerCase()
          .includes(searchLower) ||
        String(item.template_kind || "")
          .toLowerCase()
          .includes(searchLower)) &&
      (activeCategory === "All" || item.category === activeCategory),
  );

  const addToCart = useCallback(
    (item) => {
      // A completed sale is acknowledged until the operator begins the next one.
      registerTillActivity();
      setSuccessMessage("");
      setCart((prev) => {
        const existing = prev.find((c) => c.menu_item_id === item.id);
        if (existing) {
          return prev.map((c) =>
            c.menu_item_id === item.id ? { ...c, quantity: c.quantity + 1 } : c,
          );
        }
        return [
          ...prev,
          {
            id: Date.now(),
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
            barcode: item.barcode || null,
          },
        ];
      });
    },
    [location.state?.tabId, registerTillActivity],
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
      if (hasStockSetupIssue(match))
        return {
          success: false,
          code: "stock_setup_required",
          barcode,
          message: `${match.name || "Product"} needs stock setup before it can be sold.`,
        };
      return { success: true, barcode, item: match };
    },
    [hasStockSetupIssue, outletName, selectedOutlet?.id, tillMenuItems],
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
        reportScanner({
          level: "error",
          code: resolved.code,
          message: resolved.message || "Barcode could not be added.",
        });
        return;
      }
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
        reportScanner({
          level: "error",
          code: "barcode_not_found",
          message: `Barcode or product not found: ${q}`,
        });
        return false;
      }
      addToCart(match);
      setSearch("");
      return true;
    },
    [addToCart, reportScanner, resolveBarcodeScan, tillMenuItems],
  );

  const updateQty = useCallback((id, qty) => {
    registerTillActivity();
    if (qty <= 0) {
      setCart((prev) => prev.filter((c) => c.id !== id));
    } else {
      setCart((prev) =>
        prev.map((c) => (c.id === id ? { ...c, quantity: qty } : c)),
      );
    }
  }, [registerTillActivity]);

  const removeLine = useCallback((id) => {
    registerTillActivity();
    setCart((prev) => prev.filter((c) => c.id !== id));
  }, [registerTillActivity]);

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
  const itemCount = cart.reduce((sum, c) => sum + c.quantity, 0);
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

  const selectTable = (nextTableName) => {
    const table = tables.find(
      (row) => String(row.name || row.table_number || "") === nextTableName,
    );
    const openTab = table?.tab || null;
    if (
      cart.length > 0 &&
      nextTableName !== tableName &&
      !window.confirm(
        "Switch tables and replace the order currently on screen?",
      )
    )
      return;
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
        })),
      );
      setSuccessMessage(`${nextTableName} open check loaded.`);
    } else if (nextTableName !== tableName) {
      setCart([]);
      setSuccessMessage("");
    }
  };

  const openShift = async () => {
    if (!selectedOutlet?.id || shiftBusy) return;
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
    setHolding(true);
    setSubmitError("");
    setSuccessMessage("");
    try {
      const result = await window.api?.pos?.saveTab?.({
        id: location.state?.tabId || selectedOpenTab?.id || undefined,
        expected_version: location.state?.tabVersion ?? selectedOpenTab?.tab_version ?? undefined,
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
        `${tableName || tabName || "Check"} held. Resume it from Open Checks.`,
      );
      const latestTables = await Promise.resolve(
        window.api?.pos?.getTablesWithStatus?.(selectedOutlet.id),
      ).catch(() => null);
      if (Array.isArray(latestTables)) setTables(latestTables);
    } catch (error) {
      setSubmitError(
        error?.message || "Could not hold this check. Nothing was cleared.",
      );
    } finally {
      setHolding(false);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") {
        setShowPayment(false);
        setSearch("");
      }
      if (e.key === "F2" && cart.length > 0) {
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
  }, [cart.length]);

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
    }
    const splitCash = Number(splitCashAmount || 0);
    if (!retryingSubmit && paymentMethod === "split" && (!(splitCash > 0) || !(splitCash < total))) {
      setSubmitError(`Enter a cash amount above zero and below ${currency} ${fmt(total)}. The balance will be assigned to ${splitRemainderMethod === "card" ? "card" : "mobile money"}.`);
      return;
    }
    const tenderReference = (method) =>
      String(paymentReferences[method] || "").trim() || null;
    const voucherValue = Number(voucherAmount || 0);
    if (!retryingSubmit && barOnly && !canUseVoucher && (voucherCode.trim() || voucherValue !== 0)) {
      setSubmitError("Voucher tender is not included in the current Bar POS package.");
      return;
    }
    if (!retryingSubmit && barOnly && !canUseTips && Number(tipTotal) !== 0) {
      setSubmitError("Tip tender is not included in the current Bar POS package.");
      return;
    }
    if (!retryingSubmit && voucherValue < 0) {
      setSubmitError("Voucher amount cannot be negative.");
      return;
    }
    if (!retryingSubmit && voucherValue > total) {
      setSubmitError("Voucher amount cannot exceed the order total.");
      return;
    }
    const paymentBreakdown = chargeToAccount
      ? [{ method: "account", amount: total, customer_id: selectedCustomerId || null, reference: null }]
      : voucherCode.trim() && voucherValue > 0
        ? [
            { method: "voucher", amount: voucherValue, code: voucherCode.trim().toUpperCase(), reference: null },
            ...(total - voucherValue > 0.005
              ? [{ method: paymentMethod === "split" ? splitRemainderMethod : paymentMethod, amount: Number((total - voucherValue).toFixed(2)), reference: tenderReference(paymentMethod === "split" ? splitRemainderMethod : paymentMethod) }]
              : []),
          ]
      : paymentMethod === "split"
        ? [
            { method: "cash", amount: splitCash, reference: null },
            {
              method: splitRemainderMethod,
              amount: Number((total - splitCash).toFixed(2)),
              reference: tenderReference(splitRemainderMethod),
            },
          ]
        : [
            {
              method: paymentMethod,
              amount: total,
              reference: tenderReference(paymentMethod),
            },
          ];
    const missingReferences = paymentBreakdown.filter(
      (tender) =>
        ["card", "mobile_money"].includes(tender.method) &&
        !tender.reference,
    );
    if (!retryingSubmit && missingReferences.length > 0) {
      const methodLabels = missingReferences
        .map((tender) =>
          tender.method === "mobile_money" ? "mobile money" : "card",
        )
        .join(" and ");
      setSubmitError(
        `Enter the ${methodLabels} transaction or approval reference before recording payment.`,
      );
      return;
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
      orderItems = cart.map((line) => ({
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
      }));
    }

    try {
      let postOrderNotice = "";
      if (!retryingSubmit) {
        let tabId = null;
        let resolvedTabName = servicePayload.tab_name;
        if (servicePayload.openSession) {
          const session = await window.api.pos.openTableSession({
            outlet_id: selectedOutlet.id,
            table_name: servicePayload.table_name,
            tab_name: servicePayload.tab_name,
            waiter_name: user?.name || user?.email || null,
            waiter_id: user?.id || null,
            items: orderItems,
          });
          if (!session?.success) {
            if (String(session?.code || "").startsWith("till_operator_") || session?.code === "till_shift_closed" || session?.code === "shift_not_open") {
              clearTillOperatorState({ showUnlock: true, message: session?.error || "Verify the operator PIN again." });
            }
            throw new Error(
              session?.error ||
                (serviceMode === "tab"
                  ? "Could not open the tab."
                  : "Could not open the table."),
            );
          }
          tabId = session.tab?.id || null;
          resolvedTabName = session.tab?.tab_name || servicePayload.tab_name;
        }

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
          total,
          service_mode: servicePayload.service_mode,
          table_name: servicePayload.table_name,
          delivery_address:
            serviceMode === "delivery" ? deliveryAddress.trim() || null : null,
          delivery_notes:
            serviceMode === "delivery" ? deliveryNotes.trim() || null : null,
          customer_account_charge:
            chargeToAccount && selectedCustomerId
              ? { customer_id: selectedCustomerId, amount: total }
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
        };
      }
      const result = await window.api.pos.createOrder(orderPayload);
      if (!result?.success) {
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
      const hardware = await window.api?.pos
        ?.getHardwareSettings?.()
        .catch(() => null);
      const provisional = result.offline === true || result.provisional === true;
      const receiptOrder = provisional
        ? {
            ...orderPayload,
            _pending_sync: true,
            provisional: true,
            pos_order_items: orderItems,
          }
        : {
            ...result,
            receipt_number: result.receipt_number || null,
            created_at: result.server_received_at || result.created_at,
            pos_order_items: Array.isArray(result.items) ? result.items : [],
          };
      setCompletedReceipt({
        order: {
          ...receiptOrder,
          _open_drawer_on_print:
            Array.isArray(receiptOrder.payment_breakdown) &&
            receiptOrder.payment_breakdown.some((row) => row.method === "cash") &&
            hardware?.cash_drawer_open_on_cash === true,
        },
        autoPrint: hardware?.auto_print_receipts === true,
      });
      if (!retryingSubmit && selectedCustomerId && !result.offline) {
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
      setCart([]);
      setSelectedCustomerId("");
      setDeliveryAddress("");
      setDeliveryNotes("");
      setChargeToAccount(false);
      setVoucherCode("");
      setVoucherAmount("");
      setTipAmount("");
      setSplitCashAmount("");
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
      const latestTables = await Promise.resolve(
        window.api?.pos?.getTablesWithStatus?.(selectedOutlet.id),
      ).catch(() => null);
      if (Array.isArray(latestTables)) setTables(latestTables);
    } catch (error) {
      setSubmitError(
        error?.message || "Could not complete this order. Nothing was cleared.",
      );
    } finally {
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
    paymentMethod,
    paymentReferences,
    splitCashAmount,
    splitRemainderMethod,
    sharedTerminalMode,
    tillOperatorPolicy,
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
    tillSessionExpiresAt,
    total,
    user?.email,
    user?.id,
    user?.name,
    verifiedOperator,
    voucherAmount,
    voucherCode,
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
          {/* Top Bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "13px 18px",
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
              <div style={{ fontSize: 13, fontWeight: 800, color: "#24362c" }}>
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
                  color: "#7b7a70",
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
                style={{
                  width: "100%",
                  padding: "7px 10px 7px 32px",
                  borderRadius: "8px",
                  border: "1px solid rgba(55,70,57,.16)",
                  background: "#fffaf4",
                  color: "#24362c",
                  fontSize: "12px",
                  outline: "none",
                }}
              />
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

            <div style={{ display: "flex", gap: "4px" }}>
              {serviceModeOptions.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setServiceMode(mode.id)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: "6px",
                    border: "1px solid",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    borderColor:
                      serviceMode === mode.id
                        ? "#c95635"
                        : "rgba(55,70,57,.14)",
                    background: serviceMode === mode.id ? "#c95635" : "#fffdf8",
                    color: serviceMode === mode.id ? "#fff" : "#526157",
                  }}
                >
                  {mode.emoji ? `${mode.emoji} ${mode.label}` : mode.label}
                </button>
              ))}
            </div>
            <div
              role="status"
              title="USB/Bluetooth keyboard-wedge scanners are verified by successful input, not by a permanent connection signal."
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
                      : showPayment || showShiftStart || showOperatorUnlock || modifierLineId != null
                      ? "#8b5a11"
                      : "#176447",
                  background:
                    scannerSettings.barcode_scanner_enabled === false
                      ? "#f1ece8"
                      : showPayment || showShiftStart || showOperatorUnlock || modifierLineId != null
                      ? "#fff6df"
                      : "#edfbf3",
                }}
              >
              {scannerSettings.barcode_scanner_enabled === false
                ? "Scanner disabled"
                : showPayment || showShiftStart || showOperatorUnlock || modifierLineId != null
                ? "Scanner paused"
                : "Scanner ready"}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: "8px",
              padding: "10px 16px",
              borderBottom: "1px solid rgba(55,70,57,.08)",
              background: "#f6efe5",
            }}
          >
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
                color: "#24362c",
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
                  color: "#24362c",
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
                  color: "#24362c",
                  fontSize: "12px",
                }}
              />
            )}
            {serviceMode === "tab" && (
              <datalist id="hpos-open-tab-suggestions">
                {tables
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
              serviceMode === "counter") && (
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
                  color: "#24362c",
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
                  color: "#487d57",
                  background: "rgba(72,125,87,.09)",
                  border: "1px solid rgba(72,125,87,.18)",
                  borderRadius: 999,
                  padding: "5px 9px",
                  fontSize: "11px",
                  fontWeight: 800,
                }}
              >
                Shift open
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
                  background: "#fffaf4",
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
              background: "#fffaf4",
              flexShrink: 0,
            }}
          >
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                style={{
                  whiteSpace: "nowrap",
                  padding: "8px 13px",
                  borderRadius: 999,
                  border: `1px solid ${activeCategory === category ? "#c95635" : "rgba(55,70,57,.14)"}`,
                  background:
                    activeCategory === category ? "#c95635" : "#fffdf8",
                  color: activeCategory === category ? "#fff" : "#526157",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {category}
              </button>
            ))}
          </div>

          {/* Product Grid */}
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: "16px 18px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(174px, 1fr))",
              gap: "12px",
              alignContent: "start",
            }}
          >
            {loading ? (
              <div
                style={{
                  gridColumn: "1 / -1",
                  padding: "60px",
                  textAlign: "center",
                  color: "#7b7a70",
                  fontSize: "13px",
                }}
              >
                {barOnly ? "Loading drinks…" : "Loading menu..."}
              </div>
            ) : filtered.length === 0 ? (
              <div
                style={{
                  gridColumn: "1 / -1",
                  padding: "60px",
                  textAlign: "center",
                  color: "#7b7a70",
                  fontSize: "13px",
                }}
              >
                No items found
              </div>
            ) : (
              filtered.map((item) => (
                <ProductCard
                  key={item.id}
                  item={item}
                  onAdd={addToCart}
                  stockSetupRequired={hasStockSetupIssue(item)}
                />
              ))
            )}
          </div>
        </div>
        {/* Right: Order Panel */}
        <div
          style={{
            width: "372px",
            flexShrink: 0,
            background: "rgba(255,250,242,.96)",
            borderLeft: "1px solid rgba(55,70,57,.14)",
            boxShadow: "-12px 0 32px rgba(47,58,47,.08)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Order Header */}
          <div
            style={{
              padding: "16px 18px",
              borderBottom: "1px solid rgba(55,70,57,.11)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <ShoppingCart size={16} color="#c95635" />
              <span
                style={{ fontSize: "14px", fontWeight: 700, color: "#24362c" }}
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
                    color: "#c95635",
                  }}
                >
                  {itemCount}
                </span>
              )}
            </div>
            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                style={{
                  fontSize: "11px",
                  color: "#b84a38",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Clear
              </button>
            )}
          </div>

          {/* Cart Lines */}
          <div style={{ flex: 1, overflow: "auto" }}>
            {cart.length === 0 ? (
              <div
                style={{
                  padding: "54px 22px",
                  textAlign: "center",
                  color: "#7b7a70",
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
                    color: "#c95635",
                    boxShadow: "0 10px 22px rgba(47,58,47,.08)",
                  }}
                >
                  <ShoppingCart size={26} strokeWidth={1.7} />
                </div>
                <p
                  style={{
                    margin: 0,
                    color: "#24362c",
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
              </div>
            ) : (
              cart.map((line) => (
                <CartLine
                  key={line.id}
                  line={line}
                  onUpdateQty={updateQty}
                  onRemove={removeLine}
                  onCustomize={(entry) => setModifierLineId(entry.id)}
                  currency={currency}
                />
              ))
            )}
          </div>

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
                  <span>
                    An earlier sale attempt from {recoveredAttempt.createdAtClient ? new Date(recoveredAttempt.createdAtClient).toLocaleString() : "an unknown time"} is still unresolved. Retry uses its original operation key: if the server already recorded it, the original result is returned; if it was not recorded, retry may complete that older sale now. Check Sales first and do not retry if you already entered a replacement sale.
                  </span>
                  {Array.isArray(recoveredAttempt?.payload?.items) && <small style={{ display: "block", marginTop: 6 }}>
                    Attempt details: {recoveredAttempt.payload.items.map((item) => `${Number(item.quantity || 0)} × ${item.item_name || "item"}`).join(", ")} · submitted tender {currency} {fmt(recoveredAttempt.payload.payment_breakdown?.reduce((sum, tender) => sum + Number(tender.amount || 0), 0) || 0)}
                  </small>}
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
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
                  </div>
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
                color: submitError ? "#8d2f24" : "#2f6b42",
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
              <span>{submitError || successMessage}</span>
            </div>
          )}

          {/* Totals + Payment */}
          {cart.length > 0 && (
            <div style={{ borderTop: "1px solid rgba(55,70,57,.11)" }}>
              <div style={{ padding: "12px 16px" }}>
                {eligiblePromotions.length > 0 && (
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
                    color: "#647066",
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
                      color: "#647066",
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
                    fontSize: "18px",
                    fontWeight: 850,
                    color: "#24362c",
                    paddingTop: "10px",
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

              {/* Payment Methods */}
              {!showPayment ? (
                <div
                  style={{
                    padding: "0 16px 14px",
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: "6px",
                  }}
                >
                  {selectedCustomer &&
                    selectedCustomer.account_status === "active" &&
                    Number(selectedCustomer.available_credit || 0) >= Number(total || 0) && (
                      <button
                        onClick={() => {
                          setChargeToAccount(true);
                          setShowPayment(true);
                        }}
                        style={{
                          gridColumn: "1 / -1",
                          padding: "9px 11px",
                          borderRadius: 9,
                          border: "1px solid rgba(53,110,216,.22)",
                          background: "rgba(53,110,216,.08)",
                          color: "#356ed8",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
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
                      color: "#356ed8",
                    },
                    {
                      id: "mobile_money",
                      label: "Mobile money",
                      icon: Smartphone,
                      color: "#8a5d3b",
                    },
                  ].map((pm) => (
                    <button
                      key={pm.id}
                      onClick={() => {
                        setChargeToAccount(false);
                        setPaymentMethod(pm.id);
                        setShowPayment(true);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        padding: "12px",
                        borderRadius: "10px",
                        border: `1px solid ${pm.color}20`,
                        background: `${pm.color}08`,
                        color: pm.color,
                        fontSize: "13px",
                        fontWeight: 700,
                        cursor: "pointer",
                        transition: "all 120ms ease",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = `${pm.color}15`)
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = `${pm.color}08`)
                      }
                    >
                      <pm.icon size={16} />
                      {pm.label}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setChargeToAccount(false);
                      setPaymentMethod("split");
                      setSplitCashAmount("");
                      setShowPayment(true);
                    }}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "12px", borderRadius: "10px", border: "1px solid rgba(109,76,130,.18)", background: "rgba(109,76,130,.06)", color: "#6d4c82", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}
                  >
                    <WalletCards size={16} /> Split payment
                  </button>
                </div>
              ) : (
                <div style={{ padding: "0 16px 14px" }}>
                  {canUseTips && <label
                    style={{
                      display: "block",
                      marginBottom: "10px",
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
                        marginTop: "5px",
                        border: "1px solid rgba(55,70,57,.18)",
                        borderRadius: "8px",
                        padding: "9px 10px",
                        fontSize: "14px",
                      }}
                    />
                  </label>}
                  {paymentMethod === "split" && !chargeToAccount && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
                      <label style={{ fontSize: "12px", fontWeight: 700, color: "#5d4b52" }}>
                        Cash amount
                        <input type="number" min="0.01" max={Math.max(0, total - 0.01)} step="0.01" value={splitCashAmount} onChange={(event) => setSplitCashAmount(event.target.value)} placeholder="0.00" style={{ display: "block", boxSizing: "border-box", width: "100%", marginTop: "5px", border: "1px solid rgba(55,70,57,.18)", borderRadius: "8px", padding: "9px 10px", fontSize: "14px" }} />
                      </label>
                      <label style={{ fontSize: "12px", fontWeight: 700, color: "#5d4b52" }}>
                        Balance method
                        <select value={splitRemainderMethod} onChange={(event) => setSplitRemainderMethod(event.target.value)} style={{ display: "block", boxSizing: "border-box", width: "100%", marginTop: "5px", border: "1px solid rgba(55,70,57,.18)", borderRadius: "8px", padding: "9px 10px", fontSize: "14px", background: "white" }}>
                          <option value="card">Card</option>
                          <option value="mobile_money">Mobile money</option>
                        </select>
                      </label>
                      <label style={{ gridColumn: "1 / -1", fontSize: "12px", fontWeight: 700, color: "#5d4b52" }}>
                        {splitRemainderMethod === "mobile_money" ? "Mobile money reference" : "Card approval/reference"} *
                        <input
                          type="text"
                          required
                          maxLength={120}
                          value={paymentReferences[splitRemainderMethod] || ""}
                          onChange={(event) =>
                            setPaymentReferences((previous) => ({
                              ...previous,
                              [splitRemainderMethod]: event.target.value,
                            }))
                          }
                          placeholder={splitRemainderMethod === "mobile_money" ? "Transaction ID" : "Terminal approval code"}
                          style={{ display: "block", boxSizing: "border-box", width: "100%", marginTop: "5px", border: "1px solid rgba(55,70,57,.18)", borderRadius: "8px", padding: "9px 10px", fontSize: "14px" }}
                        />
                      </label>
                    </div>
                  )}
                  {!chargeToAccount && paymentMethod !== "cash" && paymentMethod !== "split" && (
                    <label style={{ display: "block", marginBottom: "10px", fontSize: "12px", fontWeight: 700, color: "#5d4b52" }}>
                      {paymentMethod === "mobile_money" ? "Mobile money reference" : "Card approval/reference"} *
                      <input
                        type="text"
                        required
                        maxLength={120}
                        value={paymentReferences[paymentMethod] || ""}
                        onChange={(event) =>
                          setPaymentReferences((previous) => ({
                            ...previous,
                            [paymentMethod]: event.target.value,
                          }))
                        }
                        placeholder={paymentMethod === "mobile_money" ? "Transaction ID" : "Terminal approval code"}
                        style={{ display: "block", boxSizing: "border-box", width: "100%", marginTop: "5px", border: "1px solid rgba(55,70,57,.18)", borderRadius: "8px", padding: "9px 10px", fontSize: "14px" }}
                      />
                    </label>
                  )}
                  <div
                    style={{
                      padding: "14px",
                      borderRadius: "10px",
                      background: "rgba(245, 158, 11, 0.06)",
                      border: "1px solid rgba(245, 158, 11, 0.12)",
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "11px",
                        color: "#7b7a70",
                        marginBottom: "4px",
                      }}
                    >
                      {chargeToAccount
                        ? `Charge ${selectedCustomer?.name || "customer"} account`
                        : paymentMethod === "split"
                          ? `Cash + ${splitRemainderMethod === "card" ? "Card" : "Mobile money"}`
                          : paymentMethod === "cash"
                            ? "Collect Cash"
                            : paymentMethod === "mobile_money"
                              ? "Confirm mobile money"
                              : "Process Card"}
                    </div>
                    <div
                      style={{
                        fontSize: "22px",
                        fontWeight: 800,
                        color: "#c95635",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {currency} {fmt(total)}
                    </div>
                  </div>
                  <button
                    onClick={completeOrder}
                    disabled={submitting}
                    style={{
                      width: "100%",
                      padding: "12px",
                      marginTop: "8px",
                      borderRadius: "10px",
                      border: "none",
                      background: "linear-gradient(135deg, #497a8b, #315866)",
                      color: "#fffdf8",
                      fontSize: "14px",
                      fontWeight: 800,
                      cursor: "pointer",
                      boxShadow: "0 8px 22px rgba(49, 88, 102, 0.24)",
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
                      padding: "8px",
                      marginTop: "6px",
                      borderRadius: "8px",
                      border: "1px solid rgba(55,70,57,.16)",
                      background: "#fffdf8",
                      color: "#7b7a70",
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
              <h3 style={{ margin: "5px 0 4px", color: "#24362c" }}>
                Start your shift
              </h3>
              <p
                style={{
                  margin: "0 0 16px",
                  color: "#7b7a70",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                Choose the opening cash float. Sales from this terminal will
                then be included in your cash-up.
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
                  disabled={shiftBusy || !selectedOutlet?.id}
                  onClick={openShift}
                  style={{
                    padding: "9px 14px",
                    border: 0,
                    borderRadius: 9,
                    background: "#c95635",
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
                  style={{
                    width: "min(500px,100%)",
                    maxHeight: "80vh",
                    overflow: "auto",
                    background: "#fffdf8",
                    borderRadius: 20,
                    padding: 24,
                  }}
                >
                  <h3 style={{ margin: 0, color: "#24362c" }}>
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
                                border: `1px solid ${selected ? "#c95635" : "rgba(55,70,57,.16)"}`,
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
                    <p style={{ color: "#7b7a70" }}>
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
                        background: "#c95635",
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
      </div>
      {completedReceipt && (
        <POSReceipt
          order={completedReceipt.order}
          autoPrint={completedReceipt.autoPrint}
          onClose={() => setCompletedReceipt(null)}
        />
      )}
    </>
  );
}
