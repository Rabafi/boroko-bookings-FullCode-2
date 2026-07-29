import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  Boxes,
  CheckCircle2,
  CookingPot,
  Edit2,
  Eye,
  EyeOff,
  Plus,
  Search,
  Tag,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { useSettings } from "../../app-context";
import { isBarOnlyMode } from "../../../../shared/propertyTypes";
import {
  BAR_PACK_SIZES,
  getBarModeProfile,
} from "../../../../shared/barModeProfile";

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
const categoryRequiresRecipe = (category) =>
  RECIPE_REQUIRED_SECTIONS.has(String(category || "").trim().toLowerCase());
// Every available item must have one stock method: a direct stock link or a recipe.

function MenuItemCard({
  item,
  onEdit,
  onDelete,
  onToggleAvailability,
  availabilityBusy,
  barOnly,
  stockMethod,
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
          </div>
        </div>
        <div className="hpos-service-row-actions">
          <button
            type="button"
            aria-label={`Edit ${item.name}`}
            onClick={() => onEdit(item)}
          >
            <Edit2 size={14} /> Edit
          </button>
          <button
            type="button"
            className="is-danger"
            aria-label={`Delete ${item.name}`}
            onClick={() => onDelete(item)}
          >
            <Trash2 size={14} /> Delete
          </button>
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
  stock_method: "direct",
  pack6: false,
  pack12: false,
  pack24: false,
});

export default function HposMenu() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const barOnly = isBarOnlyMode(settings);
  const profile = useMemo(() => getBarModeProfile(settings), [settings]);
  const defaultCategory = barOnly ? "Beer" : "Mains";

  const [items, setItems] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [recipeMenuItemIds, setRecipeMenuItemIds] = useState(() => new Set());
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [saveError, setSaveError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [packBusy, setPackBusy] = useState(false);
  const [availabilityBusyId, setAvailabilityBusyId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showModifiers, setShowModifiers] = useState(false);
  const [modifierGroups, setModifierGroups] = useState([]);
  const [modifierBusy, setModifierBusy] = useState(false);
  const [modifierError, setModifierError] = useState("");
  const [modifierDraft, setModifierDraft] = useState({
    name: "",
    options: "",
    min_selections: "0",
    max_selections: "1",
    applies_to_categories: "All",
  });

  const loadMenu = async () => {
    const menuData = (await window.api?.pos?.getMenuItems?.()) ?? [];
    const rows = Array.isArray(menuData) ? menuData : [];
    setItems(rows);
    setCategories([
      ...new Set(rows.map((item) => item.category).filter(Boolean)),
    ]);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [menuData, inventoryRows, modifierRows, recipeRows] =
          await Promise.all([
            window.api?.pos?.getMenuItems?.() ?? [],
            window.api?.inventory?.getItems?.() ?? [],
            window.api?.pos?.getModifierGroups?.() ?? [],
            window.api?.pos?.getRecipes?.() ?? [],
          ]);
        if (!active) return;
        setItems(Array.isArray(menuData) ? menuData : []);
        setInventoryItems(Array.isArray(inventoryRows) ? inventoryRows : []);
        setModifierGroups(Array.isArray(modifierRows) ? modifierRows : []);
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
        setCategories([
          ...new Set(
            (Array.isArray(menuData) ? menuData : [])
              .map((item) => item.category)
              .filter(Boolean),
          ),
        ]);
      } catch {}
      if (active) setLoading(false);
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const openCreate = () => {
    setSaveError("");
    setEditing("new");
    setDraft(emptyDraft());
  };

  const openEdit = (item) => {
    setSaveError("");
    setEditing(item);
    const invId = item.inventory_item_id || "";
    const packFlags = { pack6: false, pack12: false, pack24: false };
    if (invId) {
      for (const row of items) {
        if (
          row.inventory_item_id === invId &&
          row.template_kind === "bar_pack"
        ) {
          if (Number(row.template_pack_size) === 6) packFlags.pack6 = true;
          if (Number(row.template_pack_size) === 12) packFlags.pack12 = true;
          if (Number(row.template_pack_size) === 24) packFlags.pack24 = true;
        }
      }
    }
    setDraft({
      name: item.name || "",
      category: item.category || "",
      price: String(item.price ?? ""),
      barcode: item.barcode || "",
      inventory_item_id: invId,
      stock_method: item.stock_method || (invId ? "direct" : recipeMenuItemIds.has(item.id) ? "recipe" : "direct"),
      ...packFlags,
    });
  };

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
    if (barOnly && draft.stock_method === "recipe") {
      setSaveError("Base Bar POS sells prepared food as a counted finished portion. Choose Direct stock and link the prepared-portion stock item.");
      return;
    }
    if (draft.stock_method === "direct" && !draft.inventory_item_id) {
      setSaveError("Choose the stock item sold for this packaged product.");
      return;
    }
    setPackBusy(true);
    try {
      const isDirect = draft.stock_method === "direct";
      const isRecipe = draft.stock_method === "recipe";
      const payload = {
        name: draft.name.trim(),
        category: draft.category.trim(),
        price: Number(draft.price),
        barcode: draft.barcode.trim() || null,
        stock_method: draft.stock_method,
        is_available: isRecipe ? false : isDirect ? Boolean(draft.inventory_item_id) : true,
      };
      if (isDirect && draft.inventory_item_id)
        payload.inventory_item_id = draft.inventory_item_id;

      const saved = editing === "new"
        ? await window.api.pos.createMenuItem(payload)
        : await window.api.pos.updateMenuItem(editing.id, payload);
      const menuItemId = editing === "new" ? saved?.id : editing.id;

      const invId = isDirect ? (draft.inventory_item_id || editing?.inventory_item_id) : null;
      if (invId && barOnly) {
        await applyPackTemplates(invId, draft);
      }

      setEditing(null);
      await loadMenu();
      if (!barOnly && isRecipe && menuItemId) {
        navigate(`/restaurant/menu-production?tab=recipes&menu_item_id=${encodeURIComponent(menuItemId)}&recipe_name=${encodeURIComponent(draft.name.trim())}`);
      }
    } catch (error) {
      setSaveError(error?.message || "Could not save this product.");
    } finally {
      setPackBusy(false);
    }
  };

  const deleteItem = async (item) => {
    if (
      !window.confirm(
        `Delete ${item.name}? Items with completed sale history will be archived instead to protect reports.`,
      )
    )
      return;
    setActionNotice("");
    try {
      const result = await window.api.pos.deleteMenuItem(item.id);
      setActionNotice(
        result?.soft_deleted
          ? "Item archived because it has sale history."
          : "Item deleted.",
      );
      await loadMenu();
    } catch (error) {
      setSaveError(error?.message || "Could not remove this product.");
    }
  };

  const toggleAvailability = async (item) => {
    const isAvailable = item.available !== false && item.is_available !== false;
    setSaveError("");
    setAvailabilityBusyId(item.id);
    try {
      await window.api.pos.updateMenuItem(item.id, {
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
      });
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
      const result = await window.api?.pos?.saveModifierGroup?.({
        name: modifierDraft.name.trim(),
        options,
        min_selections: min,
        max_selections: max,
        applies_to_categories: modifierDraft.applies_to_categories
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      });
      if (!result?.success)
        throw new Error(result?.error || "Could not save modifier group.");
      const groups = (await window.api?.pos?.getModifierGroups?.()) ?? [];
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
      {saveError && !editing && (
        <div className="hpos-inline-error">{saveError}</div>
      )}
      {setupRequiredCount > 0 && (
        <div className="hpos-inline-error">
          <strong>
            {setupRequiredCount} menu item{setupRequiredCount === 1 ? "" : "s"}{" "}
            need stock setup — they are not sold out.
          </strong>{" "}
          {barOnly ? <>Choose its <strong>Direct stock link</strong> in Edit. Simple food should link to a counted prepared-portion stock item.</> : <>To repair a packaged item, choose its <strong>Direct stock link</strong> in Edit. For prepared food, leave the direct link blank, create a recipe with stock ingredients in <strong>Menu &amp; Production → Recipes &amp; Costing</strong>, then return here and make it available.</>}
        </div>
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
              onToggleAvailability={toggleAvailability}
              availabilityBusy={availabilityBusyId === item.id}
              barOnly={barOnly}
              stockMethod={stockMethodFor(item)}
            />
          ))}
        </section>
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
              onClick={() => setEditing(null)}
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
              <div className="hpos-inline-error">
                <strong>Choose one stock method.</strong> Keep the direct link
                for packaged goods, or remove it and use the recipe for prepared
                food.
              </div>
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
                <input
                  type="text"
                  value={draft.barcode}
                  onChange={(event) =>
                    setDraft({ ...draft, barcode: event.target.value })
                  }
                  placeholder="Optional scan code"
                />
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
                  {!barOnly && <option value="recipe">Prepared food or cocktail — recipe required</option>}
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
              <label>
                Direct stock link
                <select
                  value={draft.inventory_item_id}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      inventory_item_id: event.target.value,
                    })
                  }
                >
                  <option value="">
                    No direct link — save as recipe draft
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
              )}
            </div>
            {barOnly && draft.inventory_item_id && (
              <section className="hpos-service-pack-options">
                <strong>Pack / case sell templates</strong>
                <p>
                  Create sellable packs that use the existing bar-pack depletion
                  contract.
                </p>
                <div>
                  {BAR_PACK_SIZES.map((size) => {
                    const key = `pack${size}`;
                    return (
                      <label key={size}>
                        <input
                          type="checkbox"
                          checked={draft[key] === true}
                          onChange={(event) =>
                            setDraft({ ...draft, [key]: event.target.checked })
                          }
                        />
                        {size === 24 ? "Case 24" : `${size}-pack`}
                      </label>
                    );
                  })}
                </div>
              </section>
            )}
            {saveError && <div className="hpos-inline-error">{saveError}</div>}
            <footer>
              <button
                type="button"
                className="hpos-secondary-action"
                onClick={() => setEditing(null)}
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
      {showModifiers && (
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
                <div className="hpos-inline-error">{modifierError}</div>
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
