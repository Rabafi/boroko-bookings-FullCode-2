import { useEffect, useMemo, useRef, useState } from "react";
import { ScanLine, X } from "lucide-react";
import { useSettings } from "../../app-context";
import { ErrorNotice } from "../shared/ErrorNotice";
import { BAR_PRODUCT_CATEGORIES, BAR_PACK_SIZES, BAR_COUNTED_UNITS } from "../../../../shared/barModeProfile";
import { createBarcodeScannerDecoder } from "../../../../shared/barcodeScanner";

/**
 * Unified product-creation flow launched from Products and Stock alike.
 * One form, five concerns: what (name/category/price/barcode), stock
 * (create-matching by default or link existing), counted unit/outlet/
 * opening/threshold, optional packs, plain-language review.
 *
 * Editing reuses the same flow but never replays opening stock: current
 * quantity leads to Count/Receive actions instead. Recipe products get a
 * read-only recovery panel (no casual conversion).
 */
const emptyForm = (initialBarcode = "") => ({
  mode: "product",
  name: "",
  category: "Beer",
  price: "",
  barcode: initialBarcode || "",
  available: true,
  depletionQty: "1",
  stockChoice: "create",
  linkStockId: "",
  stockName: "",
  unit: "bottle",
  outletId: "",
  openingStock: "",
  reorderLevel: "",
  unitCost: "",
  sellingPrice: "",
  pack6: false,
  pack12: false,
  pack24: false,
  pack6Barcode: "",
  pack12Barcode: "",
  pack24Barcode: "",
  operationKey: "",
});

function newOperationKey() {
  try {
    return crypto.randomUUID();
  } catch {
    return `op-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

// Mirror of public.restaurant_menu_category_requires_recipe (20260716025000).
// The server silently forces these sections onto the recipe method, so the
// no-stock choice fails closed here instead of saving an unavailable draft.
const SERVER_RECIPE_FORCED_CATEGORIES = Object.freeze([
  "breakfast", "starters", "mains", "sides", "desserts", "cocktails", "food",
]);

export default function HposProductWizard({
  initialBarcode = "",
  initialProduct = null,
  initialStock = null,
  initialPacks = null,
  initialAvailable = true,
  hasRecipe = false,
  modifierGroups = [],
  onManageModifiers = null,
  onEditExisting = null,
  onClose = null,
  onSaved = null,
}) {
  const { settings } = useSettings();
  const currency = settings?.currency || "P";
  const editing = Boolean(initialProduct?.id);
  const [form, setForm] = useState(() => {
    const base = emptyForm(initialBarcode);
    if (!initialProduct) return { ...base, operationKey: newOperationKey() };
    const packs = initialPacks || {};
    return {
      ...base,
      operationKey: newOperationKey(),
      name: initialProduct.name || "",
      category: initialProduct.category || "Beer",
      price: initialProduct.price != null ? String(initialProduct.price) : "",
      barcode: initialProduct.barcode || initialBarcode || "",
      available: initialAvailable,
      stockChoice: initialProduct.inventory_item_id ? "link" : initialProduct.stock_method === "non_stock" ? "none" : "create",
      linkStockId: initialProduct.inventory_item_id || "",
      unit: initialStock?.unit || "bottle",
      outletId: initialStock?.outlet_id || "",
      reorderLevel: initialStock?.reorder_level ?? "",
      unitCost: initialStock?.latest_unit_cost ?? "",
      sellingPrice: initialStock?.selling_price ?? "",
      depletionQty: initialProduct.depletion_qty ?? "1",
      pack6: packs.pack6 === true,
      pack12: packs.pack12 === true,
      pack24: packs.pack24 === true,
      pack6Barcode: packs.pack6Barcode || "",
      pack12Barcode: packs.pack12Barcode || "",
      pack24Barcode: packs.pack24Barcode || "",
    };
  });
  const [menuItems, setMenuItems] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [publicationNotice, setPublicationNotice] = useState("");
  const [scanTarget, setScanTarget] = useState(null);
  const [scanStatus, setScanStatus] = useState("");
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  // After a failed save, the operation key retires only when the operator
  // actually changes the submitted values: an explicit retry of identical
  // values must keep the key for verbatim replay (no duplicates), while
  // corrected values need a fresh key (no overwrite collisions).
  const failedRef = useRef(false);
  const lastSubmittedRef = useRef(null);
  const businessKey = (values) => {
    const { operationKey: _ignored, ...rest } = values || {};
    return JSON.stringify(rest);
  };
  const set = (patch) => {
    setForm((current) => {
      const next = { ...current, ...patch };
      if (failedRef.current && businessKey(next) !== lastSubmittedRef.current) {
        failedRef.current = false;
        next.operationKey = newOperationKey();
      }
      return next;
    });
    setUnknownOutcome(false);
  };

  // Shared by the mount load and post-save refresh: after "Save & add
  // another" the just-created stock must appear in Link existing stock
  // instead of waiting for the wizard to be closed and reopened.
  const refreshLists = async () => {
    const [menu, stock, outletRows] = await Promise.all([
      window.api?.pos?.getMenuItems?.() ?? [],
      window.api?.inventory?.getItems?.() ?? [],
      window.api?.outlets?.getAll?.() ?? [],
    ]);
    setMenuItems(Array.isArray(menu) ? menu : []);
    // Delisted stock is never offered for linking: deleting its product
    // delists it, and re-creating the product mints fresh stock instead.
    setInventoryItems(
      (Array.isArray(stock) ? stock : []).filter((row) => row?.is_active !== false),
    );
    const rows = Array.isArray(outletRows) ? outletRows : [];
    setOutlets(rows);
    return rows;
  };

  useEffect(() => {
    let active = true;
    refreshLists()
      .then((rows) => {
        if (!active) return;
        if (!editing && !form.outletId) {
          const beverage = rows.find((outlet) => outlet?.type === "beverage" && outlet?.is_active !== false);
          if (beverage) set({ outletId: beverage.id });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard-wedge scan arming for any barcode field.
  useEffect(() => {
    if (!scanTarget) return undefined;
    const decoder = createBarcodeScannerDecoder();
    let idleTimer = null;
    const finish = (result = {}) => {
      setScanTarget(null);
      if (!result.success) {
        setScanStatus(`Barcode scan failed: ${result.code || "invalid_scan"}.`);
        return;
      }
      set({ [scanTarget]: result.barcode });
      setScanStatus(`Barcode captured: ${result.barcode}`);
    };
    const onKeyDown = (event) => {
      const key = String(event.key || "");
      if (!(key.length === 1 || key === "Enter" || key === "NumpadEnter" || key === "Tab")) return;
      const outcome = decoder.consumeKey(event);
      if (outcome.type === "buffered" || outcome.type === "completed") event.preventDefault();
      if (outcome.type === "buffered") {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          const flushed = decoder.flush();
          if (flushed.type === "completed") finish(flushed.result);
        }, decoder.getOptions().idleCompleteMs);
        return;
      }
      if (outcome.type === "completed") finish(outcome.result);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      clearTimeout(idleTimer);
      window.removeEventListener("keydown", onKeyDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanTarget]);

  const linkedStock = useMemo(
    () => inventoryItems.find((row) => String(row.id) === String(form.linkStockId || "")) || null,
    [inventoryItems, form.linkStockId],
  );
  const effectiveOutlet = useMemo(
    () => outlets.find((outlet) => String(outlet.id) === String(form.stockChoice === "link" ? linkedStock?.outlet_id || form.outletId : form.outletId)) || null,
    [outlets, form.stockChoice, form.outletId, linkedStock],
  );
  const outletIsBeverage = Boolean(
    effectiveOutlet && effectiveOutlet.type === "beverage" && effectiveOutlet.is_active !== false,
  );
  const nameNeedle = form.name.trim().toLowerCase();
  const barcodeNeedle = form.barcode.trim();
  const duplicateProduct = useMemo(() => {
    if (editing) return null;
    return (
      menuItems.find((row) => {
        if (editing && String(row.id) === String(initialProduct?.id)) return false;
        if (nameNeedle && String(row.name || "").trim().toLowerCase() === nameNeedle) return true;
        if (barcodeNeedle && String(row.barcode || "").trim() === barcodeNeedle) return true;
        return false;
      }) || null
    );
  }, [menuItems, nameNeedle, barcodeNeedle, editing, initialProduct]);
  const duplicateStock = useMemo(() => {
    if (editing || form.stockChoice !== "create") return null;
    const stockNeedle = String(form.stockName || "").trim().toLowerCase() || nameNeedle;
    if (barcodeNeedle) {
      const byBarcode = inventoryItems.find((row) => String(row.barcode || "").trim() === barcodeNeedle);
      if (byBarcode) return byBarcode;
    }
    if (!stockNeedle) return null;
    return inventoryItems.find((row) => String(row.name || "").trim().toLowerCase() === stockNeedle) || null;
  }, [inventoryItems, barcodeNeedle, nameNeedle, form.stockName, editing, form.stockChoice]);
  // A <select> shows every category without filtering. Legacy rows may carry
  // a custom category outside BAR_PRODUCT_CATEGORIES; keep that exact value
  // visible while editing instead of silently resetting it to Beer.
  const visibleCategories = useMemo(() => {
    const current = String(form.category || "").trim();
    if (!current || BAR_PRODUCT_CATEGORIES.includes(current)) return BAR_PRODUCT_CATEGORIES;
    return Object.freeze([...BAR_PRODUCT_CATEGORIES, current]);
  }, [form.category]);
  // Modifier groups that offer sizes & extras for the chosen category.
  // An empty applies_to_categories list means the group covers all sections.
  const applicableModifiers = useMemo(() => {
    const needle = String(form.category || "").trim().toLowerCase();
    return (Array.isArray(modifierGroups) ? modifierGroups : []).filter((group) => {
      const scopes = Array.isArray(group?.applies_to_categories)
        ? group.applies_to_categories.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
        : [];
      if (scopes.length === 0 || scopes.includes("all")) return true;
      return needle !== "" && scopes.includes(needle);
    });
  }, [modifierGroups, form.category]);
  const isPool = String(form.category || '').trim().toLowerCase() === 'pool';

  const depletion = Number(form.depletionQty ?? "1");
  const reviewSentence = useMemo(() => {
    if (form.mode === "stock-only") {
      return "Stock-only: counted but not sold directly. No selling price or packs.";
    }
    if (form.stockChoice === "none") {
      return "No stock tracking: each sale records revenue only and depletes nothing. Mark the product unavailable yourself when the tray runs out.";
    }
    const unit = (form.stockChoice === "link" ? linkedStock?.unit : null) || form.unit || "unit";
    const perSale = Number.isFinite(depletion) && depletion > 0 ? depletion : 1;
    const packs = BAR_PACK_SIZES.filter((size) => form[`pack${size}`]);
    const packText = packs.length && outletIsBeverage
      ? ` A ${packs.map((size) => (size === 24 ? "case of 24" : `${size}-pack`)).join(", ")} removes ${packs.join(", ")} ${unit}s.`
      : "";
    return `One sale removes ${perSale} ${unit}${perSale === 1 ? "" : "s"}.${packText}`;
  }, [form, depletion, outletIsBeverage, linkedStock]);

  const validate = () => {
    if (!form.name.trim()) return "Enter the product name.";
    if (!String(form.category || "").trim()) return "Choose a category.";
    if (form.mode === "stock-only" && form.stockChoice === "none") {
      return "Stock-only items always create counted stock. Switch back to a sellable product for no-stock tracking.";
    }
    if (form.mode === "product") {
      if (!(Number(isPool ? 1 : form.price) > 0)) return "Set a selling price greater than zero.";
      if (isPool) {
        if (form.stockChoice !== "none") return "Pool tables must use No stock tracking — sales record cash only and deplete nothing.";
        if (BAR_PACK_SIZES.some((size) => form[`pack${size}`])) return "Pool tables do not use packs. Keep all pack boxes unticked.";
        return null;
      }
      if (form.stockChoice === "none") {
        if (SERVER_RECIPE_FORCED_CATEGORIES.includes(String(form.category || "").trim().toLowerCase())) {
          return "This section needs a recipe with ingredients — no-stock tracking is not allowed here. Use Simple Food or Snacks for in-house food sold without stock.";
        }
        return null;
      }
      if (!Number.isFinite(depletion) || depletion <= 0) return "Enter the positive stock quantity consumed by one sale.";
      if (form.stockChoice === "link" && !form.linkStockId) return "Choose the existing stock item to link, or switch to creating matching stock.";
      if (BAR_PACK_SIZES.some((size) => form[`pack${size}`]) && !outletIsBeverage) {
        return "Packs need an active Bar outlet. Assign the stock to one first.";
      }
    }
    if (form.stockChoice === "create" && Number(form.openingStock || 0) < 0) {
      return "Opening stock cannot be negative.";
    }
    return null;
  };

  const buildPayload = () => ({
    operation_key: form.operationKey || newOperationKey(),
    menu_item_id: editing ? initialProduct.id : null,
    inventory_item_id:
      form.stockChoice === "link" ? form.linkStockId : initialStock?.id || undefined,
    expected_menu_version: editing ? initialProduct.updated_at || null : null,
    // Linking needs the selected row's version: a product that currently
    // tracks nothing has no stock version of its own to offer.
    expected_stock_version: form.stockChoice === "link"
      ? linkedStock?.updated_at || initialStock?.updated_at || null
      : initialStock?.updated_at || null,
    name: form.name.trim(),
    category: form.category.trim() || "Beer",
    price: Number(form.price),
    barcode: form.barcode.trim() || null,
    depletion_qty: Number.isFinite(depletion) && depletion > 0 ? depletion : 1,
    // Edits preserve the hydrated availability; a sold-out item stays
    // sold-out unless the operator explicitly re-enables it.
    is_available: editing ? form.available !== false : true,
    stock_mode: form.stockChoice === "link" ? "link" : "create",
    stock_name: String(form.stockName || "").trim() || form.name.trim(),
    stock_category: form.category.trim() || "Beer",
    stock_unit: form.unit,
    stock_barcode: form.barcode.trim() || null,
    outlet_id: form.stockChoice === "link" ? linkedStock?.outlet_id || form.outletId || null : form.outletId || null,
    // Never replay opening stock on edit: the server ignores it for links
    // and the wizard omits it when editing.
    opening_stock: editing ? 0 : Number(form.openingStock || 0),
    reorder_level: Number(form.reorderLevel || 0),
    unit_cost: Number(form.unitCost || 0),
    selling_price: Number(form.sellingPrice || form.price) || 0,
    pack6: form.pack6,
    pack12: form.pack12,
    pack24: form.pack24,
    pack6Barcode: form.pack6Barcode || null,
    pack12Barcode: form.pack12Barcode || null,
    pack24Barcode: form.pack24Barcode || null,
  });

  const save = async (addAnother) => {
    const problem = validate();
    if (problem) {
      setSaveError(problem);
      return;
    }
    lastSubmittedRef.current = businessKey(form);
    setSaving(true);
    setSaveError("");
    setPublicationNotice("");
    setUnknownOutcome(false);
    try {
      if (form.mode === "stock-only") {
        // Stock-only creation carries no operation key on the legacy stock
        // contract, so an ambiguous failure must not auto-retry: the
        // operator verifies in Stock first, then explicitly retries.
        const result = await window.api?.inventory?.createItem?.({
          name: form.name.trim(),
          category: form.category.trim() || "Beer",
          current_stock: editing ? undefined : Number(form.openingStock || 0),
          unit: form.unit,
          reorder_level: Number(form.reorderLevel || 0),
          unit_cost: form.unitCost,
          outlet_id: form.outletId || null,
          barcode: form.barcode.trim() || null,
        });
        if (!result?.success) throw new Error(result?.error || "Could not save this stock item.");
      } else if (hasRecipe && editing) {
        // Recipe products: price/barcode/availability only. Stock linkage
        // and packs stay untouched (no casual conversion contract exists).
        const result = await window.api?.pos?.updateMenuItem?.(initialProduct.id, {
          name: form.name.trim(),
          category: form.category.trim() || initialProduct.category || "Beer",
          price: Number(form.price),
          barcode: form.barcode.trim() || null,
          is_available: initialProduct.is_available !== false,
        });
        if (!result?.success) throw new Error(result?.error || "Could not save this product.");
      } else if (form.stockChoice === "none" && !hasRecipe) {
        // In-house food sold without depleting anything (fatcakes by the
        // tray). The atomic product+stock contract requires a stock identity,
        // so this uses the plain menu-item contract with an explicit
        // non-stock method instead. Outlet stays null (global, sells at the
        // Bar Till) on create and untouched on edit; a delinked stock item
        // stays listed in Stock with its history. Like stock-only creation
        // this carries no operation key: an ambiguous failure must be checked
        // in Products before any retry, never replayed blindly.
        const payload = {
          name: form.name.trim(),
          category: form.category.trim() || "Beer",
          price: String(form.category || '').trim().toLowerCase() === 'pool' ? 1 : Number(form.price),
          barcode: form.barcode.trim() || null,
          stock_method: "non_stock",
          inventory_item_id: null,
          depletion_qty: null,
          is_available: editing ? form.available !== false : true,
        };
        const result = editing
          ? await window.api?.pos?.updateMenuItem?.(initialProduct.id, payload)
          : await window.api?.pos?.createMenuItem?.(payload);
        if (!result?.success) throw new Error(result?.error || "Could not save this product.");
      } else {
        const payload = buildPayload();
        // No staged legacy fallback: when the atomic contract is missing
        // server-side the request stays preserved and the operator is told
        // which update is required. Legacy writes must never run silently.
        const saved = await window.api?.pos?.saveBarProductWithStock?.(payload);
        if (!saved?.success) throw new Error(saved?.error || "Could not save this product.");
        if (saved.publication === "pending" && !publicationNotice) {
          setPublicationNotice("Saved. Catalog publication is pending — the Till picks it up after publish.");
        }
        if (saved.publication === "failed") {
          setPublicationNotice("Saved, but catalog publication needs manager review. Use Retry publication.");
        }
      }
      const keep = addAnother
        ? { ...emptyForm(), operationKey: newOperationKey(), category: form.category, unit: form.unit, outletId: form.outletId, mode: form.mode, stockChoice: form.stockChoice }
        : null;
      if (keep) {
        // Reload so the stock (and product) just created is linkable and
        // duplicate-checked in the next round without reopening the wizard.
        await refreshLists().catch(() => {});
        setForm(keep);
        onSaved?.({ success: true }, { addAnother: true });
      } else {
        onSaved?.({ success: true }, { addAnother: false });
        onClose?.();
      }
    } catch (error) {
      failedRef.current = true;
      const message = error?.message || "Could not save.";
      setSaveError(message);
      // Ambiguous outcomes keep the operation key for verbatim retry; the
      // operator verifies first, then explicitly retries (never auto).
      if (/Nothing was confirmed|outcome unknown|reuses the original|update, then retry/i.test(message)) {
        setUnknownOutcome(true);
      }
    } finally {
      setSaving(false);
    }
  };

  const retryPublication = async () => {
    setSaveError("");
    try {
      // One path for banner and wizard: replays the stored save verbatim,
      // sweeps its outlets, and marks the request, so the notice always
      // agrees with the Products banner. Sweeping the form outlet directly
      // could report success without touching the request's outlets.
      const result = await window.api?.pos?.retryProductRequest?.(form.operationKey);
      if (!result?.success) throw new Error(result?.error || "Publication is still pending.");
      if (result?.publication === "published") {
        setPublicationNotice("Catalog published.");
      } else if (result?.publication === "failed") {
        setPublicationNotice("Saved, but catalog publication needs manager review. Use Retry publication.");
      } else {
        throw new Error(result?.error || "Publication is still pending.");
      }
    } catch (error) {
      setSaveError(error?.message || "Publication is still pending.");
    }
  };

  const barcodeField = (key, label, placeholder) => (
    <label>
      {label}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="text"
          value={form[key] || ""}
          onChange={(event) => set({ [key]: event.target.value })}
          placeholder={placeholder}
          autoComplete="off"
          style={{ flex: 1 }}
        />
        <button
          type="button"
          onClick={() => {
            setScanStatus(`Waiting for scanner input for ${label}…`);
            setScanTarget(key);
          }}
          disabled={saving}
          aria-label={`Scan ${label}`}
        >
          <ScanLine size={14} /> {scanTarget === key ? "Scanning…" : "Scan"}
        </button>
        {form[key] && (
          <button type="button" onClick={() => set({ [key]: "" })} disabled={saving} aria-label={`Clear ${label}`}>
            <X size={14} />
          </button>
        )}
      </div>
      <small>Leading zeroes are preserved. Singles and packs may intentionally differ — each barcode is kept, never bulk-overwritten.</small>
    </label>
  );

  return (
    <div className="hpos-modal-backdrop" role="presentation">
      <section
        className="hpos-service-dialog hpos-service-menu-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bar-product-wizard-title"
      >
        <button
          type="button"
          className="hpos-service-dialog__close"
          onClick={() => onClose?.()}
          disabled={saving}
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <p className="hpos-eyebrow">{editing ? "Edit product and stock" : "New product and stock"}</p>
        <h2 id="bar-product-wizard-title">{editing ? `Edit ${initialProduct.name}` : "Add a product"}</h2>
        <p>One flow for the sellable and the counted stock behind it. Nothing here edits recipe ingredients.</p>

        {hasRecipe && (
          <div className="hpos-inline-notice">
            <strong>Recipe product.</strong> This item is consumed through a
            recipe, so stock linking is read-only here. Manage ingredients in
            Stock &amp; Purchasing Pro (Recipes &amp; margin). Price, barcode
            and availability below remain editable.
          </div>
        )}

        {loading ? (
          <div className="hpos-service-loading"><span>Loading stock and outlets…</span></div>
        ) : (
          <>
            <div className="hpos-service-form hpos-service-form--two">
              <label className="is-wide">
                What are you adding?
                <select value={form.mode} onChange={(event) => set({ mode: event.target.value, stockChoice: event.target.value === "stock-only" && form.stockChoice === "none" ? "create" : form.stockChoice })} disabled={editing || hasRecipe}>
                  <option value="product">For sale at the Till</option>
                  <option value="stock-only">Stock only (not sold directly)</option>
                </select>
                <small>For-sale products appear at the Till with a selling price — choose below whether sales deplete stock or sell without tracking. Stock-only items are counted and received but never sold directly and need no selling price or menu entry.</small>
              </label>
              <label className="is-wide">
                Product name
                <input autoFocus type="text" value={form.name} onChange={(event) => set({ name: event.target.value })} placeholder="Heineken 330ml" />
              </label>
              <label>
                Category (shared with stock)
                <select value={form.category} onChange={(event) => {
                  const next = event.target.value;
                  if (String(next || '').trim().toLowerCase() === 'pool') {
                    set({ category: next, mode: "product", price: "1", stockChoice: "none", name: form.name || "Pool Table 1" });
                  } else {
                    set({ category: next });
                  }
                }}>
                  {visibleCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <small>For example, Coke uses Softs. Pool tables use Pool. Shared with stock.</small>
              </label>
              {isPool && form.mode === "product" && !hasRecipe && (
                <div className="hpos-inline-notice is-stack" role="status">
                  <span>
                    <strong>Pool table cash.</strong> Price stays P1, No stock tracking. At night type cash from each table box as quantity: Table 1 P80 = quantity 80. One table = one product (Pool Table 1, Pool Table 2).
                  </span>
                </div>
              )}
              {form.mode === "product" && (
                <label>
                  Selling price ({currency})
                  <input type="number" min="0.01" step="0.01" value={isPool ? "1" : form.price} onChange={(event) => set({ price: event.target.value })} disabled={isPool} />
                  {isPool ? <small>Pool price is fixed P1. You type the cash as quantity at night.</small> : null}
                </label>
              )}
              {barcodeField("barcode", form.mode === "product" ? "Single barcode (optional)" : "Barcode (optional)", "Scan or enter barcode")}
              {form.mode === "product" && !hasRecipe && form.stockChoice !== "none" && (
                <label>
                  Stock units consumed per sale
                  <input type="number" min="0.000001" step="any" inputMode="decimal" value={form.depletionQty ?? "1"} onChange={(event) => set({ depletionQty: event.target.value })} />
                  <small>1 for one bottle, can or portion. Use a decimal for weighed or measured use, for example 0.3 for 0.3 kg of potatoes per Fries, or 0.05 litres per pour.</small>
                </label>
              )}
              {editing && (
                <label>
                  <input
                    type="checkbox"
                    checked={form.available !== false}
                    onChange={(event) => set({ available: event.target.checked })}
                  />
                  Available for sale
                  <small>Unchanged edits keep the current availability — a sold-out item stays sold-out unless re-enabled here.</small>
                </label>
              )}
            </div>

            {(duplicateProduct || duplicateStock) && (
              <div className="hpos-inline-notice is-stack" role="status">
                <span>
                  <strong>Already exists:</strong>{" "}
                  {duplicateProduct ? `“${duplicateProduct.name}” is already a sellable product` : barcodeNeedle && String(duplicateStock.barcode || "").trim() === barcodeNeedle ? `barcode is already on stock “${duplicateStock.name}”` : `“${duplicateStock.name}” is already a stock item — link it instead of creating a second one`}
                </span>
                {duplicateProduct && onEditExisting && (
                  <button type="button" className="hpos-secondary-action" onClick={() => onEditExisting(duplicateProduct)}>
                    Use existing product
                  </button>
                )}
              </div>
            )}

            {form.mode === "product" && !hasRecipe && !isPool && (
              <div className="hpos-inline-notice is-stack" role="status">
                <span>
                  <strong>Sizes &amp; extras: </strong>
                  {applicableModifiers.length > 0 ? (
                    <>offered at the Till for {form.category || "this category"}: {applicableModifiers.map((group) => group.name).join(", ")}.</>
                  ) : (
                    <>no modifier group covers {form.category || "this category"} yet. Add one for sizes (Small / Large) or extras instead of duplicating products.</>
                  )}
                </span>
                {onManageModifiers ? (
                  <button type="button" className="hpos-secondary-action" onClick={() => onManageModifiers()}>
                    Manage sizes &amp; extras
                  </button>
                ) : (
                  <span> Manage groups in Products › Modifiers.</span>
                )}
              </div>
            )}

            {!hasRecipe && (
              <>
                <h3>Stock</h3>
                <div className="hpos-service-form hpos-service-form--two">
                  <label className="is-wide">
                    Stock source
                    <select value={isPool ? "none" : form.stockChoice} onChange={(event) => set({ stockChoice: event.target.value })} disabled={isPool || (editing && form.stockChoice === "link")}>
                      <option value="create">Create matching stock</option>
                      <option value="link">Link existing stock</option>
                      <option value="none" disabled={form.mode === "stock-only"}>No stock tracking — sell without depleting anything</option>
                    </select>
                    {isPool ? <small>Pool tables never track stock. Cash only. This box is locked.</small> : <small>Creating copies the name, category and barcode once — edit the stock name first when one stock serves several products. Linking preserves the existing stock metadata unless you edit it in Stock. No tracking suits in-house food cooked by the tray, such as fatcakes: sales record revenue only, and you mark the product unavailable yourself when it runs out.</small>}
                  </label>
                  {form.stockChoice === "link" ? (
                    <label className="is-wide">
                      Existing stock item
                      <select value={form.linkStockId} onChange={(event) => set({ linkStockId: event.target.value })}>
                        <option value="">Choose a stock item…</option>
                        {inventoryItems.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name} · {Number(row.current_stock || 0)} {row.unit || "each"}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : form.stockChoice === "create" ? (
                    <>
                      <label>
                        Stock item name
                        <input type="text" value={form.stockName} onChange={(event) => set({ stockName: event.target.value })} placeholder={form.name.trim() ? `Same as product (“${form.name.trim()}”)` : "Same as product"} />
                        <small>Name the counted thing, not the variation — for example stock “Russian” serves products “Russian (Full)” and “Russian (Half)”.</small>
                      </label>
                      <label>
                        Counted unit
                        <select value={form.unit} onChange={(event) => set({ unit: event.target.value })}>
                          {BAR_COUNTED_UNITS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <small>Use kilograms or grams for weighed ingredients such as potatoes, litres for measured pours.</small>
                      </label>
                      <label>
                        Stock location
                        <select value={form.outletId} onChange={(event) => set({ outletId: event.target.value })}>
                          <option value="">Unassigned</option>
                          {outlets.filter((outlet) => outlet?.is_active !== false).map((outlet) => (
                            <option key={outlet.id} value={outlet.id}>
                              {outlet.name}{outlet.type === "beverage" ? " (Bar)" : ""}
                            </option>
                          ))}
                        </select>
                        <small>Packs need an active Bar location.</small>
                      </label>
                      {!editing && (
                        <label>
                          Opening quantity
                          <input type="number" min="0" step="any" value={form.openingStock} onChange={(event) => set({ openingStock: event.target.value })} placeholder="0" />
                          <small>Recorded once. Later changes use Receive or Count.</small>
                        </label>
                      )}
                      <label>
                        Low-stock threshold
                        <input type="number" min="0" step="any" value={form.reorderLevel} onChange={(event) => set({ reorderLevel: event.target.value })} placeholder="0" />
                      </label>
                      <label>
                        Unit cost ({currency}, optional)
                        <input type="number" min="0" step="any" value={form.unitCost} onChange={(event) => set({ unitCost: event.target.value })} placeholder="0.00" />
                      </label>
                      <label>
                        Stock selling price ({currency})
                        <input type="number" min="0" step="any" value={form.sellingPrice} onChange={(event) => set({ sellingPrice: event.target.value })} placeholder={form.price || "Same as selling price"} />
                        <small>Defaults to the selling price. Required above zero for Bar locations.</small>
                      </label>
                    </>
                  ) : (
                    <div className="hpos-inline-notice is-wide is-stack">
                      <span>
                        <strong>No stock tracking.</strong> This product sells at the Till without depleting anything and never runs out on its own — mark it unavailable when the tray is empty.
                        {editing && initialStock ? " Its previous stock item stays listed in Stock with its history." : ""}
                      </span>
                    </div>
                  )}
                  {editing && (
                    <div className="hpos-inline-notice is-wide">
                      Current quantity leads to Count or Receive actions in Stock — opening stock is never replayed by editing.
                    </div>
                  )}
                </div>

                {form.mode === "product" && form.stockChoice !== "none" && (
                  <>
                    <h3>Packs (optional)</h3>
                    {!outletIsBeverage ? (
                      <div className="hpos-inline-notice">
                        Assign the stock to an active Bar outlet to enable 6-packs, 12-packs and cases.
                      </div>
                    ) : (
                      <>
                        <div className="hpos-inline-notice">
                          Packs work for any counted unit: a 6-pack of fatcake portions removes 6 portions, just as a 6-pack of bottles removes 6 bottles. Sizes stay 6, 12 and 24.
                        </div>
                      <div style={{ display: "grid", gap: 10 }}>
                        {BAR_PACK_SIZES.map((size) => {
                          const key = `pack${size}`;
                          const barcodeKey = `${key}Barcode`;
                          return (
                            <div key={size} style={{ display: "grid", gap: 5 }}>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={form[key] === true}
                                  onChange={(event) => set({ [key]: event.target.checked })}
                                />
                                {size === 24 ? "Case 24" : `${size}-pack`}
                              </label>
                              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <input
                                  type="text"
                                  value={form[barcodeKey] || ""}
                                  onChange={(event) => set({ [barcodeKey]: event.target.value })}
                                  placeholder={`${size === 24 ? "Case 24" : `${size}-pack`} barcode (optional)`}
                                  autoComplete="off"
                                  style={{ flex: 1 }}
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setScanStatus(`Waiting for scanner input for ${size}-pack barcode…`);
                                    setScanTarget(barcodeKey);
                                  }}
                                  disabled={saving}
                                  aria-label={`Scan ${size}-pack barcode`}
                                >
                                  <ScanLine size={14} /> {scanTarget === barcodeKey ? "Scanning…" : "Scan"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      </>
                    )}
                  </>
                )}
              </>
            )}

            <div className="hpos-inline-notice is-stack" role="status">
              <span>
                <strong>Review:</strong> {reviewSentence}
                {form.stockChoice === "create" && !editing && Number(form.openingStock || 0) > 0 && (
                  <> Opening {form.openingStock} is added once.</>
                )}
              </span>
            </div>
            {scanStatus && <div role="status" className="hpos-inline-notice">{scanStatus}</div>}
            {saveError && <ErrorNotice className="hpos-inline-error">{saveError}</ErrorNotice>}
            {unknownOutcome && (
              <div className="hpos-inline-notice is-stack" role="status">
                <span>
                  <strong>Outcome unknown — nothing was confirmed.</strong>{" "}
                  {form.mode === "stock-only"
                    ? "Check Stock for this item before retrying; retrying blindly may duplicate it."
                    : form.stockChoice === "none"
                    ? "Check Products for this item before retrying; retrying blindly may duplicate it."
                    : "Retrying reuses the original save — it cannot duplicate stock or products."}{" "}
                </span>
                <button type="button" className="hpos-secondary-action" onClick={() => save(false)} disabled={saving}>
                  I checked — retry
                </button>
              </div>
            )}
            {publicationNotice && (
              <div className="hpos-inline-notice is-stack" role="status">
                <span>{publicationNotice}</span>{" "}
                {publicationNotice.includes("pending") && (
                  <button type="button" className="hpos-secondary-action" onClick={retryPublication} disabled={saving}>
                    Retry publication
                  </button>
                )}
              </div>
            )}
            <footer>
              <button type="button" className="hpos-secondary-action" onClick={() => onClose?.()} disabled={saving}>
                Cancel
              </button>
              {!editing && (
                <button type="button" className="hpos-secondary-action" onClick={() => save(true)} disabled={saving}>
                  {saving ? "Saving…" : "Save & add another"}
                </button>
              )}
              <button type="button" className="hpos-primary-action" onClick={() => save(false)} disabled={saving}>
                {saving ? "Saving…" : editing ? "Save changes" : "Save product"}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
