import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'src/renderer/src/components/POS.jsx'), 'utf8')
const posDomain = fs.readFileSync(path.join(root, 'src/main/domains/pos.js'), 'utf8')
const favouritesBar = fs.readFileSync(path.join(root, 'src/renderer/src/components/pos/POSFavouritesBar.jsx'), 'utf8')
const cartLine = fs.readFileSync(path.join(root, 'src/renderer/src/components/pos/POSTerminalCartLine.jsx'), 'utf8')
const productCard = fs.readFileSync(path.join(root, 'src/renderer/src/components/pos/POSTerminalProductCard.jsx'), 'utf8')
const keyboardHelp = fs.readFileSync(path.join(root, 'src/renderer/src/components/pos/POSKeyboardHelp.jsx'), 'utf8')
const rpcMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260710150000_pos_menu_item_visual_cues_rpc.sql'), 'utf8')

// ── Favourites Contract Tests ────────────────────────────────────────────────

test('POS favourites: storage key, max limit, and state infrastructure', () => {
  assert.match(source, /POS_FAVOURITES_STORAGE_KEY/)
  assert.match(source, /POS_FAVOURITES_MAX = 30/)
  assert.match(source, /const \[favourites, setFavourites\] = useState/)
  assert.match(source, /const toggleFavourite/)
  assert.match(source, /const isFavourite/)
  assert.match(source, /const favouriteItems = useMemo/)
})

test('POS favourites are declared after their fallback-menu dependency', () => {
  assert.ok(
    source.indexOf('const fallbackBarMenuItems = useMemo') < source.indexOf('const favouriteItems = useMemo'),
    'favouriteItems must not reference fallbackBarMenuItems in the temporal dead zone'
  )
})

test('POS favourites: toggle adds and removes items, respects max', () => {
  assert.match(source, /prev\.includes\(itemId\)\) return prev\.filter/)
  assert.match(source, /prev\.length >= POS_FAVOURITES_MAX/)
  assert.match(source, /\[\.\.\.prev\.slice\(1\), itemId\]/)
})

test('POS favourites: persisted to localStorage', () => {
  assert.match(source, /localStorage\.setItem\(POS_FAVOURITES_STORAGE_KEY/)
})

test('POSFavouritesBar: renders pinned items with remove action', () => {
  assert.match(favouritesBar, /memo/)
  assert.match(favouritesBar, /favouriteItems/)
  assert.match(favouritesBar, /onToggleFavourite/)
  assert.match(favouritesBar, /pinned/)
  assert.match(favouritesBar, /Remove from favourites/)
})

test('POSFavouritesBar: renders nothing when no favourites', () => {
  assert.match(favouritesBar, /if \(favouriteItems\.length === 0\) return null/)
})

// ── Keyboard Shortcut Contract Tests ─────────────────────────────────────────

test('POS keyboard: infrastructure and state', () => {
  assert.match(source, /const \[selectedLineIdx, setSelectedLineIdx\] = useState/)
  assert.match(source, /const \[showKeyboardHelp, setShowKeyboardHelp\] = useState/)
  assert.match(source, /handleShortcut/)
})

test('POS keyboard: Ctrl+F focuses search', () => {
  assert.match(source, /Ctrl\+F/)
  assert.match(source, /menuSearchInputRef/)
})

test('POS keyboard: F2 cash, F3 card, F9 complete', () => {
  assert.match(source, /F2.*Cash payment/)
  assert.match(source, /F3.*Card payment/)
  assert.match(source, /F9.*Ctrl\+Enter.*Complete order/)
})

test('POS keyboard: Escape clears and returns focus', () => {
  assert.match(source, /Escape/)
  assert.match(source, /menuSearchInputRef\.current\?\.focus/)
})

test('POS keyboard: +/- increment/decrement, arrows navigate, Delete removes', () => {
  assert.match(source, /Increment selected line quantity/)
  assert.match(source, /Decrement selected line quantity/)
  assert.match(source, /ArrowUp/)
  assert.match(source, /ArrowDown/)
  assert.match(source, /Delete or Backspace/)
})

test('POSKeyboardHelp: renders overlay with shortcut table', () => {
  assert.match(keyboardHelp, /memo/)
  assert.match(keyboardHelp, /POSKeyboardHelp/)
  assert.match(keyboardHelp, /Ctrl\+F/)
  assert.match(keyboardHelp, /F2/)
  assert.match(keyboardHelp, /F3/)
  assert.match(keyboardHelp, /F9/)
})

// ── Compact Cart Contract Tests ──────────────────────────────────────────────

test('POS compact cart: threshold defined and compact badge shown', () => {
  assert.match(source, /POS_COMPACT_CART_THRESHOLD = 20/)
  assert.match(source, /Compact/)
})

test('POSTerminalCartLine: compact mode at threshold, mod button always visible', () => {
  assert.match(cartLine, /isCompact/)
  assert.match(cartLine, /POS_MOD_COMPACT_THRESHOLD/)
  assert.match(cartLine, /onOpenModifiers/)
  assert.match(cartLine, /Mods|Mod/)
})

test('POSTerminalCartLine: shows modifier chips and notes in compact mode', () => {
  assert.match(cartLine, /modifierNames/)
  assert.match(cartLine, /hasNotes/)
  assert.match(cartLine, /item_notes/)
})

test('POSTerminalCartLine: memoized and keyboard-selectable', () => {
  assert.match(cartLine, /memo/)
  assert.match(cartLine, /isSelected/)
  assert.match(cartLine, /onSelect/)
})

// ── Visual Cue Contract Tests ────────────────────────────────────────────────

test('POSTerminalProductCard: renders popular, dietary, prep time badges', () => {
  assert.match(productCard, /isPopular/)
  assert.match(productCard, /dietaryFlags/)
  assert.match(productCard, /prepTime/)
  assert.match(productCard, /Flame/)
  assert.match(productCard, /Leaf/)
  assert.match(productCard, /Clock/)
  assert.match(productCard, /Popular/)
  assert.match(productCard, /VG/)
  assert.match(productCard, /GF/)
})

test('POSTerminalProductCard: handles sold out and cross-outlet states', () => {
  assert.match(productCard, /soldOut/)
  assert.match(productCard, /crossOutlet/)
  assert.match(productCard, /Sold out/)
  assert.match(productCard, /cursor-not-allowed/)
})

test('POSTerminalProductCard: favourite toggle on card (no nested button)', () => {
  assert.match(productCard, /onToggleFavourite/)
  assert.match(productCard, /Star/)
  assert.match(productCard, /fill-amber/)
})

test('POSTerminalProductCard: shows inventory units when available', () => {
  assert.match(productCard, /availableUnits/)
  assert.match(productCard, /left/)
})

// ── Menu Form Contract Tests ─────────────────────────────────────────────────

test('POS menu form includes visual cue fields', () => {
  assert.match(source, /dietary_flags: \[\]/)
  assert.match(source, /prep_time_minutes: 0/)
  assert.match(source, /is_popular: false/)
})

test('POS menu form loads visual cues when editing', () => {
  assert.match(source, /dietary_flags: Array\.isArray\(item\.dietary_flags\)/)
  assert.match(source, /prep_time_minutes: item\.prep_time_minutes/)
  assert.match(source, /is_popular: item\.is_popular/)
})

test('POS menu form submits visual cues in payload', () => {
  assert.match(source, /\.\.\.menuForm,/)
})

// ── Service Mode Contract Tests ──────────────────────────────────────────────

test('POS service modes: restaurant includes delivery, non-restaurant includes room', () => {
  assert.match(source, /\['takeaway', 'table', 'delivery'\]/)
  assert.match(source, /\['takeaway', 'table', 'room'\]/)
})

test('POS delivery mode: address and notes fields rendered', () => {
  assert.match(source, /deliveryAddress/)
  assert.match(source, /deliveryNotes/)
  assert.match(source, /service_mode: serviceMode/)
  assert.match(source, /delivery_address: serviceMode === 'delivery'/)
  assert.match(source, /delivery_notes: serviceMode === 'delivery'/)
})

// ── Component Import Contract Tests ──────────────────────────────────────────

test('POS imports all split components', () => {
  assert.match(source, /import POSFavouritesBar from/)
  assert.match(source, /import POSTerminalCartLine from/)
  assert.match(source, /import POSTerminalProductCard from/)
  assert.match(source, /import POSKeyboardHelp from/)
})

test('POS uses POSTerminalProductCard in product grid', () => {
  assert.match(source, /<POSTerminalProductCard/)
  assert.match(source, /onAdd=\{addToOrder\}/)
  assert.match(source, /onToggleFavourite=\{toggleFavourite\}/)
})

test('POS uses POSTerminalCartLine in cart', () => {
  assert.match(source, /<POSTerminalCartLine/)
  assert.match(source, /onOpenModifiers=\{openModifierEditor\}/)
})

test('POS uses POSFavouritesBar above product grid', () => {
  assert.match(source, /<POSFavouritesBar/)
  assert.match(source, /favouriteItems=\{favouriteItems\}/)
})

// ── Source Structure Tests (preserved from original) ─────────────────────────

test('POS exposes a cashier-focused rush navigation', () => {
  assert.match(source, /canCloseCashup = canAccessCapability\(access, 'pos\.cashup'\)/)
  assert.match(source, /\['terminal', 'Terminal'\]/)
  assert.match(source, /\['tickets', 'Tickets'\]/)
  assert.match(source, /canManageMenu \? \[\['setup', 'Setup'\]\] : \[\]/)
})

test('POS keeps the common cash sale path collapsed and returns focus to search', () => {
  assert.match(source, /const \[showPaymentDetails, setShowPaymentDetails\] = useState\(false\)/)
  assert.match(source, /Complete & New Order/)
  assert.match(source, /menuSearchInputRef\.current\?\.focus\(\)/)
})

test('POS memoizes menu filtering and category grouping for repeated orders', () => {
  assert.match(source, /const filteredVisibleMenuItems = useMemo\(\(\) => visibleMenuItems\.filter/)
  assert.match(source, /const menuByCategory = useMemo\(\(\) => MENU_CATEGORIES\.reduce/)
})

test('POS live refresh avoids loading order history during terminal service', () => {
  assert.match(source, /refreshLivePosState = useCallback\(async \(\{ includeOrders = false \} = \{\}\)/)
  assert.match(source, /includeOrders: tab === 'history'/)
})

test('POS renders one control for duplicate outlet rows and gives virtual outlets stable keys', () => {
  assert.match(source, /function dedupeOutlets\(rows = \[\]\)/)
  assert.match(source, /const list = dedupeOutlets\(d \|\| \[\]\)/)
  assert.match(source, /key=\{o\.id \|\| `\$\{o\.type\}:\$\{o\.name\}`\}/)
  assert.match(posDomain, /A stale local cache must not create duplicate Kitchen\/Bar choices/)
})

test('POS bounds a long menu to the active category with an explicit show-more action', () => {
  assert.match(source, /const POS_MENU_PAGE_SIZE = 72/)
  assert.match(source, /const visibleTerminalCategories = \[activeTerminalCategory\]/)
  assert.match(source, /const items = allItems\.slice\(0, menuDisplayLimit\)/)
  assert.match(source, /Show \{Math\.min\(POS_MENU_PAGE_SIZE, allItems\.length - items\.length\)\} more products/)
})

// ── Visual Cue Pipeline Integration Tests ────────────────────────────────────

test('Migration RPC retains SECURITY DEFINER and lodge-role guard on create', () => {
  assert.match(rpcMigration, /create or replace function public\.create_pos_menu_item/)
  assert.match(rpcMigration, /security definer/)
  assert.match(rpcMigration, /set search_path to 'public'/)
  assert.match(rpcMigration, /perform public\.app_require_lodge_role\(v_lodge_id, array\['manager', 'admin', 'super_admin'\]\)/)
  assert.match(rpcMigration, /perform public\.app_require_pos_outlet_access\(v_lodge_id, v_outlet_id\)/)
})

test('Migration RPC retains SECURITY DEFINER and lodge-role guard on update', () => {
  assert.match(rpcMigration, /create or replace function public\.update_pos_menu_item/)
  assert.match(rpcMigration, /security definer/)
  assert.match(rpcMigration, /set search_path to 'public'/)
  assert.match(rpcMigration, /perform public\.app_require_lodge_role\(p_lodge_id, array\['manager', 'admin', 'super_admin'\]\)/)
  assert.match(rpcMigration, /perform public\.app_require_pos_outlet_access\(p_lodge_id, v_outlet_id\)/)
})

test('Migration create RPC writes dietary_flags, prep_time_minutes, is_popular', () => {
  assert.match(rpcMigration, /dietary_flags, prep_time_minutes, is_popular/)
  assert.match(rpcMigration, /coalesce\(payload->'dietary_flags', '\[\]'::jsonb\)/)
  assert.match(rpcMigration, /coalesce\(\(payload->>'prep_time_minutes'\)::integer, 0\)/)
  assert.match(rpcMigration, /coalesce\(\(payload->>'is_popular'\)::boolean, false\)/)
})

test('Migration update RPC writes dietary_flags, prep_time_minutes, is_popular', () => {
  assert.match(rpcMigration, /dietary_flags = case when payload \? 'dietary_flags' then coalesce\(payload->'dietary_flags'/)
  assert.match(rpcMigration, /prep_time_minutes = case when payload \? 'prep_time_minutes' then coalesce\(\(payload->>'prep_time_minutes'\)::integer/)
  assert.match(rpcMigration, /is_popular = case when payload \? 'is_popular' then coalesce\(\(payload->>'is_popular'\)::boolean/)
})

test('pos.js createPosMenuItem includes visual cue fields in RPC payload', () => {
  assert.match(posDomain, /dietary_flags: Array\.isArray\(data\.dietary_flags\) \? data\.dietary_flags : \[\]/)
  assert.match(posDomain, /prep_time_minutes: Number\(data\.prep_time_minutes\) \|\| 0/)
  assert.match(posDomain, /is_popular: data\.is_popular === true/)
})

test('pos.js updatePosMenuItem includes visual cue fields in RPC payload', () => {
  assert.match(posDomain, /dietary_flags: Array\.isArray\(data\.dietary_flags\) \? data\.dietary_flags : \[\]/)
  assert.match(posDomain, /prep_time_minutes: Number\(data\.prep_time_minutes\) \|\| 0/)
  assert.match(posDomain, /is_popular: data\.is_popular === true/)
})

test('pos.js _getPosMenuItems selects visual cue columns from database', () => {
  assert.match(posDomain, /select\('id, name, category, price, is_available, barcode, inventory_item_id, depletion_qty, outlet_id, template_kind, lodge_id, created_at, updated_at, dietary_flags, prep_time_minutes, is_popular, kitchen_station_id'\)/)
})

test('Full pipeline: form state -> pos.js payload -> RPC column -> POS read back', () => {
  // 1. Form state has the fields
  assert.match(source, /dietary_flags: \[\]/)
  assert.match(source, /prep_time_minutes: 0/)
  assert.match(source, /is_popular: false/)

  // 2. pos.js create includes them
  assert.match(posDomain, /dietary_flags: Array\.isArray\(data\.dietary_flags\)/)
  assert.match(posDomain, /prep_time_minutes: Number\(data\.prep_time_minutes\)/)
  assert.match(posDomain, /is_popular: data\.is_popular === true/)

  // 3. RPC INSERT writes them to the table
  assert.match(rpcMigration, /dietary_flags, prep_time_minutes, is_popular/)
  assert.match(rpcMigration, /coalesce\(payload->'dietary_flags'/)

  // 4. RPC UPDATE writes them to the table
  assert.match(rpcMigration, /dietary_flags = case when payload \? 'dietary_flags'/)

  // 5. pos.js read selects them back
  assert.match(posDomain, /dietary_flags, prep_time_minutes, is_popular/)

  // 6. POS.jsx product card renders them
  assert.match(source, /isPopular=\{item\.is_popular/)
  assert.match(source, /dietaryFlags=\{Array\.isArray\(item\.dietary_flags\)/)
  assert.match(source, /prepTime=\{Number\(item\.prep_time_minutes/)
})
