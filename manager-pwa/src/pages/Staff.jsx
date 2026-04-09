import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useFeatures } from '../contexts/FeaturesContext'
import { listStaff } from '../lib/api'
import { shortDate, titleCase } from '../lib/format'

export default function Staff() {
  const { user } = useAuth()
  const { roleMeta } = useFeatures()
  const [staff, setStaff] = useState([])

  useEffect(() => {
    listStaff(user.lodge_id).then(setStaff).catch(() => setStaff([]))
  }, [user.lodge_id])

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <h1 className="text-lg font-bold text-white">Staff</h1>
        <p className="text-xs text-gray-400">Current mobile role: {roleMeta?.label || titleCase(user.role)}</p>
      </div>

      <div className="px-4 py-4 space-y-3">
        {staff.map((member) => (
          <div key={member.id} className="bg-gray-800 rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-gray-900 flex items-center justify-center text-green-300">
                <Users size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{member.name}</p>
                <p className="text-xs text-gray-400 mt-1">{member.email || 'No email'} • {titleCase(member.role)}</p>
                <p className="text-xs text-gray-500 mt-1">Joined {shortDate(member.created_at)}</p>
              </div>
            </div>
          </div>
        ))}
        {staff.length === 0 && <p className="text-sm text-gray-500">No staff profiles found.</p>}
      </div>
    </div>
  )
}
