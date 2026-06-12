import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ShoppingCart, X, Plus, Minus, Search, Banknote, ReceiptText, Check, Clock, Users, Percent, Package } from 'lucide-react';
import { buildPosTotals } from '@shared/totals.js';
import { buildCreatePosOrderPayload } from '@shared/payloads.js';
import { sanitizePosError } from '@shared/errors.js';

const CURRENCY = 'P';
const fmt = (v) => Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'orange_money', label: 'Orange Money' },
  { value: 'myzaka', label: 'MyZaka' },
  { value: 'smega', label: 'SMEGA' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'folio', label: 'Room Folio' },
  { value: 'other', label: 'Other' }
];
const QUICK_PAYMENT_METHODS = PAYMENT_METHODS.filter((m) => m.value !== 'folio' && m.value !== 'other');
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const modifierTotal = (item) => (item.modifiers || []).reduce((sum, mod) => sum + Number(mod?.price || 0), 0);
const lineUnitPrice = (item) => money(Number(item.unit_price || 0) + modifierTotal(item));
const normalizeStockValue = (value) => {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
};
const normalizePositiveQty = (value, fallback = 1) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};
const getInventoryAvailableUnits = (inventoryMap, inventoryItemId, depletionQty = 1) => {
  if (!inventoryItemId) return Number.POSITIVE_INFINITY;
  const row = inventoryMap.get(inventoryItemId);
  if (!row) return 0;
  return Math.floor(normalizeStockValue(row.current_stock) / normalizePositiveQty(depletionQty, 1));
};
const isOrderableMenuItem = (item, inventoryMap) => {
  if (item?.is_available === false) return false;
  return getInventoryAvailableUnits(inventoryMap, item?.inventory_item_id, item?.depletion_qty) > 0;
};
const buildOrderStockUsage = (items = []) => {
  const usage = new Map();
  for (const item of items || []) {
    if (!item?.inventory_item_id) continue;
    const delta = Math.max(0, Number(item.quantity || 0)) * normalizePositiveQty(item.depletion_qty, 1);
    usage.set(item.inventory_item_id, (usage.get(item.inventory_item_id) || 0) + delta);
  }
  return usage;
};
const normalizeSubmitItem = (item = {}) => ({
  menu_item_id: item.menu_item_id || null,
  inventory_item_id: item.inventory_item_id || null,
  depletion_qty: normalizePositiveQty(item.depletion_qty, 1),
  item_name: String(item.item_name || '').trim(),
  quantity: Number(item.quantity || 0),
  unit_price: Number(item.unit_price || 0),
  modifiers: item.modifiers || []
});
const buildSubmitSignature = ({ cart, customerType, selectedRoom, walkInName, paymentMethod, paymentBreakdown, outletId, totals, serviceMode, tableName }) => JSON.stringify({
  customerType,
  selectedRoom: customerType === 'room' ? selectedRoom || null : null,
  walkInName: customerType === 'walkin' ? String(walkInName || '').trim() : null,
  paymentMethod,
  paymentBreakdown,
  outletId: outletId || null,
  total: Number(totals?.total || 0),
  serviceMode,
  tableName: tableName || null,
  items: (cart || []).map(normalizeSubmitItem).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
});
const createIntentId = () => globalThis.crypto?.randomUUID?.() || `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function POSTerminal({ user, settings, isOnline, lowResource }) {
  const [menuItems, setMenuItems] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [cart, setCart] = useState([]);
  const [paymentMode, setPaymentMode] = useState('single');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [splitPayments, setSplitPayments] = useState([{ method: 'cash', amount: '', reference: '' }]);
  const [customerType, setCustomerType] = useState('walkin');
  const [walkInName, setWalkInName] = useState('');
  const [selectedRoom, setSelectedRoom] = useState('');
  const [rooms, setRooms] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [orderNotes, setOrderNotes] = useState('');
  const [discountValue, setDiscountValue] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [taxRate, setTaxRate] = useState(settings?.default_tax_rate || '');
  const [tipAmount, setTipAmount] = useState('');
  const [serviceMode, setServiceMode] = useState('takeaway');
  const [tableName, setTableName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastOrder, setLastOrder] = useState(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [error, setError] = useState('');
  const [barcodeFlash, setBarcodeFlash] = useState(null);
  const currency = settings?.currency || CURRENCY;

  // Outlet state
  const [outlets, setOutlets] = useState([]);
  const [selectedOutlet, setSelectedOutlet] = useState(null);
  const [outletFilter, setOutletFilter] = useState(null);

  // Staff/PIN state
  const [posStaff, setPosStaff] = useState([]);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [showStaffLogin, setShowStaffLogin] = useState(false);
  const [pendingStaffId, setPendingStaffId] = useState('');
  const [staffPin, setStaffPin] = useState('');

  // Waiter state
  const [waiters, setWaiters] = useState([]);
  const [selectedWaiter, setSelectedWaiter] = useState(null);
  const [showWaiterPicker, setShowWaiterPicker] = useState(false);

  // Modifier state
  const [modifierGroups, setModifierGroups] = useState([]);
  const [showModifiers, setShowModifiers] = useState(false);
  const [modifierTargetIdx, setModifierTargetIdx] = useState(null);
  const [modifierSelections, setModifierSelections] = useState([]);

  // Promotions state
  const [promotions, setPromotions] = useState([]);
  const [appliedPromo, setAppliedPromo] = useState(null);

  // Shift state
  const [currentShift, setCurrentShift] = useState(null);

  // Staged data loading: rooms/bookings loaded on demand
  const [roomsLoaded, setRoomsLoaded] = useState(false);

  const searchRef = useRef(null);
  const barcodeBufferRef = useRef('');
  const barcodeTimerRef = useRef(null);
  const menuItemsRef = useRef([]);
  const selectedOutletRef = useRef(null);
  const outletsRef = useRef([]);
  const inventoryItemsRef = useRef([]);
  const submitIntentRef = useRef({ signature: null, intentId: null });

  const cartForTotals = useMemo(() => cart.map((item) => ({
    ...item,
    unit_price: lineUnitPrice(item)
  })), [cart]);

  const inventoryById = useMemo(
    () => new Map((inventoryItems || []).map((item) => [item.id, item])),
    [inventoryItems]
  );

  const orderStockIssues = useMemo(() => {
    const usage = buildOrderStockUsage(cart);
    const issues = [];
    for (const item of cart) {
      if (!item.inventory_item_id) continue;
      const availableStock = normalizeStockValue(inventoryById.get(item.inventory_item_id)?.current_stock);
      const requiredStock = usage.get(item.inventory_item_id) || 0;
      if (requiredStock > availableStock) {
        issues.push({
          itemName: item.item_name,
          availableUnits: getInventoryAvailableUnits(inventoryById, item.inventory_item_id, item.depletion_qty)
        });
      }
    }
    return issues;
  }, [cart, inventoryById]);

  // ── Staged Data Loading ──────────────────────────────────────────────────
  // Phase 1: load menu, outlets, staff immediately (required for terminal)
  const loadCoreData = useCallback(async () => {
    try {
      const [menu, out, staff, modGroups, promos, shifts, inventory] = await Promise.all([
        window.api.pos.getMenuItems().catch(() => []),
        window.api.pos.getOutlets().catch(() => []),
        window.api.pos.getStaff().catch(() => []),
        window.api.pos.getModifierGroups().catch(() => []),
        window.api.pos.getPromotions().catch(() => []),
        window.api.pos.getShifts().catch(() => []),
        window.api.pos.getInventory().catch(() => [])
      ]);
      setMenuItems(menu || []);
      setInventoryItems(inventory || []);
      setOutlets(out || []);
      setPosStaff((staff || []).filter((s) => ['cashier', 'supervisor', 'waiter'].includes(String(s.role || '').toLowerCase())));
      setWaiters((staff || []).filter((s) => String(s.role || '').toLowerCase() === 'waiter'));
      setModifierGroups(modGroups || []);
      setPromotions(promos || []);

      const openShift = (shifts || []).find((s) => s.status === 'open' && s.cashier_id === user.id);
      setCurrentShift(openShift || null);

      const access = await window.api.pos.getUserPosAccess();
      setOutletFilter(access.outletFilter);
      const allowed = access.outletFilter;
      if (Array.isArray(allowed) && allowed.length === 1) {
        const match = (out || []).find((o) => o.id === allowed[0]);
        if (match) setSelectedOutlet(match);
      } else if (allowed === null && (out || []).length === 1) {
        setSelectedOutlet(out[0]);
      }

      const cashierStaff = (staff || []).filter((s) => ['cashier', 'supervisor'].includes(String(s.role || '').toLowerCase()));
      if (cashierStaff.length === 1) setSelectedStaff(cashierStaff[0]);
    } catch (e) {
      console.error('Failed to load POS data:', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Phase 2: load rooms/bookings only when "Room Folio" is selected
  const loadRoomData = useCallback(async () => {
    if (roomsLoaded) return;
    try {
      const [roomList, bookingList] = await Promise.all([
        window.api.pos.getRooms().catch(() => []),
        window.api.pos.getBookings().catch(() => [])
      ]);
      setRooms(roomList || []);
      setBookings(bookingList || []);
      setRoomsLoaded(true);
    } catch (e) {
      console.error('Failed to load room data:', e);
    }
  }, [roomsLoaded]);

  useEffect(() => { loadCoreData(); }, [loadCoreData]);

  useEffect(() => { menuItemsRef.current = menuItems; }, [menuItems]);
  useEffect(() => { selectedOutletRef.current = selectedOutlet; }, [selectedOutlet]);
  useEffect(() => { outletsRef.current = outlets; }, [outlets]);
  useEffect(() => { inventoryItemsRef.current = inventoryItems; }, [inventoryItems]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target;
      const tag = String(target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (event.key === 'Enter') {
        const code = barcodeBufferRef.current.trim();
        barcodeBufferRef.current = '';
        if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current);
        barcodeTimerRef.current = null;
        if (code.length < 4) return;
        const currentInventoryMap = new Map((inventoryItemsRef.current || []).map((item) => [item.id, item]));
        const found = (menuItemsRef.current || []).find((item) => String(item.barcode || '') === code && item.is_available !== false);
        if (!found) {
          setBarcodeFlash({ ok: false, message: `Barcode not found: ${code}` });
        } else if (found.outlet_id && selectedOutletRef.current?.id && found.outlet_id !== selectedOutletRef.current.id) {
          const outletName = (outletsRef.current || []).find((o) => o.id === found.outlet_id)?.name || 'another outlet';
          setBarcodeFlash({ ok: false, message: `${found.name} belongs to ${outletName}` });
        } else if (!isOrderableMenuItem(found, currentInventoryMap)) {
          setBarcodeFlash({ ok: false, message: `${found.name} is sold out` });
        } else {
          addToCart(found);
          setBarcodeFlash({ ok: true, message: `${found.name} added` });
        }
        setTimeout(() => setBarcodeFlash(null), 2500);
      } else if (event.key.length === 1) {
        barcodeBufferRef.current += event.key;
        if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current);
        barcodeTimerRef.current = setTimeout(() => {
          barcodeBufferRef.current = '';
        }, 80);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current);
    };
  }, [inventoryItems]);

  // Load rooms when customer type switches to 'room'
  useEffect(() => {
    if (customerType === 'room' && !roomsLoaded) loadRoomData();
  }, [customerType, roomsLoaded, loadRoomData]);

  const categories = useMemo(() => {
    const cats = [...new Set(menuItems.map((i) => i.category || 'Other'))];
    return ['All', ...cats];
  }, [menuItems]);

  const filteredItems = useMemo(() => {
    let items = menuItems.filter((i) => i.is_available !== false);
    if (selectedOutlet) {
      items = items.filter((i) => !i.outlet_id || i.outlet_id === selectedOutlet.id);
    } else if (Array.isArray(outletFilter) && outletFilter.length > 0) {
      items = items.filter((i) => !i.outlet_id || outletFilter.includes(i.outlet_id));
    }
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((i) =>
        String(i.name || '').toLowerCase().includes(q) ||
        String(i.barcode || '').toLowerCase().includes(q)
      );
    }
    if (activeCategory !== 'All') items = items.filter((i) => (i.category || 'Other') === activeCategory);
    return items;
  }, [menuItems, search, activeCategory, selectedOutlet, outletFilter]);

  // ── Cart Operations ────────────────────────────────────────────────────────
  const addToCart = (item) => {
    if (!isOrderableMenuItem(item, inventoryById)) {
      setError(`${item.name} is sold out on the latest synced stock.`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((c) => c.menu_item_id === item.id);
      const candidate = existing
        ? prev.map((c) => c.menu_item_id === item.id ? { ...c, quantity: c.quantity + 1 } : c)
        : [...prev, {
        menu_item_id: item.id, inventory_item_id: item.inventory_item_id || null,
        depletion_qty: item.depletion_qty || 1, item_name: item.name, category: item.category || 'Other',
        quantity: 1, unit_price: item.price || 0, modifiers: [], item_notes: null
      }];
      if (item.inventory_item_id) {
        const usage = buildOrderStockUsage(candidate);
        const availableStock = normalizeStockValue(inventoryById.get(item.inventory_item_id)?.current_stock);
        if ((usage.get(item.inventory_item_id) || 0) > availableStock) {
          const availableUnits = getInventoryAvailableUnits(inventoryById, item.inventory_item_id, item.depletion_qty);
          setError(availableStock <= 0 ? `${item.name} is sold out.` : `Only ${availableUnits} sale unit(s) of ${item.name} are left.`);
          return prev;
        }
      }
      setError('');
      return candidate;
    });
  };

  const updateCartQty = (idx, delta) => {
    setCart((prev) => {
      const next = [...prev];
      const qty = (next[idx].quantity || 0) + delta;
      if (qty <= 0) next.splice(idx, 1); else next[idx] = { ...next[idx], quantity: qty };
      if (delta > 0 && next[idx]?.inventory_item_id) {
        const usage = buildOrderStockUsage(next);
        const availableStock = normalizeStockValue(inventoryById.get(next[idx].inventory_item_id)?.current_stock);
        if ((usage.get(next[idx].inventory_item_id) || 0) > availableStock) {
          const availableUnits = getInventoryAvailableUnits(inventoryById, next[idx].inventory_item_id, next[idx].depletion_qty);
          setError(`Only ${availableUnits} sale unit(s) of ${next[idx].item_name} are left.`);
          return prev;
        }
      }
      setError('');
      return next;
    });
  };

  const removeFromCart = (idx) => setCart((prev) => prev.filter((_, i) => i !== idx));

  // ── Modifier Handling ──────────────────────────────────────────────────────
  const openModifiers = (idx) => {
    setModifierTargetIdx(idx);
    setModifierSelections(cart[idx]?.modifiers || []);
    setShowModifiers(true);
  };

  const applyModifiers = () => {
    if (modifierTargetIdx === null) return;
    setCart((prev) => prev.map((c, i) => i === modifierTargetIdx ? { ...c, modifiers: modifierSelections } : c));
    setShowModifiers(false);
  };

  // ── Promotions ─────────────────────────────────────────────────────────────
  const applicablePromo = useMemo(() => {
    if (!promotions.length || !cart.length) return null;
    for (const promo of promotions) {
      if (!promo || promo.enabled === false) continue;
      if (promo.applies_to_category && promo.applies_to_category !== 'All') {
        const hasMatching = cartForTotals.some((c) => (c.category || 'Other') === promo.applies_to_category);
        if (!hasMatching) continue;
      }
      return promo;
    }
    return null;
  }, [promotions, cartForTotals]);

  // ── Totals ─────────────────────────────────────────────────────────────────
  const cartTotals = useMemo(() => {
    let discount = Number(discountValue) || 0;
    if (appliedPromo && applicablePromo && applicablePromo === appliedPromo) {
      const promoValue = Number(applicablePromo.discount_value) || 0;
      if (applicablePromo.discount_type === 'percent') {
        const sub = cartForTotals.reduce((s, c) => s + c.quantity * c.unit_price, 0);
        discount += sub * promoValue / 100;
      } else {
        discount += promoValue;
      }
    }
    return buildPosTotals(cartForTotals, {
      discount_total: discount,
      tax_rate: Number(taxRate) || 0,
      tip_total: Number(tipAmount) || 0
    });
  }, [cartForTotals, discountValue, taxRate, tipAmount, appliedPromo, applicablePromo]);

  const effectivePaymentMethod = customerType === 'room'
    ? 'folio'
    : paymentMode === 'split'
      ? 'split'
      : paymentMethod;

  const paymentBreakdown = useMemo(() => {
    if (customerType === 'room') {
      return [{ method: 'folio', amount: cartTotals.total, reference: null }];
    }
    if (paymentMode !== 'split') {
      return [{ method: paymentMethod, amount: cartTotals.total, reference: paymentReference || null }];
    }
    return splitPayments
      .map((row) => ({
        method: row.method || 'cash',
        amount: money(row.amount),
        reference: row.reference || null
      }))
      .filter((row) => row.amount !== 0);
  }, [customerType, paymentMode, paymentMethod, paymentReference, splitPayments, cartTotals.total]);

  const paymentTotal = useMemo(
    () => paymentBreakdown.reduce((sum, row) => money(sum + Number(row.amount || 0)), 0),
    [paymentBreakdown]
  );
  const paymentBalance = money(cartTotals.total - paymentTotal);

  const updateSplitPayment = (idx, patch) => {
    setSplitPayments((prev) => prev.map((row, i) => i === idx ? { ...row, ...patch } : row));
  };

  const addSplitPayment = () => {
    setSplitPayments((prev) => [...prev, { method: 'cash', amount: Math.max(0, paymentBalance).toFixed(2), reference: '' }].slice(0, 6));
  };

  const removeSplitPayment = (idx) => {
    setSplitPayments((prev) => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx));
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      window.api.pos.updateCustomerDisplay({
        items: cartForTotals.map((item) => ({
          item_name: item.item_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          modifiers: item.modifiers || []
        })),
        totals: cartTotals,
        currency,
        service_mode: serviceMode,
        table_name: tableName || null,
        updated_at: new Date().toISOString()
      }).catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [cartForTotals, cartTotals, currency, serviceMode, tableName]);

  // ── Submit Order ───────────────────────────────────────────────────────────
  const handleSubmitOrder = async () => {
    if (!selectedStaff) { setError('Select a cashier/operator first.'); return; }
    if (cart.length === 0) { setError('Add items to the cart first.'); return; }
    if (customerType === 'room' && !selectedRoom) { setError('Select a room for folio charge.'); return; }
    if (orderStockIssues.length > 0) {
      setError(`${orderStockIssues[0].itemName} no longer has enough synced stock for this order.`);
      return;
    }
    if (customerType !== 'room' && paymentMode === 'split' && Math.abs(paymentBalance) > 0.01) {
      setError(`Split payments must match the total. Balance: ${currency} ${fmt(paymentBalance)}`);
      return;
    }

    // Offline folio guard
    if (customerType === 'room' && paymentMethod === 'folio' && !isOnline) {
      const activeBooking = bookings.find((b) => b.room_id === selectedRoom && b.status !== 'cancelled');
      if (!activeBooking) {
        setError('Room folio charge requires an active booking cached locally. Go online first or sync bookings.');
        return;
      }
    }

    setError('');
    setSubmitting(true);
    try {
      const submitSignature = buildSubmitSignature({
        cart: cartForTotals,
        customerType,
        selectedRoom,
        walkInName,
        paymentMethod: effectivePaymentMethod,
        paymentBreakdown,
        outletId: selectedOutlet?.id || null,
        totals: cartTotals,
        serviceMode,
        tableName
      });
      if (submitIntentRef.current.signature !== submitSignature || !submitIntentRef.current.intentId) {
        submitIntentRef.current = { signature: submitSignature, intentId: createIntentId() };
      }
      const submitIntentId = submitIntentRef.current.intentId;
      const bookingId = customerType === 'room' && selectedRoom
        ? bookings.find((b) => b.room_id === selectedRoom && ['confirmed', 'checked_in'].includes(String(b.status || '').toLowerCase()))?.id || null
        : null;

      if (customerType === 'room' && paymentMethod === 'folio' && !bookingId) {
        setError('No active booking found for this room. Cannot charge to folio.');
        setSubmitting(false);
        return;
      }

      const result = await window.api.pos.createOrder({
        id: submitIntentId,
        submit_intent_id: submitIntentId,
        items: cartForTotals,
        payment_method: effectivePaymentMethod,
        payment_breakdown: paymentBreakdown,
        walk_in_name: customerType === 'walkin' ? walkInName : null,
        room_id: customerType === 'room' ? selectedRoom : null,
        booking_id: bookingId,
        notes: orderNotes,
        discount_total: Number(discountValue) || 0,
        tax_rate: Number(taxRate) || 0,
        tax_total: cartTotals.tax_total,
        tip_total: Number(tipAmount) || 0,
        service_mode: serviceMode,
        table_name: tableName || null,
        outlet_id: selectedOutlet?.id || null,
        waiter_name: selectedWaiter?.name || null,
        cashier_id: selectedStaff.id,
        cashier_name: selectedStaff.name || selectedStaff.email,
        shift_id: currentShift?.id || null,
        created_at_client: new Date().toISOString()
      });

      if (result?.success) {
        const orderData = {
          id: result.id || submitIntentId, total: cartTotals.total, gross_total: cartTotals.gross_total,
          discount_total: cartTotals.discount_total, tax_rate: cartTotals.tax_rate,
          tax_total: cartTotals.tax_total, tip_total: cartTotals.tip_total,
          status: 'completed', created_at: new Date().toISOString(),
          payment_method: effectivePaymentMethod,
          payment_breakdown: paymentBreakdown,
          walk_in_name: customerType === 'walkin' ? walkInName : null,
          table_name: tableName || null, waiter_name: selectedWaiter?.name || null,
          cashier_name: selectedStaff.name || selectedStaff.email,
          pos_order_items: cartForTotals.map((item, idx) => ({ id: `local-${idx}`, ...item, subtotal: item.quantity * item.unit_price })),
          _pending_sync: result.offline || false
        };
        submitIntentRef.current = { signature: null, intentId: null };
        setLastOrder(orderData);
        setShowReceipt(true);
        setCart([]); setWalkInName(''); setSelectedRoom(''); setOrderNotes('');
        setDiscountValue(''); setDiscountReason(''); setTipAmount(''); setPaymentReference('');
        setSplitPayments([{ method: 'cash', amount: '', reference: '' }]);
        setPaymentMode('single');
        setAppliedPromo(null);
      }
    } catch (err) {
      setError(sanitizePosError(err?.message));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-56px)] bg-slate-100">
      {/* Menu Panel */}
      <div className="flex flex-1 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <select value={selectedOutlet?.id || ''} onChange={(e) => {
            const o = outlets.find((x) => x.id === e.target.value);
            setSelectedOutlet(o || null);
          }} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold">
            <option value="">{outlets.length === 0 ? 'No outlets' : 'All outlets'}</option>
            {outlets.filter((o) => !outletFilter || outletFilter === null || outletFilter.includes(o.id)).map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <select value={selectedStaff?.id || ''} onChange={(e) => {
            const s = posStaff.find((x) => x.id === e.target.value);
            setSelectedStaff(s || null);
          }} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold">
            <option value="">Select cashier...</option>
            {posStaff.map((s) => (
              <option key={s.id} value={s.id}>{s.name || s.email}</option>
            ))}
          </select>
          {currentShift && (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">Shift Open</span>
          )}
        </div>
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input ref={searchRef} type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items or scan barcode..."
              className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-12 pr-4 text-base focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
          </div>
          {barcodeFlash && (
            <div className={`rounded-lg px-3 py-2 text-xs font-bold ${barcodeFlash.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {barcodeFlash.message}
            </div>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-4 py-3">
          {categories.map((cat) => (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              className={`min-h-11 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition-colors ${activeCategory === cat ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {cat}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {filteredItems.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400">No items found</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filteredItems.map((item) => {
                const availableUnits = getInventoryAvailableUnits(inventoryById, item.inventory_item_id, item.depletion_qty);
                const soldOut = !isOrderableMenuItem(item, inventoryById);
                return (
                  <button key={item.id} onClick={() => addToCart(item)} disabled={soldOut}
                    className={`flex min-h-[116px] flex-col items-start rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition-all active:scale-[0.99] ${soldOut ? 'cursor-not-allowed opacity-60' : 'hover:border-emerald-300 hover:shadow-md'}`}>
                    <span className="text-base font-bold leading-snug text-slate-800 line-clamp-2">{item.name}</span>
                    <span className="mt-2 text-xs font-semibold uppercase text-slate-400">{item.category || 'Other'}</span>
                    {item.inventory_item_id && (
                      <span className={`mt-1 text-xs font-bold ${soldOut ? 'text-red-600' : availableUnits <= 3 ? 'text-amber-600' : 'text-slate-400'}`}>
                        {soldOut ? 'Sold out' : `${availableUnits} left`}
                      </span>
                    )}
                    <span className="mt-auto pt-3 text-lg font-black text-emerald-700">{currency} {fmt(item.price)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Cart Panel */}
      <div className="flex w-[430px] flex-col bg-slate-50">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-emerald-600" />
            <span className="font-bold text-slate-800">Order ({cart.length})</span>
          </div>
          {cart.length > 0 && <button onClick={() => setCart([])} className="min-h-10 rounded-lg px-3 text-sm font-semibold text-red-500 hover:bg-red-50 hover:text-red-700">Clear All</button>}
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {cart.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No items in cart</p>
          ) : (
            <div className="space-y-3">
              {cart.map((item, idx) => (
                <div key={idx} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-bold text-slate-800">{item.item_name}</p>
                      <p className="text-xs text-slate-500">{currency} {fmt(lineUnitPrice(item))} ea</p>
                      {item.modifiers?.length > 0 && (
                        <p className="mt-1 text-xs font-medium text-amber-700">{item.modifiers.map((m) => `${m.name}${Number(m.price || 0) ? ` +${currency} ${fmt(m.price)}` : ''}`).join(', ')}</p>
                      )}
                    </div>
                    <button onClick={() => removeFromCart(idx)} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"><X className="h-5 w-5" /></button>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateCartQty(idx, -1)} className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"><Minus className="h-5 w-5" /></button>
                      <span className="w-10 text-center text-lg font-black">{item.quantity}</span>
                      <button onClick={() => updateCartQty(idx, 1)} className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"><Plus className="h-5 w-5" /></button>
                      {modifierGroups.length > 0 && (
                        <button onClick={() => openModifiers(idx)} className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200" title="Add modifiers"><Package className="h-5 w-5" /></button>
                      )}
                    </div>
                    <span className="text-base font-black text-slate-800">{currency} {fmt(item.quantity * lineUnitPrice(item))}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Order Config */}
        <div className="space-y-3 border-t border-slate-200 bg-white px-4 py-3">
          <div className="flex gap-2">
            <select value={customerType} onChange={(e) => setCustomerType(e.target.value)} className="min-h-11 flex-1 rounded-lg border border-slate-200 px-3 text-sm font-semibold">
              <option value="walkin">Walk-in</option>
              <option value="room">Room Folio</option>
            </select>
            <select value={serviceMode} onChange={(e) => setServiceMode(e.target.value)} className="min-h-11 flex-1 rounded-lg border border-slate-200 px-3 text-sm font-semibold">
              <option value="takeaway">Takeaway</option>
              <option value="table">Table</option>
              <option value="room">Room Service</option>
            </select>
          </div>
          {customerType === 'walkin' && (
            <input type="text" value={walkInName} onChange={(e) => setWalkInName(e.target.value)} placeholder="Guest name (optional)" className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm" />
          )}
          {customerType === 'room' && (
            <select value={selectedRoom} onChange={(e) => setSelectedRoom(e.target.value)} className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm">
              <option value="">Select room...</option>
              {rooms.map((room) => {
                const booking = bookings.find((b) => b.room_id === room.id && ['confirmed', 'checked_in'].includes(String(b.status || '').toLowerCase()));
                return <option key={room.id} value={room.id}>{room.name || room.number || room.id}{booking ? ` (${booking.guest_name})` : ''}</option>;
              })}
            </select>
          )}
          {serviceMode === 'table' && (
            <input type="text" value={tableName} onChange={(e) => setTableName(e.target.value)} placeholder="Table name/number" className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm" />
          )}
          {/* Waiter Selection */}
          {serviceMode === 'table' && waiters.length > 0 && (
            <select value={selectedWaiter?.id || ''} onChange={(e) => { const w = waiters.find((x) => x.id === e.target.value); setSelectedWaiter(w || null); }}
              className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm">
              <option value="">Select waiter...</option>
              {waiters.map((w) => <option key={w.id} value={w.id}>{w.name || w.email}</option>)}
            </select>
          )}
          <input type="text" value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} placeholder="Order notes..." className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-slate-500">Discount ({currency})</label>
              <input type="number" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} placeholder="0" className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm" min="0" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Tax Rate (%)</label>
              <input type="number" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} placeholder="0" className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm" min="0" max="100" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Tip ({currency})</label>
            <input type="number" value={tipAmount} onChange={(e) => setTipAmount(e.target.value)} placeholder="0" className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm" min="0" />
          </div>
          {applicablePromo && (
            <button onClick={() => setAppliedPromo(appliedPromo ? null : applicablePromo)}
              className={`min-h-11 w-full rounded-lg border px-3 text-sm font-semibold ${appliedPromo ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
              <Percent className="mr-1 inline h-3 w-3" /> {appliedPromo ? 'Remove' : 'Apply'} Promo: {applicablePromo.name || 'Discount'}
            </button>
          )}
        </div>

        {/* Totals & Payment */}
        <div className="space-y-3 border-t border-slate-200 bg-white px-4 py-3">
          {Number(cartTotals.discount_total) > 0 && (
            <div className="flex justify-between text-xs text-emerald-600"><span>Discount</span><span>-{currency} {fmt(cartTotals.discount_total)}</span></div>
          )}
          {Number(cartTotals.tax_total) > 0 && (
            <div className="flex justify-between text-xs text-slate-500"><span>Tax ({cartTotals.tax_rate}%)</span><span>{currency} {fmt(cartTotals.tax_total)}</span></div>
          )}
          {Number(cartTotals.tip_total) > 0 && (
            <div className="flex justify-between text-xs text-slate-500"><span>Tip</span><span>{currency} {fmt(cartTotals.tip_total)}</span></div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-2">
            <span className="text-base font-bold text-slate-800">Total</span>
            <span className="text-2xl font-black text-emerald-700">{currency} {fmt(cartTotals.total)}</span>
          </div>
          {customerType !== 'room' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setPaymentMode('single')}
                  className={`min-h-11 rounded-lg border px-3 text-sm font-bold ${paymentMode === 'single' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                  Single
                </button>
                <button onClick={() => setPaymentMode('split')}
                  className={`min-h-11 rounded-lg border px-3 text-sm font-bold ${paymentMode === 'split' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                  Split
                </button>
              </div>
              {paymentMode === 'single' ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {QUICK_PAYMENT_METHODS.map((m) => (
                      <button key={m.value} onClick={() => setPaymentMethod(m.value)}
                        className={`min-h-12 rounded-lg border px-2 text-xs font-black ${paymentMethod === m.value ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-700'}`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {(paymentMethod === 'card' || paymentMethod === 'bank_transfer' || paymentMethod === 'other') && (
                    <input type="text" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="Reference / approval code" className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm" />
                  )}
                </>
              ) : (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                  {splitPayments.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_96px_40px] gap-2">
                      <select value={row.method} onChange={(e) => updateSplitPayment(idx, { method: e.target.value })}
                        className="min-h-11 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold">
                        {QUICK_PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                      <input type="number" value={row.amount} onChange={(e) => updateSplitPayment(idx, { amount: e.target.value })}
                        className="min-h-11 rounded-lg border border-slate-200 bg-white px-2 text-sm font-bold" placeholder="0.00" min="0" />
                      <button onClick={() => removeSplitPayment(idx)} className="flex h-11 w-10 items-center justify-center rounded-lg bg-white text-slate-400 hover:bg-red-50 hover:text-red-600">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={addSplitPayment} className="min-h-10 rounded-lg bg-white px-3 text-sm font-bold text-slate-700 shadow-sm">Add payment</button>
                    <span className={`text-sm font-black ${Math.abs(paymentBalance) <= 0.01 ? 'text-emerald-700' : 'text-red-600'}`}>
                      Balance {currency} {fmt(paymentBalance)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
          {customerType === 'room' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-semibold text-amber-800">
              Room folio charge
            </div>
          )}
          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>}
          {orderStockIssues.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              {orderStockIssues[0].itemName} exceeds latest synced stock.
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => window.api.pos.openCashDrawer(settings)} className="flex h-14 w-14 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200" title="Open Cash Drawer">
              <Banknote className="h-5 w-5" />
            </button>
            <button onClick={handleSubmitOrder} disabled={submitting || cart.length === 0 || !selectedStaff || orderStockIssues.length > 0}
              className="min-h-14 flex-1 rounded-lg bg-emerald-600 px-4 text-lg font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? 'Processing...' : `Pay ${currency} ${fmt(cartTotals.total)}`}
            </button>
          </div>
        </div>
      </div>

      {/* Receipt Modal */}
      {showReceipt && lastOrder && (
        <ReceiptModal order={lastOrder} settings={settings} currency={currency}
          onClose={() => { setShowReceipt(false); setLastOrder(null); }} />
      )}

      {/* Modifier Modal */}
      {showModifiers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-5">
            <h2 className="text-xl font-black text-slate-800">Modifiers</h2>
            {modifierGroups.map((group) => (
              <div key={group.id || group.name}>
                <p className="mb-2 text-sm font-bold text-slate-600">{group.name}</p>
                <div className="flex flex-wrap gap-2">
                  {(group.options || []).map((opt) => {
                    const name = typeof opt === 'string' ? opt : opt.name;
                    const price = typeof opt === 'object' ? Number(opt.price || 0) : 0;
                    const active = modifierSelections.some((s) => s.group === group.name && s.name === name);
                    return (
                      <button key={name} onClick={() => {
                        setModifierSelections((prev) => {
                          if (prev.some((s) => s.group === group.name && s.name === name)) {
                            return prev.filter((s) => !(s.group === group.name && s.name === name));
                          }
                          return [...prev, { group: group.name, name, price }];
                        });
                      }} className={`min-h-11 rounded-lg px-4 text-sm font-bold ${active ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
                        {name}{price ? ` +${currency} ${fmt(price)}` : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="flex gap-3">
              <button onClick={applyModifiers} className="min-h-12 flex-1 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white">Apply</button>
              <button onClick={() => setShowModifiers(false)} className="min-h-12 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-600">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReceiptModal({ order, settings, currency, onClose }) {
  const handlePrint = async () => {
    const hw = await window.api.pos.getHardwareSettings().catch(() => null);
    const shouldOpenDrawer = order.payment_method === 'cash' ||
      (order.payment_breakdown || []).some((p) => String(p.method || '').toLowerCase() === 'cash' && Number(p.amount || 0) > 0);
    await window.api.pos.printReceipt({ order, business: settings || {}, settings: hw || settings || {}, openDrawer: shouldOpenDrawer })
      .catch((e) => alert(e?.message || 'Print failed'));
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="font-bold text-slate-800">Order Confirmed</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6">
          <div className="text-center mb-4">
            <Check className="mx-auto h-12 w-12 text-emerald-500" />
            <p className="mt-2 text-sm text-slate-500">{order._pending_sync ? 'Saved offline - will sync when connected' : 'Order submitted successfully'}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-slate-500">Order ID</span><span className="font-mono text-xs">{String(order.id).slice(0, 8)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Items</span><span>{order.pos_order_items?.length || 0}</span></div>
            <div className="flex justify-between font-bold"><span>Total</span><span>{currency} {fmt(order.total)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Payment</span><span className="uppercase">{order.payment_method}</span></div>
            {order.waiter_name && <div className="flex justify-between"><span className="text-slate-500">Waiter</span><span>{order.waiter_name}</span></div>}
          </div>
        </div>
        <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
          <button onClick={handlePrint} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
            <ReceiptText className="mr-2 inline h-4 w-4" /> Print Receipt
          </button>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Close</button>
        </div>
      </div>
    </div>
  );
}
