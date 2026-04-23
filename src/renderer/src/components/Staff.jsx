import { useEffect, useMemo, useState, useCallback } from 'react'
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
  Mail
} from 'lucide-react'
import { Modal } from './shared/Modal'
import { useAccess, useAuth } from '../app-context'
import {
  CAPABILITY_LABELS,
  ROLE_DEFINITIONS,
  buildCapabilitySnapshot,
  getRoleOptions,
  canAccessCapability,
  isPwaEligibleRole,
  isPosOutletScopedRole,
  normalizeAppRole
} from '../../../shared/accessControl'

const emptyForm = {
  name: '',
  email: '',
  pin: '',
  role: 'receptionist',
  pwa_enabled: false,
  pwa_password: '',
  pwa_disabled_reason: '',
  allowed_outlet_ids: []
}

const emptyResetForm = {
  password: '',
  confirmPassword: ''
}

function roleTone(role) {
  return {
    receptionist: 'bg-emerald-100 text-emerald-700',
    operations: 'bg-amber-100 text-amber-700',
    finance: 'bg-sky-100 text-sky-700',
    manager: 'bg-violet-100 text-violet-700',
    admin: 'bg-rose-100 text-rose-700'
  }[role] || 'bg-gray-100 text-gray-600'
}

function formatShortDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

function buildUserPayload(form, existingUser = null) {
  const payload = {
    name: form.name,
    email: form.email,
    role: form.role,
    allowed_outlet_ids: Array.isArray(form.allowed_outlet_ids) ? form.allowed_outlet_ids : []
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
  const { user: currentUser } = useAuth()
  const access = useAccess()
  const canManageStaff = canAccessCapability(access, 'staff.manage')
  const canSetRoles = canAccessCapability(access, 'staff.permissions')

  const [users, setUsers] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editingUser, setEditingUser] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [outlets, setOutlets] = useState([])
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

  useEffect(() => {
    window.api.outlets.getAll().then(d => setOutlets(d || [])).catch(() => {})
  }, [])

  const availableRoles = useMemo(() => {
    return getRoleOptions().filter((role) => {
      if (role.value === 'super_admin') return false
      if (role.value === 'admin') return currentUser?.role === 'admin' || currentUser?.role === 'super_admin' || currentUser?.isMasterAdmin
      return true
    })
  }, [currentUser?.isMasterAdmin, currentUser?.role])

  const load = useCallback(async () => {
    const data = await window.api.users.getAll()
    setUsers(Array.isArray(data) ? data : [])
  }, [])

  const adminCount = useMemo(
    () => users.filter((user) => normalizeAppRole(user.role) === 'admin').length,
    [users]
  )

  const sortedUsers = useMemo(() => {
    const roleLabel = (user) => {
      const snapshot = buildCapabilitySnapshot({
        role: user.role,
        features: access?.features || {}
      })
      const roleInfo = ROLE_DEFINITIONS[snapshot.role] || ROLE_DEFINITIONS.receptionist
      return roleInfo.label || snapshot.role || ''
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
  }, [access?.features, sortBy, users])

  useEffect(() => {
    load()
  }, [load])

  const openAdd = () => {
    setEditingId(null)
    setEditingUser(null)
    setForm(emptyForm)
    setResetForm(emptyResetForm)
    setShowCreatePassword(false)
    setShowPin(false)
    setShowPwaPassword(false)
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
      role: user.role || 'receptionist',
      pwa_enabled: user.pwa_enabled === true,
      pwa_password: '',
      pwa_disabled_reason: user.pwa_disabled_reason || '',
      allowed_outlet_ids: Array.isArray(user.allowed_outlet_ids) ? user.allowed_outlet_ids : []
    })
    setShowPin(false)
    setShowPwaPassword(false)
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

    if (!canSetRoles && form.role !== 'receptionist') {
      setLoading(false)
      setError('Your role can add staff, but only managers and admins can assign advanced access templates.')
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

    if (isPosOutletScopedRole(form.role) && form.allowed_outlet_ids.length === 0) {
      setLoading(false)
      setError('Select at least one outlet for this role. Without an outlet, this user will be blocked from POS.')
      return
    }

    let result
    if (editingId) {
      result = await window.api.users.update(editingId, buildUserPayload(form, editingUser))
    } else {
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

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">{users.length} staff member{users.length !== 1 ? 's' : ''}</p>
          <p className="mt-1 text-xs text-slate-400">Role templates control what each team member can see, do, and access across Boroko.</p>
          {inviteNotice && (
            <p className={`mt-2 text-xs ${/could not|requires|failed|error/i.test(inviteNotice) ? 'text-red-600' : 'text-emerald-600'}`}>
              {inviteNotice}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
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
              className="btn-primary"
            >
              <Plus size={15} /> Add Staff
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {sortedUsers.map((staffUser) => {
          const snapshot = buildCapabilitySnapshot({
            role: staffUser.role,
            features: access?.features || {}
          })
          const roleInfo = ROLE_DEFINITIONS[snapshot.role] || ROLE_DEFINITIONS.receptionist
          const pwaEligible = isPwaEligibleRole(staffUser.role)
          const pwaEnabled = pwaEligible && staffUser.pwa_enabled === true
          const isSelf = staffUser.id === currentUser?.id
          const isLastAdmin = normalizeAppRole(staffUser.role) === 'admin' && adminCount <= 1
          const deleteBlockedReason = isSelf
            ? 'You cannot delete the account you are currently signed in with.'
            : isLastAdmin
              ? 'You cannot delete the last admin in this lodge.'
              : ''

          return (
            <div key={staffUser.id} className="bb-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 bg-green-100 rounded-2xl flex items-center justify-center">
                    {snapshot.role === 'manager' || snapshot.role === 'admin'
                      ? <ShieldCheck size={18} className="text-green-600" />
                      : <User size={18} className="text-green-500" />}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">{staffUser.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{staffUser.email}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${roleTone(snapshot.role)}`}>
                        {roleInfo.label}
                      </span>
                      <span className="text-xs text-slate-400">
                        {Object.values(snapshot.capabilities).filter(Boolean).length} active permissions
                      </span>
                    </div>
                  </div>
                </div>

                {canManageStaff && (
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
                  </div>
                )}
              </div>

              <p className="mt-4 text-sm text-slate-500">{roleInfo.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {roleInfo.highlights.map((highlight) => (
                  <span key={highlight} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                    {highlight}
                  </span>
                ))}
                {staffUser.id === currentUser?.id && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">(you)</span>
                )}
                {pwaEligible && (
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    pwaEnabled ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {pwaEnabled ? 'Manager mobile app ready' : 'Manager mobile app turned off'}
                  </span>
                )}
                {staffUser.pwa_password_set_at && (
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">
                    Mobile app password updated {formatShortDate(staffUser.pwa_password_set_at)}
                  </span>
                )}
              </div>
              {pwaEligible && !pwaEnabled && staffUser.pwa_disabled_reason && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mt-3">
                  {staffUser.pwa_disabled_reason}
                </p>
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

      {showModal && (
        <Modal
          title={editingId ? 'Edit Staff Member' : 'Add Staff Member'}
          onClose={() => {
            setShowModal(false)
            setResetForm(emptyResetForm)
          }}
          size="sm"
        >
          <form onSubmit={handleSave} className="space-y-4">
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
                <label className="mb-1 block text-sm font-medium text-slate-700">Desktop Password *</label>
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
            {['supervisor', 'manager', 'admin'].includes(form.role) && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Approval PIN <span className="font-normal text-slate-400">(4–6 digits)</span>
                </label>
                <div className="relative">
                  <input
                    type={showPin ? 'text' : 'password'}
                    inputMode="numeric"
                    className="input pr-10"
                    placeholder={editingId ? 'Leave blank to keep existing PIN' : 'Set a numeric PIN (optional)'}
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
                  Used to approve POS actions without a full login.
                </p>
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Role Template</label>
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
                  <option key={role.value} value={role.value}>{role.label}</option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">
                {ROLE_DEFINITIONS[form.role]?.description || ROLE_DEFINITIONS.receptionist.description}
              </p>
            </div>

            {/* POS Outlet Access — only shown for outlet-scoped roles (cashier / supervisor) */}
            {isPosOutletScopedRole(form.role) && outlets.length > 0 && (
              <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-medium text-slate-800">POS Outlet Access</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Select which outlets this {ROLE_DEFINITIONS[form.role]?.label || form.role} can access.
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

            {isPwaEligibleRole(form.role) && (
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
                You can create staff accounts, but advanced role changes require Manager or Admin permission.
              </div>
            )}
            {error && <div className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={loading} className="btn-primary flex-1">
                {loading ? 'Saving...' : editingId ? 'Save Changes' : 'Add Staff'}
              </button>
            </div>
          </form>
        </Modal>
      )}

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
              This action removes the staff member from this lodge. It cannot be undone from the Staff screen.
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

function ActivityLog() {
  const access = useAccess()
  const canClear = canAccessCapability(access, 'sync.manage')
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [backupInfo, setBackupInfo] = useState(null)
  const [showBackups, setShowBackups] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [log, info] = await Promise.all([
        window.api.activity.getAll(),
        window.api.backup.getInfo()
      ])
      setEntries(Array.isArray(log) ? log : [])
      setBackupInfo(info)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleClear = async () => {
    if (!window.confirm('Clear all activity log entries? This cannot be undone.')) return
    await window.api.activity.clear()
    setEntries([])
  }

  const filtered = filter === 'all' ? entries : entries.filter((entry) => entry.action === filter)
  const grouped = filtered.reduce((accumulator, entry) => {
    const day = new Date(entry.timestamp).toDateString()
    if (!accumulator[day]) accumulator[day] = []
    accumulator[day].push(entry)
    return accumulator
  }, {})

  const lastBackup = backupInfo?.backups?.[0]

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {FILTER_OPTIONS.map((option) => (
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
        <div className="text-center py-12 text-gray-400 text-sm">Loading activity...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <ClipboardList size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No activity recorded yet</p>
          <p className="text-xs mt-1">Actions like check-ins, bookings and payments will appear here</p>
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

      <div className="mt-6 border border-gray-200 rounded-xl overflow-hidden">
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
      </div>
    </div>
  )
}

function RolesAndPermissions() {
  const access = useAccess()
  const roles = getRoleOptions().filter((role) => role.value !== 'super_admin')

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <div className="flex items-center gap-3 mb-3">
          <Users2 size={18} className="text-green-600" />
          <div>
            <h2 className="text-base font-semibold text-gray-800">Role Templates</h2>
            <p className="text-sm text-gray-500 mt-1">Use these templates when assigning staff. Plan-limited modules are hidden automatically when the current subscription does not include them.</p>
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
          return (
            <div key={role.value} className={`rounded-2xl border p-5 bg-white shadow-sm ${access?.role === role.value ? 'border-green-300' : 'border-gray-200'}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-gray-800">{role.label}</p>
                  <p className="text-sm text-gray-500 mt-1">{role.description}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${roleTone(role.value)}`}>
                  {Object.values(snapshot.capabilities).filter(Boolean).length} live permissions
                </span>
              </div>

              <div className="flex flex-wrap gap-2 mt-4">
                {role.highlights.map((highlight) => (
                  <span key={highlight} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">{highlight}</span>
                ))}
              </div>

              <div className="mt-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Key access</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(snapshot.capabilities)
                    .filter(([, allowed]) => allowed)
                    .slice(0, 10)
                    .map(([capability]) => (
                      <span key={capability} className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded-full">
                        {CAPABILITY_LABELS[capability]}
                      </span>
                    ))}
                </div>
              </div>

              {blocked.length > 0 && (
                <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Unavailable on current plan</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {blocked.slice(0, 6).map((capability) => (
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
  const access = useAccess()

  const tabs = [
    { key: 'staff', label: 'Staff Members', icon: User },
    { key: 'roles', label: 'Roles & Permissions', icon: ShieldCheck },
    { key: 'activity', label: 'Activity Log', icon: ClipboardList }
  ]

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">People & Access</p>
          <h1 className="bb-page-header-title mt-2">Staff</h1>
          <p className="bb-page-header-subtitle">
            Manage your team, assign role templates, and review operational activity.
          </p>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs md:flex">
          <ShieldCheck size={14} className="text-green-600" />
          <span className="text-slate-600">Current role: {ROLE_DEFINITIONS[access?.role]?.label || 'User'}</span>
        </div>
      </div>

      <div className="bb-card flex gap-1 p-2">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === key
                ? 'bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-[0_10px_24px_rgba(22,101,52,0.24)]'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'staff' && <StaffMembers />}
      {tab === 'roles' && <RolesAndPermissions />}
      {tab === 'activity' && <ActivityLog />}
    </div>
  )
}
