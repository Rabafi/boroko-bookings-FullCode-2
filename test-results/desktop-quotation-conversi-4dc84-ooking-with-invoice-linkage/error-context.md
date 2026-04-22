# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-quotation-conversion-online.spec.mjs >> desktop converts an online quotation into a booking with invoice linkage
- Location: Playwright tests\desktop\desktop-quotation-conversion-online.spec.mjs:21:1

# Error details

```
Error: Seed does not include any rooms
```

# Test source

```ts
  1   | import fs from 'fs'
  2   | import os from 'os'
  3   | import path from 'path'
  4   | import crypto from 'crypto'
  5   | import bcrypt from 'bcryptjs'
  6   | import { createClient } from '@supabase/supabase-js'
  7   | import { fileURLToPath } from 'url'
  8   | import { _electron as electron } from 'playwright'
  9   | 
  10  | const __filename = fileURLToPath(import.meta.url)
  11  | const __dirname = path.dirname(__filename)
  12  | export const desktopTestsRoot = path.resolve(__dirname, '..')
  13  | export const repoRoot = path.resolve(desktopTestsRoot, '..', '..')
  14  | 
  15  | function readDotEnv(filePath) {
  16  |   try {
  17  |     const raw = fs.readFileSync(filePath, 'utf8')
  18  |     return raw
  19  |       .split(/\r?\n/)
  20  |       .map((line) => line.trim())
  21  |       .filter((line) => line && !line.startsWith('#'))
  22  |       .reduce((acc, line) => {
  23  |         const index = line.indexOf('=')
  24  |         if (index <= 0) return acc
  25  |         const key = line.slice(0, index).trim()
  26  |         const value = line.slice(index + 1).trim().replace(/^"|"$/g, '')
  27  |         if (key) acc[key] = value
  28  |         return acc
  29  |       }, {})
  30  |   } catch {
  31  |     return {}
  32  |   }
  33  | }
  34  | 
  35  | export function getRealBackendEnv() {
  36  |   const rootEnv = readDotEnv(path.join(repoRoot, '.env'))
  37  |   return {
  38  |     SUPABASE_URL: rootEnv.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  39  |     SUPABASE_ANON_KEY: rootEnv.VITE_SUPABASE_KEY || process.env.VITE_SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || ''
  40  |   }
  41  | }
  42  | 
  43  | function writeJson(filePath, data) {
  44  |   fs.mkdirSync(path.dirname(filePath), { recursive: true })
  45  |   fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
  46  | }
  47  | 
  48  | function clone(value) {
  49  |   return JSON.parse(JSON.stringify(value))
  50  | }
  51  | 
  52  | function addDays(baseDate, days) {
  53  |   const date = new Date(baseDate)
  54  |   date.setDate(date.getDate() + days)
  55  |   return date
  56  | }
  57  | 
  58  | function formatDateForBotswana(date) {
  59  |   try {
  60  |     const parts = new Intl.DateTimeFormat('en-CA', {
  61  |       timeZone: 'Africa/Gaborone',
  62  |       year: 'numeric',
  63  |       month: '2-digit',
  64  |       day: '2-digit'
  65  |     }).formatToParts(date)
  66  |     const year = parts.find((part) => part.type === 'year')?.value || '1970'
  67  |     const month = parts.find((part) => part.type === 'month')?.value || '01'
  68  |     const day = parts.find((part) => part.type === 'day')?.value || '01'
  69  |     return `${year}-${month}-${day}`
  70  |   } catch {
  71  |     return date.toISOString().slice(0, 10)
  72  |   }
  73  | }
  74  | 
  75  | export function createTempUserDataDir(prefix = 'boroko-e2e-') {
  76  |   return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  77  | }
  78  | 
  79  | export async function findLiveAvailableStay(seed, {
  80  |   minOffsetDays = 30,
  81  |   maxOffsetDays = 90,
  82  |   nights = 1
  83  | } = {}) {
  84  |   const env = getRealBackendEnv()
  85  |   if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
  86  |     throw new Error('Live backend env is required to find an available stay window')
  87  |   }
  88  | 
  89  |   const rooms = Array.isArray(seed?.rooms) ? seed.rooms.filter((room) => room?.id) : []
  90  |   if (rooms.length === 0) {
> 91  |     throw new Error('Seed does not include any rooms')
      |           ^ Error: Seed does not include any rooms
  92  |   }
  93  | 
  94  |   const rangeStart = formatDateForBotswana(addDays(new Date(), minOffsetDays))
  95  |   const rangeEnd = formatDateForBotswana(addDays(new Date(), maxOffsetDays + nights))
  96  |   const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY)
  97  |   let data = null
  98  |   let error = null
  99  |   for (let attempt = 1; attempt <= 3; attempt += 1) {
  100 |     const response = await supabase
  101 |       .from('bookings')
  102 |       .select('room_id, check_in, check_out, status')
  103 |       .eq('lodge_id', seed.lodgeId)
  104 |       .in('room_id', rooms.map((room) => room.id))
  105 |       .neq('status', 'cancelled')
  106 |       .lte('check_in', rangeEnd)
  107 |       .gte('check_out', rangeStart)
  108 |     data = response.data
  109 |     error = response.error
  110 |     if (!error) break
  111 |     if (attempt < 3) {
  112 |       await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
  113 |     }
  114 |   }
  115 | 
  116 |   if (error) {
  117 |     throw new Error(`Could not load live bookings for availability check: ${error.message}`)
  118 |   }
  119 | 
  120 |   const liveBookings = Array.isArray(data) ? data : []
  121 |   for (let offset = minOffsetDays; offset <= maxOffsetDays; offset += 1) {
  122 |     const checkIn = formatDateForBotswana(addDays(new Date(), offset))
  123 |     const checkOut = formatDateForBotswana(addDays(new Date(), offset + nights))
  124 |     const availableRoom = rooms.find((room) => !liveBookings.some((booking) => (
  125 |       String(booking?.room_id || '') === String(room.id)
  126 |       && String(booking?.check_in || '') < checkOut
  127 |       && String(booking?.check_out || '') > checkIn
  128 |     )))
  129 | 
  130 |     if (availableRoom) {
  131 |       return {
  132 |         roomId: availableRoom.id,
  133 |         roomNumber: String(availableRoom.room_number),
  134 |         checkIn,
  135 |         checkOut
  136 |       }
  137 |     }
  138 |   }
  139 | 
  140 |   throw new Error(`No free stay window found between ${rangeStart} and ${rangeEnd}`)
  141 | }
  142 | 
  143 | export function createDesktopSeed(overrides = {}) {
  144 |   const now = new Date()
  145 |   const lodgeId = overrides.lodgeId || crypto.randomUUID()
  146 |   const password = overrides.password || 'Password123!'
  147 |   const email = (overrides.email || 'manager@example.com').toLowerCase()
  148 |   const userId = overrides.userId || crypto.randomUUID()
  149 |   const sessionNonce = overrides.sessionNonce || crypto.randomBytes(16).toString('hex')
  150 |   const sessionToken = overrides.sessionToken || crypto.randomBytes(24).toString('hex')
  151 |   const userName = overrides.userName || 'Test Manager'
  152 |   const lodgeName = overrides.lodgeName || 'Boroko Test Lodge'
  153 |   const sessionExpiresAt = overrides.sessionExpiresAt || new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  154 |   const createdAt = overrides.createdAt || now.toISOString()
  155 |   const lastSuccessfulSyncAt = overrides.lastSuccessfulSyncAt || new Date(now.getTime() - 15 * 60 * 1000).toISOString()
  156 | 
  157 |   const user = {
  158 |     id: userId,
  159 |     name: userName,
  160 |     email,
  161 |     role: overrides.role || 'manager',
  162 |     lodge_id: lodgeId,
  163 |     allowed_outlet_ids: overrides.allowedOutletIds ?? null,
  164 |     isMasterAdmin: false,
  165 |     created_at: createdAt
  166 |   }
  167 | 
  168 |   const profile = {
  169 |     lodge_id: lodgeId,
  170 |     label: lodgeName,
  171 |     status: overrides.profileStatus || 'ready',
  172 |     created_at: createdAt,
  173 |     last_used_at: createdAt
  174 |   }
  175 | 
  176 |   const settings = {
  177 |     lodge_id: lodgeId,
  178 |     lodge_name: lodgeName,
  179 |     company_name: lodgeName,
  180 |     business_type: 'lodge',
  181 |     currency: 'P',
  182 |     phone: '+26770000000'
  183 |   }
  184 | 
  185 |   const bookings = overrides.bookings || [
  186 |     {
  187 |       id: 'booking-pending',
  188 |       booking_number: 'BK-001',
  189 |       invoice_number: 'INV-001',
  190 |       customer_name: 'Pending Guest',
  191 |       customer_phone: '+26770000001',
```