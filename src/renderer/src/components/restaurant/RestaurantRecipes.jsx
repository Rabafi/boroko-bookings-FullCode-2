import { useState, useEffect } from "react";
import { useSearchParams } from "react-router";
import { Plus, Pencil, Trash2, X } from "lucide-react";

export default function RestaurantRecipes() {
  const [searchParams] = useSearchParams();
  const [recipes, setRecipes] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [form, setForm] = useState({
    name: "",
    menu_item_id: "",
    serving_size: "",
    ingredients: [],
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const menuItemId = searchParams.get("menu_item_id");
    if (!menuItemId) return;
    setEditingRecipe(null);
    setForm({
      name: searchParams.get("recipe_name") || "",
      menu_item_id: menuItemId,
      serving_size: "1",
      ingredients: [
        { inventory_item_id: "", quantity: "", unit: "", waste_percent: "" },
      ],
    });
    setError("");
    setNotice(
      "Add the ingredients used for one serving. Saving the recipe will make this menu item available at Till.",
    );
    setShowForm(true);
  }, [searchParams]);

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const [r, m, inventory] = await Promise.all([
        window.api.pos.getRecipes(),
        window.api.pos.getMenuItems(),
        window.api.inventory.getItems(),
      ]);
      setRecipes(Array.isArray(r) ? r : []);
      setMenuItems(Array.isArray(m) ? m : []);
      setInventoryItems(Array.isArray(inventory) ? inventory : []);
    } catch (err) {
      console.error("Failed to load recipes:", err);
      setError(err.message || "Could not load recipes and stock ingredients.");
    } finally {
      setLoading(false);
    }
  }

  function openNew() {
    setEditingRecipe(null);
    setForm({
      name: "",
      menu_item_id: "",
      serving_size: "",
      ingredients: [
        { inventory_item_id: "", quantity: "", unit: "", waste_percent: "" },
      ],
    });
    setShowForm(true);
  }

  function openEdit(recipe) {
    setEditingRecipe(recipe);
    setForm({
      name: recipe.name || recipe.menu_item_name || "",
      menu_item_id: recipe.menu_item_id || "",
      serving_size: recipe.serving_size || "",
      ingredients:
        (recipe.ingredients || []).length > 0
          ? recipe.ingredients.map((i) => ({
              inventory_item_id: i.inventory_item_id || "",
              quantity: i.quantity || "",
              unit: i.unit || "",
              waste_percent: i.wastage_pct || i.waste_percent || "",
            }))
          : [
              {
                inventory_item_id: "",
                quantity: "",
                unit: "",
                waste_percent: "",
              },
            ],
    });
    setShowForm(true);
  }

  function addIngredient() {
    setForm({
      ...form,
      ingredients: [
        ...form.ingredients,
        { inventory_item_id: "", quantity: "", unit: "", waste_percent: "" },
      ],
    });
  }

  function updateIngredient(index, field, value) {
    const updated = [...form.ingredients];
    updated[index] = { ...updated[index], [field]: value };
    setForm({ ...form, ingredients: updated });
  }

  function removeIngredient(index) {
    if (form.ingredients.length <= 1) return;
    setForm({
      ...form,
      ingredients: form.ingredients.filter((_, i) => i !== index),
    });
  }

  async function saveRecipe() {
    if (!form.name.trim()) return;
    const validIngredients = form.ingredients.filter(
      (i) => i.inventory_item_id && Number(i.quantity) > 0,
    );
    if (validIngredients.length === 0) {
      setError(
        "Add at least one stock ingredient with a quantity greater than zero.",
      );
      return;
    }
    const payload = {
      name: form.name.trim(),
      menu_item_id: form.menu_item_id || null,
      serving_size: form.serving_size || null,
      ingredients: validIngredients.map((i, idx) => ({
        inventory_item_id: i.inventory_item_id || null,
        quantity: Number(i.quantity) || 0,
        unit: i.unit || null,
        waste_percent: Number(i.waste_percent) || 0,
        sort_order: idx,
      })),
    };
    try {
      setSaving(true);
      setError("");
      setNotice("");
      if (editingRecipe) {
        payload.id = editingRecipe.id;
        payload.version = (editingRecipe.version || 1) + 1;
      }
      const result = await window.api.pos.saveRecipe(payload);
      if (result?.success === false)
        throw new Error(result.error || "Could not save recipe.");
      setShowForm(false);
      setEditingRecipe(null);
      setNotice(
        `Recipe ${editingRecipe ? "updated" : "created"} and linked ingredient quantities saved.`,
      );
      await loadData();
    } catch (err) {
      console.error("Failed to save recipe:", err);
      setError(err.message || "Could not save recipe.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecipe(id) {
    if (!confirm("Delete this recipe?")) return;
    try {
      setError("");
      setNotice("");
      const result = await window.api.pos.deleteRecipe(id);
      if (result?.success === false)
        throw new Error(result.error || "Could not delete recipe.");
      setNotice("Recipe deleted.");
      await loadData();
    } catch (err) {
      console.error("Failed to delete recipe:", err);
      setError(err.message || "Could not delete recipe.");
    }
  }

  return (
    <div className="restaurant-native-page">
      <div className="restaurant-native-hero">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Recipes & Costing
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Create, edit, and cost recipes
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openNew}
            className="bb-btn-primary text-sm flex items-center gap-1.5"
          >
            <Plus size={14} /> New Recipe
          </button>
          <button onClick={loadData} className="bb-btn-outline text-sm">
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="restaurant-native-loading">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : recipes.length === 0 ? (
        <div className="restaurant-native-empty">
          <p className="text-gray-500 text-lg mb-2">No recipes configured</p>
          <p className="text-gray-400 text-sm">
            Click "New Recipe" to create your first recipe
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {recipes.map((recipe) => {
            const totalCost = (recipe.ingredients || []).reduce(
              (sum, ing) =>
                sum +
                (ing.quantity || 0) *
                  (ing.recipe_unit_cost ??
                    ing.unit_cost ??
                    ing.latest_unit_cost ??
                    0) *
                  (1 + (ing.wastage_pct || ing.waste_percent || 0) / 100),
              0,
            );
            const sellingPrice = recipe.selling_price || 0;
            const margin =
              sellingPrice > 0
                ? (((sellingPrice - totalCost) / sellingPrice) * 100).toFixed(1)
                : null;

            return (
              <div key={recipe.id} className="bb-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {recipe.name || recipe.menu_item_name}
                    </h3>
                    {Number(recipe.version) > 1 && (
                      <span className="text-xs text-gray-400">
                        Recipe revision {recipe.version}
                      </span>
                    )}
                    {recipe.menu_item_name && (
                      <p className="text-xs text-gray-500">
                        Linked menu item: {recipe.menu_item_name}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex gap-3 text-sm">
                      <div className="text-right">
                        <div className="text-gray-500 text-xs">Cost</div>
                        <div className="font-medium">
                          P {totalCost.toFixed(2)}
                        </div>
                      </div>
                      {sellingPrice > 0 && (
                        <div className="text-right">
                          <div className="text-gray-500 text-xs">Selling</div>
                          <div className="font-medium">
                            P {sellingPrice.toFixed(2)}
                          </div>
                        </div>
                      )}
                      {margin != null && (
                        <div className="text-right">
                          <div className="text-gray-500 text-xs">Margin</div>
                          <div
                            className={`font-medium ${Number(margin) < 30 ? "text-red-600" : Number(margin) < 60 ? "text-amber-600" : "text-emerald-600"}`}
                          >
                            {margin}%
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => openEdit(recipe)}
                        className="text-gray-400 hover:text-blue-600 p-1"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => deleteRecipe(recipe.id)}
                        className="text-gray-400 hover:text-red-600 p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {(recipe.ingredients || []).map((ing, i) => (
                    <div
                      key={i}
                      className="bg-gray-50 rounded-lg px-3 py-2 text-sm"
                    >
                      <div className="font-medium">
                        {ing.name ||
                          ing.ingredient_name ||
                          ing.inventory_item_name ||
                          "Stock item"}
                      </div>
                      <div className="text-gray-500 text-xs">
                        {ing.quantity} {ing.unit || "units"} @ P{" "}
                        {Number(
                          ing.recipe_unit_cost ??
                            ing.unit_cost ??
                            ing.latest_unit_cost ??
                            0,
                        ).toFixed(4)}{" "}
                        per {ing.unit || "unit"}
                        {(ing.wastage_pct || ing.waste_percent) > 0 && (
                          <span className="text-amber-500">
                            {" "}
                            +{ing.wastage_pct || ing.waste_percent}% waste
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {!recipe.menu_item_id && (
                  <div className="mt-3 text-xs text-amber-600 bg-amber-50 rounded px-3 py-1.5">
                    Not linked to a menu item
                  </div>
                )}
                {recipe.menu_item_id && sellingPrice <= 0 && (
                  <div className="mt-3 text-xs text-amber-700 bg-amber-50 rounded px-3 py-1.5">
                    This recipe is linked, but its menu item has no selling
                    price. Go to Menu &amp; Modifiers and set a price before
                    selling it.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">
                {editingRecipe ? "Edit Recipe" : "New Recipe"}
              </h2>
              <button
                onClick={() => {
                  setShowForm(false);
                  setEditingRecipe(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3">
              {error && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                  {error}
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-gray-600">
                  Recipe Name *
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="bb-input w-full mt-1"
                  placeholder="e.g. Classic Burger"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">
                    Linked Menu Item
                  </label>
                  <select
                    value={form.menu_item_id}
                    onChange={(e) =>
                      setForm({ ...form, menu_item_id: e.target.value })
                    }
                    className="bb-input w-full mt-1"
                  >
                    <option value="">None</option>
                    {menuItems.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">
                    Serving Size
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={form.serving_size}
                    onChange={(e) =>
                      setForm({ ...form, serving_size: e.target.value })
                    }
                    className="bb-input w-full mt-1"
                    placeholder="1"
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600">
                    Ingredients
                  </label>
                  <button
                    onClick={addIngredient}
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>
                <p className="mb-2 text-xs leading-5 text-gray-500">
                  Add the stock used for one serving. <strong>Waste %</strong>{" "}
                  is optional—for example, enter 5 when roughly 5% is lost
                  during preparation.
                </p>
                <div className="space-y-3">
                  {form.ingredients.map((ing, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-stone-200 bg-stone-50 p-3"
                    >
                      <div className="grid grid-cols-2 gap-2">
                        <label className="col-span-2 text-xs font-medium text-gray-600">
                          Stock item
                          <select
                            value={ing.inventory_item_id}
                            onChange={(e) =>
                              updateIngredient(
                                i,
                                "inventory_item_id",
                                e.target.value,
                              )
                            }
                            className="bb-input mt-1 w-full"
                            aria-label={`Ingredient ${i + 1}`}
                          >
                            <option value="">Choose stock item…</option>
                            {inventoryItems.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-medium text-gray-600">
                          Quantity per serving
                          <input
                            value={ing.quantity}
                            onChange={(e) =>
                              updateIngredient(i, "quantity", e.target.value)
                            }
                            type="number"
                            min="0"
                            step="0.01"
                            className="bb-input mt-1 w-full"
                            placeholder="e.g. 0.25"
                          />
                        </label>
                        <label className="text-xs font-medium text-gray-600">
                          Unit
                          <select
                            value={ing.unit}
                            onChange={(e) =>
                              updateIngredient(i, "unit", e.target.value)
                            }
                            className="bb-input mt-1 w-full"
                            aria-label={`Unit ${i + 1}`}
                          >
                            <option value="">Choose unit…</option>
                            {["each", "g", "kg", "ml", "l", "portion"].map(
                              (unit) => (
                                <option key={unit} value={unit}>
                                  {unit}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                        <label className="text-xs font-medium text-gray-600">
                          Waste %{" "}
                          <span className="font-normal text-gray-400">
                            optional
                          </span>
                          <input
                            value={ing.waste_percent}
                            onChange={(e) =>
                              updateIngredient(
                                i,
                                "waste_percent",
                                e.target.value,
                              )
                            }
                            type="number"
                            min="0"
                            step="0.01"
                            className="bb-input mt-1 w-full"
                            placeholder="e.g. 5"
                          />
                        </label>
                      </div>
                      {form.ingredients.length > 1 && (
                        <button
                          onClick={() => removeIngredient(i)}
                          className="mt-3 flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-red-600"
                        >
                          <Trash2 size={14} />
                          Remove ingredient
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowForm(false);
                  setEditingRecipe(null);
                }}
                className="bb-btn-outline flex-1"
              >
                Cancel
              </button>
              <button
                onClick={saveRecipe}
                disabled={!form.name.trim() || saving}
                className="bb-btn-primary flex-1"
              >
                {saving
                  ? "Saving…"
                  : editingRecipe
                    ? "Save Changes"
                    : "Create Recipe"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
