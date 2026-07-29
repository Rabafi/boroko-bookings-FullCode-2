import { useCallback, useEffect, useMemo, useState } from 'react'
import { Users, Calendar, CheckSquare, BookOpen, BarChart3, Layers, Clock, Plus, Edit3, Trash2, RefreshCw, AlertTriangle, X, CheckCircle } from 'lucide-react'

const TABS = [
  ['schedule', 'Schedule', Calendar],
  ['departments', 'Departments', Layers],
  ['templates', 'Templates', Clock],
  ['tasks', 'Tasks', CheckSquare],
  ['training', 'Training', BookOpen],
  ['handover', 'Handover', Users],
  ['productivity', 'Productivity', BarChart3]
]

function priorityColor(p) {
  if (p === 'urgent') return 'text-red-600 bg-red-50'
  if (p === 'high') return 'text-orange-600 bg-orange-50'
  if (p === 'medium') return 'text-amber-600 bg-amber-50'
  return 'text-slate-600 bg-slate-50'
}

function statusColor(s) {
  if (s === 'completed') return 'text-emerald-600 bg-emerald-50'
  if (s === 'in_progress') return 'text-blue-600 bg-blue-50'
  if (s === 'cancelled') return 'text-slate-500 bg-slate-100'
  return 'text-amber-600 bg-amber-50'
}

function statusLabel(s) {
  if (s === 'in_progress') return 'In Progress'
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Pending'
}

export default function StaffOperations() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [warnings, setWarnings] = useState([])
  const [activeTab, setActiveTab] = useState('schedule')

  const [departments, setDepartments] = useState([])
  const [templates, setTemplates] = useState([])
  const [categories, setCategories] = useState([])
  const [tasks, setTasks] = useState([])
  const [checklists, setChecklists] = useState([])
  const [trainingRecords, setTrainingRecords] = useState([])
  const [handovers, setHandovers] = useState([])
  const [productivity, setProductivity] = useState({ metrics: [], summary: {} })

  const [deptModal, setDeptModal] = useState(null)
  const [templateModal, setTemplateModal] = useState(null)
  const [taskModal, setTaskModal] = useState(null)
  const [trainingModal, setTrainingModal] = useState(null)
  const [handoverModal, setHandoverModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [filterDept, setFilterDept] = useState('')

  const today = new Date().toISOString().slice(0, 10)
  const weekStart = useMemo(() => {
    const d = new Date()
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    return new Date(d.setDate(diff)).toISOString().slice(0, 10)
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    setWarnings([])
    const warn = []
    const settle = async (label, promise) => {
      try { return await promise } catch (e) { warn.push(`${label}: ${e?.message || 'failed'}`); return null }
    }
    try {
      const [depts, tpls, cats, tks, cls, records, hovers, prod] = await Promise.all([
        settle('Departments', window.api.staffOperations.getStaffDepartments()),
        settle('Templates', window.api.staffOperations.getShiftTemplates()),
        settle('Categories', window.api.staffOperations.getTaskCategories()),
        settle('Tasks', window.api.staffOperations.getTaskAssignments()),
        settle('Checklists', window.api.staffOperations.getTrainingChecklists()),
        settle('TrainingRecords', window.api.staffOperations.getTrainingRecords()),
        settle('Handovers', window.api.staffOperations.getShiftHandovers()),
        settle('Productivity', window.api.staffOperations.getStaffProductivityDashboard(
          new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), today
        ))
      ])
      if (warn.length && !depts && !tpls && !cats && !tks) {
        setError(warn.join(' · ') || 'Could not load staff operations data.')
        return
      }
      setWarnings(warn)
      if (depts) setDepartments(depts)
      if (tpls) setTemplates(tpls)
      if (cats) setCategories(cats)
      if (tks) setTasks(tks)
      if (cls) setChecklists(cls)
      if (records) setTrainingRecords(records)
      if (hovers) setHandovers(hovers)
      if (prod) setProductivity(prod)
    } catch (e) {
      setError(e?.message || 'Failed to load staff operations')
    } finally {
      setLoading(false)
    }
  }, [today])

  useEffect(() => { loadAll() }, [loadAll])

  const deptMap = useMemo(() => {
    const m = {}
    for (const d of departments) m[d.id] = d.name
    return m
  }, [departments])

  const filteredTemplates = useMemo(() => {
    if (!filterDept) return templates
    return templates.filter((t) => t.department_id === filterDept)
  }, [templates, filterDept])

  const tasksByStatus = useMemo(() => {
    const groups = { pending: [], in_progress: [], completed: [], cancelled: [] }
    for (const t of tasks) {
      const s = t.status || 'pending'
      if (groups[s]) groups[s].push(t)
      else groups.pending.push(t)
    }
    return groups
  }, [tasks])

  const filteredChecklists = useMemo(() => {
    if (!filterDept) return checklists
    return checklists.filter((c) => c.department_id === filterDept)
  }, [checklists, filterDept])

  // ── Department handlers ────────────────────────────────────────────────────
  const handleSaveDepartment = async () => {
    if (!deptModal?.name?.trim()) return
    try {
      if (deptModal.id) {
        await window.api.staffOperations.updateStaffDepartment(deptModal.id, {
          name: deptModal.name, description: deptModal.description, color: deptModal.color, is_active: deptModal.is_active
        })
      } else {
        await window.api.staffOperations.createStaffDepartment(deptModal.name, deptModal.description, deptModal.color)
      }
      setDeptModal(null)
      loadAll()
    } catch (e) { setError(e?.message || 'Failed to save department') }
  }

  const handleDeleteDepartment = async (id) => {
    try {
      const result = await window.api.staffOperations.deleteStaffDepartment(id)
      if (result?.success === false) { setError(result.error || 'Cannot delete department'); return }
      setConfirmDelete(null)
      loadAll()
    } catch (e) { setError(e?.message || 'Failed to delete department') }
  }

  // ── Template handlers ──────────────────────────────────────────────────────
  const handleSaveTemplate = async () => {
    if (!templateModal?.name?.trim() || !templateModal?.start_time || !templateModal?.end_time) return
    try {
      if (templateModal.id) {
        await window.api.staffOperations.updateShiftTemplate(templateModal.id, templateModal)
      } else {
        await window.api.staffOperations.createShiftTemplate(templateModal)
      }
      setTemplateModal(null)
      loadAll()
    } catch (e) { setError(e?.message || 'Failed to save template') }
  }

  // ── Task handlers ──────────────────────────────────────────────────────────
  const handleSaveTask = async () => {
    if (!taskModal?.title?.trim() || !taskModal?.staff_id) return
    try {
      if (taskModal.id) {
        await window.api.staffOperations.updateTaskAssignment(taskModal.id, taskModal)
      } else {
        await window.api.staffOperations.createTaskAssignment(taskModal)
      }
      setTaskModal(null)
      loadAll()
    } catch (e) { setError(e?.message || 'Failed to save task') }
  }

  const handleCompleteTask = async (id, notes) => {
    try {
      await window.api.staffOperations.completeTaskAssignment(id, notes)
      loadAll()
    } catch (e) { setError(e?.message || 'Failed to complete task') }
  }

  // ── Training handler ───────────────────────────────────────────────────────
  const handleRecordTraining = async () => {
    if (!trainingModal?.staff_id || !trainingModal?.checklist_id) return
    try {
      await window.api.staffOperations.recordTrainingCompletion(trainingModal.staff_id, trainingModal.checklist_id, trainingModal.notes)
      setTrainingModal(null)
      loadAll()
    } catch (e) { setError(e?.message || 'Failed to record training') }
  }

  // ── Handover handler ───────────────────────────────────────────────────────
  const handleSaveHandover = async () => {
    if (!handoverModal.from_staff_id || !handoverModal.to_staff_id) return
    try {
      await window.api.staffOperations.createShiftHandover(handoverModal)
      setHandoverModal(false)
      loadAll()
    } catch (e) { setError(e?.message || 'Failed to create handover') }
  }

  if (loading && !departments.length && !tasks.length) {
    return (
      <div className="bb-page">
        <div className="bb-page-header">
          <p className="bb-section-kicker">WORKFORCE</p>
          <h1 className="bb-page-header-title">Staff Operations</h1>
          <p className="bb-page-header-subtitle">Departments, shift templates, tasks, training, handover &amp; productivity</p>
        </div>
        <div className="flex items-center justify-center py-20">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      </div>
    )
  }

  return (
    <div className="bb-page">
      <div className="bb-page-header">
        <div className="flex items-center justify-between">
          <div>
            <p className="bb-section-kicker">WORKFORCE</p>
            <h1 className="bb-page-header-title">Staff Operations</h1>
            <p className="bb-page-header-subtitle">Departments, shift templates, tasks, training, handover &amp; productivity</p>
          </div>
          <button onClick={loadAll} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bb-card p-4 mb-4 border-red-200 bg-red-50">
          <div className="flex items-center justify-between">
            <p className="text-xs text-red-600 font-medium flex items-center gap-2"><AlertTriangle size={14} />{error}</p>
            <button onClick={() => setError(null)} className="text-xs text-slate-500 hover:underline">Dismiss</button>
          </div>
        </div>
      )}
      {warnings.length > 0 && !error && (
        <div className="bb-card p-4 mb-4 border-amber-200 bg-amber-50">
          <p className="text-xs text-amber-800 font-medium mb-1">Partial load warnings</p>
          <ul className="text-xs text-amber-700 list-disc pl-4 space-y-0.5">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-slate-200 mb-4 overflow-x-auto">
        {TABS.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 whitespace-nowrap px-4 py-2 text-xs font-semibold transition-colors ${activeTab === key ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* ── Schedule Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'schedule' && (
        <section className="bb-card p-5">
          <h2 className="text-sm font-bold text-slate-800 mb-3">Weekly Schedule Overview</h2>
          <p className="text-xs text-slate-500 mb-4">Schedule management, conflict detection, and publishing are handled in the Staff Scheduling view.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Week Start</p>
              <p className="text-sm font-bold text-slate-800">{weekStart}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Staff</p>
              <p className="text-sm font-bold text-slate-800">{tasks.length ? [...new Set(tasks.map((t) => t.staff_id))].length : 0}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Departments</p>
              <p className="text-sm font-bold text-slate-800">{departments.length}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Active Templates</p>
              <p className="text-sm font-bold text-slate-800">{templates.filter((t) => t.is_active).length}</p>
            </div>
          </div>
        </section>
      )}

      {/* ── Departments Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'departments' && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-800">All Departments ({departments.length})</h2>
            <button onClick={() => setDeptModal({ name: '', description: '', color: '', is_active: true })} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors">
              <Plus size={13} /> Add Department
            </button>
          </div>
          {departments.length === 0 ? (
            <div className="bb-empty-state min-h-[180px]">
              <Layers size={28} className="opacity-30 mb-1" />
              <p className="text-sm font-semibold text-slate-800">No departments yet</p>
              <p className="text-xs text-slate-500">Create your first department to organise staff.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {departments.map((d) => (
                <div key={d.id} className="bb-card p-4 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-block w-3 h-3 rounded-full ${d.color ? '' : 'bg-slate-300'}`} style={d.color ? { backgroundColor: d.color } : {}} />
                      <h3 className="text-sm font-bold text-slate-800">{d.name}</h3>
                      {!d.is_active && <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">Inactive</span>}
                    </div>
                    {d.description && <p className="text-xs text-slate-500 mb-2">{d.description}</p>}
                    <p className="text-[10px] text-slate-400">ID: {d.id.slice(0, 8)}…</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => setDeptModal({ id: d.id, name: d.name, description: d.description || '', color: d.color || '', is_active: d.is_active })} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                      <Edit3 size={13} />
                    </button>
                    <button onClick={() => setConfirmDelete({ type: 'department', id: d.id, name: d.name })} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Templates Tab ───────────────────────────────────────────────────── */}
      {activeTab === 'templates' && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-800">Shift Templates ({filteredTemplates.length})</h2>
            <div className="flex gap-2 items-center">
              <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600">
                <option value="">All departments</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <button onClick={() => setTemplateModal({ name: '', start_time: '08:00', end_time: '16:00', department_id: filterDept || null, required_roles: [], break_duration_minutes: 0, is_active: true })} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors">
                <Plus size={13} /> Add Template
              </button>
            </div>
          </div>
          {filteredTemplates.length === 0 ? (
            <div className="bb-empty-state min-h-[180px]">
              <Clock size={28} className="opacity-30 mb-1" />
              <p className="text-sm font-semibold text-slate-800">No shift templates</p>
              <p className="text-xs text-slate-500">Create reusable shift templates for quick scheduling.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredTemplates.map((t) => (
                <div key={t.id} className="bb-card p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">{t.name}</h3>
                      <p className="text-xs text-slate-500">{t.department_name || 'No department'}</p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setTemplateModal({ id: t.id, name: t.name, start_time: t.start_time?.slice(0, 5), end_time: t.end_time?.slice(0, 5), department_id: t.department_id, required_roles: t.required_roles || [], break_duration_minutes: t.break_duration_minutes || 0, is_active: t.is_active })} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                        <Edit3 size={13} />
                      </button>
                      <button onClick={() => setConfirmDelete({ type: 'template', id: t.id, name: t.name })} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-600 mb-1">
                    <span className="font-mono font-semibold">{t.start_time?.slice(0, 5)} – {t.end_time?.slice(0, 5)}</span>
                    {t.break_duration_minutes > 0 && <span className="text-slate-400">{t.break_duration_minutes}min break</span>}
                  </div>
                  {t.required_roles?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {t.required_roles.map((r) => <span key={r} className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{r}</span>)}
                    </div>
                  )}
                  {!t.is_active && <span className="mt-2 inline-block text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">Inactive</span>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Tasks Tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'tasks' && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-800">Task Assignments ({tasks.length})</h2>
            <button onClick={() => setTaskModal({ title: '', description: '', staff_id: '', task_category_id: '', priority: 'medium', due_date: '' })} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors">
              <Plus size={13} /> New Task
            </button>
          </div>
          {tasks.length === 0 ? (
            <div className="bb-empty-state min-h-[180px]">
              <CheckSquare size={28} className="opacity-30 mb-1" />
              <p className="text-sm font-semibold text-slate-800">No task assignments</p>
              <p className="text-xs text-slate-500">Assign tasks to staff members to track work.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {['pending', 'in_progress', 'completed', 'cancelled'].map((status) => (
                <div key={status}>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
                    {statusLabel(status)} <span className="text-slate-400 font-mono">({tasksByStatus[status]?.length || 0})</span>
                  </h3>
                  <div className="flex flex-col gap-2">
                    {(tasksByStatus[status] || []).length === 0 ? (
                      <p className="text-[10px] text-slate-400 italic px-1">No tasks</p>
                    ) : (
                      (tasksByStatus[status] || []).map((t) => (
                        <div key={t.id} className="bb-card p-3 text-xs">
                          <div className="flex items-start justify-between gap-1 mb-1">
                            <span className="font-semibold text-slate-800">{t.title}</span>
                            <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${priorityColor(t.priority)}`}>{t.priority}</span>
                          </div>
                          {t.category_name && <p className="text-[10px] text-slate-400 mb-1">{t.category_name}</p>}
                          <p className="text-slate-500 mb-1 line-clamp-2">{t.description || '—'}</p>
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span>{t.staff_name || 'Unknown'}</span>
                            {t.due_date && <span>Due {t.due_date}</span>}
                          </div>
                          {status !== 'completed' && status !== 'cancelled' && (
                            <button onClick={() => handleCompleteTask(t.id, '')} className="mt-2 text-[10px] font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
                              <CheckCircle size={11} /> Complete
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Training Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'training' && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-800">Training Checklists ({filteredChecklists.length})</h2>
            <div className="flex gap-2 items-center">
              <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600">
                <option value="">All departments</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          {filteredChecklists.length === 0 ? (
            <div className="bb-empty-state min-h-[180px]">
              <BookOpen size={28} className="opacity-30 mb-1" />
              <p className="text-sm font-semibold text-slate-800">No training checklists</p>
              <p className="text-xs text-slate-500">Create checklists to track staff training completion.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {filteredChecklists.map((cl) => (
                <div key={cl.id} className="bb-card overflow-hidden">
                  <div className="p-4 border-b border-slate-100">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-slate-800">{cl.title}</h3>
                        <p className="text-xs text-slate-500">{cl.department_name || 'General'}{cl.is_required ? ' · Required' : ' · Optional'}</p>
                      </div>
                      <button onClick={() => setTrainingModal({ checklist_id: cl.id, staff_id: '', notes: '' })} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700 transition-colors">
                        <CheckCircle size={11} /> Record
                      </button>
                    </div>
                    {cl.description && <p className="text-xs text-slate-500 mt-2">{cl.description}</p>}
                  </div>
                  {cl.items?.length > 0 && (
                    <ul className="divide-y divide-slate-50 px-4 py-2">
                      {cl.items.map((item) => (
                        <li key={item.id} className="flex items-center gap-2 py-1.5 text-xs text-slate-600">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${item.is_optional ? 'bg-slate-300' : 'bg-emerald-500'}`} />
                          {item.title}
                          {item.is_optional && <span className="text-[10px] text-slate-400">(optional)</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Training Records */}
          {trainingRecords.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Recent Training Records ({trainingRecords.length})</h3>
              <div className="bb-table-shell">
                <table className="bb-table">
                  <thead>
                    <tr>
                      <th>Staff</th>
                      <th>Checklist</th>
                      <th>Completed</th>
                      <th>Completed By</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trainingRecords.slice(0, 10).map((r) => (
                      <tr key={r.id}>
                        <td className="font-medium text-slate-800">{r.staff_name || 'Unknown'}</td>
                        <td className="text-slate-600">{r.checklist_title || '—'}</td>
                        <td className="text-slate-600">{r.completed_at ? new Date(r.completed_at).toLocaleDateString() : '—'}</td>
                        <td className="text-slate-600">{r.completed_by_name || '—'}</td>
                        <td className="text-slate-500">{r.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Handover Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'handover' && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-800">Shift Handovers ({handovers.length})</h2>
            <button onClick={() => setHandoverModal({ from_staff_id: '', to_staff_id: '', shift_date: today, notes: '', pending_tasks: [] })} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors">
              <Plus size={13} /> New Handover
            </button>
          </div>
          {handovers.length === 0 ? (
            <div className="bb-empty-state min-h-[180px]">
              <Users size={28} className="opacity-30 mb-1" />
              <p className="text-sm font-semibold text-slate-800">No handover records</p>
              <p className="text-xs text-slate-500">Log shift handovers to keep staff informed.</p>
            </div>
          ) : (
            <div className="bb-table-shell">
              <table className="bb-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Notes</th>
                    <th>Pending Tasks</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {handovers.map((h) => (
                    <tr key={h.id}>
                      <td className="text-slate-600 font-medium">{h.shift_date}</td>
                      <td className="text-slate-800">{h.from_staff_name || 'Unknown'}</td>
                      <td className="text-slate-800">{h.to_staff_name || 'Unknown'}</td>
                      <td className="text-slate-500 max-w-[200px] truncate">{h.notes || '—'}</td>
                      <td className="text-slate-600">{Array.isArray(h.pending_tasks) ? h.pending_tasks.length : 0} tasks</td>
                      <td>{h.completed_at ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded"><CheckCircle size={10} /> Complete</span> : <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Open</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── Productivity Tab ────────────────────────────────────────────────── */}
      {activeTab === 'productivity' && (
        <section>
          <h2 className="text-sm font-bold text-slate-800 mb-3">Productivity Dashboard</h2>
          {productivity.summary && Object.keys(productivity.summary).length > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-5">
                <div className="bb-card p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Total Tasks</p>
                  <p className="text-2xl font-bold text-slate-800">{productivity.summary.total_tasks || 0}</p>
                </div>
                <div className="bb-card p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">On Time</p>
                  <p className="text-2xl font-bold text-emerald-600">{productivity.summary.on_time_tasks || 0}</p>
                </div>
                <div className="bb-card p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Avg Rating</p>
                  <p className="text-2xl font-bold text-amber-600">{productivity.summary.avg_rating || '—'}</p>
                </div>
                <div className="bb-card p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Staff Measured</p>
                  <p className="text-2xl font-bold text-slate-800">{productivity.summary.staff_count || 0}</p>
                </div>
              </div>

              {productivity.metrics?.length > 0 ? (
                <div className="bb-table-shell">
                  <table className="bb-table">
                    <thead>
                      <tr>
                        <th>Staff</th>
                        <th>Date</th>
                        <th>Completed</th>
                        <th>On Time</th>
                        <th>Avg Time (min)</th>
                        <th>Incidents</th>
                        <th>Rating</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productivity.metrics.map((m, i) => (
                        <tr key={i}>
                          <td className="font-medium text-slate-800">{m.staff_name || 'Unknown'}</td>
                          <td className="text-slate-600">{m.metric_date}</td>
                          <td className="text-slate-800">{m.tasks_completed}</td>
                          <td className="text-slate-600">{m.tasks_on_time}</td>
                          <td className="text-slate-600">{m.avg_completion_time_minutes ?? '—'}</td>
                          <td className="text-slate-600">{m.incidents}</td>
                          <td><span className="font-semibold">{m.rating ?? '—'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-slate-400">No productivity data for the selected period.</p>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-400">Productivity dashboard data is not available yet.</p>
          )}
        </section>
      )}

      {/* ── Department Modal ────────────────────────────────────────────────── */}
      {deptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setDeptModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-800">{deptModal.id ? 'Edit Department' : 'New Department'}</h3>
              <button onClick={() => setDeptModal(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Name *</label>
                <input value={deptModal.name || ''} onChange={(e) => setDeptModal({ ...deptModal, name: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Description</label>
                <textarea value={deptModal.description || ''} onChange={(e) => setDeptModal({ ...deptModal, description: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800" rows={2} />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Color</label>
                <input value={deptModal.color || ''} onChange={(e) => setDeptModal({ ...deptModal, color: e.target.value })} placeholder="# hex" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800" />
              </div>
              {deptModal.id && (
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={deptModal.is_active !== false} onChange={(e) => setDeptModal({ ...deptModal, is_active: e.target.checked })} className="rounded" />
                  <label className="text-xs font-semibold text-slate-600">Active</label>
                </div>
              )}
            </div>
            <div className="bb-modal-footer mt-4">
              <button onClick={() => setDeptModal(null)} className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleSaveDepartment} className="flex-1 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Template Modal ──────────────────────────────────────────────────── */}
      {templateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setTemplateModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-800">{templateModal.id ? 'Edit Template' : 'New Shift Template'}</h3>
              <button onClick={() => setTemplateModal(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Name *</label>
                <input value={templateModal.name || ''} onChange={(e) => setTemplateModal({ ...templateModal, name: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">Start *</label>
                  <input type="time" value={templateModal.start_time || '08:00'} onChange={(e) => setTemplateModal({ ...templateModal, start_time: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">End *</label>
                  <input type="time" value={templateModal.end_time || '16:00'} onChange={(e) => setTemplateModal({ ...templateModal, end_time: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Department</label>
                <select value={templateModal.department_id || ''} onChange={(e) => setTemplateModal({ ...templateModal, department_id: e.target.value || null })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800">
                  <option value="">No department</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Break (minutes)</label>
                <input type="number" value={templateModal.break_duration_minutes || 0} onChange={(e) => setTemplateModal({ ...templateModal, break_duration_minutes: parseInt(e.target.value) || 0 })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800" />
              </div>
              {templateModal.id && (
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={templateModal.is_active !== false} onChange={(e) => setTemplateModal({ ...templateModal, is_active: e.target.checked })} className="rounded" />
                  <label className="text-xs font-semibold text-slate-600">Active</label>
                </div>
              )}
            </div>
            <div className="bb-modal-footer mt-4">
              <button onClick={() => setTemplateModal(null)} className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleSaveTemplate} className="flex-1 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Task Modal ──────────────────────────────────────────────────────── */}
      {taskModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setTaskModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-800">{taskModal.id ? 'Edit Task' : 'New Task Assignment'}</h3>
              <button onClick={() => setTaskModal(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Title *</label>
                <input value={taskModal.title || ''} onChange={(e) => setTaskModal({ ...taskModal, title: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Description</label>
                <textarea value={taskModal.description || ''} onChange={(e) => setTaskModal({ ...taskModal, description: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800" rows={2} />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Staff *</label>
                <select value={taskModal.staff_id || ''} onChange={(e) => setTaskModal({ ...taskModal, staff_id: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800">
                  <option value="">Select staff</option>
                  {[...new Set(tasks.map((t) => t.staff_id))].map((sid) => {
                    const s = tasks.find((t) => t.staff_id === sid)
                    return <option key={sid} value={sid}>{s?.staff_name || sid}</option>
                  })}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Category</label>
                <select value={taskModal.task_category_id || ''} onChange={(e) => setTaskModal({ ...taskModal, task_category_id: e.target.value || '' })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800">
                  <option value="">No category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">Priority</label>
                  <select value={taskModal.priority || 'medium'} onChange={(e) => setTaskModal({ ...taskModal, priority: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">Due Date</label>
                  <input type="date" value={taskModal.due_date || ''} onChange={(e) => setTaskModal({ ...taskModal, due_date: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800" />
                </div>
              </div>
            </div>
            <div className="bb-modal-footer mt-4">
              <button onClick={() => setTaskModal(null)} className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleSaveTask} className="flex-1 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Training Record Modal ───────────────────────────────────────────── */}
      {trainingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setTrainingModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-800">Record Training Completion</h3>
              <button onClick={() => setTrainingModal(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Staff *</label>
                <select value={trainingModal.staff_id || ''} onChange={(e) => setTrainingModal({ ...trainingModal, staff_id: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800">
                  <option value="">Select staff</option>
                  {[...new Set(tasks.map((t) => t.staff_id))].map((sid) => {
                    const s = tasks.find((t) => t.staff_id === sid)
                    return <option key={sid} value={sid}>{s?.staff_name || sid}</option>
                  })}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Checklist *</label>
                <select value={trainingModal.checklist_id || ''} onChange={(e) => setTrainingModal({ ...trainingModal, checklist_id: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800">
                  <option value="">Select checklist</option>
                  {checklists.map((cl) => <option key={cl.id} value={cl.id}>{cl.title}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Notes</label>
                <textarea value={trainingModal.notes || ''} onChange={(e) => setTrainingModal({ ...trainingModal, notes: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800" rows={2} />
              </div>
            </div>
            <div className="bb-modal-footer mt-4">
              <button onClick={() => setTrainingModal(null)} className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleRecordTraining} className="flex-1 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors">Record</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Handover Modal ──────────────────────────────────────────────────── */}
      {handoverModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setHandoverModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-800">New Shift Handover</h3>
              <button onClick={() => setHandoverModal(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">From Staff *</label>
                  <select value={handoverModal.from_staff_id || ''} onChange={(e) => setHandoverModal({ ...handoverModal, from_staff_id: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800">
                    <option value="">Select</option>
                    {[...new Set(tasks.map((t) => t.staff_id))].map((sid) => {
                      const s = tasks.find((t) => t.staff_id === sid)
                      return <option key={sid} value={sid}>{s?.staff_name || sid}</option>
                    })}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">To Staff *</label>
                  <select value={handoverModal.to_staff_id || ''} onChange={(e) => setHandoverModal({ ...handoverModal, to_staff_id: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800">
                    <option value="">Select</option>
                    {[...new Set(tasks.map((t) => t.staff_id))].map((sid) => {
                      const s = tasks.find((t) => t.staff_id === sid)
                      return <option key={sid} value={sid}>{s?.staff_name || sid}</option>
                    })}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Shift Date</label>
                <input type="date" value={handoverModal.shift_date || today} onChange={(e) => setHandoverModal({ ...handoverModal, shift_date: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Notes</label>
                <textarea value={handoverModal.notes || ''} onChange={(e) => setHandoverModal({ ...handoverModal, notes: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800" rows={3} />
              </div>
            </div>
            <div className="bb-modal-footer mt-4">
              <button onClick={() => setHandoverModal(false)} className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleSaveHandover} className="flex-1 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Delete ──────────────────────────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle size={18} className="text-red-500 shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-slate-800">Delete {confirmDelete.type === 'department' ? 'Department' : 'Template'}</h3>
                <p className="text-xs text-slate-500 mt-1">Are you sure you want to delete &ldquo;{confirmDelete.name}&rdquo;? This cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={() => confirmDelete.type === 'department' ? handleDeleteDepartment(confirmDelete.id) : (async () => { try { await window.api.staffOperations.deleteShiftTemplate(confirmDelete.id); setConfirmDelete(null); loadAll() } catch (e) { setError(e?.message || 'Delete failed') } })()} className="flex-1 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
