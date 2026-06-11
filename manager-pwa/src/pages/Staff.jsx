import { useEffect, useMemo, useState } from 'react'
import { Shield, Smartphone, Users } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useFeatures } from '../contexts/FeaturesContext'
import { listStaff } from '../lib/api'
import { shortDate, titleCase } from '../lib/format'
import {
  ROLE_DEFINITIONS,
  STAFF_STATUS_LABELS,
  buildCapabilitySnapshot,
  normalizeAppRole,
  normalizeStaffStatus
} from '@shared/accessControl'

function toneForStatus(status) {
  return {
    active: 'bg-green-900/50 text-green-300',
    suspended: 'bg-amber-900/50 text-amber-300',
    archived: 'bg-gray-800 text-gray-300'
  }[normalizeStaffStatus(status)] || 'bg-gray-800 text-gray-300'
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

function buildSignals(member) {
  const signals = []
  if (member.last_desktop_sign_in_at) signals.push(`Desk ${formatDateTime(member.last_desktop_sign_in_at)}`)
  if (member.last_pwa_sign_in_at) signals.push(`Mobile ${formatDateTime(member.last_pwa_sign_in_at)}`)
  if (member.last_activity_at) signals.push(`Active ${formatDateTime(member.last_activity_at)}`)
  if (member.invite_sent_at && !member.last_sign_in_at) signals.push(`Invite ${formatDateTime(member.invite_sent_at)}`)
  if (member.password_updated_at) signals.push(`Password ${formatDateTime(member.password_updated_at)}`)
  signals.push(member.pwa_enabled ? 'Mobile access ready' : 'Mobile access off')
  return signals
}

export default function Staff() {
  const { user } = useAuth()
  const { roleMeta, access } = useFeatures()
  const [staff, setStaff] = useState([])

  useEffect(() => {
    listStaff(user.lodge_id).then(setStaff).catch(() => setStaff([]))
  }, [user.lodge_id])

  const summary = useMemo(() => ({
    active: staff.filter((member) => normalizeStaffStatus(member.status) === 'active').length,
    suspended: staff.filter((member) => normalizeStaffStatus(member.status) === 'suspended').length,
    archived: staff.filter((member) => normalizeStaffStatus(member.status) === 'archived').length
  }), [staff])

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <h1 className="text-lg font-bold text-white">Staff</h1>
        <p className="text-xs text-gray-400">Current mobile role: {roleMeta?.label || titleCase(user.role)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-green-900/50 px-2.5 py-1 text-[11px] text-green-300">{summary.active} active</span>
          {summary.suspended > 0 && <span className="rounded-full bg-amber-900/50 px-2.5 py-1 text-[11px] text-amber-300">{summary.suspended} suspended</span>}
          {summary.archived > 0 && <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] text-gray-300">{summary.archived} archived</span>}
          <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] text-gray-300">{access?.enabledCount || 0} mobile permissions</span>
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        {staff.map((member) => {
          const snapshot = buildCapabilitySnapshot({
            role: member.role,
            features: access?.features || {},
            capabilityOverrides: member.capability_overrides || {}
          })
          const role = ROLE_DEFINITIONS[normalizeAppRole(member.role)] || ROLE_DEFINITIONS.receptionist
          const signals = buildSignals(member)
          return (
            <div key={member.id} className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gray-800 text-green-300">
                  {member.pwa_enabled ? <Smartphone size={18} /> : <Users size={18} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-white">{member.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${toneForStatus(member.status)}`}>
                      {STAFF_STATUS_LABELS[normalizeStaffStatus(member.status)]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">{member.email || 'No email'} • {role.label}</p>
                  <p className="mt-1 text-xs text-gray-500">{role.description}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {role.highlights.map((item) => (
                      <span key={item} className="rounded-full bg-gray-800 px-2 py-1 text-[11px] text-gray-300">{item}</span>
                    ))}
                    {Object.keys(member.capability_overrides || {}).length > 0 && (
                      <span className="rounded-full bg-sky-900/40 px-2 py-1 text-[11px] text-sky-300">Custom overrides</span>
                    )}
                    {member.pwa_enabled && (
                      <span className="rounded-full bg-indigo-900/40 px-2 py-1 text-[11px] text-indigo-300">Manager mobile app enabled</span>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {signals.map((signal) => (
                      <span key={signal} className="rounded-full bg-gray-800 px-2 py-1 text-[11px] text-gray-400">{signal}</span>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-gray-500">
                    <Shield size={13} />
                    <span>{Object.values(snapshot.capabilities || {}).filter(Boolean).length} live permissions</span>
                    <span>• Joined {shortDate(member.created_at)}</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        {staff.length === 0 && <p className="text-sm text-gray-500">No staff profiles found.</p>}
      </div>
    </div>
  )
}
