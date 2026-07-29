import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Beer,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  DollarSign,
  Flame,
  PackageCheck,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShoppingCart,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wine,
  X,
} from 'lucide-react';
import { useAccess, useSettings } from '../../app-context';
import { canAccessCapability } from '../../../../shared/accessControl';
import { isBarOnlyMode } from '../../../../shared/propertyTypes';
import {
  HposButton,
  HposEmptyState,
  HposNotice,
  HposPageHero,
  HposStatusBadge,
} from './HposUi';

const tabs = [
  { id: 'owner', label: 'Owner brief', icon: TrendingUp },
  { id: 'bar', label: 'Bar control', icon: Beer, barOnly: true },
  {
    id: 'margin',
    label: 'Menu margin',
    icon: BarChart3,
    capability: 'reports.view',
  },
  { id: 'labour', label: 'Labour', icon: Users, capability: 'staff.manage' },
  {
    id: 'procurement',
    label: 'Procurement',
    icon: ShoppingCart,
    capability: 'inventory.manage',
  },
  { id: 'revenue', label: 'Promotions', icon: Target },
  {
    id: 'guest-flow',
    label: 'Guest flow',
    icon: CalendarDays,
    restaurantOnly: true,
  },
  {
    id: 'control',
    label: 'Control & safety',
    icon: ShieldAlert,
    capability: 'incident_log.view',
  },
];
const dateKey = (date) => date.toISOString().slice(0, 10);
const money = (value, currency) =>
  `${currency} ${Number(value || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function HposBusinessControl() {
  const { settings } = useSettings();
  const access = useAccess();
  const navigate = useNavigate();
  const currency = settings?.currency || 'P';
  const barOnly = isBarOnlyMode(settings);
  const [active, setActive] = useState('owner');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [data, setData] = useState({
    orders: [],
    menu: [],
    recipes: [],
    shifts: [],
    plans: [],
    suggestions: [],
    purchaseOrders: [],
    promotions: [],
    reservations: [],
    waitlist: [],
    alerts: [],
    checklists: [],
    audit: [],
    expiry: [],
    incidents: [],
    digest: null,
    voids: [],
  });
  const [showVariance, setShowVariance] = useState(false);
  const visibleTabs = tabs.filter(
    (tab) =>
      (!tab.barOnly || barOnly) &&
      (!tab.restaurantOnly || !barOnly) &&
      (!tab.capability || canAccessCapability(access, tab.capability)),
  );
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const end = new Date();
    const start = new Date(Date.now() - 30 * 86400000);
    const from = dateKey(start);
    const to = dateKey(end);
    const calls = await Promise.allSettled([
      window.api?.pos?.getOrders?.(from, to),
      window.api?.pos?.getMenuItems?.(),
      barOnly ? Promise.resolve([]) : window.api?.pos?.getRecipes?.(),
      window.api?.pos?.getShiftHistory?.(from, to),
      window.api?.pos?.getLowStockPurchaseSuggestions?.(),
      window.api?.pos?.getPurchaseOrders?.(from, to),
      window.api?.pos?.getPromotions?.(),
      barOnly
        ? Promise.resolve([])
        : window.api?.pos?.getRestaurantReservations?.(from, to),
      barOnly
        ? Promise.resolve([])
        : window.api?.pos?.getRestaurantWaitlist?.(),
      window.api?.pos?.getActiveAlerts?.(),
      window.api?.pos?.getChecklists?.(),
      window.api?.pos?.getAuditLog?.(250),
      window.api?.pos?.getExpiryLots?.(30),
      window.api?.incidents?.getAll?.(),
      window.api?.pos?.generateOwnerDigest?.(),
      window.api?.pos?.getVoidHistory?.(from, to),
      window.api?.pos?.getRestaurantShiftPlans?.(
        from,
        new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      ),
    ]);
    const value = (index, fallback = []) =>
      calls[index]?.status === 'fulfilled'
        ? (calls[index].value ?? fallback)
        : fallback;
    setData({
      orders: value(0),
      menu: value(1),
      recipes: value(2),
      shifts: value(3),
      suggestions: value(4),
      purchaseOrders: value(5),
      promotions: value(6),
      reservations: value(7),
      waitlist: value(8),
      alerts: value(9),
      checklists: value(10),
      audit: value(11),
      expiry: value(12),
      incidents: value(13),
      digest: calls[14]?.status === 'fulfilled' ? calls[14].value : null,
      voids: value(15),
      plans: value(16),
    });
    if (calls.every((call) => call.status === 'rejected'))
      setError(
        'Business control data could not be loaded. Check the connection and retry.',
      );
    setLoading(false);
  }, [barOnly]);
  useEffect(() => {
    load();
  }, [load]);

  const metrics = useMemo(() => {
    const completed = data.orders.filter(
      (order) =>
        !['voided', 'cancelled'].includes(
          String(order.status || '').toLowerCase(),
        ),
    );
    const sales = completed.reduce(
      (sum, order) => sum + Number(order.total || order.total_amount || 0),
      0,
    );
    const itemMap = {};
    completed.forEach((order) =>
      (order.pos_order_items || order.items || []).forEach((item) => {
        const name = item.item_name || item.name || 'Unlabelled item';
        const row = itemMap[name] || { name, units: 0, sales: 0 };
        row.units += Number(item.quantity || 1);
        row.sales +=
          Number(item.quantity || 1) *
          Number(item.unit_price || item.price || 0);
        itemMap[name] = row;
      }),
    );
    const topItems = Object.values(itemMap).sort((a, b) => b.sales - a.sales);
    const byDay = {};
    completed.forEach((order) => {
      const day = String(order.created_at || '').slice(0, 10) || 'unknown';
      byDay[day] =
        (byDay[day] || 0) + Number(order.total || order.total_amount || 0);
    });
    const datedSales = Object.entries(byDay)
      .filter(([day]) => day !== 'unknown')
      .sort(([a], [b]) => a.localeCompare(b));
    const days = datedSales.map(([, value]) => value);
    const averageDay = days.length
      ? days.reduce((a, b) => a + b, 0) / days.length
      : 0;
    const recent7 = datedSales
      .slice(-7)
      .reduce((sum, [, value]) => sum + value, 0);
    const previous7 = datedSales
      .slice(-14, -7)
      .reduce((sum, [, value]) => sum + value, 0);
    const weightedDaily = days.length
      ? averageDay * 0.35 +
        (recent7 / Math.min(7, Math.max(1, datedSales.slice(-7).length))) * 0.65
      : 0;
    return {
      sales,
      orders: completed.length,
      topItems,
      averageDay,
      forecast7: weightedDaily * 7,
      forecastTrend:
        previous7 > 0 ? ((recent7 - previous7) / previous7) * 100 : null,
      forecastConfidence:
        days.length >= 21 ? 'High' : days.length >= 7 ? 'Medium' : 'Low',
      voids: data.voids.length,
      discountCount: completed.filter(
        (order) =>
          Number(order.discount_total || order.discount_amount || 0) > 0,
      ).length,
    };
  }, [data.orders, data.voids]);

  const statusTone = (count) => (count > 0 ? 'warning' : 'success');
  return (
    <div className="hpos-page-frame">
      <HposPageHero
        eyebrow="Manager control"
        title={barOnly ? 'Bar business control' : 'Restaurant business control'}
        description={
          barOnly
            ? 'One bar-first view for drink performance, pour variance, shifts, purchasing, promotions, cash risk, and the next manager decision.'
            : 'One operating view for margin, labour, purchasing, revenue, guest flow, risk, and the next manager decision.'
        }
        actions={
          <HposButton
            icon={RefreshCw}
            className={loading ? 'is-loading' : ''}
            onClick={load}
            disabled={loading}
          >
            Refresh
          </HposButton>
        }
      />
      {error && <HposNotice tone="error">{error}</HposNotice>}
      {notice && <HposNotice>{notice}</HposNotice>}
      <nav className="hpos-control-tabs" aria-label="Business control sections">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={active === tab.id ? 'is-active' : ''}
              onClick={() => setActive(tab.id)}
            >
              <Icon size={16} />
              {barOnly && tab.id === 'margin'
                ? 'Drink margin'
                : barOnly && tab.id === 'labour'
                  ? 'Bar team'
                  : tab.label}
            </button>
          );
        })}
      </nav>
      {active === 'owner' && (
        <OwnerBrief
          metrics={metrics}
          data={data}
          currency={currency}
          loading={loading}
          onGenerate={async () => {
            setNotice('Owner brief refreshed from live operational data.');
            await load();
          }}
        />
      )}
      {active === 'bar' && (
        <BarControl
          data={data}
          currency={currency}
          onVariance={() => setShowVariance(true)}
          onNotice={setNotice}
        />
      )}
      {active === 'margin' && (
        <MenuMargin
          data={data}
          currency={currency}
          metrics={metrics}
          barOnly={barOnly}
        />
      )}
      {active === 'labour' && (
        <Labour
          data={data}
          currency={currency}
          metrics={metrics}
          onReload={load}
          barOnly={barOnly}
        />
      )}
      {active === 'procurement' && (
        <Procurement
          data={data}
          currency={currency}
          onNotice={setNotice}
          onReload={load}
        />
      )}
      {active === 'revenue' && (
        <Revenue data={data} onNotice={setNotice} onReload={load} />
      )}
      {active === 'guest-flow' && (
        <GuestFlow
          data={data}
          onManage={() => navigate('/restaurant/reservations')}
        />
      )}
      {active === 'control' && (
        <ControlSafety data={data} onNotice={setNotice} onReload={load} />
      )}
      {showVariance && (
        <VarianceModal
          data={data}
          onClose={() => setShowVariance(false)}
          onNotice={setNotice}
          onReload={load}
        />
      )}
    </div>
  );
}

function OwnerBrief({ metrics, data, currency, loading, onGenerate }) {
  const digest = data.digest?.summary || data.digest || {};
  return (
    <div className="hpos-control-section">
      <div className="hpos-control-kpis">
        {[
          ['30-day sales', money(metrics.sales, currency), TrendingUp],
          ['Orders', metrics.orders, ShoppingCart],
          ['Average day', money(metrics.averageDay, currency), Clock3],
          [
            '7-day weighted forecast',
            money(metrics.forecast7, currency),
            Sparkles,
          ],
        ].map(([label, value, Icon]) => (
          <article key={label}>
            <Icon size={18} />
            <small>{label}</small>
            <strong>{loading ? '—' : value}</strong>
          </article>
        ))}
      </div>
      <p className="hpos-control-copy">
        Forecast confidence: {metrics.forecastConfidence}. Recent seven-day
        trend:{' '}
        {metrics.forecastTrend == null
          ? 'not enough prior data'
          : `${metrics.forecastTrend >= 0 ? '+' : ''}${metrics.forecastTrend.toFixed(1)}%`}
        .
      </p>
      <div className="hpos-control-grid">
        <section className="hpos-control-card">
          <div className="hpos-section-title">
            <div>
              <p className="hpos-eyebrow">What needs a decision</p>
              <h2>Today’s operating signals</h2>
            </div>
            <HposStatusBadge tone={data.alerts.length ? 'warning' : 'success'}>
              {data.alerts.length ? `${data.alerts.length} alerts` : 'Clear'}
            </HposStatusBadge>
          </div>
          <Signal
            icon={AlertTriangle}
            label="Manager alerts"
            value={data.alerts.length}
            detail="Resolve exceptions before close."
          />
          <Signal
            icon={PackageCheck}
            label="Low-stock suggestions"
            value={data.suggestions.length}
            detail="Items ready for a purchase decision."
          />
          <Signal
            icon={ClipboardList}
            label="Open checklists"
            value={data.checklists.filter((item) => !item.is_completed).length}
            detail="Opening, closing and safety work."
          />
          <Signal
            icon={ShieldAlert}
            label="Recent voids"
            value={metrics.voids}
            detail="Review reasons and approvals."
          />
        </section>
        <section className="hpos-control-card">
          <div className="hpos-section-title">
            <div>
              <p className="hpos-eyebrow">Owner brief</p>
              <h2>Live decision summary</h2>
            </div>
            <HposButton icon={RefreshCw} onClick={onGenerate}>
              Refresh brief
            </HposButton>
          </div>
          <p className="hpos-control-copy">
            {digest.generated_at
              ? `Generated ${new Date(digest.generated_at).toLocaleString('en-GB')}.`
              : 'Generate a current brief from sales, stock, staff, expenses and alerts.'}
          </p>
          <div className="hpos-brief-lines">
            <div>
              <span>Expenses</span>
              <strong>{money(digest.total_expenses, currency)}</strong>
            </div>
            <div>
              <span>Net after expenses</span>
              <strong>
                {money(
                  Number(digest.total_revenue || metrics.sales) -
                    Number(digest.total_expenses || 0),
                  currency,
                )}
              </strong>
            </div>
            <div>
              <span>Staff on duty</span>
              <strong>
                {digest.staff_on_duty ??
                  data.shifts.filter((shift) => !shift.clock_out).length}
              </strong>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
function Signal({ icon: Icon, label, value, detail }) {
  return (
    <div className="hpos-signal">
      <span>
        <Icon size={16} />
      </span>
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
      <b>{value}</b>
    </div>
  );
}

function BarControl({ data, currency, onVariance }) {
  const barItems = data.menu.filter((item) =>
    /beer|spirit|wine|cocktail|bar|drink|soft/i.test(
      `${item.category || ''} ${item.template_kind || ''} ${item.name || ''}`,
    ),
  );
  const packs = barItems.filter(
    (item) => item.template_kind === 'bar_pack' || item.pack_size,
  );
  return (
    <div className="hpos-control-section">
      <div className="hpos-control-kpis">
        {[
          ['Bar products', barItems.length, Beer],
          ['Pack templates', packs.length, PackageCheck],
          ['Expiry lots', data.expiry.length, Clock3],
          ['Stock decisions', data.suggestions.length, AlertTriangle],
        ].map(([label, value, Icon]) => (
          <article key={label}>
            <Icon size={18} />
            <small>{label}</small>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
      <div className="hpos-control-grid">
        <section className="hpos-control-card">
          <div className="hpos-section-title">
            <div>
              <p className="hpos-eyebrow">Pour accountability</p>
              <h2>Bar stock watch</h2>
            </div>
            <HposButton icon={Plus} onClick={onVariance}>
              Record variance
            </HposButton>
          </div>
          <p className="hpos-control-copy">
            Record bottle breaks, comps, spillage, measured-pour variance and
            keg counts against inventory with an accountable reason.
          </p>
          {barItems.length ? (
            <div className="hpos-mini-table">
              {barItems.slice(0, 10).map((item) => (
                <div key={item.id}>
                  <strong>{item.name}</strong>
                  <span>{item.category || 'Bar item'}</span>
                  <b>{money(item.price, currency)}</b>
                </div>
              ))}
            </div>
          ) : (
            <HposEmptyState
              icon={Beer}
              title="No bar products detected"
              description="Add beer, spirits, wine, cocktails or soft drinks to the product catalog to start tracking bar control."
            />
          )}
        </section>
        <section className="hpos-control-card">
          <div className="hpos-section-title">
            <div>
              <p className="hpos-eyebrow">Loss prevention</p>
              <h2>Expiry and waste watch</h2>
            </div>
            <HposStatusBadge tone={data.expiry.length ? 'warning' : 'success'}>
              {data.expiry.length
                ? `${data.expiry.length} lots`
                : 'No due lots'}
            </HposStatusBadge>
          </div>
          {data.expiry.slice(0, 8).map((lot) => (
            <div className="hpos-list-row" key={lot.id}>
              <span>
                <strong>
                  {lot.item_name || lot.inventory_item_name || 'Inventory lot'}
                </strong>
                <small>
                  Expires {lot.expiry_date || lot.expires_at || 'soon'}
                </small>
              </span>
              <HposStatusBadge tone="warning">Review</HposStatusBadge>
            </div>
          ))}
          {!data.expiry.length && (
            <p className="hpos-control-copy">
              No inventory lots are due within the next 30 days.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function VarianceModal({ data, onClose, onNotice, onReload }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({
    itemId: '',
    quantity: '',
    expectedClosing: '',
    actualClosing: '',
    unit: 'bottle',
    reason: 'spill',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    window.api?.inventory
      ?.getItems?.()
      .then((rows) => setItems(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);
  const save = async (e) => {
    e.preventDefault();
    const measuredVariance =
      form.reason === 'pour_variance'
        ? Math.max(
            0,
            Number(form.expectedClosing || 0) - Number(form.actualClosing || 0),
          )
        : Math.abs(Number(form.quantity || 0));
    if (!form.itemId || !measuredVariance) return;
    setSaving(true);
    try {
      const result = await window.api.inventory.adjustStock(
        form.itemId,
        -measuredVariance,
        `${form.reason} (${form.unit}); expected close ${form.expectedClosing || 'n/a'}; actual close ${form.actualClosing || 'n/a'}; ${form.notes}`.trim(),
        null,
        crypto.randomUUID(),
      );
      if (result?.success === false)
        throw new Error(result.error || 'Could not record variance');
      onNotice(
        'Bar variance recorded through the inventory adjustment contract.',
      );
      onClose();
      await onReload();
    } catch (error) {
      onNotice(error.message || 'Could not record variance.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="hpos-modal-backdrop">
      <form className="hpos-control-modal" onSubmit={save}>
        <button type="button" className="hpos-modal-close" onClick={onClose}>
          <X size={18} />
        </button>
        <p className="hpos-eyebrow">Bar accountability</p>
        <h2>Record pour / waste variance</h2>
        <p className="hpos-control-copy">
          Use bottle equivalents for partial bottles (for example 0.25), keg
          units for draft stock, or millilitres when your inventory is measured
          that way. The movement is recorded with a reason and stable operation
          identifier.
        </p>
        <label>
          Inventory item
          <select
            required
            value={form.itemId}
            onChange={(e) => setForm({ ...form, itemId: e.target.value })}
          >
            <option value="">Choose bottle, keg or ingredient</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name || item.item_name}
              </option>
            ))}
          </select>
        </label>
        {form.reason === 'pour_variance' ? (
          <div className="hpos-modal-two">
            <label>
              Expected closing quantity
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={form.expectedClosing}
                onChange={(e) =>
                  setForm({ ...form, expectedClosing: e.target.value })
                }
              />
            </label>
            <label>
              Actual measured closing
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={form.actualClosing}
                onChange={(e) =>
                  setForm({ ...form, actualClosing: e.target.value })
                }
              />
            </label>
          </div>
        ) : (
          <div className="hpos-modal-two">
            <label>
              Quantity lost
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              />
            </label>
            <label>
              Measurement
              <select
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              >
                <option value="bottle">Bottle</option>
                <option value="partial_bottle">Partial bottle</option>
                <option value="keg">Keg</option>
                <option value="ml">Millilitres</option>
                <option value="unit">Unit</option>
              </select>
            </label>
          </div>
        )}
        <label>
          Reason
          <select
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          >
            <option value="spill">Spill / breakage</option>
            <option value="comp">Complimentary / staff drink</option>
            <option value="pour_variance">Measured-pour variance</option>
            <option value="expiry">Expiry / spoilage</option>
            <option value="count_adjustment">Physical count adjustment</option>
          </select>
        </label>
        <label>
          Notes
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Shift, bartender or incident reference"
          />
        </label>
        <button className="hpos-primary-action" disabled={saving}>
          {saving ? 'Recording…' : 'Record variance'}
        </button>
      </form>
    </div>
  );
}

function MenuMargin({ data, currency, metrics, barOnly }) {
  const recipesByMenu = new Map(
    (data.recipes || []).map((recipe) => [recipe.menu_item_id, recipe]),
  );
  const menuByName = new Map(
    (data.menu || []).map((item) => [item.name, item]),
  );
  return (
    <div className="hpos-control-section">
      <section className="hpos-control-card">
        <div className="hpos-section-title">
          <div>
            <p className="hpos-eyebrow">
              {barOnly ? 'Drink performance' : 'Menu engineering'}
            </p>
            <h2>
              {barOnly
                ? 'Product margin and sales contribution'
                : 'Popularity, cost and contribution'}
            </h2>
          </div>
          <HposStatusBadge tone="neutral">30 days</HposStatusBadge>
        </div>
        <p className="hpos-control-copy">
          {barOnly
            ? 'See which drinks and bar products drive revenue, which have weak margins, and where pricing or supplier costs need attention.'
            : 'Hero items earn attention and margin; review items sell but leave too little contribution. Recipe-linked costs include ingredient waste where available.'}
        </p>
        <div className="hpos-margin-table">
          <div className="hpos-margin-head">
            <span>Item</span>
            <span>Units</span>
            <span>Sales</span>
            <span>Margin</span>
          </div>
          {metrics.topItems.slice(0, 20).map((item, index) => {
            const menu = menuByName.get(item.name);
            const recipe = menu && recipesByMenu.get(menu.id);
            const cost = recipe
              ? (recipe.ingredients || []).reduce(
                  (sum, ing) =>
                    sum +
                    Number(ing.quantity || 0) *
                      Number(ing.unit_cost || 0) *
                      (1 +
                        Number(ing.wastage_pct || ing.waste_percent || 0) /
                          100),
                  0,
                )
              : Number(menu?.cost_price || 0);
            const margin = item.sales
              ? ((item.sales - cost * item.units) / item.sales) * 100
              : null;
            return (
              <div key={item.name}>
                <strong>
                  {index + 1}. {item.name}
                </strong>
                <span>{item.units}</span>
                <span>{money(item.sales, currency)}</span>
                <HposStatusBadge
                  tone={
                    margin == null
                      ? 'neutral'
                      : margin < 30
                        ? 'warning'
                        : 'success'
                  }
                >
                  {margin == null ? 'Cost missing' : `${margin.toFixed(0)}%`}
                </HposStatusBadge>
              </div>
            );
          })}
          {!metrics.topItems.length && (
            <HposEmptyState
              icon={BarChart3}
              title="No item sales yet"
              description={
                barOnly
                  ? 'Complete bar sales to build product intelligence.'
                  : 'Complete POS orders to build menu intelligence.'
              }
            />
          )}
        </div>
      </section>
    </div>
  );
}
function Labour({ data, currency, metrics, onReload, barOnly }) {
  const staff = {};
  data.orders.forEach((order) => {
    const name = order.cashier_name || order.waiter_name || 'Unassigned';
    staff[name] ??= { name, sales: 0, orders: 0 };
    staff[name].sales += Number(order.total || 0);
    staff[name].orders++;
  });
  const [form, setForm] = useState({
    staff_name: '',
    role: barOnly ? 'bartender' : 'waiter',
    shift_date: new Date().toISOString().slice(0, 10),
    start_time: '10:00',
    end_time: '18:00',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await window.api.pos.saveRestaurantShiftPlan(form);
      if (r?.success === false) throw new Error(r.error);
      setMessage('Shift plan saved.');
      setForm({ ...form, staff_name: '' });
      await onReload();
    } catch (error) {
      setMessage(error.message || 'Could not save shift plan.');
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id) => {
    try {
      const r = await window.api.pos.deleteRestaurantShiftPlan(id);
      if (r?.success === false) throw new Error(r.error);
      setMessage('Shift plan removed.');
      await onReload();
    } catch (error) {
      setMessage(error.message);
    }
  };
  return (
    <div className="hpos-control-section">
      <div className="hpos-control-kpis">
        {[
          [
            'Active shifts',
            data.shifts.filter((s) => !s.clock_out).length,
            Clock3,
          ],
          ['Planned shifts', data.plans.length, CalendarDays],
          ['People seen', Object.keys(staff).length, Users],
          [
            'Sales per order',
            money(
              metrics.orders ? metrics.sales / metrics.orders : 0,
              currency,
            ),
            DollarSign,
          ],
        ].map(([l, v, I]) => (
          <article key={l}>
            <I size={18} />
            <small>{l}</small>
            <strong>{v}</strong>
          </article>
        ))}
      </div>
      <div className="hpos-control-grid">
        <section className="hpos-control-card">
          <div className="hpos-section-title">
            <div>
              <p className="hpos-eyebrow">Labour planning</p>
              <h2>
                {barOnly
                  ? 'Schedule the next bar shift'
                  : 'Schedule the next service'}
              </h2>
            </div>
          </div>
          <form className="hpos-inline-form hpos-labour-form" onSubmit={save}>
            <input
              required
              placeholder="Staff name"
              value={form.staff_name}
              onChange={(e) => setForm({ ...form, staff_name: e.target.value })}
            />
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {!barOnly && <option value="waiter">Server</option>}
              <option value="bartender">Bartender</option>
              <option value="cashier">Cashier</option>
              {!barOnly && <option value="kitchen">Kitchen</option>}
              <option value="manager">Manager</option>
            </select>
            <input
              type="date"
              required
              value={form.shift_date}
              onChange={(e) => setForm({ ...form, shift_date: e.target.value })}
            />
            <input
              type="time"
              required
              value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            />
            <input
              type="time"
              required
              value={form.end_time}
              onChange={(e) => setForm({ ...form, end_time: e.target.value })}
            />
            <button className="hpos-primary-action" disabled={saving}>
              {saving ? 'Saving…' : 'Plan shift'}
            </button>
          </form>
          {message && <p className="hpos-control-copy">{message}</p>}
          {data.plans.slice(0, 12).map((plan) => (
            <div className="hpos-list-row" key={plan.id}>
              <span>
                <strong>
                  {plan.staff_name} · {plan.role}
                </strong>
                <small>
                  {plan.shift_date} · {String(plan.start_time).slice(0, 5)}–
                  {String(plan.end_time).slice(0, 5)}
                </small>
              </span>
              <button
                type="button"
                className="hpos-text-action"
                onClick={() => remove(plan.id)}
              >
                Remove
              </button>
            </div>
          ))}
          {!data.plans.length && (
            <p className="hpos-control-copy">
              No planned shifts in the next two weeks.
            </p>
          )}
        </section>
        <section className="hpos-control-card">
          <div className="hpos-section-title">
            <div>
              <p className="hpos-eyebrow">Labour versus sales</p>
              <h2>Coverage and accountability</h2>
            </div>
            <HposStatusBadge tone="neutral">30 days</HposStatusBadge>
          </div>
          <div className="hpos-margin-table">
            <div className="hpos-margin-head">
              <span>Operator</span>
              <span>Orders</span>
              <span>Sales</span>
              <span>Sales / order</span>
            </div>
            {Object.values(staff)
              .sort((a, b) => b.sales - a.sales)
              .map((row) => (
                <div key={row.name}>
                  <strong>{row.name}</strong>
                  <span>{row.orders}</span>
                  <span>{money(row.sales, currency)}</span>
                  <span>
                    {money(row.sales / Math.max(1, row.orders), currency)}
                  </span>
                </div>
              ))}
            {!Object.keys(staff).length && (
              <HposEmptyState
                icon={Users}
                title="No labour data yet"
                description="Open shifts and complete orders to build operator performance."
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
function Procurement({ data, currency, onNotice, onReload }) {
  const [selected, setSelected] = useState([]);
  const toggle = (i) =>
    setSelected((current) =>
      current.includes(i) ? current.filter((x) => x !== i) : [...current, i],
    );
  const total = selected.reduce(
    (sum, i) =>
      sum +
      Number(data.suggestions[i]?.suggested_quantity || 0) *
        Number(data.suggestions[i]?.last_unit_cost || 0),
    0,
  );
  const convert = async () => {
    const rows = selected.map((i) => data.suggestions[i]);
    const supplier = rows[0]?.supplier_id;
    if (!supplier) {
      onNotice('Select suggestions with a preferred supplier configured.');
      return;
    }
    if (rows.some((row) => row.supplier_id !== supplier)) {
      onNotice(
        'Create one purchase order per supplier. Remove items from other suppliers and try again.',
      );
      return;
    }
    try {
      const result = await window.api.pos.convertPurchaseSuggestionsToPo(
        supplier,
        rows,
        'Manager-approved reorder from Business Control',
      );
      if (result?.success === false) throw new Error(result.error);
      onNotice('Purchase order created from selected reorder suggestions.');
      setSelected([]);
      await onReload();
    } catch (e) {
      onNotice(e.message);
    }
  };
  return (
    <div className="hpos-control-section">
      <div className="hpos-control-kpis">
        {[
          ['Reorder suggestions', data.suggestions.length, PackageCheck],
          [
            'Suppliers',
            new Set(data.suggestions.map((s) => s.supplier_id).filter(Boolean))
              .size,
            Users,
          ],
          [
            'Open POs',
            data.purchaseOrders.filter(
              (p) => !['received', 'cancelled'].includes(p.status),
            ).length,
            ShoppingCart,
          ],
          ['Selected value', money(total, currency), DollarSign],
        ].map(([l, v, I]) => (
          <article key={l}>
            <I size={18} />
            <small>{l}</small>
            <strong>{v}</strong>
          </article>
        ))}
      </div>
      <section className="hpos-control-card">
        <div className="hpos-section-title">
          <div>
            <p className="hpos-eyebrow">Automated reorder</p>
            <h2>Supplier-ready purchase decisions</h2>
          </div>
          {selected.length > 0 && (
            <HposButton icon={ShoppingCart} onClick={convert}>
              Create PO ({selected.length})
            </HposButton>
          )}
        </div>
        {data.suggestions.map((row, index) => (
          <label className="hpos-list-row" key={row.id || index}>
            <input
              type="checkbox"
              checked={selected.includes(index)}
              onChange={() => toggle(index)}
            />
            <span>
              <strong>{row.inventory_item_name}</strong>
              <small>
                {row.supplier_name || 'No supplier'} · Current{' '}
                {Number(row.current_stock || 0).toFixed(1)} · Order{' '}
                {Number(row.suggested_quantity || 0).toFixed(1)}
              </small>
            </span>
            <b>
              {money(
                Number(row.suggested_quantity || 0) *
                  Number(row.last_unit_cost || 0),
                currency,
              )}
            </b>
          </label>
        ))}
        {!data.suggestions.length && (
          <HposEmptyState
            icon={PackageCheck}
            title="No reorder decisions"
            description="Inventory is above reorder levels or needs supplier setup."
          />
        )}
      </section>
    </div>
  );
}
function Revenue({ data, onNotice, onReload }) {
  const [form, setForm] = useState({
    name: '',
    discount_type: 'percent',
    discount_value: '',
    applies_to_category: '',
    starts_at: '',
    ends_at: '',
    minimum_spend: '',
    customer_segment: '',
    active: true,
  });
  const save = async (e) => {
    e.preventDefault();
    try {
      const r = await window.api.pos.savePromotion(form);
      if (r?.success === false) throw new Error(r.error);
      onNotice('Scheduled promotion saved to the server-backed catalog.');
      setForm({
        name: '',
        discount_type: 'percent',
        discount_value: '',
        applies_to_category: '',
        starts_at: '',
        ends_at: '',
        minimum_spend: '',
        customer_segment: '',
        active: true,
      });
      await onReload();
    } catch (error) {
      onNotice(error.message || 'Could not save promotion.');
    }
  };
  return (
    <div className="hpos-control-section">
      <section className="hpos-control-card">
        <div className="hpos-section-title">
          <div>
            <p className="hpos-eyebrow">Revenue tools</p>
            <h2>Promotions and offers</h2>
          </div>
          <HposStatusBadge
            tone={
              data.promotions.filter((p) => p.active !== false).length
                ? 'success'
                : 'neutral'
            }
          >
            {data.promotions.filter((p) => p.active !== false).length} active
          </HposStatusBadge>
        </div>
        <form className="hpos-inline-form hpos-promotion-form" onSubmit={save}>
          <input
            required
            placeholder="Promotion name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <select
            value={form.discount_type}
            onChange={(e) =>
              setForm({ ...form, discount_type: e.target.value })
            }
          >
            <option value="percent">Percent</option>
            <option value="amount">Amount</option>
          </select>
          <input
            required
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Value"
            value={form.discount_value}
            onChange={(e) =>
              setForm({ ...form, discount_value: e.target.value })
            }
          />
          <input
            placeholder="Category"
            value={form.applies_to_category}
            onChange={(e) =>
              setForm({ ...form, applies_to_category: e.target.value })
            }
          />
          <input
            type="datetime-local"
            aria-label="Starts"
            value={form.starts_at}
            onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
          />
          <input
            type="datetime-local"
            aria-label="Ends"
            value={form.ends_at}
            onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
          />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Min spend"
            value={form.minimum_spend}
            onChange={(e) =>
              setForm({ ...form, minimum_spend: e.target.value })
            }
          />
          <input
            placeholder="Customer segment"
            value={form.customer_segment}
            onChange={(e) =>
              setForm({ ...form, customer_segment: e.target.value })
            }
          />
          <button className="hpos-primary-action">
            <Plus size={16} /> Save scheduled offer
          </button>
        </form>
        <div className="hpos-mini-table">
          {data.promotions.map((p) => (
            <div key={p.id}>
              <strong>{p.name}</strong>
              <span>
                {p.discount_type === 'percent'
                  ? `${p.discount_value}% off`
                  : money(p.discount_value, '')}
                {p.starts_at
                  ? ` · from ${new Date(p.starts_at).toLocaleDateString('en-GB')}`
                  : ''}
              </span>
              <HposStatusBadge
                tone={p.active === false ? 'neutral' : 'success'}
              >
                {p.active === false ? 'Inactive' : 'Active'}
              </HposStatusBadge>
            </div>
          ))}
          {!data.promotions.length && (
            <p className="hpos-control-copy">No promotions configured yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
function GuestFlow({ data, onManage }) {
  return (
    <div className="hpos-control-section">
      <div className="hpos-control-kpis">
        {[
          ['Reservations', data.reservations.length, CalendarDays],
          ['Waitlist', data.waitlist.length, Users],
          ['Alerts', data.alerts.length, AlertTriangle],
          [
            'Open checks',
            data.orders.filter((o) => o.status === 'open').length,
            ClipboardList,
          ],
        ].map(([l, v, I]) => (
          <article key={l}>
            <I size={18} />
            <small>{l}</small>
            <strong>{v}</strong>
          </article>
        ))}
      </div>
      <section className="hpos-control-card">
        <div className="hpos-section-title">
          <div>
            <p className="hpos-eyebrow">Service flow</p>
            <h2>Reservations and waitlist</h2>
          </div>
          <HposStatusBadge
            tone={
              data.reservations.length || data.waitlist.length
                ? 'warning'
                : 'success'
            }
          >
            {data.reservations.length + data.waitlist.length} guests
          </HposStatusBadge>
          <HposButton icon={CalendarDays} onClick={onManage}>
            Manage guests
          </HposButton>
        </div>
        {data.reservations.slice(0, 10).map((row) => (
          <div className="hpos-list-row" key={row.id}>
            <span>
              <strong>
                {row.customer_name || row.guest_name || 'Reservation'}
              </strong>
              <small>
                {row.reservation_date || row.date || 'Date pending'} ·{' '}
                {row.party_size || row.guests || '—'} covers
              </small>
            </span>
            <HposStatusBadge tone="neutral">
              {row.status || 'Booked'}
            </HposStatusBadge>
          </div>
        ))}
        {!data.reservations.length && !data.waitlist.length && (
          <HposEmptyState
            icon={CalendarDays}
            title="No guest-flow work today"
            description="Reservations and waitlist entries will appear here when configured."
          />
        )}
      </section>
    </div>
  );
}
function ControlSafety({ data, onNotice, onReload }) {
  const [showIncident, setShowIncident] = useState(false);
  const voidsByOperator = data.voids.reduce((map, row) => {
    const key =
      row.cashier_name || row.staff_name || row.user_id || 'Unknown operator';
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {});
  const repeatedVoids = Object.entries(voidsByOperator).filter(
    ([, count]) => count >= 3,
  );
  const afterHours = data.audit.filter((row) => {
    const hour = row.created_at ? new Date(row.created_at).getHours() : 12;
    return hour < 5 || hour >= 23;
  });
  const riskSignals = repeatedVoids.length + afterHours.length;
  return (
    <div className="hpos-control-section">
      <div className="hpos-control-kpis">
        {[
          ['Active alerts', data.alerts.length, AlertTriangle],
          [
            'Open checklists',
            data.checklists.filter((x) => !x.is_completed).length,
            ClipboardList,
          ],
          ['Audit events', data.audit.length, ShieldAlert],
          ['Risk signals', riskSignals, ShieldAlert],
        ].map(([l, v, I]) => (
          <article key={l}>
            <I size={18} />
            <small>{l}</small>
            <strong>{v}</strong>
          </article>
        ))}
      </div>
      <div className="hpos-control-grid">
        <section className="hpos-control-card">
          <div className="hpos-section-title">
            <div>
              <p className="hpos-eyebrow">Manager control</p>
              <h2>Exceptions and approvals</h2>
            </div>
          </div>
          {data.alerts.slice(0, 8).map((row) => (
            <div className="hpos-list-row" key={row.id}>
              <span>
                <strong>
                  {row.title ||
                    row.message ||
                    row.alert_type ||
                    'Operational alert'}
                </strong>
                <small>
                  {row.created_at
                    ? new Date(row.created_at).toLocaleString('en-GB')
                    : 'Open alert'}
                </small>
              </span>
              <HposStatusBadge tone="warning">Review</HposStatusBadge>
            </div>
          ))}
          {!data.alerts.length && (
            <HposEmptyState
              icon={CheckCircle2}
              title="No active alerts"
              description="The current exception register is clear."
            />
          )}
          {repeatedVoids.map(([operator, count]) => (
            <div className="hpos-list-row" key={`void-risk-${operator}`}>
              <span>
                <strong>Repeated void pattern</strong>
                <small>
                  {operator} recorded {count} voids in the review period
                </small>
              </span>
              <HposStatusBadge tone="warning">Investigate</HposStatusBadge>
            </div>
          ))}
          {afterHours.slice(0, 5).map((row) => (
            <div className="hpos-list-row" key={`after-hours-${row.id}`}>
              <span>
                <strong>After-hours POS action</strong>
                <small>
                  {row.staff_name || 'Operator'} ·{' '}
                  {new Date(row.created_at).toLocaleString('en-GB')}
                </small>
              </span>
              <HposStatusBadge tone="warning">Review</HposStatusBadge>
            </div>
          ))}
        </section>
        <section className="hpos-control-card">
          <div className="hpos-section-title">
            <div>
              <p className="hpos-eyebrow">Safety and accountability</p>
              <h2>Incidents and audit</h2>
            </div>
            <HposButton icon={Plus} onClick={() => setShowIncident(true)}>
              Log incident
            </HposButton>
          </div>
          {data.incidents.slice(0, 5).map((row) => (
            <div className="hpos-list-row" key={row.id}>
              <span>
                <strong>{row.title || row.incident_type || 'Incident'}</strong>
                <small>
                  {row.status || 'Open'} ·{' '}
                  {row.created_at
                    ? new Date(row.created_at).toLocaleString('en-GB')
                    : ''}
                </small>
              </span>
              <HposStatusBadge
                tone={row.status === 'resolved' ? 'success' : 'warning'}
              >
                {row.status || 'Open'}
              </HposStatusBadge>
            </div>
          ))}
          {data.audit.slice(0, 5).map((row) => (
            <div className="hpos-list-row" key={`audit-${row.id}`}>
              <span>
                <strong>{row.action || row.entity_type || 'POS action'}</strong>
                <small>
                  {row.staff_name || 'Operator'} ·{' '}
                  {row.created_at
                    ? new Date(row.created_at).toLocaleString('en-GB')
                    : ''}
                </small>
              </span>
              <HposStatusBadge tone="neutral">Logged</HposStatusBadge>
            </div>
          ))}
          {!data.incidents.length && !data.audit.length && (
            <p className="hpos-control-copy">
              No incidents or audit events returned.
            </p>
          )}
        </section>
      </div>
      {showIncident && (
        <IncidentModal
          onClose={() => setShowIncident(false)}
          onNotice={onNotice}
          onReload={onReload}
        />
      )}
    </div>
  );
}

function IncidentModal({ onClose, onNotice, onReload }) {
  const [form, setForm] = useState({
    title: '',
    incident_type: 'safety',
    description: '',
    severity: 'medium',
  });
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await window.api.incidents.create(form);
      if (r?.success === false)
        throw new Error(r.error || 'Could not log incident');
      onNotice('Incident logged for manager follow-up.');
      onClose();
      await onReload();
    } catch (error) {
      onNotice(error.message || 'Could not log incident.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="hpos-modal-backdrop">
      <form className="hpos-control-modal" onSubmit={save}>
        <button type="button" className="hpos-modal-close" onClick={onClose}>
          <X size={18} />
        </button>
        <p className="hpos-eyebrow">Compliance and safety</p>
        <h2>Log incident</h2>
        <label>
          Title
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Short description"
          />
        </label>
        <label>
          Type
          <select
            value={form.incident_type}
            onChange={(e) =>
              setForm({ ...form, incident_type: e.target.value })
            }
          >
            <option value="safety">Safety</option>
            <option value="allergen">Allergen / dietary</option>
            <option value="service">Service</option>
            <option value="staff">Staff</option>
            <option value="security">Security</option>
          </select>
        </label>
        <label>
          Severity
          <select
            value={form.severity}
            onChange={(e) => setForm({ ...form, severity: e.target.value })}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label>
          Description
          <textarea
            rows="3"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <button className="hpos-primary-action" disabled={saving}>
          {saving ? 'Logging…' : 'Log incident'}
        </button>
      </form>
    </div>
  );
}
