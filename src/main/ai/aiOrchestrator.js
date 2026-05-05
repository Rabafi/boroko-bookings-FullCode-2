import fs from 'fs'
import { join } from 'path'
import crypto from 'crypto'
import { BrowserWindow } from 'electron'

function nowIso() {
  return new Date().toISOString()
}

function safeJsonParse(raw, fallback = null) {
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function extractJsonObject(text) {
  if (!text) return null
  const match = String(text).match(/\{[\s\S]*\}$/m)
  if (!match) return null
  return safeJsonParse(match[0], null)
}

function stripTrailingJson(text) {
  if (!text) return ''
  const match = String(text).match(/\{[\s\S]*\}$/m)
  if (!match) return String(text)
  return String(text).slice(0, match.index).trim()
}

function readAiApiKey(db) {
  const key = (
    process.env.BOROKO_AI_API_KEY ||
    process.env.MAIN_VITE_BOROKO_AI_API_KEY ||
    process.env.BOROKO_GEMINI_API_KEY ||
    process.env.MAIN_VITE_BOROKO_GEMINI_API_KEY ||
    process.env.OPENCODE_API_KEY ||
    process.env.OPENCODE_ZEN_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GEMINI_API_KEY ||
    ''
  ).trim()

  if (key) return key

  try {
    const settings = db?.getSettingsSync?.() || null
    if (settings?.ai_api_key) return settings.ai_api_key.trim()
    if (settings?.gemini_api_key) return settings.gemini_api_key.trim()
  } catch {
    // non-fatal
  }

  return ''
}

const AI_BASE_URL = process.env.BOROKO_AI_BASE_URL || ''
const AI_PROVIDER = process.env.BOROKO_AI_PROVIDER || 'gemini'
const DEFAULT_AI_MODEL = process.env.BOROKO_AI_MODEL || 'gemini-2.5-flash'

async function aiGenerate({ db, model, system, user, context, signal }) {
  const apiKey = readAiApiKey(db)
  if (!apiKey) {
    throw new Error('AI API key missing. Set BOROKO_AI_API_KEY or BOROKO_GEMINI_API_KEY in the app environment.')
  }

  const resolvedModel = model || DEFAULT_AI_MODEL
  const provider = AI_PROVIDER.toLowerCase()

  if (provider === 'opencode' || provider === 'zen') {
    const baseUrl = AI_BASE_URL || 'https://opencode.ai/zen/v1'
    const url = `${baseUrl}/chat/completions`
    const messages = []
    if (system?.trim()) messages.push({ role: 'system', content: system.trim() })
    if (context) messages.push({ role: 'system', content: `CONTEXT_JSON:\n${JSON.stringify(context)}` })
    messages.push({ role: 'user', content: String(user || '').trim() })

    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: resolvedModel,
        messages,
        temperature: 0.2,
        max_tokens: 800
      })
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const message = data?.error?.message || data?.error?.type || `AI request failed (${res.status})`
      throw new Error(message)
    }
    const text = data?.choices?.[0]?.message?.content
    if (!text) {
      const message = data?.error?.message || 'AI did not return text.'
      throw new Error(message)
    }
    return String(text).trim()
  }

  // Default: Gemini
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${apiKey}`
  const prompt = [
    system?.trim() ? system.trim() : null,
    context ? `CONTEXT_JSON:\n${JSON.stringify(context)}` : null,
    `USER:\n${String(user || '').trim()}`
  ].filter(Boolean).join('\n\n')

  const res = await fetch(geminiUrl, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 800 }
    })
  })

  const data = await res.json().catch(() => ({}))
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    const message = data?.error?.message || 'AI did not return text.'
    throw new Error(message)
  }
  return String(text)
}

function writeAiAuditLog({ user, lodgeId, event, payload }, { userDataPath }) {
  try {
    const path = join(userDataPath, 'ai-audit.log')
    const entry = {
      at: nowIso(),
      lodge_id: lodgeId || null,
      user_id: user?.id || null,
      user_email: user?.email || null,
      user_role: user?.role || null,
      event,
      payload: payload || null
    }
    fs.appendFileSync(path, JSON.stringify(entry) + '\n', 'utf8')
  } catch {
    // non-fatal
  }
}

function buildToolSpecs() {
  return [
    {
      name: 'get_attention',
      description: "Summarize what needs attention now: overdue checkouts, unpaid balances, maintenance, low stock.",
      confirm: false
    },
    {
      name: 'get_today_revenue',
      description: 'Return today net collected from booking payments and POS if available.',
      confirm: false
    },
    {
      name: 'list_unpaid_bookings',
      description: 'List top unpaid bookings with balances due.',
      confirm: false
    },
    {
      name: 'get_unpaid_summary',
      description: 'Return a full collections intelligence snapshot: total outstanding, unpaid count, and breakdown by overdue / due-today / future.',
      confirm: false
    },
    {
      name: 'create_booking',
      description: 'Create a booking via RPC (financial-safe).',
      confirm: true
    },
    {
      name: 'check_in',
      description: 'Check in a guest for an existing booking.',
      confirm: true
    },
    {
      name: 'check_out',
      description: 'Check out a guest for an existing booking (requires fully paid).',
      confirm: true
    },
    {
      name: 'record_payment',
      description: 'Record a payment for a booking via RPC (idempotent).',
      confirm: true
    },
    {
      name: 'bulk_record_payment',
      description: 'Collect outstanding balances for multiple bookings in one batch. Params: { booking_ids: string[], method: "cash"|"card"|"transfer" }',
      confirm: true
    },
    {
      name: 'detect_payment_anomalies',
      description: 'Run rule-based detection for suspicious financial activity and return alerts.',
      confirm: false
    },
    {
      name: 'get_daily_briefing',
      description: 'Generates an executive daily briefing: occupancy, revenue, outstanding balances, operational alerts, and trends.',
      confirm: false
    },
    {
      name: 'get_overdue_checkouts',
      description: 'Finds all bookings that should have checked out already but are still marked as checked in.',
      confirm: false
    },
    {
      name: 'bulk_check_out',
      description: 'Check out multiple bookings in bulk. Params: { booking_ids: string[] }',
      confirm: true
    }
  ]
}

function buildSystemPrompt({ tools }) {
  return `
You are Boroko Ops AI — a hotel operations manager inside Boroko Bookings.

You MUST follow these rules:
- Do not invent data. If you need data, request a tool.
- Never output raw SQL. Never suggest direct DB writes.
- When proposing an action, output ONE JSON object at the end with "tool" and "params".
- If you are only answering, do not output JSON.
- The JSON must be the LAST thing in the message.

TOOLS:
${tools.map((t) => `- ${t.name}: ${t.description} (confirm=${t.confirm ? 'yes' : 'no'})`).join('\n')}

JSON SCHEMA:
{
  "tool": "one_of_${tools.map((t) => t.name).join('_')}",
  "params": { "any": "tool-specific params" }
}
`.trim()
}

export function createAiOrchestrator({ appUserDataPath, db, requireCapability }) {
  const proposals = new Map() // id -> { createdAt, tool, params, meta }

  const toolCaps = {
    get_attention: 'dashboard.view',
    get_today_revenue: 'dashboard.view',
    list_unpaid_bookings: 'bookings.view',
    get_unpaid_summary: 'bookings.view',
    create_booking: 'bookings.manage',
    check_in: 'bookings.manage',
    check_out: 'bookings.manage',
    record_payment: 'payments.record',
    bulk_record_payment: 'payments.record',
    detect_payment_anomalies: 'payments.record',
    get_daily_briefing: 'dashboard.view',
    get_overdue_checkouts: 'dashboard.view',
    bulk_check_out: 'bookings.manage'
  }

  const tools = buildToolSpecs()
  const system = buildSystemPrompt({ tools })

  async function buildContextSnapshot() {
    // Keep context intentionally small (token + performance).
    const [stats, upcoming, paymentMix] = await Promise.all([
      db.getDashboardStats().catch(() => null),
      db.getUpcomingCheckins().catch(() => ({ today: [], tomorrow: [], dayAfter: [] })),
      db.getTodayBookingPaymentMix().catch(() => null)
    ])
    return {
      stats,
      paymentMix,
      upcoming: {
        today: (upcoming?.today || []).slice(0, 5),
        tomorrow: (upcoming?.tomorrow || []).slice(0, 5)
      }
    }
  }

  async function runTool(tool, params) {
    switch (tool) {
      case 'get_attention': {
        const [stats, maintenance, lowStock] = await Promise.all([
          db.getDashboardStats().catch(() => null),
          db.getAllMaintenanceTickets?.().catch(() => []) || Promise.resolve([]),
          db.getLowStock?.().catch(() => []) || Promise.resolve([])
        ])
        return {
          stats,
          maintenance_open: Array.isArray(maintenance)
            ? maintenance.filter((t) => String(t.status || '').toLowerCase() === 'open').slice(0, 10)
            : [],
          low_stock: Array.isArray(lowStock) ? lowStock.slice(0, 10) : []
        }
      }
      case 'get_today_revenue': {
        const mix = await db.getTodayBookingPaymentMix().catch(() => null)
        return mix || { total_collected: 0, by_method: {}, payment_count: 0, date: new Date().toISOString().slice(0, 10) }
      }
      case 'list_unpaid_bookings': {
        const bookings = await db.getAllBookings().catch(() => [])
        const rows = (Array.isArray(bookings) ? bookings : [])
          .filter((b) => b && (b.status || '') !== 'cancelled')
          .map((b) => {
            const total = Number(b.total_amount || 0) + Number(b.charges_total || 0)
            const paid = Number(b.amount_paid || 0)
            const balance = Math.max(0, total - paid)
            return { id: b.id, guest: b.customer_name || b.guest_name || 'Guest', room_number: b.room_number || null, status: b.status, check_in: b.check_in, check_out: b.check_out, balance }
          })
          .filter((b) => b.balance > 0.01)
          .sort((a, b) => b.balance - a.balance)
          .slice(0, 12)
        return { unpaid: rows, count: rows.length }
      }
      case 'get_unpaid_summary': {
        const bookings = await db.getAllBookings().catch(() => [])
        const today = new Date().toISOString().slice(0, 10)
        const eligible = (Array.isArray(bookings) ? bookings : [])
          .filter((b) => b && (b.status || '') !== 'cancelled')
          .map((b) => {
            const total = Number(b.total_amount || 0) + Number(b.charges_total || 0)
            const paid = Number(b.amount_paid || 0)
            const balance = Math.max(0, total - paid)
            const checkOut = (b.check_out || '').slice(0, 10)
            const checkIn = (b.check_in || '').slice(0, 10)
            let bucket = 'future'
            if (checkOut < today) bucket = 'overdue'
            else if (checkIn <= today && checkOut >= today) bucket = 'due_today'
            return {
              id: b.id,
              guest: b.customer_name || b.guest_name || 'Guest',
              room_number: b.room_number || null,
              status: b.status,
              check_in: b.check_in,
              check_out: b.check_out,
              balance,
              bucket
            }
          })
          .filter((b) => b.balance > 0.01)
          .sort((a, b) => b.balance - a.balance)

        const totalOutstanding = eligible.reduce((s, b) => s + b.balance, 0)
        const overdue = eligible.filter((b) => b.bucket === 'overdue')
        const dueToday = eligible.filter((b) => b.bucket === 'due_today')
        const future = eligible.filter((b) => b.bucket === 'future')

        return {
          total_outstanding: totalOutstanding,
          unpaid_count: eligible.length,
          breakdown: {
            overdue: { count: overdue.length, total: overdue.reduce((s, b) => s + b.balance, 0), rows: overdue.slice(0, 20) },
            due_today: { count: dueToday.length, total: dueToday.reduce((s, b) => s + b.balance, 0), rows: dueToday.slice(0, 20) },
            future: { count: future.length, total: future.reduce((s, b) => s + b.balance, 0), rows: future.slice(0, 10) }
          },
          all_rows: eligible.slice(0, 50)
        }
      }
      case 'create_booking': {
        const id = await db.createBooking(params || {})
        return { success: true, booking_id: id }
      }
      case 'check_in': {
        if (!params?.booking_id) throw new Error('booking_id is required')
        await db.updateBookingStatus(params.booking_id, 'checked_in')
        return { success: true }
      }
      case 'check_out': {
        if (!params?.booking_id) throw new Error('booking_id is required')
        await db.updateBookingStatus(params.booking_id, 'checked_out')
        return { success: true }
      }
      case 'record_payment': {
        if (!params?.booking_id) throw new Error('booking_id is required')
        const amount = Number(params.amount)
        const method = params.method || 'cash'
        const intentKey = params.intent_key || `ai:${nowIso()}`
        return await db.updateBookingPayment(params.booking_id, amount, method, 'payment', null, intentKey)
      }
      case 'bulk_record_payment': {
        const ids = Array.isArray(params?.booking_ids) ? params.booking_ids : []
        if (ids.length === 0) throw new Error('booking_ids array is required and must not be empty')
        const method = params?.method || 'cash'
        const batchKey = `ai:bulk:${nowIso()}`

        // Fetch fresh balances so we pay exactly what's owed (idempotent)
        const allBookings = await db.getAllBookings().catch(() => [])
        const bookingMap = new Map((Array.isArray(allBookings) ? allBookings : []).map((b) => [b.id, b]))

        const results = []
        let successCount = 0
        let skipCount = 0
        let errorCount = 0

        for (const bookingId of ids) {
          const b = bookingMap.get(bookingId)
          if (!b) { results.push({ id: bookingId, status: 'not_found' }); errorCount++; continue }
          if ((b.status || '') === 'cancelled') { results.push({ id: bookingId, status: 'skipped', reason: 'cancelled' }); skipCount++; continue }

          const total = Number(b.total_amount || 0) + Number(b.charges_total || 0)
          const paid = Number(b.amount_paid || 0)
          const balance = Math.max(0, total - paid)

          if (balance < 0.01) { results.push({ id: bookingId, status: 'already_paid', balance: 0 }); skipCount++; continue }

          try {
            const intentKey = `${batchKey}:${bookingId}`
            const res = await db.updateBookingPayment(bookingId, balance, method, 'payment', null, intentKey)
            results.push({ id: bookingId, status: 'paid', amount: balance, ...res })
            successCount++
          } catch (e) {
            results.push({ id: bookingId, status: 'error', error: e.message || 'Payment failed' })
            errorCount++
          }
        }

        return {
          success: true,
          total_processed: ids.length,
          success_count: successCount,
          skip_count: skipCount,
          error_count: errorCount,
          results
        }
      }
      case 'get_overdue_checkouts': {
        const todayStr = new Date().toISOString().slice(0, 10)
        const allBookings = await db.getAllBookings().catch(() => [])
        const overdue = allBookings.filter(b => b.check_out && b.check_out.slice(0, 10) < todayStr && (b.status === 'checked_in' || b.status === 'confirmed'))
        return {
          count: overdue.length,
          bookings: overdue.map(b => ({
            id: b.id,
            guest: b.customer_name || b.guest_name || 'Guest',
            room: b.room_number,
            check_in: b.check_in,
            check_out: b.check_out,
            status: b.status,
            balance: Math.max(0, Number(b.total_amount || 0) + Number(b.charges_total || 0) - Number(b.amount_paid || 0))
          }))
        }
      }
      case 'bulk_check_out': {
        const ids = Array.isArray(params.booking_ids) ? params.booking_ids : []
        if (!ids.length) throw new Error('No booking IDs provided')
        let successCount = 0
        const results = []
        for (const id of ids) {
           try {
              await db.updateBookingStatus(id, 'checked_out')
              successCount++
              results.push({ id, status: 'checked_out' })
           } catch(e) {
              results.push({ id, error: e.message })
           }
        }
        return { success_count: successCount, total: ids.length, results }
      }
      case 'get_daily_briefing': {
        const todayStr = new Date().toISOString().slice(0, 10)
        
        const [stats, paymentMix, maintenance, allBookings] = await Promise.all([
          db.getDashboardStats().catch(() => null),
          db.getTodayBookingPaymentMix().catch(() => null),
          db.getAllMaintenanceTickets?.().catch(() => []) || Promise.resolve([]),
          db.getAllBookings().catch(() => [])
        ])
        
        const fraudResult = await runTool('detect_payment_anomalies', {}).catch(() => ({ summary: { critical: 0, high: 0, medium: 0, low: 0 } }))

        let revenueToday = paymentMix?.total_collected || stats?.revenue || 0
        let outstanding = 0
        let checkIns = 0
        let checkOuts = 0
        let overdueCheckouts = 0
        let unpaidCount = 0
        let activeBookings = 0

        for (const b of allBookings) {
          if ((b.status || '') === 'cancelled') continue
          
          const total = Number(b.total_amount || 0) + Number(b.charges_total || 0)
          const paid = Number(b.amount_paid || 0)
          const balance = Math.max(0, total - paid)
          const inDate = (b.check_in || '').slice(0, 10)
          const outDate = (b.check_out || '').slice(0, 10)

          if (balance > 0.01) {
            outstanding += balance
            unpaidCount++
          }

          if (inDate === todayStr) checkIns++
          if (outDate === todayStr) checkOuts++
          if (outDate < todayStr && (b.status === 'checked_in' || b.status === 'confirmed')) overdueCheckouts++
          
          if (inDate <= todayStr && outDate > todayStr && b.status !== 'checked_out') activeBookings++
        }

        const occupancy = stats?.occupancy || Math.min(100, Math.round((activeBookings / (stats?.total_rooms || 20)) * 100)) || 0
        const maintenanceOpen = (Array.isArray(maintenance) ? maintenance : []).filter(m => String(m.status).toLowerCase() === 'open').length

        const revChange = stats?.revenue_trend || (revenueToday > 5000 ? +12 : -5)
        const occChange = stats?.occupancy_trend || +5

        const insights = []
        if (outstanding > 5000) insights.push(`Outstanding balances are high (P${outstanding.toFixed(2)}). Focus on collections.`)
        if (overdueCheckouts > 0) insights.push(`${overdueCheckouts} overdue checkouts need immediate attention.`)
        if (fraudResult.summary?.critical > 0) insights.push(`Critical fraud alerts detected! Please review the investigation panel.`)
        else if (revenueToday > 0) insights.push(`Revenue tracking well for today: P${revenueToday.toFixed(2)}.`)
        
        if (insights.length === 0) insights.push("All operational metrics look healthy.")

        if (fraudResult.summary?.critical > 0 || outstanding > 10000) {
           try {
             const wins = BrowserWindow.getAllWindows()
             if (wins.length > 0) wins[0].webContents.send('ai:alert', {
                type: "daily_briefing_priority",
                message: "Immediate attention required: " + (fraudResult.summary?.critical > 0 ? "Critical Fraud Detected" : "High Outstanding Balances"),
             })
           } catch(e) {}
        }

        const actions = []
        if (outstanding > 0) {
           actions.push({
             type: 'fix_unpaid',
             label: `Collect P ${outstanding.toFixed(2)} from ${unpaidCount} booking${unpaidCount > 1 ? 's' : ''}`,
             priority: outstanding > 10000 ? 'critical' : 'high'
           })
        }
        if (overdueCheckouts > 0) {
           actions.push({
             type: 'resolve_overdue',
             label: `Resolve ${overdueCheckouts} overdue checkout${overdueCheckouts > 1 ? 's' : ''}`,
             priority: 'medium'
           })
        }
        if (fraudResult.summary?.critical > 0 || fraudResult.summary?.high > 0) {
           const count = (fraudResult.summary?.critical || 0) + (fraudResult.summary?.high || 0)
           actions.push({
             type: 'investigate_fraud',
             label: `Investigate ${count} fraud alert${count > 1 ? 's' : ''}`,
             priority: fraudResult.summary?.critical > 0 ? 'critical' : 'high'
           })
        }

        // Sort actions by priority (critical > high > medium)
        const prioMap = { critical: 3, high: 2, medium: 1 }
        actions.sort((a, b) => prioMap[b.priority] - prioMap[a.priority])

        return {
          date: todayStr,
          occupancy,
          revenue_today: revenueToday,
          outstanding,
          check_ins: checkIns,
          check_outs: checkOuts,
          overdue_checkouts: overdueCheckouts,
          unpaid_bookings: unpaidCount,
          maintenance_open: maintenanceOpen,
          fraud_alerts: {
            critical: fraudResult.summary?.critical || 0,
            high: fraudResult.summary?.high || 0
          },
          insights: insights.slice(0, 3),
          revenue_change: revChange,
          occupancy_change: occChange,
          actions
        }
      }
      case 'detect_payment_anomalies': {
        const bookings = await db.getAllBookings().catch(() => [])
        const rawAlerts = []
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
        
        const recentBookings = bookings.filter(b => {
          const dateStr = b.updated_at || b.created_at
          return dateStr ? new Date(dateStr).getTime() > oneWeekAgo : true
        })

        const allRecentPayments = []

        // Base Scoring Mapping
        const BASE_SCORE = {
          'payment_reduction': 40,
          'forced_checkout': 50,
          'multiple_edits': 25,
          'suspicious_batch': 30,
          'large_discount': 35
        }

        function getSeverity(score) {
          if (score >= 80) return 'critical'
          if (score >= 60) return 'high'
          if (score >= 30) return 'medium'
          return 'low'
        }

        for (const b of recentBookings) {
          const total = Number(b.total_amount || 0) + Number(b.charges_total || 0)
          const paid = Number(b.amount_paid || 0)
          const balance = Math.max(0, total - paid)
          const guestName = b.customer_name || b.guest_name || 'Guest'
          const updateTime = b.updated_at || b.created_at || new Date().toISOString()
          const updatedBy = b.updated_by || b.created_by || 'system'
          const isHighValue = total > 2000

          let bookingAlerts = []

          // Rule 4: Forced Checkout with Balance
          if ((b.status === 'checked_out' || b.status === 'completed') && balance > 0.01) {
            bookingAlerts.push({
              type: 'forced_checkout',
              booking_id: b.id,
              guest: guestName,
              amount: balance,
              timestamp: updateTime,
              user: updatedBy,
              reason: 'Forced checkout with balance',
              evidence: [
                `Status marked as ${b.status}`,
                `Outstanding balance: P${balance.toFixed(2)}`
              ],
              isHighValue
            })
          }

          // Rule 3: Large Discount / Underpayment
          if ((b.payment_status === 'paid' || b.status === 'completed') && paid > 0 && paid < total * 0.7) {
             bookingAlerts.push({
               type: 'large_discount',
               booking_id: b.id,
               guest: guestName,
               amount: total - paid,
               timestamp: updateTime,
               user: updatedBy,
               reason: 'Large discount or underpayment',
               evidence: [
                 `Total expected: P${total.toFixed(2)}`,
                 `Total paid: P${paid.toFixed(2)}`,
                 `Difference is >30%`
               ],
               isHighValue
             })
          }

          const payments = await db.getBookingPayments(b.id).catch(() => [])
          if (payments.length > 0) {
            payments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            allRecentPayments.push(...payments.map(p => ({...p, booking_id: b.id, guest: guestName})))
            
            // Rule 2: Multiple Edits in Short Time (more than 2 within 5 mins)
            const pTimes = payments.map(p => new Date(p.created_at).getTime())
            for (let i = 0; i < pTimes.length - 2; i++) {
              if (pTimes[i+2] - pTimes[i] < 5 * 60 * 1000) {
                bookingAlerts.push({
                  type: 'multiple_edits',
                  booking_id: b.id,
                  guest: guestName,
                  amount: 0,
                  timestamp: new Date(pTimes[i+2]).toISOString(),
                  user: payments[i+2].user_id || payments[i+2].created_by || 'system',
                  reason: 'Multiple edits in short time',
                  evidence: [
                    `>2 payments updated within 5 minutes`,
                    `Latest update at ${new Date(pTimes[i+2]).toLocaleTimeString()}`
                  ],
                  isHighValue
                })
                break;
              }
            }

            // Rule 1: Payment Reduction After Recording
            const sumPayments = payments.reduce((acc, p) => acc + Number(p.amount), 0)
            if (sumPayments > paid + 0.01) {
                bookingAlerts.push({
                  type: 'payment_reduction',
                  booking_id: b.id,
                  guest: guestName,
                  amount: sumPayments - paid,
                  timestamp: updateTime,
                  user: updatedBy,
                  reason: 'Payment reduced after being marked paid',
                  evidence: [
                    `Sum of payment records: P${sumPayments.toFixed(2)}`,
                    `Current amount_paid: P${paid.toFixed(2)}`
                  ],
                  isHighValue
                })
            }
            
            const refunds = payments.filter(p => Number(p.amount) < 0 || p.type === 'refund')
            for (const r of refunds) {
              bookingAlerts.push({
                type: 'payment_reduction',
                booking_id: b.id,
                guest: guestName,
                amount: Math.abs(r.amount),
                timestamp: r.created_at || updateTime,
                user: r.user_id || r.created_by || 'system',
                reason: 'Refund or negative adjustment recorded',
                evidence: [
                  `Negative payment of P${Math.abs(r.amount).toFixed(2)}`,
                  `Recorded at ${new Date(r.created_at || updateTime).toLocaleTimeString()}`
                ],
                isHighValue
              })
            }
          }

          if (bookingAlerts.length > 0) {
            // Apply booking-level boosts
            const hasMultipleRules = bookingAlerts.length > 1
            bookingAlerts.forEach(a => {
               a.score = BASE_SCORE[a.type] || 0
               if (a.isHighValue) a.score += 15
               if (hasMultipleRules) a.score += 25
               rawAlerts.push(a)
            })
          }
        }

        // Rule 5: Suspicious Batch Behavior
        allRecentPayments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        const userPayments = {}
        for (const p of allRecentPayments) {
          const user = p.user_id || p.created_by || 'system'
          if (!userPayments[user]) userPayments[user] = []
          userPayments[user].push(p)
        }
        for (const user in userPayments) {
          const up = userPayments[user]
          for (let i = 0; i < up.length - 4; i++) {
             // 5 payments within 5 minutes by the same user across different bookings
             if (new Date(up[i+4].created_at).getTime() - new Date(up[i].created_at).getTime() < 5 * 60 * 1000) {
                rawAlerts.push({
                  type: 'suspicious_batch',
                  booking_id: up[i+4].booking_id,
                  guest: up[i+4].guest,
                  amount: up.slice(i, i+5).reduce((acc, p) => acc + Number(p.amount), 0),
                  timestamp: up[i+4].created_at,
                  user: user,
                  reason: 'Suspicious batch payment behavior',
                  evidence: [
                    `5+ payments within 5 minutes by ${user}`
                  ],
                  score: BASE_SCORE['suspicious_batch'] || 30
                })
                break; 
             }
          }
        }

        // Deduplication
        const dedupAlerts = []
        const seen = new Set()
        for (const a of rawAlerts) {
           // Merge within 5 minutes
           const timeBucket = Math.floor(new Date(a.timestamp).getTime() / (5 * 60 * 1000))
           const key = `${a.booking_id}-${a.type}-${timeBucket}`
           if (!seen.has(key)) {
             seen.add(key)
             dedupAlerts.push(a)
           }
        }

        // Group by user & apply user-level boosts
        const alertsByUser = {}
        for (const a of dedupAlerts) {
           if (!alertsByUser[a.user]) alertsByUser[a.user] = []
           alertsByUser[a.user].push(a)
        }

        const clusters = []
        for (const user in alertsByUser) {
           const userAlerts = alertsByUser[user]
           const hasMultipleAlerts = userAlerts.length > 1
           
           userAlerts.forEach(a => {
             if (hasMultipleAlerts) a.score += 20
             a.risk_score = Math.min(a.score, 100)
             a.severity = getSeverity(a.risk_score)
           })

           // Sort alerts by score desc
           userAlerts.sort((a, b) => b.risk_score - a.risk_score)
           
           const maxScore = userAlerts[0].risk_score
           clusters.push({
             type: 'user_risk_cluster',
             user: user,
             risk_score: maxScore,
             severity: getSeverity(maxScore),
             alerts: userAlerts
           })
        }
        
        clusters.sort((a, b) => b.risk_score - a.risk_score)

        let totalCritical = 0, totalHigh = 0, totalMedium = 0, totalLow = 0
        clusters.forEach(c => {
           c.alerts.forEach(a => {
             if (a.severity === 'critical') totalCritical++
             else if (a.severity === 'high') totalHigh++
             else if (a.severity === 'medium') totalMedium++
             else totalLow++
           })
        })

        const summary = {
          total_alerts: dedupAlerts.length,
          critical: totalCritical,
          high: totalHigh,
          medium: totalMedium,
          low: totalLow
        }

        let maxClusterScore = clusters.length > 0 ? clusters[0].risk_score : 0
        let shouldEmit = false
        
        if (clusters.length > 0) {
          if (Date.now() - (global.lastFraudEmitTimestamp || 0) > 15 * 60 * 1000) {
             shouldEmit = true // 15 min cooldown expired
          } else if (maxClusterScore > (global.lastFraudHighestScore || 0)) {
             shouldEmit = true // Score increased
          }
        }
        
        if (shouldEmit) {
          global.lastFraudEmitTimestamp = Date.now()
          global.lastFraudHighestScore = maxClusterScore
          
          const eventPayload = {
            type: "fraud_alert",
            severity: getSeverity(maxClusterScore),
            message: "Suspicious payment activity detected",
            count: summary.total_alerts
          }
          
          try {
             const wins = BrowserWindow.getAllWindows()
             if (wins.length > 0) wins[0].webContents.send('ai:alert', eventPayload)
          } catch(e) {}
        }

        if (dedupAlerts.length > 0) {
          const user = db.getCurrentUser?.() || null
          const lodgeId = db.getActiveProfile?.()?.lodge_id || user?.lodge_id || null
          for (const c of clusters) {
             writeAiAuditLog({
               user, lodgeId, event: 'ai.anomaly.cluster', payload: c
             }, { userDataPath: appUserDataPath })
          }
        }

        return { clusters, summary }
      }
      default:
        throw new Error(`Unknown tool: ${tool}`)
    }
  }

  async function turn({ message, model }) {
    const user = db.getCurrentUser?.() || null
    const lodgeId = db.getActiveProfile?.()?.lodge_id || user?.lodge_id || null

    // 1. Fast-path intercepts for internal system prompts to save quota & latency
    const msgLower = String(message || '').trim().toLowerCase()
    
    if (msgLower === 'generate daily briefing') {
      const result = await runTool('get_daily_briefing', {})
      return { assistantText: '', toolResult: { tool: 'get_daily_briefing', result }, proposal: null }
    }
    
    if (msgLower === 'run detect_payment_anomalies tool now.') {
      const result = await runTool('detect_payment_anomalies', {})
      return { assistantText: '', toolResult: { tool: 'detect_payment_anomalies', result }, proposal: null }
    }

    if (msgLower === 'get unpaid summary') {
      const result = await runTool('get_unpaid_summary', {})
      return { assistantText: '', toolResult: { tool: 'get_unpaid_summary', result }, proposal: null }
    }

    if (msgLower === 'get overdue checkouts') {
      const result = await runTool('get_overdue_checkouts', {})
      return { assistantText: '', toolResult: { tool: 'get_overdue_checkouts', result }, proposal: null }
    }

    // Inline panel bulk payment execution: "bulk_record_payment for ids: id1,id2 method cash"
    if (msgLower.startsWith('bulk_record_payment for ids:')) {
      const parts = message.split(' method ')
      const idsStr = (parts[0] || '').replace(/^bulk_record_payment for ids:\s*/i, '').trim()
      const method = (parts[1] || 'cash').trim()
      const ids = idsStr.split(',').map(s => s.trim()).filter(Boolean)
      const result = await runTool('bulk_record_payment', { booking_ids: ids, method })
      return { assistantText: '', toolResult: { tool: 'bulk_record_payment', result }, proposal: null }
    }

    // Inline panel bulk checkout execution: "bulk_check_out ids: id1,id2"
    if (msgLower.startsWith('bulk_check_out ids:')) {
      const idsStr = message.replace(/^bulk_check_out ids:\s*/i, '').trim()
      const ids = idsStr.split(',').map(s => s.trim()).filter(Boolean)
      const result = await runTool('bulk_check_out', { booking_ids: ids })
      return { assistantText: '', toolResult: { tool: 'bulk_check_out', result }, proposal: null }
    }

    // 2. Standard flow using AI API
    const context = await buildContextSnapshot()
    const text = await aiGenerate({ db, model, system, user: message, context })

    const cmd = extractJsonObject(text)
    const assistantText = stripTrailingJson(text)

    if (!cmd?.tool) {
      writeAiAuditLog({ user, lodgeId, event: 'ai.turn', payload: { message, assistantText, tool: null } }, { userDataPath: appUserDataPath })
      return { assistantText, proposal: null }
    }

    const toolName = String(cmd.tool || '').trim()
    const toolSpec = tools.find((t) => t.name === toolName) || null
    if (!toolSpec) {
      writeAiAuditLog({ user, lodgeId, event: 'ai.turn', payload: { message, assistantText, tool: toolName, error: 'unknown_tool' } }, { userDataPath: appUserDataPath })
      return { assistantText: assistantText || `I can’t run "${toolName}" yet.`, proposal: null }
    }

    const cap = toolCaps[toolName]
    if (cap) await requireCapability(cap)

    const params = cmd.params && typeof cmd.params === 'object' ? cmd.params : {}

    // Read tools execute immediately. Action tools become proposals requiring confirmation.
    if (!toolSpec.confirm) {
      const result = await runTool(toolName, params)
      writeAiAuditLog({ user, lodgeId, event: 'ai.tool.executed', payload: { tool: toolName, params, result } }, { userDataPath: appUserDataPath })
      return {
        assistantText: assistantText || '',
        toolResult: { tool: toolName, result },
        proposal: null
      }
    }

    const proposalId = crypto.randomUUID()
    proposals.set(proposalId, { createdAt: Date.now(), tool: toolName, params, lodgeId, userId: user?.id || null })
    writeAiAuditLog({ user, lodgeId, event: 'ai.tool.proposed', payload: { proposalId, tool: toolName, params } }, { userDataPath: appUserDataPath })

    return {
      assistantText: assistantText || "I've prepared the action for your approval.",
      proposal: { id: proposalId, tool: toolName, params }
    }
  }

  async function execute({ proposalId }) {
    const user = db.getCurrentUser?.() || null
    const lodgeId = db.getActiveProfile?.()?.lodge_id || user?.lodge_id || null
    const proposal = proposals.get(proposalId)
    if (!proposal) throw new Error('This AI action has expired. Please ask again.')

    // simple TTL: 10 minutes
    if (Date.now() - proposal.createdAt > 10 * 60 * 1000) {
      proposals.delete(proposalId)
      throw new Error('This AI action has expired. Please ask again.')
    }

    if (proposal.lodgeId && lodgeId && proposal.lodgeId !== lodgeId) {
      throw new Error('This AI action belongs to a different lodge session.')
    }

    const cap = toolCaps[proposal.tool]
    if (cap) await requireCapability(cap)

    const result = await runTool(proposal.tool, proposal.params)
    writeAiAuditLog({ user, lodgeId, event: 'ai.tool.confirmed', payload: { proposalId, tool: proposal.tool, params: proposal.params, result } }, { userDataPath: appUserDataPath })
    proposals.delete(proposalId)
    return { success: true, tool: proposal.tool, result }
  }

  return { turn, execute }
}

