import { useEffect, useMemo, useState } from "react";
import {
  ArchiveRestore,
  BadgeDollarSign,
  ClipboardCheck,
  Clock3,
  PackagePlus,
  PackageSearch,
  PenLine,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TrendingDown,
  X,
} from "lucide-react";
import { useAccess, useSettings } from "../../app-context";
import { canAccessCapability } from "../../../../shared/accessControl";
import { isBarOnlyMode } from "../../../../shared/propertyTypes";

const today = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};
const qty = (value) => Number(value || 0);
const formatLocalDateTime = (value) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
const isLow = (item) =>
  qty(item.reorder_level) > 0 &&
  qty(item.current_stock) <= qty(item.reorder_level);
const isEmpty = (item) => qty(item.current_stock) <= 0;
const INVENTORY_CATEGORIES = [
  "Beverages",
  "Fresh produce",
  "Meat & seafood",
  "Dairy & chilled",
  "Dry goods",
  "Frozen",
  "Bakery",
  "Prepared ingredients",
  "Packaging",
  "Cleaning & consumables",
  "Other",
];
const INVENTORY_UNITS = [
  "each",
  "g",
  "kg",
  "ml",
  "litre",
  "portion",
  "pack",
  "case",
  "bottle",
  "can",
  "keg",
];

const ACTION = {
  primary: {
    border: 0,
    background: "linear-gradient(135deg, #e8994e, #c96b3e)",
    color: "#251a20",
  },
  outline: {
    border: "1px solid rgba(255,255,255,.24)",
    background: "rgba(255,255,255,.09)",
    color: "#fff",
  },
};

export default function RestaurantStock() {
  const access = useAccess();
  const { settings } = useSettings();
  const barOnly = isBarOnlyMode(settings);
  const canManageInventory = canAccessCapability(access, "inventory.manage");
  const currency = settings?.currency || "P";
  const [tab, setTab] = useState("stock");
  const [items, setItems] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [movements, setMovements] = useState([]);
  const [movementDate, setMovementDate] = useState(today);
  const [stocktakes, setStocktakes] = useState([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [adjusting, setAdjusting] = useState(null);
  const [adjustment, setAdjustment] = useState({ delta: "", notes: "" });
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [newItem, setNewItem] = useState({
    name: "",
    category: "",
    opening_stock: "",
    unit: "each",
    reorder_level: "",
    unit_cost: "",
  });
  const [activeStocktake, setActiveStocktake] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async (selectedMovementDate = movementDate) => {
    setLoading(true);
    setError("");
    try {
      const snapshot = window.api.inventory.getRestaurantStockSnapshot
        ? await window.api.inventory.getRestaurantStockSnapshot(
            selectedMovementDate,
          )
        : await Promise.all([
            window.api.inventory.getItems(),
            window.api.inventory.getLowStock(),
            window.api.inventory.getMovements({
              limit: 200,
              start_date: selectedMovementDate,
              end_date: selectedMovementDate,
            }),
            window.api.inventory.getStocktakes(12),
          ]).then(([items, lowStock, movements, stocktakes]) => ({
            items,
            lowStock,
            movements,
            stocktakes,
          }));
      if (snapshot?.error) throw new Error(snapshot.error);
      setItems(Array.isArray(snapshot?.items) ? snapshot.items : []);
      setLowStock(Array.isArray(snapshot?.lowStock) ? snapshot.lowStock : []);
      setMovements(
        Array.isArray(snapshot?.movements) ? snapshot.movements : [],
      );
      setStocktakes(
        Array.isArray(snapshot?.stocktakes) ? snapshot.stocktakes : [],
      );
    } catch (err) {
      setError(err?.message || `Could not load ${barOnly ? "bar" : "restaurant"} inventory.`);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const categories = useMemo(
    () =>
      [
        ...new Set(
          items
            .map((item) => String(item.category || "").trim())
            .filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [items],
  );
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          String(item.name || "")
            .toLowerCase()
            .includes(search.trim().toLowerCase()) &&
          (categoryFilter === "all" ||
            String(item.category || "") === categoryFilter),
      ),
    [items, search, categoryFilter],
  );
  const outOfStock = items.filter(isEmpty).length;
  const draftStocktakes = stocktakes.filter(
    (row) => row.status !== "posted",
  ).length;
  const stockValue = items.reduce((sum, item) => sum + qty(item.current_stock) * qty(item.latest_unit_cost ?? item.unit_cost), 0);
  const formInput =
    "mt-1 w-full rounded-xl border border-[#d7c9c8] bg-[#fffdfb] px-3 py-2 text-sm text-[#35242c] outline-none focus:border-[#d87945] focus:ring-2 focus:ring-[#f4d2bb]";

  const saveAdjustment = async () => {
    const delta = Number(adjustment.delta);
    if (
      !adjusting ||
      !Number.isFinite(delta) ||
      delta === 0 ||
      !adjustment.notes.trim()
    ) {
      setError("Enter a non-zero quantity and a reason for this adjustment.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await window.api.inventory.adjustStock(
        adjusting.id,
        delta,
        adjustment.notes.trim(),
        null,
        crypto.randomUUID(),
      );
      if (!result?.success)
        throw new Error(result?.error || "Could not record this adjustment.");
      setNotice(`Stock adjusted for ${adjusting.name}.`);
      setAdjusting(null);
      await load();
    } catch (err) {
      setError(err?.message || "Could not record this adjustment.");
    } finally {
      setSaving(false);
    }
  };

  const createItem = async () => {
    if (!newItem.name.trim()) {
      setError("Enter an inventory item name.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await window.api.inventory.createItem({
        name: newItem.name.trim(),
        category: newItem.category.trim() || null,
        current_stock: qty(newItem.opening_stock),
        unit: newItem.unit.trim() || "each",
        reorder_level: qty(newItem.reorder_level),
        unit_cost: newItem.unit_cost === "" ? null : Number(newItem.unit_cost),
      });
      if (!result?.success)
        throw new Error(result?.error || "Could not create inventory item.");
      setNewItem({
        name: "",
        category: "",
        opening_stock: "",
        unit: "each",
        reorder_level: "",
        unit_cost: "",
      });
      setShowCreate(false);
      setNotice(
        "Inventory item created. Link it to a Menu item when it becomes sellable.",
      );
      await load();
    } catch (err) {
      setError(err?.message || "Could not create inventory item.");
    } finally {
      setSaving(false);
    }
  };

  const saveItemDetails = async () => {
    if (!editing?.name?.trim()) {
      setError("Enter an inventory item name.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await window.api.inventory.updateItem(editing.id, {
        name: editing.name.trim(),
        category: editing.category?.trim() || null,
        unit: editing.unit?.trim() || "each",
        reorder_level: qty(editing.reorder_level),
        unit_cost: qty(editing.unit_cost),
      });
      if (!result?.success)
        throw new Error(result?.error || "Could not update inventory item.");
      setNotice(`Inventory details updated for ${editing.name}.`);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err?.message || "Could not update inventory item.");
    } finally {
      setSaving(false);
    }
  };

  const openStocktake = async (id) => {
    try {
      const result = await window.api.inventory.getStocktake(id);
      if (!result?.id) throw new Error("Could not open this stocktake.");
      setActiveStocktake({
        ...result,
        lines: (result.lines || []).map((line) => ({
          ...line,
          counted_qty: line.counted_qty ?? "",
        })),
      });
    } catch (err) {
      setError(err?.message || "Could not open this stocktake.");
    }
  };
  const startStocktake = async () => {
    setSaving(true);
    setError("");
    try {
      const result = await window.api.inventory.createStocktake({
        title: `${barOnly ? "Bar" : "Restaurant"} stocktake — ${today()}`,
      });
      if (!result?.success)
        throw new Error(result?.error || "Could not start a stocktake.");
      setNotice(
        "Stocktake started. Enter physical counts, save, then post when reviewed.",
      );
      await load();
      await openStocktake(result.stocktake_id || result.id);
    } catch (err) {
      setError(err?.message || "Could not start a stocktake.");
    } finally {
      setSaving(false);
    }
  };
  const saveCounts = async (post = false) => {
    if (!activeStocktake) return;
    setSaving(true);
    setError("");
    try {
      const lines = activeStocktake.lines.map((line) => ({
        ...line,
        counted_qty: line.counted_qty === "" ? null : Number(line.counted_qty),
      }));
      const saved = await window.api.inventory.saveStocktakeCounts(
        activeStocktake.id,
        lines,
      );
      if (!saved?.success)
        throw new Error(saved?.error || "Could not save counts.");
      if (!post) {
        setNotice("Stocktake counts saved.");
        return;
      }
      const posted = await window.api.inventory.postStocktake(
        activeStocktake.id,
        `${barOnly ? "Bar" : "Restaurant"} physical stocktake`,
      );
      if (!posted?.success)
        throw new Error(posted?.error || "Could not post stocktake.");
      setNotice("Stocktake posted and inventory movements recorded.");
      setActiveStocktake(null);
      await load();
    } catch (err) {
      setError(err?.message || "Could not save stocktake.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-3 md:p-6">
      <section className="relative overflow-hidden rounded-[26px] bg-[linear-gradient(135deg,#241a22_0%,#3e2935_54%,#713c31_100%)] px-5 py-6 text-white shadow-[0_22px_48px_rgba(54,31,41,.24)] md:px-7">
        <div className="absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/5" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[.16em] text-white/60">
              Live stock health
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight">
              Make the next stock decision
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">
              Review availability, count physical stock, investigate movement
              and act before service is affected.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                void load();
              }}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-extrabold disabled:opacity-60"
              style={ACTION.outline}
            >
              <RefreshCw size={15} /> Reload stock data
            </button>
            {canManageInventory && (
              <>
                <button
                  onClick={() => {
                    setError("");
                    setShowCreate(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-extrabold shadow-lg"
                  style={ACTION.primary}
                >
                  <PackagePlus size={16} /> Add inventory item
                </button>
                <button
                  onClick={startStocktake}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-2.5 text-sm font-extrabold text-white disabled:opacity-60"
                >
                  <ClipboardCheck size={16} /> Start stocktake
                </button>
              </>
            )}
          </div>
        </div>
        <div className="relative mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            [
              "Tracked items",
              items.length,
              "Everything in the stock ledger",
              ArchiveRestore,
            ],
            [
              "Need attention",
              lowStock.length,
              lowStock.length
                ? "At or below reorder point"
                : "No reorder warnings",
              TrendingDown,
            ],
            [
              "Out of stock",
              outOfStock,
              outOfStock
                ? "Review linked menu availability"
                : "Nothing at zero",
              PackageSearch,
            ],
            [
              "Open counts",
              draftStocktakes,
              draftStocktakes
                ? "Finish or review draft counts"
                : "No count awaiting review",
              Clock3,
            ],
            [
              "Stock value",
              `${currency}${stockValue.toFixed(2)}`,
              "On-hand quantity at latest unit cost",
              BadgeDollarSign,
            ],
          ].map(([label, value, detail, Icon]) => (
            <div
              key={label}
              className="rounded-2xl border border-white/10 bg-black/15 p-4"
            >
              <div className="flex items-center justify-between text-xs font-bold text-white/65">
                <span>{label}</span>
                <Icon size={16} />
              </div>
              <strong className="mt-2 block text-3xl leading-none">
                {value}
              </strong>
              <span className="mt-2 block text-[11px] text-white/60">
                {detail}
              </span>
            </div>
          ))}
        </div>
      </section>

      {(notice || error) && (
        <div
          className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-semibold ${error ? "border-[#f2b4aa] bg-[#fff0ed] text-[#8b3027]" : "border-[#9cd7be] bg-[#eaf9f0] text-[#17613f]"}`}
        >
          {error || notice}
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2 rounded-2xl border border-[#decfd0] bg-[#f4ece8] p-2">
        {[
          ["stock", "Stock health"],
          ["movements", "Movement ledger"],
          ["stocktakes", "Physical counts"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-xl px-4 py-2.5 text-sm font-extrabold transition ${tab === key ? "bg-[#35242c] text-white shadow-md" : "text-[#795f68] hover:bg-white/70"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-20 text-center text-sm font-semibold text-[#806d73]">
          Loading live inventory…
        </div>
      ) : tab === "stock" ? (
        <section className="mt-5 overflow-hidden rounded-[22px] border border-[#decfd0] bg-[linear-gradient(145deg,#fffdfb,#f7efeb)] shadow-[0_12px_28px_rgba(65,38,48,.08)]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e8dcda] px-5 py-5">
            <div>
              <h2 className="text-lg font-black text-[#35242c]">
                Stock health
              </h2>
              <p className="mt-1 text-sm text-[#806d73]">
                Red rows need a purchasing, menu or count decision.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="relative min-w-[240px]">
                <Search
                  className="absolute left-3 top-3 text-[#9a858b]"
                  size={16}
                />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search inventory…"
                  className="w-full rounded-xl border border-[#d9caca] bg-white py-2.5 pl-10 pr-3 text-sm text-[#35242c] outline-none focus:border-[#d87945] focus:ring-2 focus:ring-[#f4d2bb]"
                />
              </label>
              <select
                aria-label="Filter stock by category"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="rounded-xl border border-[#d9caca] bg-white px-3 py-2.5 text-sm font-semibold text-[#5d464e] outline-none focus:border-[#d87945] focus:ring-2 focus:ring-[#f4d2bb]"
              >
                <option value="all">All categories</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {lowStock.length > 0 && (
            <div className="mx-5 mt-5 flex items-start gap-3 rounded-2xl border border-[#f2c094] bg-[#fff1de] p-4 text-[#794017]">
              <TrendingDown className="mt-0.5 shrink-0" size={19} />
              <div>
                <strong>
                  {lowStock.length} item{lowStock.length === 1 ? "" : "s"} need
                  attention
                </strong>
                <p className="mt-1 text-sm">
                  Review a linked menu item, then use Purchasing or a physical
                  count to resolve it.
                </p>
              </div>
            </div>
          )}
          <div className="overflow-x-auto p-2">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-[10px] font-extrabold uppercase tracking-[.11em] text-[#8b747c]">
                  <th className="px-4 py-3">Inventory item</th>
                  <th className="px-4 py-3">Service status</th>
                  <th className="px-4 py-3">On hand</th>
                  <th className="px-4 py-3">Reorder point</th>
                  <th className="px-4 py-3">Unit cost</th>
                  {canManageInventory && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const attention = isLow(item);
                  const empty = isEmpty(item);
                  return (
                    <tr
                      key={item.id}
                      className={`border-t border-[#eadfdd] ${attention ? "bg-[#fff7f3]" : ""}`}
                    >
                      <td className="px-4 py-4 font-extrabold text-[#35242c]">
                        {item.name}
                        <small className="mt-1 block font-medium text-[#907b82]">
                          {item.category || "Uncategorised"}
                        </small>
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${empty ? "bg-[#f8ddd7] text-[#9b352a]" : attention ? "bg-[#fff0c9] text-[#8d5a09]" : "bg-[#dff3e8] text-[#1d6947]"}`}
                        >
                          {empty
                            ? "Out of stock"
                            : attention
                              ? "Needs attention"
                              : "Ready for service"}
                        </span>
                      </td>
                      <td
                        className={`px-4 py-4 font-black ${attention ? "text-[#aa3d2e]" : "text-[#246549]"}`}
                      >
                        {qty(item.current_stock)} {item.unit || "each"}
                      </td>
                      <td className="px-4 py-4 font-semibold text-[#6e5961]">
                        {qty(item.reorder_level) || "—"}
                      </td>
                      <td className="px-4 py-4 font-semibold text-[#6e5961]">
                        {item.latest_unit_cost != null
                          ? `${currency}${Number(item.latest_unit_cost).toFixed(2)} / ${item.unit || "unit"}`
                          : "—"}
                      </td>
                      {canManageInventory && (
                        <td className="px-4 py-4">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => {
                                setEditing({
                                  id: item.id,
                                  name: item.name || "",
                                  category: item.category || "",
                                  unit: item.unit || "each",
                                  reorder_level: item.reorder_level ?? "",
                                  unit_cost: item.latest_unit_cost ?? "",
                                });
                                setError("");
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[#d8c0b9] bg-white px-3 py-2 text-xs font-extrabold text-[#693c33] hover:border-[#d87945]"
                            >
                              <PenLine size={14} /> Edit
                            </button>
                            <button
                              onClick={() => {
                                setAdjusting(item);
                                setAdjustment({ delta: "", notes: "" });
                                setError("");
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[#d8c0b9] bg-white px-3 py-2 text-xs font-extrabold text-[#693c33] hover:border-[#d87945]"
                            >
                              <SlidersHorizontal size={14} /> Adjust
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {!filtered.length && (
                  <tr>
                    <td
                      colSpan={canManageInventory ? 6 : 5}
                      className="px-4 py-14 text-center text-[#806d73]"
                    >
                      No inventory item matches that search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : tab === "movements" ? (
        <Ledger
          movements={movements}
          currency={currency}
          date={movementDate}
          onDateChange={(value) => {
            setMovementDate(value);
            load(value);
          }}
        />
      ) : (
        <Counts
          rows={stocktakes}
          canManageInventory={canManageInventory}
          onOpen={openStocktake}
        />
      )}

      {adjusting && (
        <Modal
          onClose={saving ? null : () => setAdjusting(null)}
          title={`Adjust ${adjusting.name}`}
          subtitle="Every adjustment creates an auditable movement. Use a positive amount for stock in and a negative amount for waste, loss or breakage."
        >
          <label className="block text-sm font-bold text-[#5d464e]">
            Quantity change
            <input
              autoFocus
              className={formInput}
              type="number"
              step="0.01"
              value={adjustment.delta}
              onChange={(e) =>
                setAdjustment({ ...adjustment, delta: e.target.value })
              }
              placeholder="Use - for a reduction"
            />
          </label>
          <label className="mt-4 block text-sm font-bold text-[#5d464e]">
            Reason
            <textarea
              className={formInput}
              rows="3"
              value={adjustment.notes}
              onChange={(e) =>
                setAdjustment({ ...adjustment, notes: e.target.value })
              }
              placeholder="Physical count, breakage, spoilage…"
            />
          </label>
          <ModalActions
            onCancel={() => setAdjusting(null)}
            onConfirm={saveAdjustment}
            confirmLabel={saving ? "Saving…" : "Record adjustment"}
            busy={saving}
          />
        </Modal>
      )}
      {showCreate && (
        <Modal
          onClose={saving ? null : () => setShowCreate(false)}
          title="Add inventory item"
          subtitle="Create a business-wide stock item. Its opening unit cost is an estimate; each supplier receipt updates the moving-average cost used for stock valuation."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-bold text-[#5d464e] sm:col-span-2">
              Item name
              <input
                autoFocus
                className={formInput}
                value={newItem.name}
                onChange={(e) =>
                  setNewItem({ ...newItem, name: e.target.value })
                }
              />
            </label>
            <label className="block text-sm font-bold text-[#5d464e]">
              Stock category
              <select
                className={formInput}
                value={newItem.category}
                onChange={(e) =>
                  setNewItem({ ...newItem, category: e.target.value })
                }
              >
                <option value="">Choose category</option>
                {INVENTORY_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-bold text-[#5d464e]">
              Counting unit
              <select
                className={formInput}
                value={newItem.unit}
                onChange={(e) =>
                  setNewItem({ ...newItem, unit: e.target.value })
                }
              >
                {INVENTORY_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </label>
            {[
              ["Opening stock", "opening_stock", "0"],
              ["Reorder point", "reorder_level", "0"],
              ["Opening unit-cost estimate", "unit_cost", "0.00"],
            ].map(([label, key, placeholder]) => (
              <label
                key={key}
                className="block text-sm font-bold text-[#5d464e]"
              >
                {label}
                <input
                  className={formInput}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={placeholder}
                  value={newItem[key]}
                  onChange={(e) =>
                    setNewItem({ ...newItem, [key]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <ModalActions
            onCancel={() => setShowCreate(false)}
            onConfirm={createItem}
            confirmLabel={saving ? "Creating…" : "Create inventory item"}
            busy={saving}
          />
        </Modal>
      )}
      {editing && (
        <Modal
          onClose={saving ? null : () => setEditing(null)}
          title={`Edit ${editing.name}`}
          subtitle="Update the catalogue details and reorder point. Record real stock changes through Adjust, Purchasing or a physical count."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-bold text-[#5d464e] sm:col-span-2">
              Item name
              <input
                autoFocus
                className={formInput}
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <label className="block text-sm font-bold text-[#5d464e]">
              Stock category
              <select
                className={formInput}
                value={editing.category}
                onChange={(e) =>
                  setEditing({ ...editing, category: e.target.value })
                }
              >
                {editing.category &&
                  !INVENTORY_CATEGORIES.includes(editing.category) && (
                    <option value={editing.category}>{editing.category}</option>
                  )}
                {INVENTORY_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-bold text-[#5d464e]">
              Counting unit
              <select
                className={formInput}
                value={editing.unit}
                onChange={(e) =>
                  setEditing({ ...editing, unit: e.target.value })
                }
              >
                {editing.unit && !INVENTORY_UNITS.includes(editing.unit) && (
                  <option value={editing.unit}>{editing.unit}</option>
                )}
                {INVENTORY_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-bold text-[#5d464e]">
              Reorder point
              <input
                className={formInput}
                type="number"
                min="0"
                step="0.01"
                value={editing.reorder_level}
                onChange={(e) =>
                  setEditing({ ...editing, reorder_level: e.target.value })
                }
              />
            </label>
            <label className="block text-sm font-bold text-[#5d464e]">
              Current unit cost
              <input
                className={formInput}
                type="number"
                min="0"
                step="0.0001"
                value={editing.unit_cost}
                onChange={(e) =>
                  setEditing({ ...editing, unit_cost: e.target.value })
                }
              />
              <small className="mt-1 block font-medium text-[#907b82]">
                Cost for one {editing.unit || "unit"}; the next supplier receipt
                can update it.
              </small>
            </label>
          </div>
          <ModalActions
            onCancel={() => setEditing(null)}
            onConfirm={saveItemDetails}
            confirmLabel={saving ? "Saving…" : "Save item details"}
            busy={saving}
          />
        </Modal>
      )}
      {activeStocktake && (
        <Modal
          onClose={saving ? null : () => setActiveStocktake(null)}
          wide
          title={activeStocktake.title || "Physical stocktake"}
          subtitle="Enter what is physically present. Save counts for review; posting creates the audited variance movements."
        >
          <div className="max-h-[54vh] overflow-y-auto rounded-xl border border-[#e2d4d2]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#f6eee9] text-left text-[10px] font-extrabold uppercase tracking-[.1em] text-[#806b73]">
                <tr>
                  <th className="p-3">Item</th>
                  <th className="p-3">Expected</th>
                  <th className="p-3">Counted</th>
                </tr>
              </thead>
              <tbody>
                {activeStocktake.lines.map((line, index) => (
                  <tr
                    key={line.id || line.item_id}
                    className="border-t border-[#ecdfdc]"
                  >
                    <td className="p-3 font-bold text-[#35242c]">
                      {line.item_name}
                      <small className="block font-medium text-[#8b767d]">
                        {line.item_unit}
                      </small>
                    </td>
                    <td className="p-3 font-semibold text-[#67535b]">
                      {line.expected_qty}
                    </td>
                    <td className="p-3">
                      <input
                        className="w-32 rounded-lg border border-[#d9caca] bg-white px-2 py-1.5 outline-none focus:border-[#d87945]"
                        type="number"
                        step="0.01"
                        value={line.counted_qty}
                        onChange={(e) =>
                          setActiveStocktake({
                            ...activeStocktake,
                            lines: activeStocktake.lines.map((row, i) =>
                              i === index
                                ? { ...row, counted_qty: e.target.value }
                                : row,
                            ),
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setActiveStocktake(null)}
              className="rounded-xl border border-[#d8c8c7] bg-white px-4 py-2.5 text-sm font-extrabold text-[#604a52]"
            >
              Close
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => saveCounts(false)}
              className="rounded-xl border border-[#d8c8c7] bg-[#f7eee9] px-4 py-2.5 text-sm font-extrabold text-[#604a52] disabled:opacity-60"
            >
              Save counts
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => saveCounts(true)}
              className="rounded-xl bg-[#d87945] px-4 py-2.5 text-sm font-extrabold text-[#291b21] disabled:opacity-60"
            >
              {saving ? "Posting…" : "Post stocktake"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Ledger({ movements, currency, date, onDateChange }) {
  return (
    <section className="mt-5 overflow-hidden rounded-[22px] border border-[#decfd0] bg-[#fffdfb] shadow-[0_12px_28px_rgba(65,38,48,.08)]">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#e8dcda] px-5 py-5">
        <div>
          <h2 className="text-lg font-black text-[#35242c]">Movement ledger</h2>
          <p className="mt-1 text-sm text-[#806d73]">
            Stock changes for the selected local business day, including
            recipe-sale ingredient deductions.
          </p>
        </div>
        <label className="grid gap-1 text-[10px] font-extrabold uppercase tracking-[.1em] text-[#806b73]">
          Date
          <input
            type="date"
            value={date}
            onChange={(event) => onDateChange(event.target.value)}
            className="rounded-xl border border-[#d9caca] bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-[#35242c] outline-none focus:border-[#d87945] focus:ring-2 focus:ring-[#f4d2bb]"
          />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead className="bg-[#f6eee9] text-left text-[10px] font-extrabold uppercase tracking-[.1em] text-[#806b73]">
            <tr>
              {["When", "Item", "Movement", "Quantity", "Reason"].map(
                (label) => (
                  <th key={label} className="px-4 py-3">
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {movements.map((row) => (
              <tr key={row.id} className="border-t border-[#ecdfdc]">
                <td className="px-4 py-3 text-[#735e66]">
                  {formatLocalDateTime(row.created_at)}
                </td>
                <td className="px-4 py-3 font-bold text-[#35242c]">
                  {row.item_name || row.inventory_item_name || "Inventory item"}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-[#f2e5df] px-2.5 py-1 text-[10px] font-extrabold text-[#6d4037]">
                    {row.movement_type || row.type || "movement"}
                  </span>
                </td>
                <td className="px-4 py-3 font-extrabold text-[#473039]">
                  {row.quantity ?? row.delta ?? "—"}
                </td>
                <td className="px-4 py-3 text-[#735e66]">{row.notes || "—"}</td>
              </tr>
            ))}
            {!movements.length && (
              <tr>
                <td
                  colSpan="5"
                  className="px-4 py-14 text-center text-[#806d73]"
                >
                  No stock movements for this date.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function Counts({ rows, canManageInventory, onOpen }) {
  return (
    <section className="mt-5 overflow-hidden rounded-[22px] border border-[#decfd0] bg-[#fffdfb] shadow-[0_12px_28px_rgba(65,38,48,.08)]">
      <div className="border-b border-[#e8dcda] px-5 py-5">
        <h2 className="text-lg font-black text-[#35242c]">Physical counts</h2>
        <p className="mt-1 text-sm text-[#806d73]">
          Draft counts remain separate from stock until a manager reviews and
          posts them.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="bg-[#f6eee9] text-left text-[10px] font-extrabold uppercase tracking-[.1em] text-[#806b73]">
            <tr>
              {["Stocktake", "Status", "Started", ""].map((label) => (
                <th key={label} className="px-4 py-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[#ecdfdc]">
                <td className="px-4 py-4 font-bold text-[#35242c]">
                  {row.title || "Stocktake"}
                </td>
                <td className="px-4 py-4">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${row.status === "posted" ? "bg-[#dff3e8] text-[#1d6947]" : "bg-[#fff0c9] text-[#8d5a09]"}`}
                  >
                    {row.status || "draft"}
                  </span>
                </td>
                <td className="px-4 py-4 text-[#735e66]">
                  {formatLocalDateTime(row.created_at)}
                </td>
                <td className="px-4 py-4 text-right">
                  {canManageInventory && row.status !== "posted" && (
                    <button
                      onClick={() => onOpen(row.id)}
                      className="rounded-lg border border-[#d8c0b9] bg-white px-3 py-2 text-xs font-extrabold text-[#693c33]"
                    >
                      Open count
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan="4"
                  className="px-4 py-14 text-center text-[#806d73]"
                >
                  No physical counts have been started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function Modal({ title, subtitle, children, wide = false, onClose }) {
  useEffect(() => {
    if (!onClose) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[2000] grid place-items-center overflow-y-auto bg-[#241920]/65 p-4"
      onMouseDown={(event) => {
        if (onClose && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="restaurant-stock-dialog-title"
        className={`relative my-5 w-full ${wide ? "max-w-4xl" : "max-w-xl"} rounded-[24px] border border-white/20 bg-[#fffaf7] p-6 shadow-2xl`}
      >
        <h2
          id="restaurant-stock-dialog-title"
          className="pr-12 text-xl font-black text-[#35242c]"
        >
          {title}
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-xl border border-[#decfd0] bg-white text-[#6d565e] transition hover:border-[#d87945] hover:text-[#9b4a34]"
          >
            <X size={18} />
          </button>
        )}
        <p className="mt-2 text-sm leading-6 text-[#79656d]">{subtitle}</p>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
function ModalActions({ onCancel, onConfirm, confirmLabel, busy }) {
  return (
    <div className="mt-6 flex justify-end gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={onCancel}
        className="rounded-xl border border-[#d8c8c7] bg-white px-4 py-2.5 text-sm font-extrabold text-[#604a52] disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onConfirm}
        className="rounded-xl bg-[#d87945] px-4 py-2.5 text-sm font-extrabold text-[#291b21] disabled:opacity-60"
      >
        {confirmLabel}
      </button>
    </div>
  );
}
