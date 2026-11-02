// @ts-check
import { useState, useEffect, useRef, useCallback, useContext, lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router'
import { BellRing, ChevronDown, ChevronUp, Download, FileText, RefreshCw, RotateCcw, X } from 'lucide-react'
import { APP_FEATURES, FEATURE_LABELS, buildCapabilitySnapshot, canAccessCapability, isPosFullAccessRole } from '../../shared/accessControl'
import { SUPPORT_EMAIL } from '../../shared/publicEndpoints'
import { TrainingFrame, TrainingSetup } from './components/hospitality-pos/BarTraining.jsx'
import { SUBSCRIPTION_PLAN_ORDER, getFeatureRequiredPlan, normalizeSubscriptionPlan } from '../../shared/subscriptionPlans'
import { getCommercialPackageCatalog, getCommercialPackageLabel } from '../../shared/commercialPackages'
import { getCommercialAddonOffers, isCommercialSelectionEligible } from '../../shared/commercialEntitlements.js'
import { getCommercialFeatureOverride, getCommercialFeatureSet, isCommercialFeatureIncluded } from '../../shared/commercialAccess.js'
import { getModuleByKey } from '../../shared/moduleCatalog.js'
import { isBarOnlyMode, isRestaurantOnly } from '../../shared/propertyTypes'
import { isBarOnlyBlockedPath, normalizeAppPath } from '../../shared/barModeProfile'
import {
  getProductDefinition,
  getRuntimeProductId,
  isProductRouteAllowed
} from '../../shared/productIdentity'
import { HOTEL_CHROME } from './components/hotel/hotelChrome'
import AppErrorBoundary from './components/AppErrorBoundary'
import { ToastProvider } from './components/shared/Toast'
import { Modal } from './components/shared/Modal'
import { extractReleaseHighlights, formatReleaseDate, toReleaseSections } from './utils/updatePresentation'
import { applyThemeMode, getStoredThemeMode } from './utils/themeMode'
import { boundedSetupRead, classifyBarSetupStatus } from './utils/barSetupStatus.js'
import { productLogoColor, productLogoLight } from './assets/productLogos'
import { CustomerDisplay, PrepDisplay } from './components/POSDisplays'
import {
  AuthContext,
  SettingsContext,
  ProfilesContext,
  FeaturesContext,
  AccessContext,
  OnlineRequestsContext,
  UnsavedChangesContext,
  useAuth,
  useProfiles
} from './app-context'
import { UpgradeShowcase } from './components/shared/EntitlementPresentation'

// ── Lazy — split into separate chunks, loaded on first visit ──────────────────
const Welcome     = lazy(() => import('./components/Welcome'))
const Login       = lazy(() => import('./components/Login'))
const Layout      = lazy(() => import('./components/Layout'))
const HotelLayout = lazy(() => import('./components/hotel/HotelLayout'))
const HotelHome   = lazy(() => import('./components/hotel/HotelHome'))
const Dashboard   = lazy(() => import('./components/Dashboard'))
const Rooms       = lazy(() => import('./components/Rooms'))
const Bookings    = lazy(() => import('./components/Bookings'))
const Setup       = lazy(() => import('./components/Setup'))
const MasterSetup = lazy(() => import('./components/MasterSetup'))
const LodgeChooser = lazy(() => import('./components/LodgeChooser'))
const Calendar    = lazy(() => import('./components/Calendar'))
const Reports     = lazy(() => import('./components/Reports'))
const BasicReports = lazy(() => import('./components/BasicReports'))
const StarterBackup = lazy(() => import('./components/StarterBackup'))
const Staff       = lazy(() => import('./components/Staff'))
const Settings    = lazy(() => import('./components/Settings'))
const RoomGrid    = lazy(() => import('./components/RoomGrid'))
const Guests      = lazy(() => import('./components/Guests'))
const Housekeeping = lazy(() => import('./components/Housekeeping'))
const Expenses    = lazy(() => import('./components/Expenses'))
const Maintenance = lazy(() => import('./components/Maintenance'))
const POS         = lazy(() => import('./components/POS'))
const Inventory   = lazy(() => import('./components/Inventory'))
const RoomSupplies = lazy(() => import('./components/RoomSupplies'))
const NightAudit  = lazy(() => import('./components/NightAudit'))
const NightAuditEnterprise = lazy(() => import('./components/NightAuditEnterprise'))
const AdminCentral = lazy(() => import('./components/AdminCentral'))
const Conference  = lazy(() => import('./components/Conference'))
const DayUse      = lazy(() => import('./components/DayUse'))
const DataManagement = lazy(() => import('./components/DataManagement'))
const Quotations     = lazy(() => import('./components/Quotations'))
const BookingInvoices = lazy(() => import('./components/BookingInvoices'))
const Prepayments = lazy(() => import('./components/Prepayments'))
const OpsAi = lazy(() => import('./components/OpsAi'))
const HotelDashboard = lazy(() => import('./components/HotelDashboard'))
const RoomTypes = lazy(() => import('./components/RoomTypes'))
const FloorsSections = lazy(() => import('./components/FloorsSections'))
const HotelKpis = lazy(() => import('./components/HotelKpis'))
const Folios = lazy(() => import('./components/Folios'))
const EnterpriseAddonPlaceholder = lazy(() => import('./components/EnterpriseAddonPlaceholder'))
const AdvancedHousekeeping = lazy(() => import('./components/AdvancedHousekeeping'))
const CorporateAccounts = lazy(() => import('./components/CorporateAccounts'))
const RatePlans = lazy(() => import('./components/RatePlans'))
const RoomMoves = lazy(() => import('./components/RoomMoves'))
const SubscriptionPackageBuilder = lazy(() => import('./components/SubscriptionPackageBuilder'))
const EnterpriseWorkflowWorkspace = lazy(() => import('./components/EnterpriseWorkflowWorkspace'))
const ChannelManager = lazy(() => import('./components/ChannelManager'))
const GuestMessaging = lazy(() => import('./components/GuestMessaging'))
const GuestPortalConfig = lazy(() => import('./components/GuestPortalConfig'))
const MultiPropertyDashboard = lazy(() => import('./components/MultiPropertyDashboard'))
const RevenueManager = lazy(() => import('./components/RevenueManager'))
const AdvancedReports = lazy(() => import('./components/AdvancedReports'))
const GuestCRM = lazy(() => import('./components/GuestCRM'))
const OperationsCompliance = lazy(() => import('./components/OperationsCompliance'))
const MultiOutletPos = lazy(() => import('./components/MultiOutletPos'))
const RoomAttributes = lazy(() => import('./components/RoomAttributes'))
const CorporateBilling = lazy(() => import('./components/CorporateBilling'))
const HotelRolesConfig = lazy(() => import('./components/HotelRolesConfig'))
const CheckinWorkflow = lazy(() => import('./components/CheckinWorkflow'))
const EarlyLateCheckout = lazy(() => import('./components/EarlyLateCheckout'))
const CancellationPolicies = lazy(() => import('./components/CancellationPolicies'))
const BookingEngine = lazy(() => import('./components/BookingEngine'))
const RateCalendar = lazy(() => import('./components/RateCalendar'))
const HousekeepingCommandCenter = lazy(() => import('./components/HousekeepingCommandCenter'))
const MaintenanceEnterprise = lazy(() => import('./components/MaintenanceEnterprise'))
const GroupOperations = lazy(() => import('./components/GroupOperations'))
const PaymentGatewayConfig = lazy(() => import('./components/PaymentGatewayConfig'))
const PromoCodes = lazy(() => import('./components/PromoCodes'))

// ── Restaurant standalone modules ─────────────────────────────────────────────
const RestaurantTables = lazy(() => import('./components/restaurant/RestaurantTables'))
const RestaurantKitchen = lazy(() => import('./components/restaurant/RestaurantKitchen'))
const RestaurantMenu = lazy(() => import('./components/restaurant/RestaurantMenu'))
const RestaurantRecipes = lazy(() => import('./components/restaurant/RestaurantRecipes'))
const RestaurantStock = lazy(() => import('./components/restaurant/RestaurantStock'))
const RestaurantPurchasing = lazy(() => import('./components/restaurant/RestaurantPurchasing'))
const RestaurantShifts = lazy(() => import('./components/restaurant/RestaurantShifts'))
const RestaurantCashDrawer = lazy(() => import('./components/restaurant/RestaurantCashDrawer'))
const RestaurantDailyClose = lazy(() => import('./components/restaurant/RestaurantDailyClose'))
const RestaurantCustomers = lazy(() => import('./components/restaurant/RestaurantCustomers'))
const RestaurantChecklists = lazy(() => import('./components/restaurant/RestaurantChecklists'))
const RestaurantAlerts = lazy(() => import('./components/restaurant/RestaurantAlerts'))
const RestaurantOwnerDigest = lazy(() => import('./components/restaurant/RestaurantOwnerDigest'))

// ── Phase 6: Restaurant Differentiators ──────────────────────────────────────
const RestaurantReservations = lazy(() => import('./components/restaurant/RestaurantReservations'))
const RestaurantCombos = lazy(() => import('./components/restaurant/RestaurantCombos'))
const RestaurantRecipeVariance = lazy(() => import('./components/restaurant/RestaurantRecipeVariance'))
const RestaurantStaffPerformance = lazy(() => import('./components/restaurant/RestaurantStaffPerformance'))
const RestaurantPrepBatches = lazy(() => import('./components/restaurant/RestaurantPrepBatches'))
const RestaurantKitchenAnalytics = lazy(() => import('./components/restaurant/RestaurantKitchenAnalytics'))
const RestaurantPurchaseSuggestions = lazy(() => import('./components/restaurant/RestaurantPurchaseSuggestions'))
const RestaurantGrowthControls = lazy(() => import('./components/restaurant/RestaurantGrowthControls'))
const RestaurantWorkspace = lazy(() => import('./components/restaurant/RestaurantWorkspace'))
const LodgeFoodBeverageHub = lazy(() => import('./components/LodgeFoodBeverageHub'))

// ── Restaurant Accounting (Finance module) ────────────────────────────────────
const RestaurantChartOfAccounts = lazy(() => import('./components/restaurant-accounting/RestaurantChartOfAccounts'))
const RestaurantGeneralLedger = lazy(() => import('./components/restaurant-accounting/RestaurantGeneralLedger'))
const RestaurantBankReconciliation = lazy(() => import('./components/restaurant-accounting/RestaurantBankReconciliation'))
const RestaurantAccountsPayable = lazy(() => import('./components/restaurant-accounting/RestaurantAccountsPayable'))
const RestaurantTaxReturns = lazy(() => import('./components/restaurant-accounting/RestaurantTaxReturns'))
const RestaurantBudgets = lazy(() => import('./components/restaurant-accounting/RestaurantBudgets'))
const RestaurantBalanceSheet = lazy(() => import('./components/restaurant-accounting/RestaurantBalanceSheet'))
const RestaurantPayroll = lazy(() => import('./components/restaurant-accounting/RestaurantPayroll'))
const RestaurantAccountingActivation = lazy(() => import('./components/restaurant-accounting/RestaurantAccountingActivation'))

// ── Restaurant & Bar POS UI ───────────────────────────────────────────────────
const HposLayout       = lazy(() => import('./components/hospitality-pos/HposLayout'))
const HposFloorPlan    = lazy(() => import('./components/hospitality-pos/HposFloorPlan'))
const HposServiceReservations = lazy(() => import('./components/hospitality-pos/HposServiceReservations'))
const HposKitchen      = lazy(() => import('./components/hospitality-pos/HposKitchen'))
const HposMenu         = lazy(() => import('./components/hospitality-pos/HposMenu'))
const HposStock        = lazy(() => import('./components/hospitality-pos/HposStock'))
const HposTeam         = lazy(() => import('./components/hospitality-pos/HposTeam'))
const HposCashClose    = lazy(() => import('./components/hospitality-pos/HposCashClose'))
const HposCustomers    = lazy(() => import('./components/hospitality-pos/HposCustomers'))
const HposControl      = lazy(() => import('./components/hospitality-pos/HposControl'))
const HposTerminal     = lazy(() => import('./components/hospitality-pos/HposTerminal'))
const HposMyShift      = lazy(() => import('./components/hospitality-pos/HposMyShift'))
const HposMyCashup     = lazy(() => import('./components/hospitality-pos/HposMyCashup'))
const HposAttendanceKiosk = lazy(() => import('./components/hospitality-pos/HposAttendanceKiosk'))
const HposSharedCashup = lazy(() => import('./components/hospitality-pos/HposSharedCashup'))
const HposSharedShiftClose = lazy(() => import('./components/hospitality-pos/HposSharedShiftClose'))
const HposOpenChecks   = lazy(() => import('./components/hospitality-pos/HposOpenChecks'))
const HposSystemHealth = lazy(() => import('./components/hospitality-pos/HposSystemHealth'))
const HposBusinessControl = lazy(() => import('./components/hospitality-pos/HposBusinessControl'))
const StaffOperations = lazy(() => import('./components/hotel/StaffOperations'))
const AssetManagement = lazy(() => import('./components/hotel/AssetManagement'))
const VenueManagement = lazy(() => import('./components/hotel/VenueManagement'))
const HposReports      = lazy(() => import('./components/hospitality-pos/HposReports'))
const HposMySales      = lazy(() => import('./components/hospitality-pos/HposMySales'))
const HposExpenses     = lazy(() => import('./components/hospitality-pos/HposExpenses'))
const HposManageHub    = lazy(() => import('./components/hospitality-pos/HposManageHub'))
const HposSetupReadiness = lazy(() => import('./components/hospitality-pos/HposSetupReadiness'))
const BarLocalWorkspace = lazy(() => import('./components/hospitality-pos/BarLocalWorkspace'))

// ── Loading fallback for lazy routes ─────────────────────────────────────────
function PageLoader() {
  const productId = getRuntimeProductId()
  const accent = productId === 'hospitality-pos' ? '#c95635' : productId === 'hotel' ? '#b8734a' : '#174c3a'
  const ink = productId === 'hospitality-pos' ? '#7a2e1c' : productId === 'hotel' ? '#1f1814' : '#163229'
  const productName = getProductDefinition(productId).brandName
  return (
    <div className="flex min-h-[400px] h-full items-center justify-center p-6">
      <div className="bb-card flex min-w-[220px] flex-col items-center gap-4 px-8 py-7 text-center">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: accent, borderTopColor: 'transparent' }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: ink }}>Loading workspace</p>
          <p className="mt-1 text-xs text-[#6e857d]">Preparing {productName} for this screen.</p>
        </div>
      </div>
    </div>
  )
}

// Thin wrapper so each lazy route element reads cleanly
/** @param {{children: import('react').ReactNode}} props */
function Lazy({ children }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

// { pos: true, inventory: true, ... }
const INPUT_FOCUS_DEBUG = false
const DEFAULT_TRIAL_STATUS = { status: 'trial', daysLeft: 30, expired: false }
const USER_SCOPE_KEY = 'bb_user_scope'

/** @param {EventTarget | null} target */
function isEditableFieldTarget(target) {
  if (!(target instanceof Element)) return false
  const editable = target.closest('input, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable]')
  if (!(editable instanceof HTMLElement)) return false
  if ('disabled' in editable && editable.disabled) return false
  if ('readOnly' in editable && editable.readOnly) return false
  return true
}

const BUILD_PRODUCT = getProductDefinition(getRuntimeProductId())
const IS_HOTEL_PRODUCT = BUILD_PRODUCT.id === 'hotel'
const IS_HPOS_PRODUCT = BUILD_PRODUCT.id === 'hospitality-pos'
const IS_LODGE_PRODUCT = BUILD_PRODUCT.id === 'lodge-camp'
// Window/chrome accent per product so the taskbar, theme-color meta, and
// loading surfaces never share LodgingOS green across products.
const PRODUCT_THEME_COLORS = Object.freeze({
  'lodge-camp': '#0f3d2c',
  hotel: '#1a1512',
  'hospitality-pos': '#2f222a'
})

// ── Upgrade Wall ───────────────────────────────────────────────────────────────
/** @param {{feature: string, children: import('react').ReactNode}} props */
function UpgradeWall({ feature, children }) {
  const features = useContext(FeaturesContext)
  const access = useContext(AccessContext)
  const location = useLocation()
  const commercialPackageKey = access?.entitlement?.commercial_package_key || null
  const commercialAddonKeys = access?.entitlement?.enterprise_addons || []
  const commercialLodgeId = access?.entitlement?.lodge_id || null
  const commercialBlocked = IS_HPOS_PRODUCT && commercialPackageKey
    ? !isCommercialFeatureIncluded(BUILD_PRODUCT.id, commercialPackageKey, feature, commercialAddonKeys, access?.entitlement, commercialLodgeId)
    : false

  // Only block when flags have been loaded AND this feature is explicitly false
  if ((Object.keys(features).length > 0 && features[feature] === false) || commercialBlocked) {
    // The module catalogue is the richer source of page metadata. Keep the
    // feature fallback for legacy/restaurant flags that do not have a module
    // row yet.
    const catalogModule = getModuleByKey(feature)
    const requiredTier = catalogModule?.requiredPlan || getFeatureRequiredPlan(feature)
    const requiredCommercialPackage = commercialBlocked
      ? getCommercialPackageCatalog(BUILD_PRODUCT.id).find((candidate) => (
          isCommercialFeatureIncluded(BUILD_PRODUCT.id, candidate.commercialPackageKey, feature, commercialAddonKeys)
        ))
      : null
    return (
      <UpgradeShowcase
        feature={feature}
        requiredPlan={requiredTier}
        requiredPackage={requiredCommercialPackage}
        currentPlan={access?.entitlement?.plan || 'Starter'}
        productId={BUILD_PRODUCT.id}
        module={catalogModule}
        routePath={location.pathname}
      />
    )
  }
  return children
}

/**
 * Hard product boundary: foreign modules may still exist in the shared bundle,
 * but this product binary will not navigate into routes outside its allowlist.
 * Lodge allowlist remains full so live Lodge behaviour is unchanged.
 */
/** @param {{children: import('react').ReactNode}} props */
function ProductShellGuard({ children }) {
  const location = useLocation()
  if (!isProductRouteAllowed(location.pathname, BUILD_PRODUCT.id)) {
    return <Navigate to={BUILD_PRODUCT.defaultHome || '/'} replace />
  }
  return children
}

// ── Layout Switcher ──────────────────────────────────────────────────────────
// Hotel product = HotelLayout (independent PMS shell).
// Restaurant product / restaurant property = HposLayout.
// Lodge product = live Layout (frozen).
function HposAwareLayout() {
  const { settings } = useContext(SettingsContext)
  const propertyType = settings?.property_type || settings?.business_type || 'lodge'
  if (IS_HOTEL_PRODUCT) {
    return <Lazy><HotelLayout /></Lazy>
  }
  if (IS_HPOS_PRODUCT || isRestaurantOnly(propertyType)) {
    return <Lazy><HposLayout /></Lazy>
  }
  return <Lazy><Layout /></Lazy>
}

function ProductHome() {
  if (IS_HOTEL_PRODUCT) return <Lazy><HotelHome /></Lazy>
  if (IS_HPOS_PRODUCT) return <Navigate to="/hpos/pos" replace />
  return <Lazy><Dashboard /></Lazy>
}

function RestaurantPosEntry() {
  const { settings } = useContext(SettingsContext)
  const propertyType = settings?.property_type || settings?.business_type || 'lodge'
  return isRestaurantOnly(propertyType)
    ? <Lazy><HposTerminal /></Lazy>
    : <Lazy><POS /></Lazy>
}

function RestaurantReportsEntry() {
  const { settings } = useContext(SettingsContext)
  return isRestaurantOnly(settings?.property_type || settings?.business_type || 'lodge') ? <Lazy><HposReports /></Lazy> : <Lazy><Reports /></Lazy>
}

function RestaurantExpensesEntry() {
  const { settings } = useContext(SettingsContext)
  return isRestaurantOnly(settings?.property_type || settings?.business_type || 'lodge') ? <Lazy><HposExpenses /></Lazy> : <Lazy><Expenses /></Lazy>
}

// ── Restaurant Route Guard ────────────────────────────────────────────────────
const RESTAURANT_EXCLUDED_PATHS = [
  '/bookings', '/rooms', '/guests', '/housekeeping', '/maintenance',
  '/calendar', '/roomgrid', '/conference', '/dayuse', '/quotations',
  '/invoices', '/prepayments', '/folios', '/corporate', '/rate-plans',
  '/room-moves', '/channel-manager', '/guest-messaging', '/guest-portal',
  '/multi-property', '/guest-crm', '/operations-compliance', '/group-operations',
  '/hotel-dashboard', '/room-types', '/floors', '/room-attributes',
  '/hotel-reports', '/enterprise-reports', '/advanced-housekeeping',
  '/housekeeping-command-center', '/maintenance-enterprise', '/hotel-roles',
  '/corporate-billing', '/rate-calendar', '/revenue-manager', '/promo-codes',
  '/checkin-workflow', '/early-late-checkout', '/cancellation-policies',
  '/documents', '/payment-links', '/booking-engine', '/night-audit-enterprise',
  '/payment-gateway-config', '/subscription-builder', '/custom-website',
  '/supplies'
]

/**
 * Blocks bar_only operators from restaurant kitchen/floor/production surfaces.
 * Used under the main layout and on sibling display routes (e.g. kitchen-display)
 * that sit outside RestaurantGuard.
 */
/** @param {{children: import('react').ReactNode, redirectTo?: string}} props */
function BarOnlyBlockedRedirect({ children, redirectTo = '/hpos/pos' }) {
  const { settings } = useContext(SettingsContext)
  const access = useContext(AccessContext)
  const propertyType = settings?.property_type || settings?.business_type || 'lodge'
  const barOnlyMode = isRestaurantOnly(propertyType) && isBarOnlyMode(settings)
  // Router-owned location: reading the URL hash during render misses
  // HashRouter updates and can fight the layout effect. Single source is the
  // guard's declarative <Navigate/> (the HposLayout imperative redirect was
  // removed); this hook re-renders on every navigation.
  const routerLocation = useLocation()
  const appPath = normalizeAppPath(routerLocation.pathname || '/')

  const enabledFeatures = getCommercialFeatureSet(
    access?.entitlement?.product_id || BUILD_PRODUCT.id,
    access?.entitlement?.commercial_package_key,
    access?.entitlement?.enterprise_addons || [],
    access?.entitlement,
    access?.entitlement?.lodge_id || null
  )
  if (barOnlyMode && isBarOnlyBlockedPath(appPath, enabledFeatures)) {
    return <Navigate to={redirectTo} replace />
  }
  return children
}

/** @param {{children: import('react').ReactNode}} props */
function RestaurantGuard({ children }) {
  const { settings } = useContext(SettingsContext)
  const propertyType = settings?.property_type || settings?.business_type || 'lodge'
  const restaurantMode = isRestaurantOnly(propertyType)
  const routerLocation = useLocation()
  const appPath = normalizeAppPath(routerLocation.pathname || '/')

  if (restaurantMode && RESTAURANT_EXCLUDED_PATHS.some(path => appPath.startsWith(path))) {
    return <Navigate to="/" replace />
  }

  // Bar Only blocks restaurant kitchen/floor/production and matching HPOS routes.
  return <BarOnlyBlockedRedirect>{children}</BarOnlyBlockedRedirect>
}

// ── Restaurant-Only Route Guard ────────────────────────────────────────────────
/** @param {{children: import('react').ReactNode}} props */
function RestaurantOnlyRoute({ children }) {
  const { settings } = useContext(SettingsContext)
  const propertyType = settings?.property_type || settings?.business_type || 'lodge'
  if (!isRestaurantOnly(propertyType)) return <Navigate to="/" replace />
  return children
}

/** @param {{feature: string, children: import('react').ReactNode}} props */
function BarAddonFeatureRoute({ feature, children }) {
  const { settings } = useContext(SettingsContext)
  if (!isBarOnlyMode(settings)) return children
  return <UpgradeWall feature={feature}>{children}</UpgradeWall>
}

/** @param {{payroll?: boolean, children: import('react').ReactNode}} props */
function RestaurantAccountingRoute({ payroll = false, children }) {
  const access = useContext(AccessContext)
  const capability = payroll ? 'accounting.payroll_view' : 'accounting.read'
  if (!canAccessCapability(access, capability)) {
    return <div data-testid="role-permission-denial" data-lock-reason="role" className="flex min-h-[420px] items-center justify-center p-8"><div className="max-w-lg rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center"><h1 className="text-2xl font-bold text-rose-950">Accounting role permission required</h1><p className="mt-3 text-sm leading-6 text-rose-800">{payroll ? 'Private payroll access is assigned separately from general Accounting.' : 'Your role does not include Restaurant Accounting read access.'} A package upgrade will not change role permissions.</p></div></div>
  }
  return <UpgradeWall feature="restaurant_accounting">{children}</UpgradeWall>
}

/** @param {{capability: string, children: import('react').ReactNode}} props */
function CapabilityRoute({ capability, children }) {
  const access = useContext(AccessContext)
  if (!canAccessCapability(access, capability)) {
    return <div data-testid="role-permission-denial" data-lock-reason="role" className="flex min-h-[420px] items-center justify-center p-8"><div className="max-w-lg rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center"><h1 className="text-2xl font-bold text-rose-950">Role permission required</h1><p className="mt-3 text-sm leading-6 text-rose-800">Your current role does not include this workflow. A package upgrade will not change role permissions; ask a manager or administrator to update your access.</p></div></div>
  }
  return children
}

// ── Update Banner ─────────────────────────────────────────────────────────────
function UpdateBanner() {
  const UPDATE_SNOOZE_KEY = 'bb_update_snooze_until'
  /** @type {[import('./types/desktop-api').DesktopUpdateStateReadView['phase'] | null, import('react').Dispatch<import('react').SetStateAction<import('./types/desktop-api').DesktopUpdateStateReadView['phase'] | null>>]} */
  const [state, setState] = useState(/** @type {import('./types/desktop-api').DesktopUpdateStateReadView['phase'] | null} */ (null))
  /** @type {[import('./types/desktop-api').DesktopUpdateStateReadView | null, import('react').Dispatch<import('react').SetStateAction<import('./types/desktop-api').DesktopUpdateStateReadView | null>>]} */
  const [updateInfo, setUpdateInfo] = useState(/** @type {import('./types/desktop-api').DesktopUpdateStateReadView | null} */ (null))
  /** @type {[import('./types/desktop-api').DesktopUpdateProgressReadView, import('react').Dispatch<import('react').SetStateAction<import('./types/desktop-api').DesktopUpdateProgressReadView>>]} */
  const [progress, setProgress] = useState({ percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 })
  const [message, setMessage] = useState('')
  const [minimized, setMinimized] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [snoozed, setSnoozed] = useState(false)
  const listenersAdded = useRef(false)

  const formatBytes = (bytes = 0) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  useEffect(() => {
    if (listenersAdded.current || !window.api?.updates) return
    listenersAdded.current = true

    const isSnoozed = () => {
      try {
        const raw = window.localStorage.getItem(UPDATE_SNOOZE_KEY)
        if (!raw) return false
        const until = Number(raw)
        if (!Number.isFinite(until) || until <= Date.now()) {
          window.localStorage.removeItem(UPDATE_SNOOZE_KEY)
          return false
        }
        return true
      } catch {
        return false
      }
    }

    window.api.updates.getState().then((info) => {
      if (!info?.phase || ['idle', 'checking', 'uptodate'].includes(info.phase)) return
      const snoozedNow = isSnoozed() && info.phase === 'available'
      setSnoozed(snoozedNow)
      setUpdateInfo(info)
      setState(info.phase)
      setProgress(info.progress || { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 })
      if (info.phase === 'available') setMessage('New version available')
      if (info.phase === 'downloading') setMessage('Downloading update…')
      if (info.phase === 'ready') setMessage('Restart when you are ready to install.')
      if (info.phase === 'error') setMessage(info.error || 'The update failed.')
    }).catch(() => {})

    const cleanupAvailable = window.api.updates.onAvailable((info) => {
      setSnoozed(isSnoozed())
      setUpdateInfo(info)
      setMessage('New version available')
      setState('available')
      setMinimized(isSnoozed())
    })
    const cleanupProgress = window.api.updates.onProgress((p) => {
      setSnoozed(false)
      setProgress(p)
      setState('downloading')
      setMessage(p.bytesPerSecond > 0 ? `${formatBytes(p.bytesPerSecond)}/s` : 'Downloading…')
    })
    const cleanupReady = window.api.updates.onReady((info) => {
      setUpdateInfo(info)
      setState('ready')
      setMessage('Ready to install')
      setMinimized(false)
    })
    const cleanupError = window.api.updates.onError((info) => {
      setUpdateInfo(info)
      setMessage(info?.message || 'The update failed.')
      setState('error')
      setMinimized(false)
    })

    return () => {
      listenersAdded.current = false
      cleanupAvailable?.()
      cleanupProgress?.()
      cleanupReady?.()
      cleanupError?.()
    }
  }, [])

  if (!state) return null
  const version = updateInfo?.version || ''
  const releaseDate = formatReleaseDate(updateInfo?.releaseDate)
  const highlights = extractReleaseHighlights(updateInfo?.releaseNotes)
  const sections = toReleaseSections(updateInfo?.releaseNotes)

  const snoozeForDay = () => {
    try {
      window.localStorage.setItem(UPDATE_SNOOZE_KEY, String(Date.now() + 24 * 60 * 60 * 1000))
    } catch {}
    setSnoozed(true)
    setMinimized(true)
  }

  const dismiss = () => {
    setState(null)
    setDetailsOpen(false)
  }

  const downloadUpdate = async () => {
    setState('downloading')
    setMessage('Preparing download…')
    const result = await window.api.updates.download().catch((error) => ({
      success: false,
      error: error?.message || 'Download failed.'
    }))
    if (!result?.success) {
      setState('error')
      setMessage(result?.error || 'Download failed.')
    }
  }

  if (minimized || (snoozed && state === 'available')) {
    return (
      <div className="fixed bottom-5 right-5 z-[9999] pointer-events-none">
        <button
          type="button"
          onClick={() => {
            setSnoozed(false)
            setMinimized(false)
          }}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-xs font-semibold text-slate-700 shadow-[0_18px_40px_rgba(15,23,42,0.16)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-white"
        >
          <BellRing size={14} className={state === 'downloading' ? 'animate-pulse text-sky-600' : state === 'ready' ? 'text-emerald-600' : state === 'error' ? 'text-red-600' : 'text-amber-600'} />
          <span>{state === 'ready' ? `Restart to install v${version}` : state === 'downloading' ? `Downloading v${version}` : state === 'error' ? 'Update failed' : `Update available v${version}`}</span>
          <ChevronUp size={14} />
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="fixed bottom-5 right-5 z-[9999] pointer-events-none">
        <div className="pointer-events-auto w-[360px] overflow-hidden rounded-[22px] border border-slate-200/80 bg-white/95 shadow-[0_28px_80px_rgba(15,23,42,0.22)] backdrop-blur">
          <div className="border-b border-slate-200/80 bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-900 px-4 py-3 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">App update</p>
                <p className="mt-1 text-sm font-semibold">
                  {state === 'ready'
                    ? `${BUILD_PRODUCT.brandName} v${version} is ready`
                    : state === 'downloading'
                      ? `Downloading v${version}`
                      : state === 'error'
                        ? 'Update needs attention'
                        : `${BUILD_PRODUCT.brandName} v${version} is available`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMinimized(true)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
                  aria-label="Minimize update card"
                >
                  <ChevronDown size={16} />
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
                  aria-label="Dismiss update card"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4 px-4 py-4">
            <div className="space-y-1">
              <p className="text-sm text-slate-700">{message}</p>
              {(updateInfo?.releaseName || releaseDate) && (
                <p className="text-xs text-slate-500">
                  {[updateInfo?.releaseName, releaseDate].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>

            {state === 'downloading' && (
              <div className="rounded-2xl border border-sky-100 bg-sky-50 px-3 py-3">
                <div className="mb-2 flex items-center justify-between text-xs font-semibold text-sky-800">
                  <span>Download progress</span>
                  <span>{progress.percent}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500 transition-all duration-300"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-sky-700">
                  <span>{formatBytes(progress.transferred)} of {progress.total ? formatBytes(progress.total) : 'calculating...'}</span>
                  <span>{progress.bytesPerSecond > 0 ? `${formatBytes(progress.bytesPerSecond)}/s` : 'starting...'}</span>
                </div>
              </div>
            )}

            {highlights.length > 0 && state !== 'error' && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">What changed</p>
                <div className="space-y-1.5">
                  {highlights.map((item) => (
                    <p key={item} className="text-xs text-slate-700">• {item}</p>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              {state === 'available' && (
                <button type="button" onClick={downloadUpdate} className="btn-primary flex-1 justify-center">
                  <Download size={15} />
                  Download update
                </button>
              )}
              {state === 'ready' && (
                <button type="button" onClick={() => window.api.updates.install()} className="btn-primary flex-1 justify-center">
                  <RotateCcw size={15} />
                  Restart to install
                </button>
              )}
              {state === 'error' && (
                <button type="button" onClick={() => window.api.updates.check()} className="btn-primary flex-1 justify-center">
                  <RefreshCw size={15} />
                  Try again
                </button>
              )}
              {updateInfo?.releaseNotes && (
                <button type="button" onClick={() => setDetailsOpen(true)} className="btn-secondary justify-center">
                  <FileText size={15} />
                  Details
                </button>
              )}
            </div>

            {state === 'available' && (
              <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-1">
                <p className="text-[11px] text-slate-500">You can keep working and install later.</p>
                <button
                  type="button"
                  onClick={snoozeForDay}
                  className="text-xs font-semibold text-slate-600 transition hover:text-slate-900"
                >
                  Remind me tomorrow
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {detailsOpen && (
        <Modal title={`${BUILD_PRODUCT.brandName} v${version}`} onClose={() => setDetailsOpen(false)} size="lg">
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-sm font-semibold text-slate-900">Update details</p>
              <p className="mt-1 text-sm text-slate-600">
                {[updateInfo?.releaseName, releaseDate].filter(Boolean).join(' · ') || 'Release notes from the latest desktop update.'}
              </p>
            </div>
            {sections.length > 0 ? (
              <div className="space-y-4">
                {sections.map((section) => (
                  <div key={section.title} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <p className="text-sm font-semibold text-slate-900">{section.title}</p>
                    <div className="mt-3 space-y-2">
                      {section.items.map((item) => (
                        <p key={item} className="text-sm leading-6 text-slate-700">• {item}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm leading-6 text-slate-700">
                {updateInfo?.releaseNotes}
              </pre>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}

// ── Broadcast Banner ──────────────────────────────────────────────────────────
/** The active-broadcast producer selects these columns; Array.isArray below checks only the outer IPC container. */
/** @typedef {{id: string, title: string, message: string}} ActiveBroadcastBannerExpectedView */
function BroadcastBanner() {
  const [broadcasts, setBroadcasts] = useState(/** @type {ActiveBroadcastBannerExpectedView[]} */ ([]))
  const [minimized, setMinimized] = useState(false)

  useEffect(() => {
    if (!window.api?.admin?.getActiveBroadcasts) return
    window.api.admin.getActiveBroadcasts().then((data) => {
      if (!Array.isArray(data)) return
      const dismissed = JSON.parse(localStorage.getItem('bb_dismissed_broadcasts') || '[]')
      setBroadcasts((/** @type {ActiveBroadcastBannerExpectedView[]} */ (data)).filter(b => !dismissed.includes(b.id)))
    }).catch(() => {})
  }, [])

  const dismiss = (/** @type {string} */ id) => {
    const dismissed = JSON.parse(localStorage.getItem('bb_dismissed_broadcasts') || '[]')
    localStorage.setItem('bb_dismissed_broadcasts', JSON.stringify([...dismissed, id]))
    setBroadcasts(prev => prev.filter(b => b.id !== id))
  }

  if (broadcasts.length === 0) return null
  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="fixed top-2 left-1/2 z-[9998] -translate-x-1/2 rounded-full bg-purple-700 px-3 py-2 text-xs font-semibold text-white shadow-lg"
      >
        <ChevronDown size={13} className="mr-1 inline rotate-180" />
        {broadcasts.length} announcement{broadcasts.length === 1 ? '' : 's'}
      </button>
    )
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[9998] space-y-px pointer-events-none">
      <button
        type="button"
        onClick={() => setMinimized(true)}
        className="pointer-events-auto absolute right-10 top-1 rounded p-1 text-purple-100 hover:bg-white/10"
        aria-label="Minimize announcement banners"
      >
        <ChevronDown size={15} />
      </button>
      {broadcasts.map(b => (
        <div key={b.id} className="bg-purple-700 text-white text-sm flex items-center justify-between px-4 py-2 shadow-lg pointer-events-auto">
          <div className="flex items-center gap-2">
            <span className="text-purple-200">📢</span>
            <span><strong>{b.title}:</strong> {b.message}</span>
          </div>
          <button onClick={() => dismiss(b.id)} className="text-purple-200 hover:text-white ml-4 text-lg leading-none">×</button>
        </div>
      ))}
    </div>
  )
}

// ── Sync Fail Banner ───────────────────────────────────────────────────────────
/** The mesh producer emits these summary fields; lastError remains unknown because it originates in runtime mesh state. */
/** @typedef {{running: boolean, peerCount: number, activeLockCount: number, lastError: unknown}} SyncFailMeshExpectedView */
/** The sync IPC fallback omits cacheStale and mesh; this banner also has a smaller nested cacheStale default. IPC data is not validated here. */
/** @typedef {Omit<Partial<import('../../shared/desktopIpcContracts.js').FullSyncStatusSnapshot>, 'cacheStale'|'mesh'> & {cacheStale?: Partial<import('../../shared/desktopIpcContracts.js').FullSyncStatusSnapshot['cacheStale']>, mesh?: SyncFailMeshExpectedView}} SyncFailBannerStatusExpectedView */
function SyncFailBanner() {
  const navigate = useNavigate()
  const [syncStatus, setSyncStatus] = useState(/** @type {SyncFailBannerStatusExpectedView} */ ({ failed: 0, cacheStale: { active: false, names: [] } }))
  const [minimized, setMinimized] = useState(false)
  const [dismissedSignature, setDismissedSignature] = useState('')

  useEffect(() => {
    if (!window.api?.sync?.getStatus || !window.api?.sync?.onStatusChanged) return

    const checkStatus = async () => {
      try {
        const status = await window.api.sync.getStatus()
        setSyncStatus(/** @type {SyncFailBannerStatusExpectedView} */ (status || { failed: 0, cacheStale: { active: false, names: [] } }))
      } catch (e) {
        setSyncStatus(/** @type {SyncFailBannerStatusExpectedView} */ ({ failed: 0, cacheStale: { active: false, names: [] } }))
      }
    }

    checkStatus()
    const unsubscribe = window.api.sync.onStatusChanged((status) => {
      setSyncStatus(/** @type {SyncFailBannerStatusExpectedView} */ (status || { failed: 0, cacheStale: { active: false, names: [] } }))
    })

    return () => unsubscribe?.()
  }, [])

  const failedCount = Number(syncStatus?.failed || 0)
  const staleNames = Array.isArray(syncStatus?.cacheStale?.names) ? syncStatus.cacheStale.names : []
  const hasStaleCache = syncStatus?.cacheStale?.active === true && staleNames.length > 0
  const mesh = /** @type {Partial<SyncFailMeshExpectedView>} */ (syncStatus?.mesh || {})
  const meshPeerCount = Number(mesh.peerCount || 0)
  const meshLastError = String(mesh.lastError || '').trim()
  const meshAutoStandby = /missing lodge_mesh_secret/i.test(meshLastError)
  const hasMeshSignal = Boolean(meshLastError) && !meshAutoStandby
  const isGlobalOffline = syncStatus?.isOnline === false
  const signature = JSON.stringify({
    failedCount,
    staleNames,
    meshLastError,
    lastError: syncStatus?.cacheStale?.lastError || ''
  })

  if (failedCount === 0 && !hasStaleCache && !hasMeshSignal) return null
  if (dismissedSignature === signature) return null

  const staleLabel = staleNames.join(', ')
  const tone = failedCount > 0 ? 'bg-amber-500 shadow-amber-500/20' : isGlobalOffline && meshPeerCount > 0 ? 'bg-emerald-700 shadow-emerald-700/20' : 'bg-sky-600 shadow-sky-600/20'
  const title =
    failedCount > 0
      ? `${failedCount} sync issue${failedCount === 1 ? '' : 's'} need attention`
      : isGlobalOffline && meshPeerCount > 0
        ? `Global Offline • Local Mesh: ${meshPeerCount} Peer${meshPeerCount === 1 ? '' : 's'} Connected`
        : meshLastError
          ? 'Local Mesh needs setup'
          : hasStaleCache
            ? `Fresh ${staleLabel} data is loading...`
            : `Local Mesh: ${mesh.running ? 'Ready' : 'Idle'}`
  const subtitle =
    failedCount > 0
      ? 'Tap to open System Health and resolve issues'
      : meshLastError
        ? meshLastError
        : isGlobalOffline && meshPeerCount > 0
          ? 'Nearby front-desk computers can share locks and offline work'
          : hasMeshSignal
            ? `${meshPeerCount} peer${meshPeerCount === 1 ? '' : 's'} · ${Number(mesh.activeLockCount || 0)} active lock${Number(mesh.activeLockCount || 0) === 1 ? '' : 's'}`
            : syncStatus?.cacheStale?.lastError || 'Reviewing status in System Health'

  if (minimized) {
    return (
      <div className="fixed top-[52px] left-1/2 -translate-x-1/2 z-[9996] pointer-events-none">
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className={`${tone} pointer-events-auto inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-white shadow-xl`}
          aria-label="Expand data status banner"
        >
          <ChevronUp size={14} />
          {failedCount > 0 ? `${failedCount} sync issue${failedCount === 1 ? '' : 's'}` : 'Data refresh notice'}
        </button>
      </div>
    )
  }

  return (
    <div className="fixed top-[52px] left-1/2 -translate-x-1/2 z-[9996] pointer-events-none w-full max-w-md px-4">
      <div
        className={`${tone} text-white flex items-center justify-between gap-4 px-4 py-3 shadow-2xl rounded-2xl border border-white/20 backdrop-blur-md pointer-events-auto cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98] select-none`}
        onClick={() => navigate('/settings', { state: { activeTab: 'system' } })}
        title={failedCount > 0 ? 'Open System Health to review issues' : 'Opening System Health'}
      >
        <div className="flex items-center gap-3">
          <div className="bg-white/20 p-2 rounded-xl">
            {failedCount > 0 ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
            ) : isGlobalOffline && meshPeerCount > 0 ? (
              <WifiIcon />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><path d="M22 4 12 14.01l-3-3"/></svg>
            )}
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">
              {title}
            </p>
            <p className="text-[11px] opacity-80 mt-0.5">
              {subtitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setMinimized(true)
            }}
            className="rounded-lg bg-white/15 p-1.5 transition hover:bg-white/25"
            aria-label="Minimize data status banner"
          >
            <ChevronDown size={14} />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setDismissedSignature(signature)
            }}
            className="rounded-lg bg-white/15 p-1.5 transition hover:bg-white/25"
            aria-label="Dismiss data status banner"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

function WifiIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13a10 10 0 0 1 14 0" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M12 20h.01" />
      <path d="M2 8.82a15 15 0 0 1 20 0" />
    </svg>
  )
}

/** @param {{message?: unknown, error?: unknown, scope?: unknown, operation?: unknown}} entry Persisted log data remains unvalidated; this view records only the current reads. */
function importantIssueMessage(entry) {
  return String(entry?.message || entry?.error || entry?.scope || entry?.operation || 'System warning').trim()
}

// ── Financial Health Banner ───────────────────────────────────────────────────
function FinancialHealthBanner() {
  const navigate = useNavigate()
  // Critical-error log values remain unvalidated; this is the banner's expected row projection.
  const [errors, setErrors] = useState(/** @type {Array<{id?: string | number | null, detected_at?: string | number | null, scope?: string | null, operation?: string | null, severity?: string | null, level?: string | null, message?: unknown, error?: unknown}>} */ ([]))
  const [minimized, setMinimized] = useState(false)
  const [dismissedSignature, setDismissedSignature] = useState('')

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const criticalErrors = await (window.api.reports?.criticalErrors?.(3).catch(() => []) || Promise.resolve([]))
        if (!mounted) return
        setErrors(Array.isArray(criticalErrors) ? /** @type {Array<{id?: string | number | null, detected_at?: string | number | null, scope?: string | null, operation?: string | null, severity?: string | null, level?: string | null, message?: unknown, error?: unknown}>} */ (criticalErrors) : [])
      } catch {
        if (mounted) setErrors([])
      }
    }
    load()
    const interval = setInterval(load, 5 * 60_000)
    const onCleared = () => load()
    window.addEventListener('saved-app-issues-cleared', onCleared)
    return () => {
      mounted = false
      clearInterval(interval)
      window.removeEventListener('saved-app-issues-cleared', onCleared)
    }
  }, [])

  if (errors.length === 0) return null

  const hasFinancial = errors.some(e => e.scope?.toLowerCase().includes('financial') || e.operation?.toLowerCase().includes('financial'))
  const hasHighSeverity = errors.some(e => e.severity === 'error' || e.level === 'error' || e.scope?.toLowerCase().includes('db_init'))
  const isTrulyCritical = hasFinancial || hasHighSeverity

  const tone = isTrulyCritical
    ? 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100'
    : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
  const count = errors.length
  const label = isTrulyCritical ? 'critical error' : 'system warning'
  const dotTone = isTrulyCritical ? 'bg-rose-500' : 'bg-amber-500 animate-pulse'
  const firstMessage = importantIssueMessage(errors[0])
  const signature = errors.map((entry) => entry?.id || entry?.detected_at || importantIssueMessage(entry)).join('|')
  if (dismissedSignature === signature) return null

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className={`${tone} fixed top-[72px] right-4 z-[9995] rounded-full border p-2 shadow-lg`}
        aria-label="Expand system warning banner"
      >
        <ChevronUp size={14} />
      </button>
    )
  }

  return (
    <div className="fixed top-[72px] right-4 z-[9995] pointer-events-none">
      <div
        className={`${tone} pointer-events-auto inline-flex items-center gap-3 rounded-full border px-3 py-2 text-xs shadow-lg backdrop-blur-sm transition-colors`}
        onClick={() => navigate('/settings', { state: { activeTab: 'system' } })}
      >
        <div className={`h-2.5 w-2.5 rounded-full ${dotTone}`} />
        <span className="font-semibold">{count} {label}{count === 1 ? '' : 's'}</span>
        <span className="hidden max-w-[320px] text-[11px] font-medium opacity-80 sm:inline leading-tight">{firstMessage}</span>
        <span className="text-[11px] font-medium opacity-75">Open Health</span>
        <button type="button" onClick={(event) => { event.stopPropagation(); setMinimized(true) }} aria-label="Minimize system warning banner"><ChevronDown size={13} /></button>
        <button type="button" onClick={(event) => { event.stopPropagation(); setDismissedSignature(signature) }} aria-label="Dismiss system warning banner"><X size={13} /></button>
      </div>
    </div>
  )
}

// ── Booking Sync Conflict Notification ────────────────────────────────────────
// P0-4: Notify staff when offline bookings fail due to room conflicts
function BookingSyncConflictNotification() {
  // Current main send sites construct these rows; event payloads are still unvalidated.
  /** @typedef {{bookingId: string, error: string, timestamp: number, mesh?: boolean}} BookingConflictBannerExpectedView */
  /** @typedef {{bookingId: string, error: string}} BookingConflictEventExpectedView */
  /** @typedef {{loserId?: string, bookingId?: string, roomId?: string, checkIn?: string}} MeshConflictEventExpectedView */
  const [conflicts, setConflicts] = useState(/** @type {BookingConflictBannerExpectedView[]} */ ([]))

  useEffect(() => {
    /** @type {Array<() => unknown>} */
    const unsubscribers = []

    if (window.api?.sync?.onBookingConflict) {
      unsubscribers.push(window.api.sync.onBookingConflict((payload) => {
      const { bookingId, error } = /** @type {BookingConflictEventExpectedView} */ (payload)
      setConflicts((prev) => {
        // Avoid duplicate notifications for the same booking
        if (prev.some((c) => c.bookingId === bookingId)) return prev
        return [...prev, { bookingId, error, timestamp: Date.now() }]
      })

      // Auto-dismiss after 8 seconds
      setTimeout(() => {
        setConflicts((prev) => prev.filter((c) => c.bookingId !== bookingId))
      }, 8000)
      }))
    }

    if (window.api?.mesh?.onConflictDetected) {
      unsubscribers.push(window.api.mesh.onConflictDetected((payload) => {
        const bookingId = (/** @type {MeshConflictEventExpectedView} */ (payload))?.loserId || (/** @type {MeshConflictEventExpectedView} */ (payload))?.bookingId || `${(/** @type {MeshConflictEventExpectedView} */ (payload))?.roomId || 'mesh'}:${(/** @type {MeshConflictEventExpectedView} */ (payload))?.checkIn || ''}`
        const error = (/** @type {MeshConflictEventExpectedView} */ (payload))?.roomId
          ? `Local mesh conflict on room ${(/** @type {MeshConflictEventExpectedView} */ (payload)).roomId} for ${(/** @type {MeshConflictEventExpectedView} */ (payload)).checkIn || 'selected dates'}`
          : 'Local mesh conflict detected'
        setConflicts((prev) => {
          if (prev.some((c) => c.bookingId === bookingId)) return prev
          return [...prev, { bookingId, error, timestamp: Date.now(), mesh: true }]
        })
        setTimeout(() => {
          setConflicts((prev) => prev.filter((c) => c.bookingId !== bookingId))
        }, 10000)
      }))
    }

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe?.())
  }, [])

  if (conflicts.length === 0) return null

  return (
    <div className="fixed top-[100px] left-0 right-0 z-[9995] pointer-events-none">
      {conflicts.map((conflict) => (
        <div
          key={conflict.bookingId}
          className="bg-red-600 hover:bg-red-700 text-white text-xs flex items-center justify-center px-4 py-2 shadow-md pointer-events-auto cursor-pointer transition-colors mx-4 mb-2 rounded-lg"
          onClick={() => {
            window.location.hash = '#/bookings'
            setConflicts((prev) => prev.filter((c) => c.bookingId !== conflict.bookingId))
          }}
        >
          <span className="font-semibold">
            {conflict.mesh ? 'Local mesh conflict' : 'Booking sync failed'}: {conflict.error} — Open Bookings to fix it.
          </span>
          <button
            type="button"
            className="ml-3 rounded p-1 hover:bg-white/15"
            onClick={(event) => {
              event.stopPropagation()
              setConflicts((prev) => prev.filter((item) => item.bookingId !== conflict.bookingId))
            }}
            aria-label="Dismiss booking conflict banner"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Trial Expired Lock Screen ─────────────────────────────────────────────────

/** @param {string} featureName */
function commercialFeatureLabel(featureName) {
  return FEATURE_LABELS[/** @type {keyof typeof FEATURE_LABELS} */ (featureName)]
    || String(featureName || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

/** @param {ReturnType<typeof getCommercialPackageCatalog>[number]} tier */
function commercialPriceLabel(tier) {
  const amount = Number(tier?.priceBwp)
  if (!Number.isFinite(amount) || amount < 0) return 'Price on request'
  const billingCopy = tier.billingBasis === 'annual_license'
    ? 'per year'
    : tier.billingBasis === 'initial_purchase'
      ? 'once-off'
      : 'per year'
  return `P${amount.toLocaleString('en-BW', { maximumFractionDigits: 0 })} ${billingCopy}`
}

/** @param {ReturnType<typeof getCommercialAddonOffers>[number]} addon */
function commercialAddonPriceLabel(addon) {
  const annualAmount = Number(addon?.annualPriceBwp)
  if (Number.isFinite(annualAmount) && annualAmount >= 0) {
    return `P${annualAmount.toLocaleString('en-BW', { maximumFractionDigits: 0 })} per year`
  }
  const oneTimeAmount = Number(addon?.oneTimePriceBwp)
  if (Number.isFinite(oneTimeAmount) && oneTimeAmount >= 0) {
    return `P${oneTimeAmount.toLocaleString('en-BW', { maximumFractionDigits: 0 })} once-off`
  }
  return 'Price on request'
}

/** @param {{lodgeName?: string | null, lodgeId?: string | null, operatingProfile: 'bar_only' | 'restaurant_bar' | null, propertyType: string | null, user: import('./app-context.jsx').AuthContextUser, onSwitchAccount: () => void}} props */
function TrialExpiredScreen({ lodgeName, lodgeId, operatingProfile, propertyType, user, onSwitchAccount }) {
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [selectedAddonKeys, setSelectedAddonKeys] = useState(/** @type {string[]} */ ([]))
  const tiers = getCommercialPackageCatalog(BUILD_PRODUCT.id).filter((tier) => {
    if (!IS_HPOS_PRODUCT) return true
    if (!operatingProfile) return false
    return isCommercialSelectionEligible({
      productId: BUILD_PRODUCT.id,
      commercialPackageKey: tier.commercialPackageKey,
      operatingProfile
    })
  })
  const brand = BUILD_PRODUCT.brandName
  const noun = IS_LODGE_PRODUCT ? 'lodge' : BUILD_PRODUCT.businessNoun
  const shell = IS_HOTEL_PRODUCT
    ? `${HOTEL_CHROME.shell} flex flex-col items-center justify-center p-6`
    : IS_HPOS_PRODUCT
      ? 'min-h-screen bg-gradient-to-br from-[#6f8061] via-[#d08a64] to-[#a83c26] flex flex-col items-center justify-center p-6'
      : 'min-h-screen bg-gradient-to-br from-green-900 via-green-800 to-green-700 flex flex-col items-center justify-center p-6'
  const subText = IS_HOTEL_PRODUCT ? `${HOTEL_CHROME.mute} text-sm max-w-md` : IS_HPOS_PRODUCT ? 'text-orange-50 text-sm max-w-md' : 'text-green-200 text-sm max-w-md'
  /** @param {ReturnType<typeof getCommercialPackageCatalog>[number]} tier */
  const eligibleAddonsForTier = (tier) => {
    if (!IS_HPOS_PRODUCT || !tier?.commercialPackageKey) return []
    return getCommercialAddonOffers(BUILD_PRODUCT.id, propertyType)
      .filter((addon) => !addon.eligiblePackageKeys || addon.eligiblePackageKeys.includes(tier.commercialPackageKey))
      .filter((addon) => !addon.eligibleOperatingProfiles || addon.eligibleOperatingProfiles.length === 0 || addon.eligibleOperatingProfiles.includes(operatingProfile))
  }
  /** @param {ReturnType<typeof getCommercialPackageCatalog>[number]} tier */
  const selectedAddonsForTier = (tier) => {
    const eligibleKeys = new Set(eligibleAddonsForTier(tier).map((addon) => addon.addonKey))
    return selectedAddonKeys.filter((addonKey) => eligibleKeys.has(addonKey))
  }
  const toggleAddon = (/** @type {string} */ addonKey) => {
    setSelectedAddonKeys((current) => current.includes(addonKey)
      ? current.filter((key) => key !== addonKey)
      : [...current, addonKey])
  }

  /** @param {ReturnType<typeof getCommercialPackageCatalog>[number]} tier */
  const requestUpgrade = async (tier) => {
    setRequestError('')
    setSubmitting(true)
    try {
      const selectedAddons = selectedAddonsForTier(tier)
      const result = await window.api?.subscriptionRequests?.submit?.({
        source: 'desktop_app',
        request_type: 'plan_upgrade',
        lodge_id: lodgeId || null,
        company_name: lodgeName || '',
        property_name: lodgeName || '',
        contact_name: user?.full_name || user?.name || '',
        contact_email: user?.email || '',
        property_type: propertyType || null,
        operating_profile: operatingProfile || null,
        product_id: BUILD_PRODUCT.id,
        commercial_package_key: tier.commercialPackageKey,
        current_plan: 'Trial expired',
        requested_plan: tier.internalPlan,
        requested_addons: selectedAddons,
        notes: `Submitted from expired-trial access for ${tier.displayName}${selectedAddons.length ? ` with ${selectedAddons.length} selected add-on${selectedAddons.length === 1 ? '' : 's'}` : ''}. Payment is not collected in the app; activation requires the server-authoritative quotation and payment approval.`
      })
      if (result?.success !== true) {
        throw new Error(result?.error || 'The commercial quote request could not be delivered.')
      }
      setSubmitted(true)
    } catch (error) {
      setRequestError(error?.message || `We could not send the request. Email ${SUPPORT_EMAIL} for help.`)
    } finally {
      setSubmitting(false)
    }
  }

  const trialTitleClass = IS_HOTEL_PRODUCT ? `text-3xl font-bold ${HOTEL_CHROME.ink} mb-2` : 'text-3xl font-bold text-white mb-2'
  const trialBadgeClass = IS_HOTEL_PRODUCT ? 'text-xs font-bold uppercase tracking-[0.16em] text-[#a84a3c] mb-3' : 'text-xs font-bold uppercase tracking-[0.3em] text-red-200 mb-3'
  const trialBtnClass = IS_HOTEL_PRODUCT
    ? `mt-4 ${HOTEL_CHROME.secondaryBtn}`
    : 'mt-4 inline-flex items-center justify-center rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/15'

  return (
    <div className={shell}>
      <div className="text-center mb-8">
        <div className={trialBadgeClass}>Trial expired</div>
        <h1 className={trialTitleClass}>{brand} is paused</h1>
        <p className={subText}>
          This {noun} is using an expired trial. App features are locked until a subscription is purchased and activated.
        </p>
        <button
          type="button"
          onClick={onSwitchAccount}
          className={trialBtnClass}
        >
          Log in to another account
        </button>
      </div>

      {submitted ? (
        <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Quote request sent!</h2>
          <p className="text-gray-500 text-sm">Sales will prepare an itemised quotation, confirm payment, and activate the approved subscription. Thank you for choosing {brand}.</p>
        </div>
      ) : (
        <div className="w-full max-w-5xl space-y-5">
          {tiers.length === 0 ? (
            <div className="mx-auto max-w-xl rounded-2xl border border-white/20 bg-white/10 p-6 text-center text-sm text-white">
              We could not confirm a package that matches this business profile. Email{' '}
              <a className="font-semibold underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>{' '}
              and our sales team will prepare the correct quotation.
            </div>
          ) : (
            <div className={`grid grid-cols-1 gap-4 ${tiers.length === 1 ? 'mx-auto max-w-sm' : 'md:grid-cols-3'}`}>
              {tiers.map((tier) => (
                <div key={tier.commercialPackageKey} className="bg-white rounded-2xl p-6 shadow-2xl flex flex-col">
                  <div className={`text-xs font-bold uppercase tracking-widest mb-1 ${tier.commercialPackageKey === 'bar_pos' ? 'text-amber-700' : tier.commercialPackageKey === 'restaurant_growth' ? 'text-purple-600' : tier.commercialPackageKey === 'restaurant_control' ? 'text-green-600' : 'text-blue-600'}`}>
                    {tier.displayName}
                  </div>
                  <div className="text-lg font-bold text-gray-800 mb-2">{commercialPriceLabel(tier)}</div>
                  <p className="mb-4 text-xs font-medium leading-5 text-gray-500">{tier.salesCopy}</p>
                  <ul className="space-y-1.5 flex-1 mb-5">
                    {tier.includedFeatures.slice(0, 5).map((featureName) => (
                      <li key={featureName} className="flex items-start gap-2 text-xs text-gray-600">
                        <span className="text-green-500 mt-0.5 flex-shrink-0">✓</span>{commercialFeatureLabel(featureName)}
                      </li>
                    ))}
                  </ul>
                  {eligibleAddonsForTier(tier).length > 0 ? (
                    <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left">
                      <p className="text-xs font-bold uppercase tracking-wide text-amber-800">Optional annual add-ons</p>
                      <p className="mt-1 text-[11px] leading-4 text-amber-700">Bar POS is required. Selected add-ons are included in the first annual invoice and each annual renewal.</p>
                      <div className="mt-3 space-y-2">
                        {eligibleAddonsForTier(tier).map((addon) => {
                          const selected = selectedAddonKeys.includes(addon.addonKey)
                          return (
                            <label key={addon.addonKey} className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-white p-2 text-xs text-gray-700">
                              <input
                                type="checkbox"
                                checked={selected}
                                disabled={submitting}
                                onChange={() => toggleAddon(addon.addonKey)}
                                className="mt-0.5 h-3.5 w-3.5 accent-amber-700"
                              />
                              <span>
                                <span className="block font-semibold text-gray-800">{addon.displayName} <span className="text-amber-800">— {commercialAddonPriceLabel(addon)}</span></span>
                                <span className="mt-0.5 block leading-4 text-gray-500">{addon.description}</span>
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                  <button
                    onClick={() => requestUpgrade(tier)}
                    disabled={submitting}
                    className={`w-full py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                      tier.commercialPackageKey === 'bar_pos' ? 'bg-amber-700 hover:bg-amber-800' :
                      tier.commercialPackageKey === 'restaurant_growth' ? 'bg-purple-600 hover:bg-purple-700' :
                      tier.commercialPackageKey === 'restaurant_control' ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    {submitting ? 'Sending…' : `Request ${tier.displayName}${selectedAddonsForTier(tier).length ? ` + ${selectedAddonsForTier(tier).length} add-on${selectedAddonsForTier(tier).length === 1 ? '' : 's'}` : ''}`}
                  </button>
                </div>
              ))}
            </div>
          )}
          {requestError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-800">
              {requestError} You can also email <a className="font-semibold underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
            </div>
          ) : null}
        </div>
      )}

      <p className="text-green-300 text-xs mt-6">
        Need help? Email <a className="font-semibold underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </p>
    </div>
  )
}

// ── Trial Banner ──────────────────────────────────────────────────────────────
/** @param {{daysLeft: number}} props */
function TrialBanner({ daysLeft }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  const color = daysLeft <= 1 ? 'bg-red-600' : daysLeft <= 2 ? 'bg-amber-500' : 'bg-blue-600'
  const label = daysLeft === 1 ? 'Last day' : `${daysLeft} days`
  return (
    <div className="fixed top-0 left-0 right-0 z-[9997] pointer-events-none">
      <div className={`${color} text-white text-xs flex items-center justify-between px-4 py-1.5 pointer-events-auto`}>
        <span>🕐 <strong>{label} left</strong> in your free trial — contact us to subscribe and keep your data.</span>
        <button onClick={() => setDismissed(true)} className="ml-4 opacity-70 hover:opacity-100 text-base leading-none">×</button>
      </div>
    </div>
  )
}

/** @param {{children: import('react').ReactNode, fallbackPath?: string, isTransitioning?: boolean}} props */
function ProtectedRoute({ children, fallbackPath = '/login', isTransitioning = false }) {
  const { user } = useAuth()
  const { activeProfile, loading } = useProfiles()

  if (loading || isTransitioning) return <PageLoader />
  if (!user) return <Navigate to={fallbackPath} replace />
  if (!user?.isMasterAdmin && (!activeProfile || activeProfile.status !== 'ready')) {
    return <Navigate to={fallbackPath} replace />
  }
  return children
}

function LocalAuthorityBoundary({ unavailable, message, authority, hasSavedCloudBusiness = false, onBack }) {
  const dedicatedLocalBarWorkspace = authority?.workspace_isolation === 'dedicated_bar'
  const [guideStatus, setGuideStatus] = useState('')
  const [guideBusy, setGuideBusy] = useState('')
  const [currentAuthority, setCurrentAuthority] = useState(authority)
  const [setupRecovery, setSetupRecovery] = useState(null)
  const [committedSetup, setCommittedSetup] = useState(null)
  const [setupMode, setSetupMode] = useState('commission')
  const [setupBusy, setSetupBusy] = useState(false)
  const [setupError, setSetupError] = useState('')
  const [newBusinessConfirmed, setNewBusinessConfirmed] = useState(false)
  // A dedicated local Bar workspace is handed the business name and currency
  // chosen in the ordinary setup journey. Nothing else crosses over.
  const setupPrefill = authority?.setup_prefill || null
  const [setupDraft, setSetupDraft] = useState({
    business_name: typeof setupPrefill?.business_name === 'string' ? setupPrefill.business_name : '',
    outlet_name: '',
    owner_name: '', owner_email: '', pin: '',
    currency: typeof setupPrefill?.currency === 'string' ? setupPrefill.currency : 'BWP',
    company_name: typeof setupPrefill?.business_profile?.company_name === 'string' ? setupPrefill.business_profile.company_name : '',
    address: typeof setupPrefill?.business_profile?.address === 'string' ? setupPrefill.business_profile.address : '',
    city: typeof setupPrefill?.business_profile?.city === 'string' ? setupPrefill.business_profile.city : '',
    country: typeof setupPrefill?.business_profile?.country === 'string' ? setupPrefill.business_profile.country : '',
    phone: typeof setupPrefill?.business_profile?.phone === 'string' ? setupPrefill.business_profile.phone : '',
    email: typeof setupPrefill?.business_profile?.email === 'string' ? setupPrefill.business_profile.email : '',
    website: typeof setupPrefill?.business_profile?.website === 'string' ? setupPrefill.business_profile.website : '',
    vat_number: typeof setupPrefill?.business_profile?.vat_number === 'string' ? setupPrefill.business_profile.vat_number : '',
    timezone: 'Africa/Gaborone', device_name: 'Bar office till'
  })
  const [joinDraft, setJoinDraft] = useState({
    base_url: '', certificate_fingerprint: '', pairing_code: '', device_name: 'Bar till'
  })
  const [serverSetup, setServerSetup] = useState(null)
  const [serverSetupCheck, setServerSetupCheck] = useState('checking')
  const [serverSetupCheckError, setServerSetupCheckError] = useState('')
  const serverStatusRead = useRef(false)
  const serverPreflightRead = useRef(false)
  const [setupClock, setSetupClock] = useState(Date.now())
  const [serverPreflight, setServerPreflight] = useState(null)
  const [serverPreflightBusy, setServerPreflightBusy] = useState(false)
  const [serverPin, setServerPin] = useState('')
  const [serverPassword, setServerPassword] = useState('')

  const refreshServerSetup = useCallback(async ({ checkPreflight = true } = {}) => {
    if (!window.api?.barLocal?.serverSetupStatus) {
      setServerSetupCheck('error')
      setServerSetupCheckError('Saved setup checks are unavailable. Preserve this Windows profile and contact support.')
      return
    }
    // Preflight hashes the entire payload. It must neither delay the saved
    // attempt display nor run again on every 2.5-second status poll.
    if (checkPreflight && !serverPreflightRead.current) {
      serverPreflightRead.current = true
      setServerPreflightBusy(true)
      void boundedSetupRead(window.api.barLocal.serverSetupPreflight(), 120000)
        .then(setServerPreflight)
        .catch((error) => setServerPreflight({ ready: false, blockers: [{ code: 'PREFLIGHT_FAILED', message: error?.message || 'Computer readiness could not be checked.' }], warnings: [] }))
        .finally(() => { serverPreflightRead.current = false; setServerPreflightBusy(false) })
    }
    if (serverStatusRead.current) return
    serverStatusRead.current = true
    try {
      const status = await boundedSetupRead(window.api.barLocal.serverSetupStatus())
      const checked = classifyBarSetupStatus(status)
      setServerSetupCheck(checked)
      setServerSetupCheckError('')
      setServerSetup(checked === 'present' ? status : null)
    } catch (error) {
      // Retain a previously displayed saved attempt on transient IPC errors.
      setServerSetupCheck('error')
      setServerSetupCheckError(error?.message || 'The saved Bar setup could not be read. Preserve it and contact support.')
    } finally { serverStatusRead.current = false }
  }, [])

  const serverSetupAvailable = !unavailable && !hasSavedCloudBusiness
    && authority?.authority_mode === 'cloud' && !authority?.configured
    && !authority?.provisioning_recovery?.pending
  useEffect(() => {
    if (serverSetupAvailable && setupMode === 'commission') void refreshServerSetup()
  }, [serverSetupAvailable, setupMode, refreshServerSetup])
  useEffect(() => {
    const prefill = authority?.setup_prefill
    if (!prefill) return
    if (prefill.entry_mode === 'join' || prefill.entry_mode === 'commission') setSetupMode(prefill.entry_mode)
    setSetupDraft((draft) => {
      if (draft.business_name || draft.pin) return draft
      return {
        ...draft,
        business_name: typeof prefill.business_name === 'string' ? prefill.business_name : draft.business_name,
        currency: typeof prefill.currency === 'string' ? prefill.currency : draft.currency
      }
    })
  }, [authority?.setup_prefill])
  useEffect(() => {
    if (!serverSetup || !['prepared', 'installing', 'owner_pending'].includes(serverSetup.phase)) return undefined
    const timer = setInterval(() => { void refreshServerSetup({ checkPreflight: false }) }, 2500)
    const clock = setInterval(() => setSetupClock(Date.now()), 1000)
    return () => { clearInterval(timer); clearInterval(clock) }
  }, [serverSetup?.phase, refreshServerSetup])

  /** @param {'open'|'save'} action @param {string} documentId @param {string} label */
  const useGuide = async (action, documentId, label) => {
    setGuideBusy(`${action}:${documentId}`)
    setGuideStatus('')
    try {
      const result = await window.api?.barGuides?.[action]?.(documentId)
      if (result && typeof result === 'object' && 'success' in result && result.success === true) {
        setGuideStatus(action === 'save' ? `${label} saved.` : `${label} opened.`)
      } else if (result && typeof result === 'object' && 'canceled' in result && result.canceled === true) {
        setGuideStatus('Save canceled.')
      } else {
        const error = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
          ? result.error
          : `${label} is unavailable in this app build.`
        setGuideStatus(error)
      }
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : `${label} is unavailable.`
      setGuideStatus(message)
    } finally {
      setGuideBusy('')
    }
  }

  const guides = [
    { id: 'bar-manual', label: 'Bar customer manual' },
    { id: 'bar-quick-start', label: 'Bar quick-start' }
  ]

  if (!unavailable && currentAuthority?.configured && !currentAuthority?.restart_required) {
    return <Lazy><BarLocalWorkspace status={currentAuthority} onLogout={() => {}} initialStaffId={setupRecovery?.staffId || (currentAuthority?.training ? currentAuthority.setup_owner_staff_id : undefined)} initialLoginNotice={setupRecovery?.notice} /></Lazy>
  }

  const startServerSetup = async (event) => {
    event.preventDefault()
    setSetupBusy(true); setSetupError('')
    try {
      const result = await window.api.barLocal.serverSetupBegin({
        business_name: setupDraft.business_name.trim(),
        outlet_name: setupDraft.outlet_name.trim(),
        owner_name: setupDraft.owner_name.trim(),
        owner_email: setupDraft.owner_email.trim(),
        pin: setupDraft.pin,
        currency: setupDraft.currency,
        business_profile: {
          company_name: setupDraft.company_name,
          address: setupDraft.address,
          city: setupDraft.city,
          country: setupDraft.country,
          phone: setupDraft.phone,
          email: setupDraft.email,
          website: setupDraft.website,
          vat_number: setupDraft.vat_number
        },
        timezone: setupDraft.timezone,
        device_name: setupDraft.device_name.trim()
      })
      setServerSetup(result?.available ? result : null)
      setSetupDraft((draft) => ({ ...draft, pin: '' }))
      await refreshServerSetup()
    } catch (error) {
      setSetupError(error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message : 'Automatic Bar server setup could not be started.')
      await refreshServerSetup()
    } finally { setSetupBusy(false) }
  }

  const resumeServerSetup = async () => {
    setSetupBusy(true); setSetupError('')
    try {
      const needsOwnerCredentials = ['installed', 'owner_pending'].includes(serverSetup?.phase)
      const result = await window.api.barLocal.serverSetupResume(needsOwnerCredentials ? { pin: serverPin, owner_password: serverPassword } : {})
      setServerPin(''); setServerPassword('')
      if (result?.available) setServerSetup(result)
      const status = await window.api.barLocal.getStatus().catch(() => null)
      if (status?.restart_required) { setCurrentAuthority(status); return }
      await refreshServerSetup()
    } catch (error) {
      setSetupError(error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message : 'The local Bar server setup could not be resumed. Do not start a second setup.')
      await refreshServerSetup()
    } finally { setSetupBusy(false) }
  }

  const cancelServerSetup = async () => {
    setSetupBusy(true); setSetupError('')
    try {
      await window.api.barLocal.serverSetupCancel()
      setServerSetup(null)
      await refreshServerSetup()
    } catch (error) {
      setSetupError(error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message : 'The prepared setup could not be cancelled.')
    } finally { setSetupBusy(false) }
  }

  const joinAuthority = async (event) => {
    event.preventDefault()
    setSetupBusy(true); setSetupError('')
    try {
      await window.api.barLocal.pairDevice(joinDraft)
      setCommittedSetup({ staffId: '', paired: true })
      setJoinDraft((draft) => ({ ...draft, pairing_code: '' }))
      const status = await window.api.barLocal.getStatus()
      if (status?.restart_required) { setCurrentAuthority(status); return }
      if (!status?.configured || status.authority_mode !== 'bar_local') throw new Error('Pairing was committed but the local authority status could not be verified. Restart this till; do not reuse the pairing code.')
      setCurrentAuthority(status)
      setJoinDraft((draft) => ({ ...draft, pairing_code: '' }))
    } catch (error) {
      const status = await window.api.barLocal.getStatus().catch(() => null)
      if (status?.restart_required) { setCommittedSetup({ staffId: '', paired: true }); setCurrentAuthority(status); return }
      setSetupError(error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message : 'This till could not join the local Bar service. Check the server address, certificate fingerprint and unused pairing code.')
    } finally { setSetupBusy(false) }
  }

  const resumeSavedProvisioning = async () => {
    const pendingKind = currentAuthority?.provisioning_recovery?.kind
    setSetupBusy(true); setSetupError('')
    try {
      if (pendingKind === 'owner' && serverPassword.length < 12) throw new Error('Re-enter the owner password to resume this setup safely. The password was not saved.')
      const result = await window.api.barLocal.resumeProvisioning(pendingKind === 'owner' ? { owner_password: serverPassword } : {})
      setServerPassword('')
      const status = await window.api.barLocal.getStatus()
      if (status?.restart_required) {
        setCommittedSetup({ staffId: result?.owner_staff_id || '', paired: pendingKind === 'pairing' })
        setCurrentAuthority(status)
        return
      }
      if (!status?.configured || status.authority_mode !== 'bar_local') {
        throw new Error('The saved setup attempt returned, but this till could not verify its local authority. Keep this till for recovery and check its status again.')
      }
      setCurrentAuthority(status)
    } catch (error) {
      const status = await window.api.barLocal.getStatus().catch(() => null)
      if (status?.restart_required) {
        setCommittedSetup({ staffId: '', paired: pendingKind === 'pairing' })
        setCurrentAuthority(status)
      } else {
        if (status) setCurrentAuthority(status)
        setSetupError(error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
          ? error.message : 'The saved local setup attempt could not be resumed. Keep this till for recovery; do not start a second setup.')
      }
    } finally { setSetupBusy(false) }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <section className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-8 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Your Bar on this computer</p>
        <h1 className="mt-3 text-2xl font-bold">{unavailable ? 'Authority state unavailable' : dedicatedLocalBarWorkspace ? 'Set up this new local Bar' : 'Set up or join a local Bar'}</h1>
        {onBack && !committedSetup && !dedicatedLocalBarWorkspace && <button type="button" disabled={setupBusy} onClick={onBack} className="mt-3 text-sm text-amber-300 underline disabled:opacity-50">Back to application choices</button>}
        <p className="mt-3 text-sm leading-6 text-slate-300">
          {unavailable
            ? message || 'The local Bar could not be checked yet. Your records are safe. Try opening it again.'
            : currentAuthority?.blocked_reason?.message || 'Create your Bar on its main computer, or connect this till to the Bar computer. Bar records stay local.'}
        </p>
        {unavailable && <button type="button" className="mt-4 rounded bg-amber-500 px-4 py-2 font-semibold text-slate-950" onClick={() => window.location.reload()}>Try opening the Bar again</button>}
        {currentAuthority?.restart_required && <p role="alert" className="mt-5 rounded bg-amber-950 p-3 text-sm text-amber-100">Setup was committed. Close and reopen the application to start the local Bar workspace. Do not repeat setup or reuse a pairing code. If the app cannot restart, keep this till for support.</p>}
        {committedSetup && !currentAuthority?.configured && !currentAuthority?.restart_required && <div className="mt-5 rounded bg-amber-950 p-3 text-sm text-amber-100">
          <p>{committedSetup.paired ? 'Pairing was committed. Do not reuse the pairing code. Check this till’s local authority status or restart the application.' : 'Setup was committed. Do not create the Bar again. Check this till’s local authority status or restart the application.'}</p>
          <button type="button" disabled={setupBusy} className="mt-3 rounded border border-amber-500 px-3 py-2 disabled:opacity-50" onClick={async () => {
            setSetupBusy(true); setSetupError('')
            try {
              const status = await window.api.barLocal.getStatus()
              if (!status?.configured || status.authority_mode !== 'bar_local') throw new Error('Local authority status is not yet available. Restart this till and contact your administrator if it remains unavailable.')
              setSetupRecovery({ staffId: committedSetup.staffId, notice: committedSetup.paired ? 'This till was paired. Sign in with your staff ID and PIN.' : 'Your Bar was created. Sign in with the owner email and password.' })
              setCurrentAuthority(status)
            } catch (error) { setSetupError(error?.message || 'Could not verify local authority status. Restart this till.') }
            finally { setSetupBusy(false) }
          }}>Check local authority status</button>
          {setupError && <p role="alert" className="mt-3">{setupError}</p>}
        </div>}
        {hasSavedCloudBusiness && !unavailable && <p role="alert" className="mt-5 rounded bg-amber-950 p-3 text-sm text-amber-100">This computer already has a saved workspace. Bar setup cannot safely start here yet. Use a separate, unused computer for a new Bar, or contact support before continuing. Do not reset this computer.</p>}
        {currentAuthority?.provisioning_recovery?.pending && !unavailable && <section role="status" className="mt-5 rounded border border-amber-700 bg-amber-950/40 p-4 text-sm text-amber-100">
          <p className="font-semibold">{currentAuthority.provisioning_recovery.kind === 'owner' ? 'A saved local Bar setup needs to be resumed.' : currentAuthority.provisioning_recovery.kind === 'pairing' ? 'A saved till pairing needs to be resumed.' : 'A saved local setup record needs recovery.'}</p>
          <p className="mt-1">The protected request and device credential were saved before contacting the service. Resume uses that same request; do not create another Bar or request a replacement pairing code.</p>
          {currentAuthority.provisioning_recovery.kind === 'owner' && <label className="mt-3 block text-sm">Re-enter owner password<input type="password" minLength={12} maxLength={128} autoComplete="new-password" value={serverPassword} onChange={(event) => setServerPassword(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>}
          {currentAuthority.provisioning_recovery.recoverable === true
            ? <button type="button" disabled={setupBusy || (currentAuthority.provisioning_recovery.kind === 'owner' && serverPassword.length < 12)} onClick={() => void resumeSavedProvisioning()} className="mt-3 rounded border border-amber-400 px-3 py-2 font-semibold disabled:opacity-50">{setupBusy ? 'Checking saved setup…' : `Resume saved ${currentAuthority.provisioning_recovery.kind === 'pairing' ? 'pairing' : 'setup'}`}</button>
            : <p className="mt-3">The recovery record could not be opened. Keep this till and its user profile intact and contact your administrator.</p>}
          {setupError && <p role="alert" className="mt-3 rounded bg-red-950 p-3">{setupError}</p>}
        </section>}
        {!hasSavedCloudBusiness && !committedSetup && !unavailable && currentAuthority?.authority_mode === 'cloud' && !currentAuthority?.configured && !currentAuthority?.provisioning_recovery?.pending && <>
          <div className="mt-5 flex gap-2" role="tablist" aria-label="Local Bar setup">
            <button type="button" role="tab" aria-selected={setupMode === 'commission'} onClick={() => { setSetupMode('commission'); setSetupError('') }} className={`rounded px-3 py-2 text-sm ${setupMode === 'commission' ? 'bg-amber-500 font-semibold text-slate-950' : 'border border-slate-600'}`}>Set up a new Bar on this computer</button>
            <button type="button" role="tab" aria-selected={setupMode === 'join'} onClick={() => { setSetupMode('join'); setSetupError('') }} className={`rounded px-3 py-2 text-sm ${setupMode === 'join' ? 'bg-amber-500 font-semibold text-slate-950' : 'border border-slate-600'}`}>Connect this till to my Bar</button>
          </div>
          {setupMode === 'commission' ? <div className="mt-4 space-y-3">
            {serverSetupCheck !== 'absent' && serverSetupCheck !== 'present' && <div role={serverSetupCheck === 'error' ? 'alert' : 'status'} className="rounded border border-amber-700 p-3 text-sm"><p>{serverSetupCheck === 'checking' ? 'Checking for your saved Bar setup…' : serverSetupCheckError}</p><p className="mt-2">Your saved setup is preserved. New Bar registration is locked until this check succeeds.</p><button type="button" onClick={() => void refreshServerSetup({ checkPreflight: false })} className="mt-2 rounded border border-slate-500 px-3 py-2">Check saved setup again</button></div>}
            {serverSetup ? <section role="status" aria-live="polite" className="space-y-3 rounded-lg border border-amber-800 bg-slate-950/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-amber-200">{serverSetup.phase_label || serverSetup.phase}</p>
                <button type="button" disabled={setupBusy || serverPreflightBusy} onClick={() => void refreshServerSetup()} className="rounded border border-slate-600 px-3 py-1 text-xs disabled:opacity-50">{serverPreflightBusy ? 'Checking…' : 'Refresh'}</button>
              </div>
              <dl className="grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
                <div><dt className="text-slate-500">Business</dt><dd>{serverSetup.business_name}</dd></div>
                <div><dt className="text-slate-500">Service address</dt><dd className="font-mono">{serverSetup.base_url}</dd></div>
                <div><dt className="text-slate-500">Service version</dt><dd>{serverSetup.service_version}</dd></div>
                <div><dt className="text-slate-500">PostgreSQL</dt><dd>{serverSetup.postgres_version}</dd></div>
              </dl>
              {serverSetup.last_error && <div role="alert" className="rounded bg-red-950 p-3 text-sm text-red-100"><p className="mt-1">{/Start-Process|0xffffffff/.test(serverSetup.last_error.message || '') ? "Windows couldn't start installation with administrator permission. Keep this saved setup and contact support before retrying." : serverSetup.last_error.message}</p><details className="mt-2"><summary>Support details</summary><p>{serverSetup.last_error.code}</p><pre className="whitespace-pre-wrap text-xs">{serverSetup.last_error.message}</pre>{serverSetup.log_tail && <pre className="whitespace-pre-wrap text-xs">{serverSetup.log_tail}</pre>}</details></div>}
              {['installing', 'owner_pending'].includes(serverSetup.phase) && serverSetup.progress && <div className="space-y-2">
                <p>{serverSetup.progress.task}</p>
                <progress aria-label="Bar installation progress" className="w-full" />
                {serverSetup.progress.total > 0 && serverSetup.progress.completed <= serverSetup.progress.total && <div><progress aria-label="Database migrations checked or committed" className="w-full" value={serverSetup.progress.completed} max={serverSetup.progress.total} /><p className="text-xs">Database migrations: {serverSetup.progress.completed} of {serverSetup.progress.total}</p></div>}
                <p className="text-xs text-slate-300">Elapsed: {Math.max(0, Math.floor((setupClock - Date.parse(serverSetup.progress.started_at)) / 1000))} seconds. Last activity: {new Date(serverSetup.progress.last_activity_at).toLocaleTimeString()}.</p>
                {serverSetup.progress.waiting && <p className="text-sm text-amber-200">No new activity has been reported for over two minutes. Keep this setup open. Check for a Windows permission prompt, then use Refresh or share Support details. Do not start another Bar installation.</p>}
              </div>}
              {serverSetup.installer_status?.message && <p className="text-xs text-slate-300">{serverSetup.installer_status.message}</p>}
              {serverSetup.phase === 'installing' && <p className="text-sm text-slate-200">Windows is installing the local database and Bar service. Approve the Windows administrator prompt if it is waiting. Keep this window open.</p>}
              {['installed', 'owner_pending'].includes(serverSetup.phase) && <div className="space-y-2 rounded border border-amber-700 p-3">
                <p className="text-sm text-amber-100">The service is installed. Enter the owner PIN and owner password to finish setup. The password is never saved; re-enter it if setup is interrupted.</p>
                <label className="block text-sm">Owner PIN<input type="password" inputMode="numeric" pattern="[0-9]{4,12}" autoComplete="new-password" value={serverPin} onChange={(event) => setServerPin(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
                <label className="block text-sm">Owner password<input type="password" minLength={12} maxLength={128} autoComplete="new-password" value={serverPassword} onChange={(event) => setServerPassword(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2" /><span className="mt-1 block text-xs text-slate-300">Use at least 12 characters. Owner sign-in works offline with this email and password.</span></label>
                <button type="button" disabled={setupBusy || !/^\d{4,12}$/.test(serverPin) || serverPassword.length < 12} onClick={() => void resumeServerSetup()} className="w-full rounded bg-amber-500 p-3 font-semibold text-slate-950 disabled:opacity-50">{setupBusy ? 'Creating the first owner…' : 'Finish creating the local Bar'}</button>
              </div>}
              {['prepared', 'failed'].includes(serverSetup.phase) && <button type="button" disabled={setupBusy || Boolean(serverPreflight && !serverPreflight.ready)} onClick={() => void resumeServerSetup()} className="w-full rounded bg-amber-500 p-3 font-semibold text-slate-950 disabled:opacity-50">{setupBusy ? 'Starting the installer…' : serverSetup.phase === 'failed' ? 'Retry the local Bar installer' : 'Install the local Bar service'}</button>}
              {serverSetup.can_cancel && <button type="button" disabled={setupBusy} onClick={() => void cancelServerSetup()} className="w-full rounded border border-slate-600 p-2 text-sm disabled:opacity-50">Cancel this prepared setup</button>}
              {serverSetup.phase === 'complete' && <p className="text-sm text-emerald-200">Setup is complete. Restart the application to open the local Bar workspace.</p>}
              {(serverSetup.log_tail || serverSetup.launcher_diagnostic) && <details className="text-xs text-slate-400"><summary className="cursor-pointer">Support details (redacted)</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2">{serverSetup.launcher_diagnostic}{'\n'}{serverSetup.log_tail}</pre></details>}
            </section> : serverSetupCheck === 'absent' ? <>
              <p className="text-xs text-slate-400">This will be the main Bar computer. It keeps the Bar’s records and must stay on while other tills are using the Bar.</p>
              <p className="text-xs text-amber-200">Windows will ask for administrator approval once. This starts a new Bar with no imported sales. Choose a computer that will stay at the venue.</p>
              {serverPreflightBusy && !serverPreflight && <p className="text-sm text-slate-300">Checking this computer and the packaged server files…</p>}
              {serverPreflight && !serverPreflight.ready && <div role="alert" className="rounded bg-red-950 p-3 text-sm text-red-100"><p className="font-semibold">{serverPreflight.storage?.status === 'blocked' && !(serverPreflight.blockers || []).some((blocker) => blocker.code !== 'INSUFFICIENT_DISK') ? 'More storage space is needed' : 'This setup needs attention before it can continue.'}</p><ul className="mt-2 list-disc space-y-1 pl-5">{(serverPreflight.blockers || []).map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul><button type="button" disabled={serverPreflightBusy} onClick={() => void refreshServerSetup()} className="mt-3 rounded border border-red-200 px-3 py-1 text-sm disabled:opacity-50">{serverPreflightBusy ? 'Checking…' : 'Check again'}</button></div>}
              {serverPreflight?.ready && <p className="rounded bg-emerald-950 p-3 text-sm text-emerald-100">This computer is ready to set up the Bar.</p>}
              {serverPreflight?.warnings?.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-amber-200">{serverPreflight.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
              <form onSubmit={startServerSetup} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">Business name <span className="text-slate-300">(required)</span><input required maxLength={200} value={setupDraft.business_name} onChange={(event) => setSetupDraft((draft) => ({ ...draft, business_name: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
                  <label className="block text-sm">Bar or counter name <span className="text-slate-300">(required)</span><input required maxLength={120} value={setupDraft.outlet_name} onChange={(event) => setSetupDraft((draft) => ({ ...draft, outlet_name: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /><span className="mt-1 block text-xs leading-5 text-slate-300">An outlet is a trading area, not each till. For one counter, enter Main Bar. If you have several, use names like Pool Bar; tills serving the same counter share its outlet.</span></label>
                  <label className="block text-sm">Owner name <span className="text-slate-300">(required)</span><input required maxLength={120} value={setupDraft.owner_name} onChange={(event) => setSetupDraft((draft) => ({ ...draft, owner_name: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /><span className="mt-1 block text-xs text-slate-300">Enter the owner’s name as it should appear in Bar records.</span></label>
                  <label className="block text-sm">Owner email <span className="text-slate-300">(required)</span><input required type="email" maxLength={254} autoComplete="email" value={setupDraft.owner_email} onChange={(event) => setSetupDraft((draft) => ({ ...draft, owner_email: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /><span className="mt-1 block text-xs text-slate-300">Used to sign in to this local Bar. No internet connection is required.</span></label>
                  <label className="block text-sm">Owner PIN <span className="text-slate-300">(required)</span><input required type="password" inputMode="numeric" pattern="[0-9]{4,12}" autoComplete="new-password" value={setupDraft.pin} onChange={(event) => setSetupDraft((draft) => ({ ...draft, pin: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /><span className="mt-1 block text-xs text-slate-300">Choose 4–12 digits for in-person approvals. The owner signs in with email and password.</span></label>
                  <label className="block text-sm">Currency <span className="text-slate-300">(required)</span><input required maxLength={3} value={setupDraft.currency} onChange={(event) => setSetupDraft((draft) => ({ ...draft, currency: event.target.value.toUpperCase() }))} className="mt-1 w-full rounded bg-slate-800 p-2" /><span className="mt-1 block text-xs text-slate-300">Use a 3-letter code, such as BWP for Botswana pula.</span></label>
                  <label className="block text-sm">Timezone <span className="text-slate-300">(required)</span><input required maxLength={80} value={setupDraft.timezone} onChange={(event) => setSetupDraft((draft) => ({ ...draft, timezone: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /><span className="mt-1 block text-xs text-slate-300">Used for Bar opening times and reports. Botswana uses Africa/Gaborone.</span></label>
                </div>
                <details open className="rounded border border-slate-700 p-3">
                  <summary className="cursor-pointer text-sm font-semibold">Bar contact details <span className="font-normal text-slate-300">(optional)</span></summary>
                  <p className="mt-2 text-xs text-slate-300">Every field here is optional. Details you enter are saved on this Bar computer with the Bar records.</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {[
                      ['company_name', 'Registered company name'], ['address', 'Street address'], ['city', 'City or town'], ['country', 'Country'],
                      ['phone', 'Phone'], ['email', 'Contact email'], ['website', 'Website'], ['vat_number', 'VAT or tax number']
                    ].map(([key, label]) => <label key={key} className="block text-sm">{label}<input maxLength={key === 'address' ? 240 : key === 'email' ? 254 : key === 'company_name' ? 200 : key === 'phone' || key === 'vat_number' ? 80 : 120} type={key === 'email' ? 'email' : 'text'} value={setupDraft[key]} onChange={(event) => setSetupDraft((draft) => ({ ...draft, [key]: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>)}
                  </div>
                </details>
                <label className="block text-sm">Main computer name <span className="text-slate-300">(required)</span><input required maxLength={120} value={setupDraft.device_name} onChange={(event) => setSetupDraft((draft) => ({ ...draft, device_name: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /><span className="mt-1 block text-xs text-slate-300">Name this computer, for example Bar Office. Other tills connect to this main computer.</span></label>
                <label className="flex gap-2 text-sm"><input type="checkbox" checked={newBusinessConfirmed} onChange={(event) => setNewBusinessConfirmed(event.target.checked)} />This is a new Bar on this computer, not an existing cloud business.</label>
                <button disabled={setupBusy || !newBusinessConfirmed || !serverPreflight?.ready} className="w-full rounded bg-amber-500 p-3 font-semibold text-slate-950 disabled:opacity-50">{setupBusy ? 'Preparing secure setup…' : 'Set up this computer as the Bar server'}</button>
              </form>
            </> : null}
          </div> : <form onSubmit={joinAuthority} className="mt-4 space-y-3">
            <p className="text-xs text-slate-400">On the main Bar computer, open Bar setup and create a one-use connection code. Enter the address and security code shown there.</p>
            <p className="text-xs text-slate-400">This computer will connect to the main Bar computer. Keep the main computer on while the Bar is open.</p>
            <label className="block text-sm">Main computer address<input required placeholder="https://bar-office.local:8787" value={joinDraft.base_url} onChange={(event) => setJoinDraft((draft) => ({ ...draft, base_url: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
            <details className="rounded border border-slate-700 p-3"><summary className="cursor-pointer text-sm">Connection security details</summary><label className="mt-3 block text-xs">Certificate fingerprint<input required autoComplete="off" value={joinDraft.certificate_fingerprint} onChange={(event) => setJoinDraft((draft) => ({ ...draft, certificate_fingerprint: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 font-mono text-xs" /></label></details>
            <label className="block text-sm">Single-use pairing code<input required inputMode="numeric" pattern="[0-9]{6,12}" autoComplete="one-time-code" value={joinDraft.pairing_code} onChange={(event) => setJoinDraft((draft) => ({ ...draft, pairing_code: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
            <label className="block text-sm">Till name<input required maxLength={120} value={joinDraft.device_name} onChange={(event) => setJoinDraft((draft) => ({ ...draft, device_name: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
            <button disabled={setupBusy} className="w-full rounded bg-amber-500 p-3 font-semibold text-slate-950 disabled:opacity-50">{setupBusy ? 'Pairing…' : 'Join local Bar'}</button>
          </form>}
          {setupError && <p role="alert" className="mt-3 rounded bg-red-950 p-3 text-sm text-red-200">{setupError}</p>}
        </>}
        {(unavailable || currentAuthority?.authority_mode !== 'cloud' || currentAuthority?.configured) && <p className="mt-5 rounded-lg border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-100">This till will not restore a cloud profile or send local sales to cloud. Keep it connected to its configured Bar service and resolve saved operations before changing or repairing its pairing.</p>}
        <div className="mt-6 border-t border-slate-700 pt-5">
          <h2 className="text-sm font-semibold">Offline Bar guides</h2>
          <p className="mt-1 text-xs text-slate-400">Open a guide or save a copy on this computer.</p>
          <div className="mt-3 space-y-3">
            {guides.map((guide) => (
              <div key={guide.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-800 p-3">
                <span className="text-sm">{guide.label}</span>
                <div className="flex gap-2">
                  {/** @type {Array<'open'|'save'>} */ (['open', 'save']).map((action) => {
                    const busy = guideBusy === `${action}:${guide.id}`
                    return (
                      <button
                        key={action}
                        type="button"
                        disabled={Boolean(guideBusy)}
                        onClick={() => useGuide(action, guide.id, guide.label)}
                        className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-700 disabled:opacity-50"
                      >
                        {busy ? 'Working…' : action === 'open' ? 'Open' : 'Save'}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          {guideStatus && <p role="status" className="mt-3 text-sm text-slate-200">{guideStatus}</p>}
        </div>
      </section>
    </main>
  )
}

export default function App() {
  const isBrowserPreview = !window.api?.settings
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('bb_user')
      return saved
        ? /** @type {import('./app-context.jsx').AuthContextUser} */ (JSON.parse(saved))
        : null
    } catch {
      return null
    }
  })
  const [authRestoreLoading, setAuthRestoreLoading] = useState(() => !isBrowserPreview && !!user)
  const [profiles, setProfiles] = useState([])
  const [activeProfile, setActiveProfile] = useState(null)
  const [profilesLoading, setProfilesLoading] = useState(!isBrowserPreview)
  const [settingsLoading, setSettingsLoading] = useState(!isBrowserPreview)
  // Resolve the trusted authority profile before any cloud profile/session
  // bootstrap. A committed local profile must never be ignored because the
  // existing cloud shell happened to load first.
  const [localAuthorityState, setLocalAuthorityState] = useState(/** @type {null | {authority_mode?: string, configured?: boolean, error?: string, workspace_choice_required?: boolean, has_saved_cloud_business?: boolean, provisioning_recovery?: {pending?: boolean, kind?: 'owner'|'pairing'|null, recoverable?: boolean, error_code?: string}|null}} */ (null))
  // A fresh hospitality-pos install enters the local Bar setup path by default.
  // Existing cloud workspaces remain available only through the explicit
  // cloud-choice action; committed local authorities never reach that chooser.
  const [entryChoice, setEntryChoice] = useState(IS_HPOS_PRODUCT ? 'local' : 'choose')
  const [entryChoiceError, setEntryChoiceError] = useState('')
  const [settings, setSettings] = useState(/** @type {import('./app-context.jsx').SettingsRowView | null} */ (null))
  const [features, setFeatures] = useState(/** @type {import('./app-context.jsx').FeatureFlags} */ ({})) // feature flags keyed by feature name
  const [trialStatus, setTrialStatus] = useState(DEFAULT_TRIAL_STATUS)
  const [profileContextVersion, setProfileContextVersion] = useState(0)
  const [onlineRequests, setOnlineRequests] = useState([])
  const focusRecoveryQueuedRef = useRef(false)
  const lastEditablePointerRef = useRef(null)
  const focusObservedRef = useRef(false)
  const lastRecoveryTimeRef = useRef(0)
  const restoreAttemptedRef = useRef(false)
  const navigationGuardRef = useRef({ isDirty: false, confirmLeave: null })

  // Let Electron's native frame own the caption and window controls.
  useEffect(() => {
    console.info('[STARTUP] react-first-commit', { at_ms: Math.round(performance.now()) })
    void window.api?.barLocal?.rendererReady?.().catch(() => {})
    document.title = BUILD_PRODUCT.name
    const themeColor = PRODUCT_THEME_COLORS[BUILD_PRODUCT.id] || PRODUCT_THEME_COLORS['lodge-camp']
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor)
  }, [])

  // Theme — apply saved preference on startup and follow system changes when requested.
  useEffect(() => {
    applyThemeMode(getStoredThemeMode())
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return undefined
    const syncSystemTheme = () => {
      if (getStoredThemeMode() === 'system') applyThemeMode('system')
    }
    media.addEventListener?.('change', syncSystemTheme)
    return () => media.removeEventListener?.('change', syncSystemTheme)
  }, [])

  // Poll for pending online booking requests at a gentler cadence.
  const refreshOnlineRequests = useCallback(async () => {
    if (!window.api?.bookings?.getPendingOnline) return
    try {
      const data = await window.api.bookings.getPendingOnline()
      setOnlineRequests(data || [])
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => {
    if (isBrowserPreview) return
    if (IS_HPOS_PRODUCT) {
      setOnlineRequests([])
      return
    }
    if (!user || user.isMasterAdmin) return
    if (activeProfile?.status !== 'ready') return
    refreshOnlineRequests()
    const interval = setInterval(() => {
      if (document.visibilityState !== 'hidden') refreshOnlineRequests()
    }, 2 * 60_000)
    const handleVisible = () => {
      if (document.visibilityState === 'visible') refreshOnlineRequests()
    }
    document.addEventListener('visibilitychange', handleVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [activeProfile?.status, isBrowserPreview, refreshOnlineRequests, user])

  const runFocusRecovery = useCallback((reason, preferredTarget = null) => {
    const now = Date.now()
    const RECOVERY_COOLDOWN_MS = 250
    if (now - lastRecoveryTimeRef.current < RECOVERY_COOLDOWN_MS) return
    lastRecoveryTimeRef.current = now
    if (focusRecoveryQueuedRef.current) return
    focusRecoveryQueuedRef.current = true
    if (INPUT_FOCUS_DEBUG) {
      console.log('[INPUT FOCUS] recovery requested:', {
        reason,
        activeTag: document.activeElement?.tagName || null,
        activeType: document.activeElement?.getAttribute?.('type') || null
      })
    }
    requestAnimationFrame(() => {
      window.focus()
      const target = isEditableFieldTarget(preferredTarget) ? preferredTarget.closest('input, textarea, [contenteditable]') : null
      if (target?.focus) {
        try {
          target.focus({ preventScroll: true })
        } catch {
          target.focus()
        }
      }
      setTimeout(() => {
        if (target?.focus && document.activeElement !== target) {
          try {
            target.focus({ preventScroll: true })
          } catch {
            target.focus()
          }
        }
        document.body?.offsetHeight
        focusRecoveryQueuedRef.current = false
        if (INPUT_FOCUS_DEBUG) {
          console.log('[INPUT FOCUS] recovery finished:', {
            reason,
            activeTag: document.activeElement?.tagName || null,
            activeType: document.activeElement?.getAttribute?.('type') || null
          })
        }
      }, 30)
    })
  }, [])

  /** @param {unknown} entitlement Expected entitlement view; upstream IPC/cache values remain unvalidated. */
  const applyEntitlement = useCallback((entitlement) => {
    const nextTrial = entitlement || DEFAULT_TRIAL_STATUS
    /** @type {import('./app-context.jsx').FeatureFlags} */
    const nextFeatures = {}
    const normalizedPlan = normalizeSubscriptionPlan(nextTrial?.plan || 'Starter')
    const planIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(normalizedPlan)
    APP_FEATURES.forEach((featureName) => {
      const commercialOverride = getCommercialFeatureOverride(nextTrial, BUILD_PRODUCT.id, featureName, nextTrial?.commercial_package_key || null, nextTrial?.lodge_id || null)
      if (commercialOverride !== null) {
        nextFeatures[featureName] = commercialOverride
        return
      }
      if (nextTrial?.product_id === 'hospitality-pos' && nextTrial?.commercial_package_key
        && !isCommercialFeatureIncluded(BUILD_PRODUCT.id, nextTrial.commercial_package_key, featureName, nextTrial.enterprise_addons || [], nextTrial, nextTrial?.lodge_id || null)) {
        nextFeatures[featureName] = false
        return
      }
      if (Object.prototype.hasOwnProperty.call(nextTrial?.effective_features || {}, featureName)) {
        nextFeatures[featureName] = nextTrial.effective_features[featureName] !== false
      } else if (nextTrial?.expired === true) {
        nextFeatures[featureName] = false
      } else if (nextTrial?.status === 'trial') {
        nextFeatures[featureName] = true
      } else {
        const requiredPlan = getFeatureRequiredPlan(featureName)
        const requiredIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(requiredPlan)
        nextFeatures[featureName] = planIndex >= requiredIndex
      }
    })
    setTrialStatus(nextTrial)
    setFeatures(nextFeatures)
  }, [])

  // Expose one renderer-owned refresh path so subscription changes update the
  // global capability snapshot immediately. The main process receives
  // forceFresh and invalidates its in-memory entitlement result before the
  // authoritative read; disk cache remains available only for offline use.
  /** @param {{forceFresh?: boolean}} [options] */
  const refreshEntitlement = useCallback(async ({ forceFresh = false } = {}) => {
    const lodgeId = activeProfile?.lodge_id
    if (isBrowserPreview || !lodgeId || !window.api?.trial?.getStatus) return null
    const nextTrial = await window.api.trial.getStatus(lodgeId, { forceFresh: forceFresh === true }).catch(() => null)
    if (nextTrial) applyEntitlement(nextTrial)
    return nextTrial
  }, [activeProfile?.lodge_id, applyEntitlement, isBrowserPreview])

  const clearStoredRendererSession = useCallback(() => {
    localStorage.removeItem('bb_user')
    localStorage.removeItem(USER_SCOPE_KEY)
    restoreAttemptedRef.current = false
    setUser(null)
  }, [])

  const logout = useCallback(() => {
    clearStoredRendererSession()
    window.api.auth.logout().catch(() => {})
  }, [clearStoredRendererSession])

  const switchAccount = useCallback(() => {
    logout()
    window.location.hash = '#/login'
  }, [logout])

  const reloadProfiles = useCallback(async () => {
    if (isBrowserPreview || !window.api?.profiles) {
      setProfiles([])
      setActiveProfile(null)
      setProfilesLoading(false)
      setSettingsLoading(false)
      return { profiles: [], activeProfile: null }
    }

    setProfilesLoading(true)
    try {
      const [list, active] = await Promise.all([
        window.api.profiles.list().catch(() => []),
        window.api.profiles.getActive().catch(() => null)
      ])

      const nextProfiles = Array.isArray(list) ? list : []
      const nextActive = active || nextProfiles.find((profile) => profile.active) || null

      setSettingsLoading(Boolean(nextActive))
      setProfiles(nextProfiles)
      setActiveProfile(nextActive)
      setProfileContextVersion((value) => value + 1)
      return { profiles: nextProfiles, activeProfile: nextActive }
    } finally {
      setProfilesLoading(false)
    }
  }, [isBrowserPreview])

  const selectProfile = useCallback(async (lodgeId) => {
    if (user && !user.isMasterAdmin) {
      logout()
    }
    const result = await window.api.profiles.select(lodgeId)
    if (!result?.success) {
      throw new Error(result?.error || `Could not switch to that ${BUILD_PRODUCT.businessNoun || 'business'} on this computer.`)
    }
    await reloadProfiles()
    return result.data
  }, [logout, reloadProfiles, user])

  const createDraftProfile = useCallback(async () => {
    if (user && !user.isMasterAdmin) {
      logout()
    }
    const result = await window.api.profiles.createDraft()
    if (!result?.success) {
      throw new Error(result?.error || `Could not create a new ${BUILD_PRODUCT.businessNoun || 'business'} profile.`)
    }
    await reloadProfiles()
    return result.data
  }, [logout, reloadProfiles, user])

  const removeDraftProfile = useCallback(async (lodgeId) => {
    const result = await window.api.profiles.removeDraft(lodgeId)
    if (result?.success) {
      await reloadProfiles()
    }
    return result
  }, [reloadProfiles])

  useEffect(() => {
    if (isBrowserPreview) {
      setProfilesLoading(false)
      setSettingsLoading(false)
      setTrialStatus(DEFAULT_TRIAL_STATUS)
      return
    }
    let cancelled = false
    const loadTrustedStartupState = async () => {
      let timeoutId
      try {
        console.info('[STARTUP] authority-check-start', { at_ms: Math.round(performance.now()) })
        const authority = await Promise.race([
          window.api?.barLocal?.getStatus?.(),
          new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error('The local Bar check took too long. Try opening the Bar again.')), 12000) })
        ])
        if (cancelled) return
        if (!authority || authority.authority_mode === 'bar_local' || authority.workspace_choice_required === true) {
          console.info('[STARTUP] authority-check-complete', { at_ms: Math.round(performance.now()), result: authority?.authority_mode || 'new-or-unknown' })
          setLocalAuthorityState(authority || { authority_mode: 'unknown', error: 'The trusted local authority state could not be read.' })
          setProfiles([])
          setActiveProfile(null)
          setSettings(null)
          setProfilesLoading(false)
          setSettingsLoading(false)
          setAuthRestoreLoading(false)
          // A stale cloud user must not be restored against a local authority.
          localStorage.removeItem('bb_user')
          localStorage.removeItem(USER_SCOPE_KEY)
          setUser(null)
          return
        }
        setLocalAuthorityState(authority)
        console.info('[STARTUP] authority-check-complete', { at_ms: Math.round(performance.now()), result: authority.authority_mode || 'workspace' })
        await reloadProfiles()
      } catch {
        if (cancelled) return
        console.error('[STARTUP] authority-check-failed', { at_ms: Math.round(performance.now()) })
        // If authority discovery itself fails, do not guess that this is a
        // cloud installation. That guess could route a commissioned till to
        // Supabase-backed write handlers.
        setLocalAuthorityState({ authority_mode: 'unknown', error: 'The trusted authority state could not be verified. Restart the application or contact your administrator.' })
        setProfiles([])
        setActiveProfile(null)
        setSettings(null)
        setProfilesLoading(false)
        setSettingsLoading(false)
        setAuthRestoreLoading(false)
      } finally {
        clearTimeout(timeoutId)
      }
    }
    loadTrustedStartupState()
    return () => { cancelled = true }
  }, [isBrowserPreview, reloadProfiles])

  useEffect(() => {
    if (isBrowserPreview) return undefined
    if (profilesLoading) return undefined

    let cancelled = false
    let interval

    const loadProfileContext = async () => {
      if (!activeProfile) {
        setSettings(null)
        setFeatures({})
        setTrialStatus(DEFAULT_TRIAL_STATUS)
        setSettingsLoading(false)
        return
      }

      setSettingsLoading(true)
      try {
        let nextSettings = await window.api.settings.get().catch(() => null)
        if (!nextSettings && window.api.settings.getOutletContext) {
          // Outlet-scoped roles (cashier/supervisor) lack settings.view, so the
          // full row is denied as null. Without property_type/hospitality_mode
          // the hpos route guards default to 'lodge' and bounce every /hpos/*
          // route back to '/' in an infinite loop. The outlet context carries
          // only routing/mode/identity fields so boot can resolve correctly.
          nextSettings = await window.api.settings.getOutletContext().catch(() => null)
        }
        if (!cancelled) {
          setSettings(nextSettings)
        }

        if (activeProfile.status === 'ready' && activeProfile.lodge_id) {
          if (window.api?.trial?.getStatus) {
            const refreshEntitlement = async () => {
              const nextTrial = await window.api.trial.getStatus(activeProfile.lodge_id).catch(() => DEFAULT_TRIAL_STATUS)
              if (!cancelled) applyEntitlement(nextTrial || DEFAULT_TRIAL_STATUS)
            }

            await refreshEntitlement()
            interval = setInterval(() => {
              refreshEntitlement().catch(() => {})
            }, 15 * 60_000)
          } else if (!cancelled) {
            applyEntitlement(DEFAULT_TRIAL_STATUS)
          }
        } else if (!cancelled) {
          setFeatures({})
          setTrialStatus(DEFAULT_TRIAL_STATUS)
        }
      } finally {
        if (!cancelled) setSettingsLoading(false)
      }
    }

    loadProfileContext()

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [activeProfile?.lodge_id, activeProfile?.status, applyEntitlement, isBrowserPreview, profileContextVersion, profilesLoading])

  const [isLoggingIn, setIsLoggingIn] = useState(false)

  useEffect(() => {
    if (isBrowserPreview || profilesLoading || !user || user.isMasterAdmin || isLoggingIn) return

    const storedScope = localStorage.getItem(USER_SCOPE_KEY) || ''
    const activeLodgeId = activeProfile?.lodge_id || ''
    const currentUserLodgeId = String(user?.lodge_id || '').trim().toLowerCase()

    if (!activeLodgeId || storedScope !== activeLodgeId || (currentUserLodgeId && currentUserLodgeId !== activeLodgeId)) {
      console.warn('[AUTH] Security scope mismatch - forcing logout', {
        activeLodgeId,
        storedScope,
        currentUserLodgeId
      })
      clearStoredRendererSession()
      window.api.auth.logout().catch(() => {})
    }
  }, [activeProfile?.lodge_id, clearStoredRendererSession, isBrowserPreview, isLoggingIn, profilesLoading, user])

  // Re-establish main-process currentUser on startup using the trusted session
  // kept by the main process. The renderer keeps only display-safe user state.
  useEffect(() => {
    if (isBrowserPreview) {
      setAuthRestoreLoading(false)
      return
    }
    if (!user) {
      setAuthRestoreLoading(false)
    }
  }, [isBrowserPreview, user])

  useEffect(() => {
    if (profilesLoading || !user || restoreAttemptedRef.current || !window.api?.auth?.restoreCurrentSession) return

    if (!user.isMasterAdmin) {
      const storedScope = localStorage.getItem(USER_SCOPE_KEY) || ''
      const activeLodgeId = activeProfile?.lodge_id || ''
      if (!activeLodgeId || storedScope !== activeLodgeId) return
    }

    restoreAttemptedRef.current = true
    console.info('[STARTUP] session-restore-start', { at_ms: Math.round(performance.now()) })
    const restorePromise = window.api.auth.restoreCurrentSession()

    restorePromise.then((restored) => {
      console.info('[STARTUP] session-restore-result', { at_ms: Math.round(performance.now()), restored: Boolean(restored) })
      if (!restored) {
        clearStoredRendererSession()
        setAuthRestoreLoading(false)
        return null
      }
      return window.api.auth.validateSession?.()
        .then((validated) => {
          return validated || restored
        })
        .catch(() => restored)
        .finally(() => {
          setAuthRestoreLoading(false)
        })
    }).catch(() => {
      clearStoredRendererSession()
      setAuthRestoreLoading(false)
    })
  }, [activeProfile?.lodge_id, clearStoredRendererSession, profilesLoading, user])

  useEffect(() => {
    if (isBrowserPreview) return undefined

    const handleFocusIn = (event) => {
      focusObservedRef.current = true
      if (INPUT_FOCUS_DEBUG) {
        console.log('[INPUT FOCUS] focusin:', {
          tag: event.target?.tagName || null,
          type: event.target?.getAttribute?.('type') || null
        })
      }
    }

    const handlePointerDown = (event) => {
      if (!isEditableFieldTarget(event.target)) return
      lastEditablePointerRef.current = event.target
      focusObservedRef.current = false

      // Immediately attempt focus — this is the most direct fix.
      // Chromium on Windows sometimes fails to route keyboard input to an element
      // that received focus via its own internal pointer handling. By explicitly
      // calling focus() here (synchronous, during pointer capture), we preempt
      // the broken codepath.
      const field = event.target.closest('input, textarea, [contenteditable]')
      if (field && document.activeElement !== field) {
        try {
          field.focus({ preventScroll: true })
        } catch {
          field.focus()
        }
      }

      if (INPUT_FOCUS_DEBUG) {
        console.log('[INPUT FOCUS] pointerdown editable target:', {
          tag: event.target?.tagName || null,
          type: event.target?.getAttribute?.('type') || null,
          className: event.target?.className || null
        })
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const target = lastEditablePointerRef.current
          if (!target) return
          const active = document.activeElement
          const targetOwnsFocus = active === target || (target.contains?.(active) ?? false)
          if (!focusObservedRef.current && !targetOwnsFocus) {
            runFocusRecovery('editable-pointerdown', target)
          }
        })
      })
    }

    document.addEventListener('focusin', handleFocusIn, true)
    document.addEventListener('pointerdown', handlePointerDown, true)

    return () => {
      document.removeEventListener('focusin', handleFocusIn, true)
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [isBrowserPreview, runFocusRecovery])

  /** @param {import('./app-context.jsx').AuthContextUser} userData Expected auth IPC user view; IPC/cache payloads are not validated here. */
  const login = useCallback(async (userData) => {
    setIsLoggingIn(true)
    try {
      localStorage.setItem('bb_user', JSON.stringify(userData))
      
      // Force refresh from main process (especially important for offline login)
      const refreshed = await reloadProfiles()
      const currentProfile = refreshed.activeProfile

      const scope = userData?.isMasterAdmin
        ? 'master_admin'
        : (currentProfile?.lodge_id || userData?.lodge_id || '')
        
      if (scope) {
        localStorage.setItem(USER_SCOPE_KEY, scope)
      } else {
        localStorage.removeItem(USER_SCOPE_KEY)
      }
      
      restoreAttemptedRef.current = false
      setUser(userData)
    } finally {
      // Small delay to ensure React has finished re-rendering with the new activeProfile
      // before we re-enable the security scope check
      setTimeout(() => setIsLoggingIn(false), 200)
    }
  }, [reloadProfiles])

  const handleSetupComplete = useCallback(async (newSettings) => {
    setSettings(newSettings)
    await reloadProfiles()
  }, [reloadProfiles])

  if (isBrowserPreview) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-900 via-green-700 to-green-500 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-8 text-center">
          <div className="text-5xl mb-4">🖥️</div>
          <h1 className="text-2xl font-bold text-gray-800 mb-3">Desktop App Required</h1>
          <p className="text-sm text-gray-600 leading-6">
            This {BUILD_PRODUCT.brandName} screen is the desktop version. It needs the app installed on your computer and cannot run fully inside a browser tab.
          </p>
          <div className="mt-5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 text-left">
            Use this link only for visual review, or share the manager mobile app link if your partner needs browser access.
          </div>
        </div>
      </div>
    )
  }

  const appLoading = (profilesLoading || settingsLoading || authRestoreLoading) && !isLoggingIn
  const preAuthFallbackPath = profiles.length === 0
    ? '/welcome'
    : activeProfile?.status === 'draft'
      ? '/setup'
      : '/choose-lodge'

  if (appLoading) {
    // Lodge live loading screen frozen. Hotel/HPOS get product shells only.
    if (IS_LODGE_PRODUCT) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-green-900">
          <div className="text-center text-white">
            <div className="mx-auto mb-5 flex h-36 w-[420px] max-w-[86vw] items-center justify-center">
              <img src={productLogoLight} alt={BUILD_PRODUCT.brandName} className="max-h-full max-w-full object-contain" draggable="false" />
            </div>
            <p className="text-sm text-green-200">Loading {BUILD_PRODUCT.brandName}...</p>
          </div>
        </div>
      )
    }
    if (IS_HOTEL_PRODUCT) {
      return (
        <div className={`flex min-h-screen items-center justify-center ${HOTEL_CHROME.shell}`}>
          <div className={`text-center ${HOTEL_CHROME.ink}`}>
            <div className="mx-auto mb-5 flex h-36 w-[420px] max-w-[86vw] items-center justify-center">
              <img src={productLogoColor} alt={BUILD_PRODUCT.brandName} className="max-h-full max-w-full object-contain" draggable="false" />
            </div>
            <h1 className="sr-only">{BUILD_PRODUCT.brandName}</h1>
            <p className={`mt-2 text-sm ${HOTEL_CHROME.mute}`}>{HOTEL_CHROME.loadingLine}</p>
          </div>
        </div>
      )
    }
    return (
      <div role="status" aria-live="polite" className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#6f8061] via-[#d08a64] to-[#a83c26]">
        <div className="text-center text-white">
          <div className="mx-auto mb-5 flex h-36 w-[420px] max-w-[86vw] items-center justify-center">
            <img src={productLogoLight} alt={BUILD_PRODUCT.brandName} className="max-h-full max-w-full object-contain" draggable="false" />
          </div>
          <h1 className="sr-only">{BUILD_PRODUCT.brandName}</h1>
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-orange-50">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-orange-100 border-t-transparent" aria-hidden="true" />
            <span>{IS_HPOS_PRODUCT ? 'Starting the application…' : 'Loading your workspace…'}</span>
          </div>
        </div>
      </div>
    )
  }

  if (IS_HPOS_PRODUCT && localAuthorityState?.training) {
    if (!localAuthorityState.configured) return <TrainingSetup />
    return <TrainingFrame><LocalAuthorityBoundary authority={localAuthorityState} /></TrainingFrame>
  }
  if (IS_HPOS_PRODUCT && (localAuthorityState?.authority_mode === 'bar_local' || localAuthorityState?.authority_mode === 'unknown')) {
    const unavailable = localAuthorityState.authority_mode === 'unknown'
    return <LocalAuthorityBoundary unavailable={unavailable} message={localAuthorityState.error} authority={localAuthorityState} />
  }

  if (IS_HPOS_PRODUCT && !isBrowserPreview && localAuthorityState?.workspace_choice_required) {
    const dedicatedLocalBarWorkspace = localAuthorityState?.workspace_isolation === 'dedicated_bar'
    if (entryChoice === 'local') return <LocalAuthorityBoundary authority={localAuthorityState} hasSavedCloudBusiness={localAuthorityState.has_saved_cloud_business === true} onBack={dedicatedLocalBarWorkspace ? undefined : () => setEntryChoice('choose')} />
    return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <section className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-8">
        <h1 className="text-2xl font-bold">{dedicatedLocalBarWorkspace ? 'This window is a local Bar' : 'Choose your workspace'}</h1>
        <p className="mt-3 text-sm text-slate-300">{dedicatedLocalBarWorkspace
          ? 'This window creates or joins the local Bar. The other workspace stays separate and is not copied or changed.'
          : 'For a new Bar, set up or join the local Bar server. Restaurant and existing cloud businesses can continue in their current workspace.'}</p>
        <button type="button" onClick={() => setEntryChoice('local')} className="mt-6 w-full rounded bg-amber-500 p-3 text-left font-semibold text-slate-950">Bar: set up or join a local server</button>
        {!dedicatedLocalBarWorkspace && <button type="button" disabled={entryChoice === 'restarting'} onClick={async () => {
          setEntryChoice('restarting'); setEntryChoiceError('')
          try {
            await window.api.barLocal.selectCloudWorkspace()
            setEntryChoiceError('Close and reopen the application to continue to the other workspace.')
          } catch {
            setEntryChoice('choose')
            setEntryChoiceError('The workspace choice could not be completed. Try again, or close and reopen the application.')
          }
        }} className="mt-3 w-full rounded border border-slate-500 p-3 text-left disabled:opacity-50">{entryChoice === 'restarting' ? 'Restarting application…' : 'Continue to other workspace'}</button>}
        {entryChoiceError && <p role="status" className="mt-3 text-sm text-amber-200">{entryChoiceError}</p>}
        <p className="mt-4 text-xs text-slate-400">Existing cloud Bars need a verified migration before local activation. Choosing local setup does not transfer cloud data.</p>
      </section>
    </main>
  }

  const authContextValue = { user, login, logout }
  // Commercial package identity comes from the authenticated entitlement and is
  // authoritative for Bar POS, even when older settings rows lack bar_only.
  const effectiveSettings = settings ? {
    ...settings,
    commercial_package_key: trialStatus?.commercial_package_key || settings.commercial_package_key || null,
    product_id: trialStatus?.product_id || settings.product_id || null
  } : settings
  const settingsContextValue = { settings: effectiveSettings, setSettings }
  const profilesContextValue = {
    profiles,
    activeProfile,
    loading: appLoading,
    profilesLoading,
    reloadProfiles,
    selectProfile,
    createDraftProfile,
    removeDraftProfile
  }
  // allowedOutletIds: null = unrestricted (manager/admin), [] = no access, [uuid] = scoped
  const _allowedOutletIds =
    user?.isMasterAdmin || isPosFullAccessRole(user?.role)
      ? null
      : (user?.allowed_outlet_ids || [])

  /** @type {import('./app-context.jsx').AccessContextValue} */
  const accessContextValue = {
    ...buildCapabilitySnapshot({
      role: user?.role,
      isMasterAdmin: user?.isMasterAdmin,
      features,
      capabilityOverrides: user?.capability_overrides || {},
      productId: trialStatus?.product_id || null,
      commercialPackageKey: trialStatus?.commercial_package_key || null,
      commercialAddonKeys: trialStatus?.enterprise_addons || [],
      commercialEntitlement: trialStatus,
      commercialLodgeId: trialStatus?.lodge_id || activeProfile?.lodge_id || null
    }),
    entitlement: trialStatus,
    allowedOutletIds: _allowedOutletIds,
    refreshEntitlement
  }

  // Master admin gets Command Central, no regular app
  if (user?.isMasterAdmin) {
    return (
      <AuthContext.Provider value={authContextValue}>
        <ProfilesContext.Provider value={profilesContextValue}>
          <SettingsContext.Provider value={settingsContextValue}>
            <ToastProvider>
              <AppErrorBoundary>
                <Lazy><AdminCentral /></Lazy>
              </AppErrorBoundary>
            </ToastProvider>
          </SettingsContext.Provider>
        </ProfilesContext.Provider>
      </AuthContext.Provider>
    )
  }

  // Trial expired and no license — full lock screen after lodge login
  if (user && trialStatus?.expired) {
    const operatingProfile = IS_HPOS_PRODUCT && settings
      ? (isBarOnlyMode(settings) ? 'bar_only' : 'restaurant_bar')
      : null
    const propertyType = String(settings?.property_type || settings?.business_type || '').trim().toLowerCase() || null
    return <TrialExpiredScreen
      lodgeName={settings?.lodge_name}
      lodgeId={settings?.lodge_id}
      operatingProfile={operatingProfile}
      propertyType={propertyType}
      user={user}
      onSwitchAccount={switchAccount}
    />
  }

  return (
    <AuthContext.Provider value={authContextValue}>
      <ProfilesContext.Provider value={profilesContextValue}>
      <AccessContext.Provider value={accessContextValue}>
      <FeaturesContext.Provider value={features}>
      <OnlineRequestsContext.Provider value={{ count: onlineRequests.length, requests: onlineRequests, refresh: refreshOnlineRequests }}>
      <SettingsContext.Provider value={settingsContextValue}>
        <AppErrorBoundary>
          <HashRouter>
            <UnsavedChangesContext.Provider value={navigationGuardRef}>
            {/* Phase 1: Unified Notification Center */}
            <div className="fixed top-4 right-4 z-[9999] flex flex-col items-end gap-3 pointer-events-none [&>*]:pointer-events-auto">
              <UpdateBanner />
              <BroadcastBanner />
              <SyncFailBanner />
              <FinancialHealthBanner />
              <BookingSyncConflictNotification />
              {user && !IS_HPOS_PRODUCT && trialStatus?.status === 'trial' && trialStatus?.lodge_id && !user?.isMasterAdmin && (
                <TrialBanner daysLeft={trialStatus.daysLeft} />
              )}
            </div>
            <Routes>
              <Route
                path="/welcome"
                element={profiles.length === 0 ? <Lazy><Welcome /></Lazy> : <Navigate to="/choose-lodge" replace />}
              />
              <Route
                path="/choose-lodge"
                element={profiles.length > 0 ? <Lazy><LodgeChooser /></Lazy> : <Navigate to="/welcome" replace />}
              />
              <Route
                path="/login"
                element={user ? <Navigate to="/" replace /> : <Lazy><Login /></Lazy>}
              />
              <Route
                path="/setup"
                element={
                  activeProfile?.status === 'draft'
                    ? <Lazy><Setup onComplete={handleSetupComplete} /></Lazy>
                    : <Navigate to={preAuthFallbackPath} replace />
                }
              />
              <Route
                path="/master-setup"
                element={<Lazy><MasterSetup onComplete={() => { window.location.hash = '/login' }} /></Lazy>}
              />
              <Route
                path="/"
                element={
                  <ProtectedRoute fallbackPath={preAuthFallbackPath} isTransitioning={isLoggingIn}>
                    <ProductShellGuard>
                      <RestaurantGuard>
                        <HposAwareLayout />
                      </RestaurantGuard>
                    </ProductShellGuard>
                  </ProtectedRoute>
                }
              >
                {/* Always available — eager */}
                <Route index element={<ProductHome />} />
                <Route path="rooms" element={<Lazy><Rooms /></Lazy>} />
                <Route path="bookings"    element={<Lazy><Bookings /></Lazy>} />
                <Route path="quotations" element={<Lazy><Quotations /></Lazy>} />
                <Route path="invoices" element={<Lazy><BookingInvoices /></Lazy>} />
                <Route path="prepayments" element={<Lazy><Prepayments /></Lazy>} />
                {/* Always available — lazy */}
                <Route path="calendar"    element={<Lazy><Calendar /></Lazy>} />
                <Route path="roomgrid"    element={<Lazy><RoomGrid /></Lazy>} />
                <Route path="guests"      element={<Lazy><Guests /></Lazy>} />
                <Route path="housekeeping" element={<Lazy><Housekeeping /></Lazy>} />
                <Route path="maintenance" element={<Lazy><Maintenance /></Lazy>} />
                <Route path="settings"    element={<CapabilityRoute capability="settings.view"><Lazy><Settings /></Lazy></CapabilityRoute>} />
                {/* Standard tier — lazy (UpgradeWall outside Lazy so wall renders without loading) */}
                <Route path="reports"    element={<UpgradeWall feature="reports">   <RestaurantReportsEntry />    </UpgradeWall>} />
                <Route path="basic-reports" element={<CapabilityRoute capability="reports.basic_view"><UpgradeWall feature="basic_reports"><Lazy><BasicReports /></Lazy></UpgradeWall></CapabilityRoute>} />
                <Route path="starter-backup" element={<CapabilityRoute capability="backup.starter_export"><UpgradeWall feature="starter_backup"><Lazy><StarterBackup /></Lazy></UpgradeWall></CapabilityRoute>} />
                <Route path="expenses"   element={<UpgradeWall feature="expenses">  <RestaurantExpensesEntry />   </UpgradeWall>} />
                <Route path="staff"      element={<UpgradeWall feature="staff_basic"><Lazy><Staff /></Lazy>      </UpgradeWall>} />
                <Route path="audit"      element={<UpgradeWall feature="audit">     <Lazy><NightAudit /></Lazy> </UpgradeWall>} />
                <Route path="conference" element={<UpgradeWall feature="conference"><Lazy><Conference /></Lazy>  </UpgradeWall>} />
                <Route path="dayuse"     element={<UpgradeWall feature="pool">      <Lazy><DayUse /></Lazy>     </UpgradeWall>} />
                <Route path="workforce" element={<UpgradeWall feature="workforce_management"><Lazy><StaffOperations /></Lazy></UpgradeWall>} />
                <Route path="assets"   element={<UpgradeWall feature="asset_management">   <Lazy><AssetManagement /></Lazy></UpgradeWall>} />
                <Route path="venues"   element={<UpgradeWall feature="venue_management">   <Lazy><VenueManagement /></Lazy></UpgradeWall>} />
                <Route path="data-management" element={<UpgradeWall feature="import"><Lazy><DataManagement /></Lazy></UpgradeWall>} />
                {/* Pro tier — lazy */}
                <Route path="pos"        element={<UpgradeWall feature="pos">       <RestaurantPosEntry />        </UpgradeWall>} />
                <Route
                  path="food-beverage/:workspace?"
                  element={IS_LODGE_PRODUCT
                    ? <UpgradeWall feature="pos"><Lazy><LodgeFoodBeverageHub /></Lazy></UpgradeWall>
                    : <Navigate to="/" replace />}
                />
                <Route path="inventory"  element={<UpgradeWall feature="inventory"> <Lazy><Inventory /></Lazy>  </UpgradeWall>} />
                <Route path="supplies"   element={<UpgradeWall feature="supplies">  <Lazy><RoomSupplies /></Lazy></UpgradeWall>} />
                <Route path="ai"         element={IS_HPOS_PRODUCT ? <Navigate to="/hpos/pos" replace /> : <Lazy><OpsAi /></Lazy>} />

                {/* Hotel / Enterprise — consolidated redirects */}
                <Route path="hotel-dashboard" element={IS_HOTEL_PRODUCT ? <Lazy><HotelHome /></Lazy> : <UpgradeWall feature="front_desk_dashboard"><Lazy><HotelDashboard /></Lazy></UpgradeWall>} />
                <Route path="room-types" element={<Navigate to="/rooms?tab=room-types" replace />} />
                <Route path="floors" element={<Navigate to="/rooms?tab=floors-sections" replace />} />
                <Route path="room-attributes" element={<Navigate to="/rooms?tab=attributes" replace />} />
                <Route path="hotel-reports" element={<Navigate to="/reports?tab=hotel-kpis" replace />} />
                <Route path="enterprise-reports" element={<Navigate to="/reports?tab=enterprise" replace />} />
                <Route path="advanced-housekeeping" element={<Navigate to="/housekeeping?tab=turnover" replace />} />
                <Route path="housekeeping-command-center" element={<Navigate to="/housekeeping?tab=assignments" replace />} />
                <Route path="maintenance-enterprise" element={<Navigate to="/maintenance?tab=preventive" replace />} />
                <Route path="hotel-roles" element={<Navigate to="/staff?tab=hotel-roles" replace />} />
                <Route path="corporate-billing" element={<Navigate to="/corporate?tab=billing" replace />} />
                <Route path="rate-calendar" element={<Navigate to="/rate-plans?tab=calendar" replace />} />
                <Route path="revenue-manager" element={<Navigate to="/rate-plans?tab=revenue" replace />} />
                <Route path="promo-codes" element={<Navigate to="/rate-plans?tab=promo-codes" replace />} />
                <Route path="checkin-workflow" element={<UpgradeWall feature="checkin_workflow"><Lazy><CheckinWorkflow /></Lazy></UpgradeWall>} />
                <Route path="early-late-checkout" element={<Navigate to="/bookings?tab=early-late" replace />} />
                <Route path="cancellation-policies" element={<Navigate to="/bookings?tab=cancellations" replace />} />
                <Route path="documents" element={<Navigate to={BUILD_PRODUCT.defaultHome || '/'} replace />} />
                <Route path="payment-links" element={<Navigate to="/folios" replace />} />
                <Route path="booking-engine" element={<Navigate to="/rate-plans?tab=booking-engine" replace />} />
                <Route path="night-audit-enterprise" element={<UpgradeWall feature="night_audit_enterprise"><Lazy><NightAuditEnterprise /></Lazy></UpgradeWall>} />
                <Route path="payment-gateway-config" element={<Navigate to="/" replace />} />
                {/* Hotel / Enterprise — distinct modules */}
                <Route path="folios" element={<UpgradeWall feature="folios"><Lazy><Folios /></Lazy></UpgradeWall>} />
                <Route path="corporate" element={<UpgradeWall feature="corporate_accounts"><Lazy><CorporateAccounts /></Lazy></UpgradeWall>} />
                <Route path="rate-plans" element={<UpgradeWall feature="rate_plans"><Lazy><RatePlans /></Lazy></UpgradeWall>} />
                <Route path="room-moves" element={<UpgradeWall feature="room_moves"><Lazy><RoomMoves /></Lazy></UpgradeWall>} />
                <Route path="subscription-builder" element={<Lazy><SubscriptionPackageBuilder /></Lazy>} />
                <Route path="custom-website" element={<Navigate to="/" replace />} />
                <Route path="channel-manager" element={<UpgradeWall feature="channel_manager"><Lazy><ChannelManager /></Lazy></UpgradeWall>} />
                <Route path="guest-messaging" element={<UpgradeWall feature="guest_messaging"><Lazy><GuestMessaging /></Lazy></UpgradeWall>} />
                <Route path="guest-portal" element={<UpgradeWall feature="guest_portal"><Lazy><GuestPortalConfig /></Lazy></UpgradeWall>} />
                <Route path="multi-property" element={<UpgradeWall feature="multi_property"><Lazy><MultiPropertyDashboard /></Lazy></UpgradeWall>} />
                <Route path="guest-crm" element={<UpgradeWall feature="guest_crm"><Lazy><GuestCRM /></Lazy></UpgradeWall>} />
                <Route path="operations-compliance" element={<UpgradeWall feature="operations_compliance"><Lazy><OperationsCompliance /></Lazy></UpgradeWall>} />
                <Route path="restaurant/outlet-control" element={<RestaurantOnlyRoute><BarAddonFeatureRoute feature="multi_outlet_controls"><Lazy><MultiOutletPos /></Lazy></BarAddonFeatureRoute></RestaurantOnlyRoute>} />
                <Route path="multi-outlet-pos" element={<Navigate to="/restaurant/outlet-control" replace />} />
                <Route path="group-operations" element={<UpgradeWall feature="group_operations"><Lazy><GroupOperations /></Lazy></UpgradeWall>} />
                {/* Restaurant workspaces. The legacy standalone routes below remain valid deep links. */}
                <Route path="restaurant/floor" element={<RestaurantOnlyRoute><Navigate to="/hpos/floor" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/floor-workspace" element={<RestaurantOnlyRoute><UpgradeWall feature="pos"><Lazy><RestaurantWorkspace workspace="floor" defaultTab="tables" /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="restaurant/kitchen-workspace" element={<RestaurantOnlyRoute><UpgradeWall feature="kitchen_tickets"><Lazy><RestaurantWorkspace workspace="kitchen" defaultTab="live" /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="restaurant/menu-production" element={<RestaurantOnlyRoute><BarAddonFeatureRoute feature="recipes"><Lazy><RestaurantWorkspace workspace="menu" defaultTab="menu" /></Lazy></BarAddonFeatureRoute></RestaurantOnlyRoute>} />
                <Route path="restaurant/stock-purchasing" element={<RestaurantOnlyRoute><Navigate to="/restaurant/inventory" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/team" element={<RestaurantOnlyRoute><Navigate to="/restaurant/team-workspace" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/team-workspace" element={<RestaurantOnlyRoute><BarAddonFeatureRoute feature="workforce_management"><Lazy><RestaurantWorkspace workspace="team" defaultTab="shifts" /></Lazy></BarAddonFeatureRoute></RestaurantOnlyRoute>} />
                <Route path="restaurant/finance-close" element={<RestaurantOnlyRoute><UpgradeWall feature="reports"><Lazy><RestaurantWorkspace workspace="finance" defaultTab="overview" /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="restaurant/cash-close" element={<RestaurantOnlyRoute><Navigate to="/restaurant/finance-close?tab=cashups" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/control" element={<RestaurantOnlyRoute><Navigate to="/restaurant/control-workspace" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/control-workspace" element={<RestaurantOnlyRoute><UpgradeWall feature="pos"><Lazy><RestaurantWorkspace workspace="control" defaultTab="checklists" /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                {/* ── Restaurant standalone modules ─────────────────────────────── */}
                <Route path="restaurant/tables" element={<RestaurantOnlyRoute><Navigate to="/hpos/floor" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/kitchen" element={<RestaurantOnlyRoute><Navigate to="/hpos/kitchen" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/menu" element={<RestaurantOnlyRoute><Navigate to="/hpos/menu" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/recipes" element={<RestaurantOnlyRoute><UpgradeWall feature="recipes"><Lazy><RestaurantWorkspace workspace="menu" defaultTab="recipes" /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="restaurant/stock" element={<RestaurantOnlyRoute><Navigate to="/hpos/stock" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/purchasing" element={<RestaurantOnlyRoute><UpgradeWall feature="purchasing"><Lazy><RestaurantWorkspace workspace="stock" defaultTab="purchasing" /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="restaurant/shifts" element={<RestaurantOnlyRoute><Navigate to="/hpos/team" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/cash-drawer" element={<RestaurantOnlyRoute><Navigate to="/hpos/cash" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/daily-close" element={<RestaurantOnlyRoute><Navigate to="/restaurant/finance-close?tab=daily-close" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/customers" element={<RestaurantOnlyRoute><Navigate to="/hpos/customers" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/checklists" element={<RestaurantOnlyRoute><Navigate to="/hpos/control" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/alerts" element={<RestaurantOnlyRoute><Navigate to="/hpos/control" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/owner-digest" element={<RestaurantOnlyRoute><Navigate to="/restaurant/finance-close?tab=owner-review" replace /></RestaurantOnlyRoute>} />
                {/* Phase 6: Differentiators */}
                <Route path="restaurant/reservations" element={<RestaurantOnlyRoute><UpgradeWall feature="pos"><Lazy><RestaurantWorkspace workspace="floor" defaultTab="reservations" /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="restaurant/combos" element={<RestaurantOnlyRoute><UpgradeWall feature="pos"><Lazy><RestaurantWorkspace workspace="menu" defaultTab="combos" /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="restaurant/recipe-variance" element={<RestaurantOnlyRoute><UpgradeWall feature="variance"><Lazy><RestaurantWorkspace workspace="menu" defaultTab="variance" /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="restaurant/staff-performance" element={<RestaurantOnlyRoute><UpgradeWall feature="performance"><Lazy><RestaurantWorkspace workspace="team" defaultTab="performance" /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="restaurant/prep-batches" element={<RestaurantOnlyRoute><UpgradeWall feature="prep"><Lazy><RestaurantWorkspace workspace="menu" defaultTab="prep" /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="restaurant/kitchen-analytics" element={<RestaurantOnlyRoute><UpgradeWall feature="performance"><Lazy><RestaurantWorkspace workspace="kitchen" defaultTab="analytics" /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="restaurant/stations" element={<RestaurantOnlyRoute><UpgradeWall feature="pos"><Lazy><RestaurantWorkspace workspace="kitchen" defaultTab="stations" /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="restaurant/inventory" element={<RestaurantOnlyRoute><BarAddonFeatureRoute feature="inventory_advanced"><Lazy><RestaurantWorkspace workspace="stock" defaultTab="stock" /></Lazy></BarAddonFeatureRoute></RestaurantOnlyRoute>} />
                <Route path="restaurant/lots-expiry" element={<RestaurantOnlyRoute><BarAddonFeatureRoute feature="lots_expiry"><Lazy><RestaurantWorkspace workspace="stock" defaultTab="lots" /></Lazy></BarAddonFeatureRoute></RestaurantOnlyRoute>} />
                <Route path="restaurant/tips" element={<RestaurantOnlyRoute><Navigate to="/restaurant/finance-close?tab=tips" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/settlements" element={<RestaurantOnlyRoute><Navigate to="/restaurant/finance-close?tab=settlements" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/feedback-deposits" element={<RestaurantOnlyRoute><Navigate to="/restaurant/finance-close?tab=customer-funds" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/gift-cards-policies" element={<RestaurantOnlyRoute><Navigate to="/restaurant/finance-close?tab=customer-funds" replace /></RestaurantOnlyRoute>} />
                <Route path="restaurant/purchase-suggestions" element={<RestaurantOnlyRoute><UpgradeWall feature="stock_control"><Lazy><RestaurantWorkspace workspace="stock" defaultTab="suggestions" /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                {/* ── Restaurant Accounting (Finance module) ──────────────────────────────── */}
                <Route path="restaurant/chart-of-accounts" element={<RestaurantOnlyRoute><RestaurantAccountingRoute><Lazy><RestaurantChartOfAccounts /></Lazy></RestaurantAccountingRoute></RestaurantOnlyRoute>} />
                <Route path="restaurant/general-ledger" element={<RestaurantOnlyRoute><RestaurantAccountingRoute><Lazy><RestaurantGeneralLedger /></Lazy></RestaurantAccountingRoute></RestaurantOnlyRoute>} />
                <Route path="restaurant/bank-reconciliation" element={<RestaurantOnlyRoute><RestaurantAccountingRoute><Lazy><RestaurantBankReconciliation /></Lazy></RestaurantAccountingRoute></RestaurantOnlyRoute>} />
                <Route path="restaurant/accounts-payable" element={<RestaurantOnlyRoute><RestaurantAccountingRoute><Lazy><RestaurantAccountsPayable /></Lazy></RestaurantAccountingRoute></RestaurantOnlyRoute>} />
                <Route path="restaurant/tax-returns" element={<RestaurantOnlyRoute><RestaurantAccountingRoute><Lazy><RestaurantTaxReturns /></Lazy></RestaurantAccountingRoute></RestaurantOnlyRoute>} />
                <Route path="restaurant/budgets" element={<RestaurantOnlyRoute><RestaurantAccountingRoute><Lazy><RestaurantBudgets /></Lazy></RestaurantAccountingRoute></RestaurantOnlyRoute>} />
                <Route path="restaurant/balance-sheet" element={<RestaurantOnlyRoute><RestaurantAccountingRoute><Lazy><RestaurantBalanceSheet /></Lazy></RestaurantAccountingRoute></RestaurantOnlyRoute>} />
                <Route path="restaurant/payroll" element={<RestaurantOnlyRoute><RestaurantAccountingRoute payroll><Lazy><RestaurantPayroll /></Lazy></RestaurantAccountingRoute></RestaurantOnlyRoute>} />
                <Route path="restaurant/accounting-setup" element={<RestaurantOnlyRoute><RestaurantAccountingRoute><Lazy><RestaurantAccountingActivation /></Lazy></RestaurantAccountingRoute></RestaurantOnlyRoute>} />
                {/* ── HPOS: New restaurant UI routes ────────────────────────────────── */}
                <Route path="hpos/" element={<RestaurantOnlyRoute><Lazy><HposTerminal /></Lazy></RestaurantOnlyRoute>} />
                <Route path="hpos/floor" element={<RestaurantOnlyRoute><UpgradeWall feature="tables"><Lazy><HposFloorPlan /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="hpos/service" element={<RestaurantOnlyRoute><UpgradeWall feature="tables"><Lazy><HposServiceReservations /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="hpos/kitchen" element={<RestaurantOnlyRoute><UpgradeWall feature="kitchen_tickets"><Lazy><HposKitchen /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="hpos/menu" element={<RestaurantOnlyRoute><Lazy><HposMenu /></Lazy></RestaurantOnlyRoute>} />
                <Route path="hpos/stock" element={<RestaurantOnlyRoute><UpgradeWall feature="inventory"><Lazy><HposStock /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="hpos/team" element={<RestaurantOnlyRoute><CapabilityRoute capability="staff.view"><Lazy><HposTeam /></Lazy></CapabilityRoute></RestaurantOnlyRoute>} />
                <Route path="hpos/my-shift" element={<RestaurantOnlyRoute><Lazy><HposMyShift /></Lazy></RestaurantOnlyRoute>} />
                <Route path="hpos/my-sales" element={<RestaurantOnlyRoute><Lazy><HposMySales /></Lazy></RestaurantOnlyRoute>} />
                <Route path="hpos/sale-correction" element={<RestaurantOnlyRoute><Lazy><HposReports correctionMode /></Lazy></RestaurantOnlyRoute>} />
                <Route path="hpos/my-cashup" element={<RestaurantOnlyRoute><Lazy><HposMyCashup /></Lazy></RestaurantOnlyRoute>} />
                <Route path="hpos/shift-close" element={<RestaurantOnlyRoute><Lazy><HposSharedShiftClose /></Lazy></RestaurantOnlyRoute>} />
                <Route path="hpos/attendance" element={<RestaurantOnlyRoute><Navigate to="/hpos/shift-close" replace /></RestaurantOnlyRoute>} />
                <Route path="hpos/shared-cashup" element={<RestaurantOnlyRoute><Navigate to="/hpos/shift-close" replace /></RestaurantOnlyRoute>} />
                <Route path="hpos/cash" element={<RestaurantOnlyRoute><Lazy><HposCashClose /></Lazy></RestaurantOnlyRoute>} />
                <Route path="hpos/reports" element={<RestaurantOnlyRoute><CapabilityRoute capability="pos.reports"><UpgradeWall feature="reports"><Lazy><HposReports /></Lazy></UpgradeWall></CapabilityRoute></RestaurantOnlyRoute>} />
                <Route path="hpos/expenses" element={<RestaurantOnlyRoute><BarAddonFeatureRoute feature="expenses"><Lazy><HposExpenses /></Lazy></BarAddonFeatureRoute></RestaurantOnlyRoute>} />
                <Route path="hpos/customers" element={<RestaurantOnlyRoute><UpgradeWall feature="customer_accounts"><Lazy><HposCustomers /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="hpos/growth-tools" element={<RestaurantOnlyRoute><BarAddonFeatureRoute feature="vouchers"><Lazy><RestaurantGrowthControls tabKey="growth" /></Lazy></BarAddonFeatureRoute></RestaurantOnlyRoute>} />
                <Route path="hpos/control" element={<RestaurantOnlyRoute><UpgradeWall feature="checklists"><Lazy><HposControl /></Lazy></UpgradeWall></RestaurantOnlyRoute>} />
                <Route path="hpos/manage" element={<RestaurantOnlyRoute><Lazy><HposManageHub /></Lazy></RestaurantOnlyRoute>} />
                <Route path="hpos/setup-readiness" element={<RestaurantOnlyRoute><Lazy><HposSetupReadiness /></Lazy></RestaurantOnlyRoute>} />
                <Route path="hpos/pos" element={<RestaurantOnlyRoute><Lazy><HposTerminal /></Lazy></RestaurantOnlyRoute>} />
                <Route path="hpos/checks" element={<RestaurantOnlyRoute><Lazy><HposOpenChecks /></Lazy></RestaurantOnlyRoute>} />
                <Route path="hpos/system-health" element={<RestaurantOnlyRoute><CapabilityRoute capability="system.health"><Lazy><HposSystemHealth /></Lazy></CapabilityRoute></RestaurantOnlyRoute>} />
                <Route path="hpos/business-control" element={<RestaurantOnlyRoute><CapabilityRoute capability="advanced_reports.view"><BarAddonFeatureRoute feature="advanced_reports"><Lazy><HposBusinessControl /></Lazy></BarAddonFeatureRoute></CapabilityRoute></RestaurantOnlyRoute>} />
              </Route>
              <Route
                path="/pos/customer-display"
                element={
                  <ProtectedRoute fallbackPath={preAuthFallbackPath} isTransitioning={isLoggingIn}>
                    <UpgradeWall feature="pos">
                      <CustomerDisplay />
                    </UpgradeWall>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/pos/kitchen-display"
                element={
                  <ProtectedRoute fallbackPath={preAuthFallbackPath} isTransitioning={isLoggingIn}>
                    <BarOnlyBlockedRedirect>
                      <UpgradeWall feature="pos">
                        <PrepDisplay station="kitchen" />
                      </UpgradeWall>
                    </BarOnlyBlockedRedirect>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/pos/bar-display"
                element={
                  <ProtectedRoute fallbackPath={preAuthFallbackPath} isTransitioning={isLoggingIn}>
                    <UpgradeWall feature="pos">
                      <PrepDisplay station="bar" />
                    </UpgradeWall>
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to={user ? '/' : preAuthFallbackPath} replace />} />
            </Routes>
            </UnsavedChangesContext.Provider>
          </HashRouter>
        </AppErrorBoundary>
      </SettingsContext.Provider>
      </OnlineRequestsContext.Provider>
      </FeaturesContext.Provider>
      </AccessContext.Provider>
      </ProfilesContext.Provider>
    </AuthContext.Provider>
  )
}
