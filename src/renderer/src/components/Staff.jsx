import React, { useEffect, useMemo, useState, useCallback, Suspense, lazy } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  Plus,
  Pencil,
  ShieldCheck,
  User,
  CalendarPlus,
  LogIn,
  LogOut,
  XCircle,
  CreditCard,
  Sparkles,
  ClipboardList,
  FolderOpen,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  BedDouble,
  CheckCircle2,
  Trash2,
  Lock,
  Users2,
  Eye,
  EyeOff,
  Mail,
  Briefcase
} from 'lucide-react'
import { Modal } from './shared/Modal'
import UsageLimitIndicator from './shared/UsageLimitIndicator'
import UsageUpgradePrompt from './shared/UpgradePromptModal'
import UpgradeNudgeBanner from './shared/UpgradeNudgeBanner'
import { useAccess, useAuth, useSettings, useFeatures } from '../app-context'
import { isBarOnlyMode, isRestaurantOnly } from '../../../shared/propertyTypes'
import {
  CAPABILITY_LABELS,
  ROLE_DEFINITIONS,
  STAFF_STATUS_LABELS,
  buildCapabilitySnapshot,
  getRoleOptions,
  canAccessCapability,
  isPwaEligibleRole,
  isPosOutletScopedRole,
  normalizeAppRole,
  normalizeStaffStatus
} from '../../../shared/accessControl'
import { MONTHLY_USAGE_RESET_COPY, canCreateUser, getEarlyUpgradePromptState, getPlanUsageLimits, normalizeSubscriptionPlan } from '../../../shared/subscriptionPlans'

const HotelRolesConfig = lazy(() => import('./HotelRolesConfig'))

const emptyForm = {
  name: '',
  email: '',
  pin: '',
  role: 'receptionist',
  status: 'active',
  pwa_enabled: false,
  pwa_password: '',
  pwa_disabled_reason: '',
  allowed_outlet_ids: [],
  capability_overrides: {}
}

const emptyResetForm = {
  password: '',
  confirmPassword: ''
}

const MANAGER_MANAGED_ROLES = new Set(['cashier', 'supervisor', 'receptionist', 'operations'])

const RESTAURANT_CAPABILITY_KEYS = new Set([
  'pos.view', 'pos.manage', 'pos.void', 'pos.discount', 'pos.price_override',
  'pos.menu_manage', 'pos.cashup', 'pos.reports', 'pos.combined_reports',
  'reports.export',
  'inventory.view', 'inventory.manage', 'staff.view', 'staff.manage',
  'staff.permissions', 'reports.view', 'expenses.view', 'expenses.manage',
  'settings.view', 'settings.manage_general', 'system.health', 'sync.manage',
  'data.export', 'accounting.read', 'accounting.manage', 'accounting.export',
  'accounting.ap_pay', 'accounting.bank_approve', 'accounting.tax_file',
  'accounting.payroll_view', 'accounting.payroll_manage', 'accounting.close'
])

function staffRoleLabel(role, restaurantMode = false) {
  if (!restaurantMode) return ROLE_DEFINITIONS[role]?.label || role || 'Staff'
  return {
    cashier: 'Till operator / cashier',
    supervisor: 'Service supervisor',
    finance: 'Finance & reporting',
    manager: 'Service manager',
    admin: 'Business owner / admin'
  }[role] || ROLE_DEFINITIONS[role]?.label || 'Restaurant staff'
}

function staffRoleHighlights(role, restaurantMode = false) {
  if (!restaurantMode) return ROLE_DEFINITIONS[role]?.highlights || []
  return {
    cashier: ['Take orders', 'Take payment', 'Assigned outlets'],
    supervisor: ['Service oversight', 'Voids & discounts', 'Cash close'],
    finance: ['Payment review', 'Expenses', 'Sales reports'],
    manager: ['Daily operations', 'Team access', 'Stock & cash control'],
    admin: ['Business setup', 'Access control', 'Recovery & subscription']
  }[role] || ROLE_DEFINITIONS[role]?.highlights || []
}

function visibleCapabilityEntries(snapshot, restaurantMode = false) {
  return Object.entries(snapshot?.capabilities || {}).filter(([capability, allowed]) => (
    allowed && (!restaurantMode || RESTAURANT_CAPABILITY_KEYS.has(capability))
  ))
}

function isManagerManagedRole(role) {
  return MANAGER_MANAGED_ROLES.has(normalizeAppRole(role))
}

function roleTone(role) {
  return {
    cashier: 'bg-orange-100 text-orange-700',
    supervisor: 'bg-teal-100 text-teal-700',
    receptionist: 'bg-emerald-100 text-emerald-700',
    operations: 'bg-amber-100 text-amber-700',
    finance: 'bg-sky-100 text-sky-700',
    manager: 'bg-violet-100 text-violet-700',
    admin: 'bg-rose-100 text-rose-700'
  }[role] || 'bg-gray-100 text-gray-600'
}

function roleDescription(role, restaurantMode) {
  if (!restaurantMode) return ROLE_DEFINITIONS[role]?.description || ROLE_DEFINITIONS.receptionist.description
  return {
    cashier: 'Takes orders, payments, and open tabs at assigned outlets.',
    supervisor: 'Supervises service, approves discounts and voids, and reviews outlet sales.',
    finance: 'Reviews payments, refunds, expenses, settlements, and sales reports.',
    manager: 'Runs daily service operations, staff access, stock, cash controls, and owner reporting.',
    admin: 'Owns business configuration, subscriptions, recovery tools, and high-risk controls.'
  }[role] || ROLE_DEFINITIONS[role]?.description || 'Service operational access.'
}

function formatShortDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDateTime(value) {
  if (!value) return ''
  return new Date(value).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function statusTone(status) {
  return {
    active: 'bg-emerald-100 text-emerald-700',
    suspended: 'bg-amber-100 text-amber-700',
    archived: 'bg-slate-200 text-slate-700'
  }[normalizeStaffStatus(status)] || 'bg-slate-100 text-slate-600'
}

function summarizeActivity(staffUser) {
  const items = []
  if (staffUser.last_desktop_sign_in_at) items.push(`Desktop sign-in ${formatDateTime(staffUser.last_desktop_sign_in_at)}`)
  if (staffUser.last_pwa_sign_in_at) items.push(`Mobile sign-in ${formatDateTime(staffUser.last_pwa_sign_in_at)}`)
  if (staffUser.last_activity_at) items.push(`Last activity ${formatDateTime(staffUser.last_activity_at)}`)
  if (staffUser.invite_sent_at && !staffUser.last_sign_in_at) items.push(`Invite sent ${formatDateTime(staffUser.invite_sent_at)}`)
  if (staffUser.password_updated_at) items.push(`Password updated ${formatDateTime(staffUser.password_updated_at)}`)
  items.push(staffUser.has_pin || staffUser.pin_hash ? 'Approval PIN set' : 'No approval PIN')
  return items
}

function buildUserPayload(form, existingUser = null) {
  const payload = {
    name: form.name,
    email: form.email,
    role: form.role,
    status: form.status,
    allowed_outlet_ids: Array.isArray(form.allowed_outlet_ids) ? form.allowed_outlet_ids : [],
    capability_overrides: form.capability_overrides && typeof form.capability_overrides === 'object' ? form.capability_overrides : {}
  }

  if (form.pin) payload.pin = form.pin

  const pwaEligible = isPwaEligibleRole(form.role)
  const existingEligible = isPwaEligibleRole(existingUser?.role)
  const pwaToggleChanged = form.pwa_enabled !== (existingUser?.pwa_enabled === true)
  const pwaReasonChanged = !form.pwa_enabled && (form.pwa_disabled_reason || '') !== (existingUser?.pwa_disabled_reason || '')
  const pwaPasswordChanged = Boolean(form.pwa_password)

  if (!existingUser) {
    if (pwaEligible) {
      payload.pwa_enabled = form.pwa_enabled === true
      if (form.pwa_password) payload.pwa_password = form.pwa_password
      if (!form.pwa_enabled && form.pwa_disabled_reason) payload.pwa_disabled_reason = form.pwa_disabled_reason
    }
    return payload
  }

  if (pwaPasswordChanged) payload.pwa_password = form.pwa_password
  if (pwaToggleChanged) payload.pwa_enabled = form.pwa_enabled === true
  if (pwaReasonChanged) payload.pwa_disabled_reason = form.pwa_disabled_reason

  if (existingEligible && !pwaEligible) {
    payload.role = form.role
  }

  return payload
}

function StaffMembers() {
  const navigate = useNavigate()
  const { user: currentUser } = useAuth()
  const access = useAccess()
  const features = useFeatures()
  const starterAccessLite = features?.staff_basic === true && features?.staff !== true
  const { settings } = useSettings()
  const propertyType = settings?.property_type || settings?.business_type || 'lodge'
  const restaurantMode = isRestaurantOnly(propertyType)
  const barOnly = isBarOnlyMode(settings)
  const propertyLabel = barOnly ? 'bar' : restaurantMode ? 'restaurant' : 'lodge'
  const currentRole = normalizeAppRole(currentUser?.role)
  const canManageStaff = canAccessCapability(access, 'staff.manage')
  const usageLimits = getPlanUsageLimits(access?.entitlement?.plan || 'Starter')
  const canSetRoles = canManageStaff && !starterAccessLite && ['admin', 'super_admin'].includes(currentRole)
  const isLimitedStaffManager = canManageStaff && currentRole === 'manager'

  const [users, setUsers] = useState([])
  const [usageSnapshot, setUsageSnapshot] = useState(null)
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editingUser, setEditingUser] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [outlets, setOutlets] = useState([])
  const [outletsReady, setOutletsReady] = useState(false)
  const [resetTarget, setResetTarget] = useState(null)
  const [resetForm, setResetForm] = useState(emptyResetForm)
  const [resetError, setResetError] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [inviteLoadingId, setInviteLoadingId] = useState(null)
  const [inviteNotice, setInviteNotice] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [showCreatePassword, setShowCreatePassword] = useState(false)
  const [showPin, setShowPin] = useState(false)
  const [showPwaPassword, setShowPwaPassword] = useState(false)
  const [showResetPassword, setShowResetPassword] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [sortBy, setSortBy] = useState('role_asc')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [showPermissionOverrides, setShowPermissionOverrides] = useState(false)
  const currentPlan = normalizeSubscriptionPlan(usageSnapshot?.plan || access?.entitlement?.plan || 'Starter')

  useEffect(() => {
    window.api.outlets.getAll()
      .then(d => setOutlets(d || []))
      .catch(() => setOutlets([]))
      .finally(() => setOutletsReady(true))
  }, [])

  const availableRoles = useMemo(() => {
    return getRoleOptions().filter((role) => {
      if (role.value === 'super_admin') return false
      if (starterAccessLite && !['receptionist', 'operations'].includes(role.value)) return false
      if (restaurantMode && ['receptionist', 'operations'].includes(role.value)) return false
      if (isLimitedStaffManager && !isManagerManagedRole(role.value)) return false
      if (role.value === 'admin') return currentUser?.role === 'admin' || currentUser?.role === 'super_admin' || currentUser?.isMasterAdmin
      return true
    })
  }, [currentUser?.isMasterAdmin, currentUser?.role, isLimitedStaffManager, restaurantMode, starterAccessLite])

  const load = useCallback(async () => {
    setLoadingUsers(true)
    setLoadError('')
    try {
      const data = await window.api.users.getAll()
      setUsers(Array.isArray(data) ? data : [])
      window.api.usage.getSnapshot?.().then((snapshot) => {
        if (!snapshot?.error) setUsageSnapshot(snapshot)
      }).catch(() => {})
    } catch (loadFailure) {
      setUsers([])
      setLoadError(loadFailure?.message || 'Could not load the service team. Check the connection, then try again.')
    } finally {
      setLoadingUsers(false)
    }
  }, [])

  const adminCount = useMemo(
    () => users.filter((user) => normalizeAppRole(user.role) === 'admin' && ['active', 'suspended'].includes(normalizeStaffStatus(user.status))).length,
    [users]
  )
  const userLimitStatus = usageSnapshot?.statuses?.users || canCreateUser({ plan: access?.entitlement?.plan || 'Starter', used: users.length })
  const staffEarlyPrompt = getEarlyUpgradePromptState({
    plan: currentPlan,
    bookingsUsage: usageSnapshot?.usage?.monthlyBookings ?? 0,
    roomsUsage: usageSnapshot?.usage?.rooms ?? 0,
    usersUsage: usageSnapshot?.usage?.users ?? users.length,
    limits: usageLimits
  })
  const showStaffEarlyPrompt = !userLimitStatus.isBlocked && staffEarlyPrompt.shouldPrompt

  const sortedUsers = useMemo(() => {
    const roleLabel = (user) => {
      const snapshot = buildCapabilitySnapshot({
        role: user.role,
        features: access?.features || {}
      })
          const roleInfo = ROLE_DEFINITIONS[snapshot.role] || ROLE_DEFINITIONS[restaurantMode ? 'cashier' : 'receptionist']
      return staffRoleLabel(snapshot.role, restaurantMode) || roleInfo.label || snapshot.role || ''
    }

    return [...users].sort((a, b) => {
      switch (sortBy) {
        case 'name_asc':
          return String(a.name || '').localeCompare(String(b.name || ''))
        case 'name_desc':
          return String(b.name || '').localeCompare(String(a.name || ''))
        case 'created_desc':
          return String(b.created_at || '').localeCompare(String(a.created_at || ''))
        case 'pwa_first': {
          const aEnabled = isPwaEligibleRole(a.role) && a.pwa_enabled === true
          const bEnabled = isPwaEligibleRole(b.role) && b.pwa_enabled === true
          if (aEnabled !== bEnabled) return aEnabled ? -1 : 1
          return String(a.name || '').localeCompare(String(b.name || ''))
        }
        case 'role_asc':
        default:
          return roleLabel(a).localeCompare(roleLabel(b)) || String(a.name || '').localeCompare(String(b.name || ''))
      }
    })
  }, [access?.features, restaurantMode, sortBy, users])
  const filteredUsers = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase()
    return sortedUsers.filter((staffUser) => {
      const statusMatches = statusFilter === 'all' || normalizeStaffStatus(staffUser.status) === statusFilter
      if (!statusMatches) return false
      if (!needle) return true
      const snapshot = buildCapabilitySnapshot({
        role: staffUser.role,
        features: access?.features || {},
        capabilityOverrides: staffUser.capability_overrides || {}
      })
      return [staffUser.name, staffUser.email, staffRoleLabel(snapshot.role, restaurantMode)]
        .some((value) => String(value || '').toLowerCase().includes(needle))
    })
  }, [access?.features, restaurantMode, searchQuery, sortedUsers, statusFilter])
  const hasStaffFilters = Boolean(searchQuery.trim()) || statusFilter !== 'active'
  const userLimitMessage = userLimitStatus.isAbovePlan
    ? `This ${propertyLabel} is above the ${usageSnapshot?.plan || access?.entitlement?.plan || 'Starter'} plan limits. Existing records remain available, but new records are restricted until usage is reduced or the plan is upgraded.`
    : userLimitStatus.isBlocked
      ? `Staff creation is restricted because this ${propertyLabel} has reached the ${usageSnapshot?.plan || access?.entitlement?.plan || 'Starter'} user limit.`
      : ''
  const rolePreview = useMemo(() => {
    const previousRole = editingUser?.role || (restaurantMode ? 'cashier' : 'receptionist')
    const fromSnapshot = buildCapabilitySnapshot({
      role: previousRole,
      features: access?.features || {},
      capabilityOverrides: editingUser?.capability_overrides || {}
    })
    const toSnapshot = buildCapabilitySnapshot({
      role: form.role,
      features: access?.features || {},
      capabilityOverrides: form.capability_overrides || {}
    })
    const gained = Object.keys(toSnapshot.capabilities || {}).filter((capability) => (
      toSnapshot.capabilities?.[capability] === true && fromSnapshot.capabilities?.[capability] !== true
    ))
    const lost = Object.keys(fromSnapshot.capabilities || {}).filter((capability) => (
      fromSnapshot.capabilities?.[capability] === true && toSnapshot.capabilities?.[capability] !== true
    ))
    return {
      fromSnapshot,
      toSnapshot,
      gained,
      lost
    }
  }, [access?.features, editingUser?.capability_overrides, editingUser?.role, form.capability_overrides, form.role])

  useEffect(() => {
    load()
  }, [load])

  const openAdd = () => {
    if (userLimitStatus.isBlocked) {
      setShowUpgradePrompt(true)
      return
    }
    setEditingId(null)
    setEditingUser(null)
    setForm({ ...emptyForm, role: restaurantMode ? 'cashier' : 'receptionist' })
    setResetForm(emptyResetForm)
    setShowCreatePassword(false)
    setShowPin(false)
    setShowPwaPassword(false)
    setShowPermissionOverrides(false)
    setError('')
    setShowModal(true)
  }

  const openEdit = (user) => {
    setEditingId(user.id)
    setEditingUser(user)
    setForm({
      name: user.name,
      email: user.email,
      pin: '',
      role: user.role || (restaurantMode ? 'cashier' : 'receptionist'),
      status: normalizeStaffStatus(user.status),
      pwa_enabled: user.pwa_enabled === true,
      pwa_password: '',
      pwa_disabled_reason: user.pwa_disabled_reason || '',
      allowed_outlet_ids: Array.isArray(user.allowed_outlet_ids) ? user.allowed_outlet_ids : [],
      capability_overrides: user.capability_overrides && typeof user.capability_overrides === 'object' ? user.capability_overrides : {}
    })
    setShowPin(false)
    setShowPwaPassword(false)
    setShowPermissionOverrides(Object.keys(user.capability_overrides || {}).length > 0)
    setError('')
    setShowModal(true)
  }

  const openResetPassword = (user) => {
    setResetTarget(user)
    setResetForm(emptyResetForm)
    setShowResetPassword(false)
    setShowResetConfirm(false)
    setResetError('')
  }

  const openDelete = (user) => {
    setDeleteTarget(user)
    setDeleteError('')
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    if (starterAccessLite) {
      const isExistingStarterOwner = editingUser && normalizeAppRole(editingUser.role) === 'admin' && normalizeAppRole(form.role) === 'admin'
      if (!['receptionist', 'operations'].includes(form.role) && !isExistingStarterOwner) {
        setLoading(false)
        setError('Starter users can only use the Receptionist or Operations role templates.')
        return
      }
      if (Object.keys(form.capability_overrides || {}).length > 0 || form.pwa_enabled || (form.allowed_outlet_ids || []).length > 0) {
        setLoading(false)
        setError('Starter user access uses fixed role templates. Custom permissions, mobile access, and outlet assignments are available on Standard.')
        return
      }
    }

    if (isLimitedStaffManager && !isManagerManagedRole(form.role)) {
      setLoading(false)
      setError('Managers can create and maintain service-team accounts only. Ask an administrator to assign manager, finance, or owner access.')
      return
    }

    if (form.pin && (form.pin.length < 4 || form.pin.length > 6)) {
      setLoading(false)
      setError('Approval PIN must be 4–6 digits.')
      return
    }

    if (form.pwa_password && form.pwa_password.length < 6) {
      setLoading(false)
      setError('Manager mobile app password must be at least 6 characters.')
      return
    }

    if (form.pwa_enabled && !isPwaEligibleRole(form.role)) {
      setLoading(false)
      setError('Only Manager and Admin roles can receive manager mobile app access.')
      return
    }

    if (form.pwa_enabled && !form.pwa_password && !editingUser?.pwa_password_set_at) {
      setLoading(false)
      setError('Set a separate manager mobile app password before enabling access.')
      return
    }

    if (isPosOutletScopedRole(form.role) && !outletsReady) {
      setLoading(false)
      setError('Outlet access is still loading. Wait a moment, then select at least one outlet.')
      return
    }

    if (isPosOutletScopedRole(form.role) && outlets.length === 0) {
      setLoading(false)
      setError(`Set up a POS outlet before adding a ${barOnly ? 'cashier or bar supervisor' : 'till operator or service supervisor'}. They cannot sell without an assigned outlet.`)
      return
    }

    if (isPosOutletScopedRole(form.role) && form.allowed_outlet_ids.length === 0) {
      setLoading(false)
      setError('Select at least one outlet for this role. Without an outlet, this user will be blocked from POS.')
      return
    }

    let result
    if (editingId) {
      result = await window.api.users.update(editingId, buildUserPayload(form, editingUser))
    } else {
      const userLimitStatus = canCreateUser({ plan: access?.entitlement?.plan || 'Starter', used: users.length })
      if (userLimitStatus.isBlocked) {
        const plan = access?.entitlement?.plan || 'Starter'
        const nextPlan = plan === 'Starter' ? 'Standard' : 'Pro'
        setLoading(false)
        setError(`User limit reached: ${plan} allows up to ${usageLimits.users} staff accounts. Upgrade to ${nextPlan} for ${nextPlan === 'Standard' ? '5' : 'unlimited'} users.`)
        return
      }
      if (!resetForm.password) {
        setLoading(false)
        setError('Password is required for new staff')
        return
      }
      if (resetForm.password.length < 6) {
        setLoading(false)
        setError('Desktop password must be at least 6 characters.')
        return
      }
      result = await window.api.users.create({
        ...buildUserPayload(form),
        password: resetForm.password
      })
    }

    setLoading(false)
    if (result?.success === false) {
      setError(result.error || 'Failed to save staff account.')
      return
    }

    setShowModal(false)
    setResetForm(emptyResetForm)
    load()
  }

  const handleResetPassword = async (event) => {
    event.preventDefault()
    setResetLoading(true)
    setResetError('')

    if (!resetForm.password || resetForm.password.length < 6) {
      setResetLoading(false)
      setResetError('Desktop password must be at least 6 characters.')
      return
    }

    if (resetForm.password !== resetForm.confirmPassword) {
      setResetLoading(false)
      setResetError('Password confirmation does not match.')
      return
    }

    const result = await window.api.users.resetPassword(resetTarget?.id, resetForm.password)
    setResetLoading(false)

    if (result?.success === false) {
      setResetError(result.error || 'Failed to reset password.')
      return
    }

    setResetTarget(null)
    setResetForm(emptyResetForm)
    setInviteNotice(`Password updated for ${resetTarget?.email || 'staff account'}.`)
    await load()
  }

  const handleSendInvite = async (staffUser) => {
    setInviteLoadingId(staffUser.id)
    setInviteNotice('')
    try {
      const result = await window.api.users.sendInvite(staffUser.id)
      if (result?.success === false) {
        setInviteNotice(result.error || 'Could not send invite or reset link.')
        return
      }
      const action = result.mode === 'invite' ? 'Invite' : 'Password reset link'
      setInviteNotice(`${action} sent to ${staffUser.email}.`)
      await load()
    } catch (e) {
      setInviteNotice(e.message || 'Could not send invite or reset link.')
    } finally {
      setInviteLoadingId(null)
    }
  }

  const handleDelete = async () => {
    setDeleteLoading(true)
    setDeleteError('')

    const result = await window.api.users.delete(deleteTarget?.id)
    setDeleteLoading(false)

    if (result?.success === false) {
      setDeleteError(result.error || 'Failed to delete staff account.')
      return
    }

    setDeleteTarget(null)
    await load()
  }

  const handleStatusChange = async (staffUser, status) => {
    const nextStatus = normalizeStaffStatus(status)
    const result = await window.api.users.update(staffUser.id, { status: nextStatus })
    if (result?.success === false) {
      setInviteNotice(result.error || 'Could not update staff status.')
      return
    }
    setInviteNotice(`${staffUser.name} is now ${STAFF_STATUS_LABELS[nextStatus].toLowerCase()}.`)
    await load()
  }

  const setCapabilityOverride = (capability, value) => {
    setForm((current) => {
      const next = { ...(current.capability_overrides || {}) }
      if (value === null) {
        delete next[capability]
      } else {
        next[capability] = value
      }
      return {
        ...current,
        capability_overrides: next
      }
    })
  }

  return (
    <div className={restaurantMode ? 'restaurant-staff-members' : ''}>
      <div className="restaurant-staff-toolbar mb-5 flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">
            {loadingUsers
              ? 'Loading service team…'
              : hasStaffFilters
                ? `${filteredUsers.length} of ${users.length} staff member${users.length !== 1 ? 's' : ''}`
                : `${users.length} staff member${users.length !== 1 ? 's' : ''}`}
          </p>
          <p className="mt-1 text-xs text-slate-400">{starterAccessLite ? 'Invite one additional lodge user with a safe Receptionist or Operations role. Suspend or reactivate access as needed.' : 'Role templates set who can serve, take payment, manage stock, close shifts, and approve exceptions.'}</p>
          <div className="mt-2">
            <UsageLimitIndicator label="Users" used={usageSnapshot?.usage?.users ?? users.length} limit={usageLimits.users} />
          </div>
          <p className="mt-2 text-xs text-slate-400">{usageSnapshot?.monthlyResetCopy || MONTHLY_USAGE_RESET_COPY}</p>
          {userLimitMessage && (
            <p className="mt-2 text-xs text-rose-600">{userLimitMessage}</p>
          )}
          <div className="mt-3">
            <UpgradeNudgeBanner
              visible={showStaffEarlyPrompt}
              message="You’re approaching your plan limits. Consider upgrading to avoid interruptions."
              sessionKey="boroko:upgrade-nudge:staff"
              lodgeId={access?.entitlement?.lodge_id || settings?.lodge_id || ''}
              lodgeName={access?.entitlement?.lodge_name || settings?.lodge_name || settings?.company_name || ''}
              plan={currentPlan}
              usage={usageSnapshot?.usage || { monthlyBookings: 0, rooms: 0, users: users.length }}
              recommendation={staffEarlyPrompt}
              trigger="banner"
              onUpgrade={() => setShowUpgradePrompt(true)}
            />
          </div>
          {inviteNotice && (
            <p className={`mt-2 text-xs ${/could not|requires|failed|error/i.test(inviteNotice) ? 'text-red-600' : 'text-emerald-600'}`}>
              {inviteNotice}
            </p>
          )}
        </div>
        <div className="restaurant-staff-controls flex items-center gap-3">
          <label className="sr-only" htmlFor="staff-search">Find a staff member</label>
          <input
            id="staff-search"
            className="input min-w-[190px]"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Find a staff member"
          />
          <label className="sr-only" htmlFor="staff-status-filter">Filter by account status</label>
          <select
            id="staff-status-filter"
            className="input w-auto min-w-[126px]"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="active">Active staff</option>
            <option value="all">All statuses</option>
            <option value="suspended">Suspended</option>
            <option value="archived">Archived</option>
          </select>
          <select
            className="input w-auto min-w-[170px]"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
          >
            <option value="role_asc">Role</option>
            <option value="name_asc">Name A-Z</option>
            <option value="name_desc">Name Z-A</option>
            <option value="created_desc">Newest added</option>
            <option value="pwa_first">Manager mobile app enabled first</option>
          </select>
          {canManageStaff && (
            <button
              onClick={openAdd}
              disabled={userLimitStatus.isBlocked}
              className="restaurant-staff-add btn-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus size={15} /> {starterAccessLite ? 'Add User' : 'Add Staff'}
            </button>
          )}
        </div>
      </div>

      {loadingUsers ? (
        <div className="restaurant-staff-state">
          <RotateCcw size={19} className="animate-spin" />
          <p>Loading the service team…</p>
        </div>
      ) : loadError ? (
        <div className="restaurant-staff-state restaurant-staff-state-error">
          <XCircle size={20} />
          <div>
            <p className="font-semibold">The service team could not be loaded</p>
            <p className="mt-1 text-sm">{loadError}</p>
            <button type="button" onClick={load} className="restaurant-staff-retry">Try again</button>
          </div>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="restaurant-staff-state">
          <Users2 size={22} />
          <div>
            <p className="font-semibold">{hasStaffFilters ? 'No staff match these filters' : 'No staff accounts yet'}</p>
            <p className="mt-1 text-sm">
              {hasStaffFilters
                ? 'Clear the search or status filter to see other accounts.'
                : 'Add the people who need to take orders, accept payments, or supervise service.'}
            </p>
            {hasStaffFilters ? (
              <button type="button" onClick={() => { setSearchQuery(''); setStatusFilter('active') }} className="restaurant-staff-retry">Clear filters</button>
            ) : canManageStaff ? (
              <button type="button" onClick={openAdd} className="restaurant-staff-retry">Add first staff member</button>
            ) : null}
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {filteredUsers.map((staffUser) => {
          const snapshot = buildCapabilitySnapshot({
            role: staffUser.role,
            features: access?.features || {},
            capabilityOverrides: staffUser.capability_overrides || {}
          })
      const roleInfo = ROLE_DEFINITIONS[snapshot.role] || ROLE_DEFINITIONS[restaurantMode ? 'cashier' : 'receptionist']
          const pwaEligible = isPwaEligibleRole(staffUser.role)
          const pwaEnabled = pwaEligible && staffUser.pwa_enabled === true
          const isSelf = staffUser.id === currentUser?.id
          const canManageThisStaff = canManageStaff && (!isLimitedStaffManager || isManagerManagedRole(snapshot.role))
          const isLastAdmin = normalizeAppRole(staffUser.role) === 'admin' && ['active', 'suspended'].includes(normalizeStaffStatus(staffUser.status)) && adminCount <= 1
          const activitySummary = summarizeActivity(staffUser)
          const hasOverrides = Object.keys(staffUser.capability_overrides || {}).length > 0
          const deleteBlockedReason = isSelf
            ? 'You cannot delete the account you are currently signed in with.'
            : isLastAdmin
              ? `You cannot delete the last admin in this ${propertyLabel}.`
              : normalizeStaffStatus(staffUser.status) !== 'archived'
                ? 'Archive this account first. Permanent deletion is reserved for already archived staff.'
              : ''

          return (
            <div key={staffUser.id} className={`bb-card p-5 ${restaurantMode ? 'restaurant-staff-card' : ''}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="restaurant-staff-avatar w-11 h-11 bg-green-100 rounded-2xl flex items-center justify-center">
                    {snapshot.role === 'manager' || snapshot.role === 'admin'
                      ? <ShieldCheck size={18} className="text-green-600" />
                      : <User size={18} className="text-green-500" />}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">{staffUser.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{staffUser.email}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${roleTone(snapshot.role)}`}>
                        {staffRoleLabel(snapshot.role, restaurantMode)}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusTone(staffUser.status)}`}>
                        {STAFF_STATUS_LABELS[normalizeStaffStatus(staffUser.status)]}
                      </span>
                      <span className="text-xs text-slate-400">
                        {Object.values(snapshot.capabilities).filter(Boolean).length} active permissions
                      </span>
                    </div>
                  </div>
                </div>

                {canManageThisStaff && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      onClick={() => openEdit(staffUser)}
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-green-50 hover:text-green-600"
                    >
                      <Pencil size={13} /> Edit
                    </button>
                    <button
                      onClick={() => openResetPassword(staffUser)}
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    >
                      <Lock size={13} /> Reset Password
                    </button>
                    <button
                      onClick={() => handleSendInvite(staffUser)}
                      disabled={inviteLoadingId === staffUser.id}
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-60"
                    >
                      <Mail size={13} /> {inviteLoadingId === staffUser.id ? 'Sending...' : (staffUser.auth_user_id ? 'Send Reset Link' : 'Send Invite')}
                    </button>
                    {!starterAccessLite && (
                      <button
                        onClick={() => openDelete(staffUser)}
                        disabled={Boolean(deleteBlockedReason)}
                        title={deleteBlockedReason || 'Delete staff'}
                        className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors ${
                          deleteBlockedReason
                            ? 'cursor-not-allowed text-slate-300'
                            : 'text-red-500 hover:bg-red-50 hover:text-red-700'
                        }`}
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    )}
                  </div>
                )}
              </div>

              <p className="mt-4 text-sm text-slate-500">{roleDescription(snapshot.role, restaurantMode)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {staffRoleHighlights(snapshot.role, restaurantMode).map((highlight) => (
                  <span key={highlight} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                    {highlight}
                  </span>
                ))}
                {staffUser.id === currentUser?.id && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">(you)</span>
                )}
                {hasOverrides && (
                  <span className="rounded-full bg-sky-100 px-2 py-1 text-xs text-sky-700">
                    Custom permission overrides
                  </span>
                )}
                {isLimitedStaffManager && !isManagerManagedRole(snapshot.role) && (
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                    Administrator-controlled account
                  </span>
                )}
                {!starterAccessLite && pwaEligible && (
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    pwaEnabled ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {pwaEnabled ? 'Manager mobile app ready' : 'Manager mobile app turned off'}
                  </span>
                )}
                {!starterAccessLite && staffUser.pwa_password_set_at && (
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">
                    Mobile app password updated {formatShortDate(staffUser.pwa_password_set_at)}
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {activitySummary.map((item) => (
                  <span key={item} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                    {item}
                  </span>
                ))}
              </div>
              {!starterAccessLite && pwaEligible && !pwaEnabled && staffUser.pwa_disabled_reason && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mt-3">
                  {staffUser.pwa_disabled_reason}
                </p>
              )}

              {canManageThisStaff && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {normalizeStaffStatus(staffUser.status) === 'active' && !isSelf && (
                    <button
                      onClick={() => handleStatusChange(staffUser, 'suspended')}
                      className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-50"
                    >
                      Suspend
                    </button>
                  )}
                  {!starterAccessLite && normalizeStaffStatus(staffUser.status) !== 'archived' && !isSelf && (
                    <button
                      onClick={() => handleStatusChange(staffUser, 'archived')}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      Archive
                    </button>
                  )}
                  {normalizeStaffStatus(staffUser.status) !== 'active' && (
                    <button
                      onClick={() => handleStatusChange(staffUser, 'active')}
                      className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
                    >
                      Restore Active
                    </button>
                  )}
                </div>
              )}

              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Allowed actions</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(snapshot.capabilities)
                    .filter(([, allowed]) => allowed)
                    .slice(0, 8)
                    .map(([capability]) => (
                      <span key={capability} className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded-full">
                        {CAPABILITY_LABELS[capability]}
                      </span>
                    ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      )}

      {showModal && (
        <Modal
          title={starterAccessLite ? (editingId ? 'Edit User Access' : 'Add User') : (editingId ? 'Edit Staff Member' : 'Add Staff Member')}
          onClose={() => {
            setShowModal(false)
            setResetForm(emptyResetForm)
          }}
          size="lg"
          footer={(
            <div className="restaurant-staff-modal-footer">
              <p>{starterAccessLite ? 'Starter uses fixed role templates and records account changes on the server.' : 'Role templates are the normal way to assign access. Changes are recorded in Access audit.'}</p>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" form="staff-member-form" disabled={loading} className="btn-primary min-w-[132px]">
                  {loading ? 'Saving…' : editingId ? 'Save changes' : starterAccessLite ? 'Add user' : 'Add staff'}
                </button>
              </div>
            </div>
          )}
        >
          <form id="staff-member-form" onSubmit={handleSave} className="space-y-4">
            {restaurantMode && (
              <div className="restaurant-staff-dialog-intro">
                <User size={18} />
                <div>
                  <p className="font-semibold">Set up a service account</p>
                  <p>Choose a role first, then assign an outlet for anyone who will use the till.</p>
                </div>
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Full Name *</label>
              <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Email *</label>
              <input type="email" className="input" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
            </div>
            {!editingId && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">{restaurantMode ? 'Staff sign-in password *' : 'Desktop Password *'}</label>
                <div className="relative">
                  <input
                    type={showCreatePassword ? 'text' : 'password'}
                    className="input pr-10"
                    value={resetForm.password}
                    onChange={(event) => setResetForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder="Min 6 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatePassword((current) => !current)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showCreatePassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            )}
            {(restaurantMode || ['supervisor', 'manager', 'admin'].includes(form.role)) && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {restaurantMode ? 'Staff PIN' : 'Approval PIN'} <span className="font-normal text-slate-400">(4–6 digits)</span>
                </label>
                <div className="relative">
                  <input
                    type={showPin ? 'text' : 'password'}
                    inputMode="numeric"
                    className="input pr-10"
                    placeholder={editingId ? 'Leave blank to keep existing PIN' : restaurantMode ? 'Set a private numeric staff PIN' : 'Set a numeric PIN (optional)'}
                    value={form.pin}
                    onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                    maxLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin((current) => !current)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {restaurantMode ? 'Used for private shared-terminal attendance. Supervisor and manager roles can also use it for approved POS actions.' : 'Used to approve POS actions without a full login.'}
                </p>
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">{restaurantMode ? 'Service role' : 'Role Template'}</label>
              <select
                className="input"
                value={form.role}
                onChange={(event) => {
                  const nextRole = event.target.value
                  setForm((current) => ({
                    ...current,
                    role: nextRole,
                    allowed_outlet_ids: [], // reset outlet access when role changes
                    pwa_enabled: isPwaEligibleRole(nextRole) ? current.pwa_enabled : false,
                    pwa_disabled_reason: isPwaEligibleRole(nextRole)
                      ? current.pwa_disabled_reason
                      : 'Only Manager and Admin roles can use the manager mobile app.'
                  }))
                }}
              >
                {availableRoles.map((role) => (
                  <option key={role.value} value={role.value}>{staffRoleLabel(role.value, restaurantMode)}</option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">
                {roleDescription(form.role, restaurantMode)}
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Account Status</label>
              <select
                className="input"
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
              >
                {Object.entries(STAFF_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">
                Active staff can sign in. Suspended staff keep history but cannot use the app. Archived staff are hidden from day-to-day operations until restored.
              </p>
            </div>

            {!starterAccessLite && (rolePreview.gained.length > 0 || rolePreview.lost.length > 0) && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-800">Role change preview</p>
                {rolePreview.gained.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Will gain</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {rolePreview.gained.slice(0, 10).map((capability) => (
                        <span key={capability} className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-700">
                          {CAPABILITY_LABELS[capability]}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {rolePreview.lost.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Will lose</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {rolePreview.lost.slice(0, 10).map((capability) => (
                        <span key={capability} className="rounded-full bg-rose-100 px-2 py-1 text-xs text-rose-700">
                          {CAPABILITY_LABELS[capability]}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {canSetRoles && (
              <div className="restaurant-staff-permissions rounded-2xl border border-slate-200 bg-slate-50">
                <button
                  type="button"
                  className="restaurant-staff-permissions-toggle"
                  onClick={() => setShowPermissionOverrides((current) => !current)}
                  aria-expanded={showPermissionOverrides}
                >
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">Custom permission exceptions</span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {Object.keys(form.capability_overrides || {}).length > 0
                        ? `${Object.keys(form.capability_overrides || {}).length} custom ${Object.keys(form.capability_overrides || {}).length === 1 ? 'exception is' : 'exceptions are'} active.`
                        : 'Optional. The selected role already provides the normal service access.'}
                    </span>
                  </span>
                  {showPermissionOverrides ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
                {showPermissionOverrides && (
                  <div className="border-t border-slate-200 px-4 pb-4 pt-3">
                    <p className="mb-3 text-xs text-amber-700">Use Allow or Block only for an approved exception. Leave an action on Default to follow the role template.</p>
                    <div className="space-y-2">
                      {Object.entries(CAPABILITY_LABELS)
                        .filter(([capability]) => !restaurantMode || RESTAURANT_CAPABILITY_KEYS.has(capability))
                        .map(([capability, label]) => {
                          const overrideValue = Object.prototype.hasOwnProperty.call(form.capability_overrides || {}, capability)
                            ? form.capability_overrides[capability]
                            : null
                          return (
                            <div key={capability} className="restaurant-staff-permission-row">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-700">{label}</p>
                                <p className="text-xs text-slate-400">
                                  Role default: {rolePreview.toSnapshot.allowedByRole?.[capability] ? 'allowed' : 'blocked'}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
                                <button type="button" onClick={() => setCapabilityOverride(capability, null)} className={`rounded-md px-2 py-1 text-xs ${overrideValue === null ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>Default</button>
                                <button type="button" onClick={() => setCapabilityOverride(capability, true)} className={`rounded-md px-2 py-1 text-xs ${overrideValue === true ? 'bg-emerald-600 text-white' : 'text-slate-500'}`}>Allow</button>
                                <button type="button" onClick={() => setCapabilityOverride(capability, false)} className={`rounded-md px-2 py-1 text-xs ${overrideValue === false ? 'bg-rose-600 text-white' : 'text-slate-500'}`}>Block</button>
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* POS Outlet Access — only shown for outlet-scoped roles (cashier / supervisor) */}
            {isPosOutletScopedRole(form.role) && !outletsReady && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Loading POS outlets before this account can be assigned to service.
              </div>
            )}

            {isPosOutletScopedRole(form.role) && outletsReady && outlets.length === 0 && (
              <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div>
                  <p className="text-sm font-semibold text-amber-900">Set up an outlet before assigning service access</p>
                  <p className="mt-1 text-xs text-amber-800">{barOnly ? 'Cashiers, bartenders and bar supervisors' : 'Waiters and service supervisors'} must belong to at least one POS outlet before they can use the till.</p>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setShowModal(false)
                    navigate('/multi-outlet-pos')
                  }}
                >
                  Set up outlets
                </button>
              </div>
            )}

            {isPosOutletScopedRole(form.role) && outletsReady && outlets.length > 0 && (
              <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-medium text-slate-800">POS Outlet Access</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Select which outlets this {staffRoleLabel(form.role, restaurantMode)} can access.
                    At least one outlet is required.
                  </p>
                </div>
                {outlets.map(o => (
                  <label key={o.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-1 text-sm text-slate-700 hover:bg-white">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={form.allowed_outlet_ids.includes(o.id)}
                      onChange={(event) => setForm(current => ({
                        ...current,
                        allowed_outlet_ids: event.target.checked
                          ? [...current.allowed_outlet_ids, o.id]
                          : current.allowed_outlet_ids.filter(id => id !== o.id)
                      }))}
                    />
                    <span className="font-medium">{o.name}</span>
                  </label>
                ))}
                {form.allowed_outlet_ids.length === 0 && (
                  <p className="text-xs text-amber-600">⚠️ No outlets selected — this user will be blocked from POS until an outlet is assigned.</p>
                )}
              </div>
            )}

            {!starterAccessLite && isPwaEligibleRole(form.role) && (
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-medium text-slate-800">Manager mobile app access</p>
                  <p className="mt-1 text-xs text-slate-500">This sets up separate access for the manager mobile app, independent of the desktop password.</p>
                </div>

                <>
                  <label className="flex items-start gap-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.pwa_enabled}
                      onChange={(event) => setForm((current) => ({
                        ...current,
                        pwa_enabled: event.target.checked,
                        pwa_disabled_reason: event.target.checked ? '' : (current.pwa_disabled_reason || 'Manager mobile app access has been turned off.')
                      }))}
                      className="mt-1"
                    />
                    <span>
                      Enable manager mobile app for this user
                      <span className="mt-1 block text-xs text-slate-500">Only Manager and Admin roles can sign in to the browser-based manager app.</span>
                    </span>
                  </label>

                  <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        Manager mobile app password {editingId && <span className="font-normal text-slate-400">(leave blank to keep current)</span>}
                    </label>
                    <div className="relative">
                      <input
                        type={showPwaPassword ? 'text' : 'password'}
                        className="input pr-10"
                        value={form.pwa_password}
                        onChange={(event) => setForm({ ...form, pwa_password: event.target.value })}
                        placeholder={editingUser?.pwa_password_set_at ? 'Leave blank to keep current password' : 'Min 6 characters'}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwaPassword((current) => !current)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showPwaPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {editingUser?.pwa_password_set_at
                        ? `Current mobile app password last updated ${formatShortDate(editingUser.pwa_password_set_at)}.`
                        : 'Set a separate password for the manager mobile app.'}
                    </p>
                  </div>

                  {!form.pwa_enabled && (
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Disable Reason</label>
                      <input
                        className="input"
                        value={form.pwa_disabled_reason}
                        onChange={(event) => setForm({ ...form, pwa_disabled_reason: event.target.value })}
                        placeholder="Why is manager mobile app access turned off?"
                      />
                    </div>
                  )}
                </>
              </div>
            )}

            {!canSetRoles && (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-700">
                <Lock size={14} className="mt-0.5 flex-shrink-0" />
                You can create and update service-team accounts. Administrator approval is required for finance, manager, owner, or custom-permission access.
              </div>
            )}
            {error && <div className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}
          </form>
        </Modal>
      )}

      <UsageUpgradePrompt
        open={showUpgradePrompt}
        onClose={() => setShowUpgradePrompt(false)}
        onUpgrade={() => {
          setShowUpgradePrompt(false)
          navigate('/settings', { state: { activeTab: 'license' } })
        }}
        resourceLabel="Staff users"
        currentPlan={usageSnapshot?.plan || access?.entitlement?.plan || 'Starter'}
        used={usageSnapshot?.usage?.users ?? users.length}
        limit={usageLimits.users}
        grace={0}
        status={userLimitStatus}
        message={userLimitMessage || `Upgrade to add more staff users for this ${propertyLabel}.`}
        usage={usageSnapshot?.usage}
        recommendation={usageSnapshot?.recommendation}
        lodgeName={access?.entitlement?.lodge_name || settings?.lodge_name || settings?.company_name || ''}
        lodgeId={access?.entitlement?.lodge_id || settings?.lodge_id || ''}
      />

      {resetTarget && (
        <Modal
          title={`Reset Password — ${resetTarget.name}`}
          onClose={() => {
            if (!resetLoading) {
              setResetTarget(null)
              setResetForm(emptyResetForm)
              setResetError('')
            }
          }}
          size="sm"
        >
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">New Desktop Password</label>
              <div className="relative">
                <input
                  type={showResetPassword ? 'text' : 'password'}
                  className="input pr-10"
                  value={resetForm.password}
                  onChange={(event) => setResetForm((current) => ({ ...current, password: event.target.value }))}
                  placeholder="Min 6 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowResetPassword((current) => !current)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showResetPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Confirm Password</label>
              <div className="relative">
                <input
                  type={showResetConfirm ? 'text' : 'password'}
                  className="input pr-10"
                  value={resetForm.confirmPassword}
                  onChange={(event) => setResetForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                  placeholder="Repeat the new password"
                />
                <button
                  type="button"
                  onClick={() => setShowResetConfirm((current) => !current)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showResetConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              This changes the staff member&apos;s sign-in password. For linked Supabase Auth users, it also updates their Auth password when Command Central service access is available.
            </p>
            {resetError && <div className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{resetError}</div>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setResetTarget(null)} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={resetLoading} className="btn-primary flex-1">
                {resetLoading ? 'Saving...' : 'Reset Password'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title={`Delete Staff — ${deleteTarget.name}`}
          onClose={() => {
            if (!deleteLoading) {
              setDeleteTarget(null)
              setDeleteError('')
            }
          }}
          size="sm"
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
              <p className="font-semibold">This will permanently delete this staff account.</p>
              <p className="mt-1">{deleteTarget.email}</p>
            </div>
            <p className="text-sm text-slate-500">
              This action removes the staff member from this {propertyLabel}. It cannot be undone from the Staff screen.
            </p>
            {deleteError && <div className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{deleteError}</div>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setDeleteTarget(null)} className="btn-secondary flex-1">Cancel</button>
              <button type="button" disabled={deleteLoading} onClick={handleDelete} className="flex-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60">
                {deleteLoading ? 'Deleting...' : 'Delete Staff'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

const ACTION_CONFIG = {
  staff_account_created: { icon: Users2, color: 'text-emerald-700', bg: 'bg-emerald-50', label: 'Staff added' },
  staff_account_updated: { icon: Pencil, color: 'text-sky-700', bg: 'bg-sky-50', label: 'Account updated' },
  staff_role_changed: { icon: ShieldCheck, color: 'text-violet-700', bg: 'bg-violet-50', label: 'Role changed' },
  staff_status_changed: { icon: User, color: 'text-amber-700', bg: 'bg-amber-50', label: 'Status changed' },
  staff_outlet_access_changed: { icon: ClipboardList, color: 'text-sky-700', bg: 'bg-sky-50', label: 'Outlet access' },
  staff_permissions_changed: { icon: ShieldCheck, color: 'text-violet-700', bg: 'bg-violet-50', label: 'Permissions' },
  staff_mobile_access_changed: { icon: Mail, color: 'text-indigo-700', bg: 'bg-indigo-50', label: 'Mobile access' },
  staff_approval_pin_changed: { icon: Lock, color: 'text-amber-700', bg: 'bg-amber-50', label: 'Approval PIN' },
  staff_password_changed: { icon: Lock, color: 'text-rose-700', bg: 'bg-rose-50', label: 'Password changed' },
  staff_auth_linked: { icon: CheckCircle2, color: 'text-emerald-700', bg: 'bg-emerald-50', label: 'Sign-in linked' },
  staff_account_deleted: { icon: Trash2, color: 'text-rose-700', bg: 'bg-rose-50', label: 'Staff removed' },
  staff_invite_sent: { icon: Mail, color: 'text-indigo-700', bg: 'bg-indigo-50', label: 'Invite sent' },
  staff_password_reset_sent: { icon: Mail, color: 'text-indigo-700', bg: 'bg-indigo-50', label: 'Reset link sent' },
  staff_password_reset: { icon: Lock, color: 'text-rose-700', bg: 'bg-rose-50', label: 'Password changed' },
  booking_created:   { icon: CalendarPlus,  color: 'text-green-600',  bg: 'bg-green-50',  label: 'New Booking' },
  check_in:          { icon: LogIn,          color: 'text-teal-600',   bg: 'bg-teal-50',   label: 'Check-in' },
  check_out:         { icon: LogOut,         color: 'text-blue-600',   bg: 'bg-blue-50',   label: 'Check-out' },
  booking_cancelled: { icon: XCircle,        color: 'text-red-500',    bg: 'bg-red-50',    label: 'Cancelled' },
  booking_confirmed: { icon: CheckCircle2,   color: 'text-green-600',  bg: 'bg-green-50',  label: 'Confirmed' },
  booking_updated:   { icon: ClipboardList,  color: 'text-gray-500',   bg: 'bg-gray-50',   label: 'Updated' },
  payment_updated:   { icon: CreditCard,     color: 'text-purple-600', bg: 'bg-purple-50', label: 'Payment' },
  housekeeping_updated: { icon: Sparkles,    color: 'text-amber-500',  bg: 'bg-amber-50',  label: 'Housekeeping' },
  room_created:         { icon: BedDouble,      color: 'text-green-600',  bg: 'bg-green-50',  label: 'Room Added' },
  event_booking_created:{ icon: CalendarPlus,  color: 'text-indigo-600', bg: 'bg-indigo-50', label: 'Event Booking' }
}

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'booking_created', label: 'New Bookings' },
  { value: 'check_in', label: 'Check-ins' },
  { value: 'check_out', label: 'Check-outs' },
  { value: 'payment_updated', label: 'Payments' },
  { value: 'housekeeping_updated', label: 'Housekeeping' },
  { value: 'booking_cancelled', label: 'Cancellations' }
]

const RESTAURANT_AUDIT_FILTER_OPTIONS = [
  { value: 'all', label: 'All changes' },
  { value: 'account', label: 'Accounts & access' },
  { value: 'security', label: 'Security' }
]

function isRestaurantSecurityAudit(action) {
  return ['staff_password_changed', 'staff_approval_pin_changed', 'staff_mobile_access_changed', 'staff_auth_linked'].includes(action)
}

function formatRestaurantAuditEntry(row) {
  const before = row?.before_snapshot || {}
  const after = row?.after_snapshot || {}
  const staffName = row?.staff_name || after.name || before.name || 'Staff account'
  const role = after.role || before.role

  switch (row?.action) {
    case 'staff_account_created':
      return `${staffName} was added as ${staffRoleLabel(role, true)}.`
    case 'staff_account_deleted':
      return `${staffName} was permanently removed after being archived.`
    case 'staff_role_changed':
      return `${staffName}'s role changed from ${staffRoleLabel(before.role, true)} to ${staffRoleLabel(after.role, true)}.`
    case 'staff_status_changed':
      return `${staffName}'s status changed from ${STAFF_STATUS_LABELS[normalizeStaffStatus(before.status)] || before.status || 'unknown'} to ${STAFF_STATUS_LABELS[normalizeStaffStatus(after.status)] || after.status || 'unknown'}.`
    case 'staff_outlet_access_changed':
      return `${staffName}'s assigned POS outlet access changed.`
    case 'staff_permissions_changed':
      return `${staffName}'s custom permission exceptions changed.`
    case 'staff_mobile_access_changed':
      return `${staffName}'s manager mobile app access changed.`
    case 'staff_approval_pin_changed':
      return `${staffName}'s approval PIN changed.`
    case 'staff_password_changed':
      return `${staffName}'s sign-in password changed.`
    case 'staff_auth_linked':
      return `${staffName}'s sign-in account was linked.`
    default: {
      const changes = []
      if (before.name !== after.name && after.name) changes.push('name')
      if (before.email !== after.email && after.email) changes.push('email')
      if (changes.length) return `${staffName}'s ${changes.join(' and ')} changed.`
      return `${staffName}'s account details changed.`
    }
  }
}

function fmt(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(iso) {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ActivityLog({ restaurantMode = false }) {
  const access = useAccess()
  const canClear = !restaurantMode && canAccessCapability(access, 'sync.manage')
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [backupInfo, setBackupInfo] = useState(null)
  const [showBackups, setShowBackups] = useState(false)
  const [auditError, setAuditError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setAuditError('')
    try {
      if (restaurantMode) {
        const result = await window.api.users.getAccessAudit()
        if (result?.success === false) throw new Error(result.error || 'Could not load the staff access audit.')
        setEntries((result?.entries || []).map((row) => ({
          ...row,
          timestamp: row.created_at,
          description: formatRestaurantAuditEntry(row),
          user_name: row.actor_name || 'System or offline sync'
        })))
        setBackupInfo(null)
        return
      }
      const [log, info] = await Promise.all([
        window.api.activity.getAll(),
        window.api.backup.getInfo()
      ])
      setEntries(Array.isArray(log) ? log : [])
      setBackupInfo(info)
    } catch (error) {
      setEntries([])
      setAuditError(error?.message || 'Could not load this activity record.')
    } finally {
      setLoading(false)
    }
  }, [restaurantMode])

  useEffect(() => {
    load()
  }, [load])

  const handleClear = async () => {
    if (!window.confirm('Clear all activity log entries? This cannot be undone.')) return
    await window.api.activity.clear()
    setEntries([])
  }

  const restaurantEntries = restaurantMode ? entries : entries
  const visibleFilters = restaurantMode ? RESTAURANT_AUDIT_FILTER_OPTIONS : FILTER_OPTIONS
  const filtered = filter === 'all'
    ? restaurantEntries
    : restaurantMode
      ? restaurantEntries.filter((entry) => filter === 'security' ? isRestaurantSecurityAudit(entry.action) : !isRestaurantSecurityAudit(entry.action))
      : restaurantEntries.filter((entry) => entry.action === filter)
  const grouped = filtered.reduce((accumulator, entry) => {
    const day = new Date(entry.timestamp).toDateString()
    if (!accumulator[day]) accumulator[day] = []
    accumulator[day].push(entry)
    return accumulator
  }, {})

  const lastBackup = backupInfo?.backups?.[0]

  return (
    <div className={restaurantMode ? 'restaurant-staff-audit' : ''}>
      {restaurantMode && (
        <div className="restaurant-staff-audit-note">
          <ShieldCheck size={17} />
          <span><strong>Server-backed access audit.</strong> It records staff account and access changes. Sales, stock, tips, and cash actions remain in their own ledgers.</span>
        </div>
      )}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {visibleFilters.map((option) => (
            <button
              key={option.value}
              onClick={() => setFilter(option.value)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                filter === option.value
                  ? 'bg-green-600 text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-green-600 px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-green-50 transition-colors"
          >
            <RotateCcw size={12} /> Refresh
          </button>
          {canClear && entries.length > 0 && (
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 px-3 py-1.5 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
            >
              <Trash2 size={12} /> Clear Log
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading {restaurantMode ? 'access audit' : 'activity'}...</div>
      ) : auditError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
          <p className="font-semibold">{restaurantMode ? 'Access audit is unavailable' : 'Activity is unavailable'}</p>
          <p className="mt-1">{auditError}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <ClipboardList size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{restaurantMode ? 'No staff access changes recorded yet' : 'No activity recorded yet'}</p>
          <p className="text-xs mt-1">{restaurantMode ? 'Adding, changing, suspending, or removing a staff account will appear here.' : 'Actions like check-ins, bookings and payments will appear here.'}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([day, dayEntries]) => (
            <div key={day}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                {fmtDate(dayEntries[0].timestamp)}
                <span className="ml-2 text-gray-300 normal-case font-normal">
                  {dayEntries.length} event{dayEntries.length !== 1 ? 's' : ''}
                </span>
              </p>
              <div className="space-y-1">
                {dayEntries.map((entry) => {
                  const config = ACTION_CONFIG[entry.action] || {
                    icon: ClipboardList, color: 'text-gray-500', bg: 'bg-gray-50', label: entry.action
                  }
                  const Icon = config.icon
                  return (
                    <div key={entry.id} className="flex items-start gap-3 bg-white rounded-lg px-4 py-3 border border-gray-100 hover:border-gray-200 transition-colors">
                      <div className={`w-7 h-7 rounded-full ${config.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        <Icon size={13} className={config.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 leading-snug">{entry.description}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {fmt(entry.timestamp)}
                          {entry.user_name && entry.user_name !== 'System' && (
                            <span className="ml-2 text-gray-400">· {entry.user_name}</span>
                          )}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${config.bg} ${config.color} font-medium`}>
                        {config.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {!restaurantMode && <div className="mt-6 border border-gray-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowBackups(!showBackups)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <FolderOpen size={15} className="text-green-600" />
            Automatic Backups
            {lastBackup ? (
              <span className="text-xs text-gray-400 font-normal ml-1">· Last backup {new Date(lastBackup.created).toLocaleString()}</span>
            ) : (
              <span className="text-xs text-gray-400 font-normal ml-1">· No backups yet</span>
            )}
          </div>
          {showBackups ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </button>

        {showBackups && (
          <div className="px-4 py-3 bg-white">
            <p className="text-xs text-gray-500 mb-3">
              Backups run automatically on startup, every hour, and after each check-in or check-out. The 10 most recent backups are kept.
            </p>
            {backupInfo?.backups?.length > 0 ? (
              <div className="space-y-1.5 mb-3">
                {backupInfo.backups.map((backup, index) => (
                  <div key={backup.name} className="flex items-center justify-between text-xs text-gray-600 bg-gray-50 rounded px-3 py-2">
                    <div className="flex items-center gap-2">
                      {index === 0 && (
                        <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded text-[10px] font-medium">Latest</span>
                      )}
                      <span className="font-mono text-gray-500">{backup.name.replace('backup-', '').replace('.json', '').replace(/-/g, ' ').trim()}</span>
                    </div>
                    <span className="text-gray-400">{fmtSize(backup.size)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 mb-3 italic">No backups found yet.</p>
            )}
            <button
              onClick={() => window.api.backup.openFolder()}
              className="flex items-center gap-2 text-xs text-green-600 hover:text-green-800 px-3 py-2 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
            >
              <FolderOpen size={13} /> Open backups folder
            </button>
          </div>
        )}
      </div>}
    </div>
  )
}

function RolesAndPermissions({ restaurantMode = false }) {
  const access = useAccess()
  const roles = getRoleOptions().filter((role) => role.value !== 'super_admin' && (!restaurantMode || !['receptionist', 'operations'].includes(role.value)))

  return (
    <div className={`space-y-4 ${restaurantMode ? 'restaurant-staff-roles' : ''}`}>
      <div className="restaurant-staff-roles-intro bg-white rounded-2xl shadow-sm p-5">
        <div className="flex items-center gap-3 mb-3">
          <Users2 size={18} className="text-green-600" />
          <div>
            <h2 className="text-base font-semibold text-gray-800">{restaurantMode ? 'Service role templates' : 'Role Templates'}</h2>
            <p className="text-sm text-gray-500 mt-1">{restaurantMode ? 'Choose the least access needed for the job. Restaurant & Bar controls are shown here; the server enforces every assignment.' : 'Use these templates when assigning staff. Plan-limited modules are hidden automatically when the current subscription does not include them.'}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {roles.map((role) => {
          const snapshot = buildCapabilitySnapshot({
            role: role.value,
            features: access?.features || {}
          })
          const blocked = Object.keys(snapshot.blockedByFeature || {})
          const visibleBlocked = blocked.filter((capability) => !restaurantMode || RESTAURANT_CAPABILITY_KEYS.has(capability))
          return (
            <div key={role.value} className={`restaurant-staff-role-card rounded-2xl border p-5 bg-white shadow-sm ${access?.role === role.value ? 'border-green-300' : 'border-gray-200'}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-gray-800">{staffRoleLabel(role.value, restaurantMode)}</p>
                  <p className="text-sm text-gray-500 mt-1">{roleDescription(role.value, restaurantMode)}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${roleTone(role.value)}`}>
                  {Object.values(snapshot.capabilities).filter(Boolean).length} live permissions
                </span>
              </div>

              <div className="flex flex-wrap gap-2 mt-4">
                {staffRoleHighlights(role.value, restaurantMode).map((highlight) => (
                  <span key={highlight} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">{highlight}</span>
                ))}
              </div>

              <div className="mt-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Key access</p>
                <div className="flex flex-wrap gap-2">
                  {visibleCapabilityEntries(snapshot, restaurantMode)
                    .slice(0, 10)
                    .map(([capability]) => (
                      <span key={capability} className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded-full">
                        {CAPABILITY_LABELS[capability]}
                      </span>
                    ))}
                </div>
              </div>

              {visibleBlocked.length > 0 && (
                <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Unavailable on current plan</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                      {visibleBlocked.slice(0, 6).map((capability) => (
                      <span key={capability} className="text-xs bg-white text-amber-700 px-2 py-1 rounded-full border border-amber-200">
                        {CAPABILITY_LABELS[capability]}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Staff() {
  const [tab, setTab] = useState('staff')
  const [searchParams, setSearchParams] = useSearchParams()
  const features = useFeatures()
  const starterAccessLite = features?.staff_basic === true && features?.staff !== true
  const hasHotelRoles = features?.hotel_roles === true
  const access = useAccess()
  const { settings } = useSettings()
  const propertyType = settings?.property_type || settings?.business_type || 'lodge'
  const restaurantMode = isRestaurantOnly(propertyType)
  const barOnly = isBarOnlyMode(settings)

  const propertyLabel = barOnly ? 'bar' : restaurantMode ? 'restaurant' : 'lodge'

  useEffect(() => {
    const tabParam = searchParams.get('tab')
    if (starterAccessLite) {
      setTab('staff')
      return
    }
    if (tabParam) setTab(tabParam)
  }, [searchParams, starterAccessLite])

  const tabs = [
    { key: 'staff', label: starterAccessLite ? 'User Accounts' : 'Staff Members', icon: User },
    ...(!starterAccessLite ? [{ key: 'roles', label: restaurantMode ? 'Service roles & access' : 'Roles & Permissions', icon: ShieldCheck }] : []),
    ...(!starterAccessLite && hasHotelRoles && !restaurantMode ? [{ key: 'hotel-roles', label: 'Hotel Roles', icon: Briefcase }] : []),
    ...(!starterAccessLite ? [{ key: 'activity', label: restaurantMode ? 'Access audit' : 'Activity Log', icon: ClipboardList }] : [])
  ]

  return (
    <div className={`mx-auto flex max-w-7xl flex-col gap-6 ${restaurantMode ? 'restaurant-staff-workspace' : ''}`}>
      <div className="bb-page-header">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-[0.22em] ${restaurantMode ? 'restaurant-staff-kicker' : 'text-emerald-700/70'}`}>{barOnly ? 'Bar operations' : restaurantMode ? 'Restaurant operations' : 'People & Access'}</p>
          <h1 className="bb-page-header-title mt-2">{starterAccessLite ? 'Users & Access' : barOnly ? 'Your bar team' : restaurantMode ? 'Your service team' : 'Staff'}</h1>
          <p className="bb-page-header-subtitle">
            {starterAccessLite ? 'Manage the two user accounts included with Starter. Invite, reset, suspend, or reactivate a safe fixed role.' : barOnly ? 'Add cashiers, bartenders and managers, assign only the access they need, and keep every shift accountable.' : restaurantMode ? 'Add the people who run service, assign their access, and keep accountability clear.' : 'Manage your team, assign role templates, and review operational activity.'}
          </p>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs md:flex">
          <ShieldCheck size={14} className="text-green-600" />
          <span className="text-slate-600">Current role: {staffRoleLabel(access?.role, restaurantMode)}</span>
        </div>
      </div>

      <div className={`bb-card flex gap-1 p-2 ${restaurantMode ? 'restaurant-staff-tabs' : ''}`}>
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => { setTab(key); setSearchParams({ tab: key }, { replace: true }) }}
            className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === key
                ? restaurantMode
                  ? 'restaurant-staff-tab-active text-white'
                  : 'bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-[0_10px_24px_rgba(22,101,52,0.24)]'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'staff' && <StaffMembers />}
      {tab === 'roles' && <RolesAndPermissions restaurantMode={restaurantMode} />}
      {tab === 'hotel-roles' && <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading...</div>}><HotelRolesConfig /></Suspense>}
      {tab === 'activity' && <ActivityLog restaurantMode={restaurantMode} />}
    </div>
  )
}
