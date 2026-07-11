import { randomUUID } from 'crypto'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { state } from '../state.js'
import { getAllRooms } from './rooms.js';
import { getAllCustomers } from './customers.js';
import { getAllBookings, getAllQuotations, getBookingInvoices } from './bookings.js';
import { getExpenses } from './expenses.js';
import { getMaintenanceTickets } from './maintenance.js';
import { getConferenceBookings } from './conference.js';
import { getPoolDayUse } from './pool.js';
import { getInventoryItems, getInventoryPurchases } from './inventory.js';
import { getSupplyItems, getSupplyPurchases } from './supplies.js';
import { getPosOrders } from './pos.js';
import { getSyncStatus } from './sync.js';

import { createBooking, updateBookingPayment } from './bookings.js'
import { createCustomer } from './customers.js'
import { createExpense, deleteExpense } from './expenses.js'
import { createInventoryItem, deleteInventoryItem } from './inventory.js'
import { createRoom, deleteRoom } from './rooms.js'
import { createSupplyItem, deleteSupplyItem } from './supplies.js'
import {
  CRITICAL_ERROR_LOG_FILE,
  isNonCriticalOperationalError,
  readAuxiliaryLog,
  writeAuxiliaryLog
} from './operationalLog.js'
import {
  BACKUP_POLICY_DEFAULT,
  buildManagedBackupStatus,
  getManagedBackupPolicyPath,
  normalizeManagedBackupPolicy,
  readManagedBackupPolicy
} from './backupPolicy.js'
import {
  logActivity,
  readCache,
  refreshAllCaches,
  refreshCache,
  writeCache,
} from './infrastructure.js'


const IMPORT_TEMPLATES = {
  bookings: [
  { key: 'guest_name', label: 'Guest Name', required: true },
  { key: 'email', label: 'Email', required: false },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'id_number', label: 'ID / Passport No', required: false },
  { key: 'nationality', label: 'Nationality', required: false },
  { key: 'room_number', label: 'Room Number', required: true },
  { key: 'check_in', label: 'Check-In Date', required: true },
  { key: 'check_out', label: 'Check-Out Date', required: true },
  { key: 'adults', label: 'Adults', required: false },
  { key: 'children', label: 'Children', required: false },
  { key: 'total_amount', label: 'Total Amount', required: false },
  { key: 'amount_paid', label: 'Amount Paid', required: false },
  { key: 'payment_method', label: 'Payment Method', required: false },
  { key: 'status', label: 'Booking Status', required: false },
  { key: 'notes', label: 'Notes', required: false }],

  guests: [
  { key: 'name', label: 'Guest Name', required: true },
  { key: 'email', label: 'Email', required: false },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'id_number', label: 'ID / Passport No', required: false },
  { key: 'nationality', label: 'Nationality', required: false }],

  rooms: [
  { key: 'room_number', label: 'Room Number', required: true },
  { key: 'room_type', label: 'Room Type', required: false },
  { key: 'rate', label: 'Rate', required: false },
  { key: 'max_adults', label: 'Max Adults', required: false },
  { key: 'max_children', label: 'Max Children', required: false }],

  inventory: [
  { key: 'name', label: 'Item Name', required: true },
  { key: 'category', label: 'Category', required: false },
  { key: 'unit', label: 'Unit', required: false },
  { key: 'current_stock', label: 'Current Stock', required: false },
  { key: 'reorder_level', label: 'Reorder Level', required: false }],

  supplies: [
  { key: 'name', label: 'Supply Item', required: true },
  { key: 'category', label: 'Category', required: false },
  { key: 'unit', label: 'Unit', required: false },
  { key: 'current_stock', label: 'Current Stock', required: false },
  { key: 'reorder_level', label: 'Reorder Level', required: false }],

  expenses: [
  { key: 'date', label: 'Date', required: true },
  { key: 'category', label: 'Category', required: true },
  { key: 'description', label: 'Description', required: false },
  { key: 'amount', label: 'Amount', required: true },
  { key: 'paid_by', label: 'Paid By', required: false }],

  menu_items: [
  { key: 'name', label: 'Name', required: true },
  { key: 'category', label: 'Category', required: false },
  { key: 'selling_price', label: 'Selling Price', required: false },
  { key: 'cost_price', label: 'Cost Price', required: false },
  { key: 'unit', label: 'Unit', required: false },
  { key: 'available', label: 'Available', required: false }],

  customers: [
  { key: 'name', label: 'Name', required: true },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'notes', label: 'Notes', required: false }],

  ingredients: [
  { key: 'name', label: 'Name', required: true },
  { key: 'category', label: 'Category', required: false },
  { key: 'unit', label: 'Unit', required: false },
  { key: 'current_stock', label: 'Current Stock', required: false },
  { key: 'reorder_level', label: 'Reorder Level', required: false },
  { key: 'cost_per_unit', label: 'Cost Per Unit', required: false }],

  recipes: [
  { key: 'menu_item', label: 'Menu Item', required: true },
  { key: 'ingredient', label: 'Ingredient', required: true },
  { key: 'quantity', label: 'Quantity', required: true },
  { key: 'unit', label: 'Unit', required: false },
  { key: 'wastage_pct', label: 'Wastage %', required: false }],

  suppliers: [
  { key: 'name', label: 'Name', required: true },
  { key: 'contact_person', label: 'Contact Person', required: false },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'category', label: 'Category', required: false }],

  staff: [
  { key: 'name', label: 'Name', required: true },
  { key: 'role', label: 'Role', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'phone', label: 'Phone', required: false }]

};

function normalizeImportType(type = 'bookings') {
  return Object.prototype.hasOwnProperty.call(IMPORT_TEMPLATES, type) ? type : 'bookings';
}

function importRowValue(row = {}, ...keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function importNumber(row = {}, keys = [], fallback = 0) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    }
  }
  return fallback;
}

function findImportDuplicate(type, row = {}) {
  if (type === 'guests') {
    const name = importRowValue(row, 'name', 'guest_name').toLowerCase();
    const email = importRowValue(row, 'email').toLowerCase();
    const phone = importRowValue(row, 'phone');
    return readCache('customers').find((customer) =>
    email && String(customer.email || '').toLowerCase() === email ||
    phone && name && String(customer.phone || '') === phone && String(customer.name || customer.full_name || '').toLowerCase() === name ||
    !email && !phone && name && String(customer.name || customer.full_name || '').toLowerCase() === name
    );
  }
  if (type === 'rooms') {
    const roomNumber = importRowValue(row, 'room_number');
    return readCache('rooms').find((room) => String(room.room_number || '').trim() === roomNumber);
  }
  if (type === 'inventory') {
    const name = importRowValue(row, 'name', 'item_name').toLowerCase();
    const category = importRowValue(row, 'category').toLowerCase();
    return readCache('inventory-items').find((item) =>
    String(item.name || item.item_name || '').toLowerCase() === name &&
    String(item.category || '').toLowerCase() === category
    );
  }
  if (type === 'supplies') {
    const name = importRowValue(row, 'name', 'item_name').toLowerCase();
    const category = importRowValue(row, 'category').toLowerCase();
    return readCache('supply-items').find((item) =>
    String(item.name || item.item_name || '').toLowerCase() === name &&
    String(item.category || '').toLowerCase() === category
    );
  }
  if (type === 'expenses') {
    const date = importRowValue(row, 'date');
    const category = importRowValue(row, 'category').toLowerCase();
    const description = importRowValue(row, 'description').toLowerCase();
    const amount = importNumber(row, ['amount'], 0);
    return readCache('expenses').find((expense) =>
    String(expense.date || '') === date &&
    String(expense.category || '').toLowerCase() === category &&
    String(expense.description || '').toLowerCase() === description &&
    Number(expense.amount || 0) === amount
    );
  }
  return null;
}

function validateImportRow(type, row = {}) {
  const errors = [];
  if (type === 'guests') {
    if (!importRowValue(row, 'name', 'guest_name')) errors.push('Guest name is required.');
  } else if (type === 'rooms') {
    if (!importRowValue(row, 'room_number')) errors.push('Room number is required.');
    if (importNumber(row, ['rate_per_night', 'rate'], 0) < 0) errors.push('Room rate cannot be negative.');
  } else if (type === 'inventory' || type === 'supplies') {
    if (!importRowValue(row, 'name', 'item_name')) errors.push('Item name is required.');
    if (importNumber(row, ['current_stock'], 0) < 0) errors.push('Current stock cannot be negative.');
    if (importNumber(row, ['reorder_level'], 0) < 0) errors.push('Reorder level cannot be negative.');
  } else if (type === 'expenses') {
    if (!importRowValue(row, 'date')) errors.push('Date is required.');
    if (!importRowValue(row, 'category')) errors.push('Category is required.');
    if (importNumber(row, ['amount'], 0) <= 0) errors.push('Amount must be greater than zero.');
  }
  return errors;
}

function friendlyImportError(msg = '') {
  const m = String(msg).toLowerCase();
  if (m.includes('room is already booked') || m.includes('no_overlapping_bookings'))
  return 'This room is already booked for those dates.';
  if (m.includes('room not found') || m.includes('room "'))
  return 'Room number not found — check it matches an existing room exactly.';
  if (m.includes('guest name') || m.includes('name is required'))
  return 'Guest name is missing.';
  if (m.includes('check-in') || m.includes('check-out') || m.includes('invalid dates'))
  return 'Check-in or check-out date is invalid. Use YYYY-MM-DD format.';
  if (m.includes('payment') || m.includes('amount must be greater'))
  return 'Payment amount is invalid.';
  if (m.includes('customer') || m.includes('create_customer'))
  return 'Could not save the guest record.';
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to fetch'))
  return 'Network error — check your internet connection and try again.';
  if (m.includes('permission') || m.includes('policy') || m.includes('rls'))
  return 'Permission denied — contact your administrator.';
  if (m.includes('duplicate') || m.includes('unique') || m.includes('23505'))
  return 'A duplicate record already exists for this entry.';
  if (m.includes('invalid total') || m.includes('room rate'))
  return 'Could not calculate the total — check room rate and dates.';
  if (m.includes('supabase') || m.includes('.catch') || m.includes('is not a function'))
  return 'An unexpected system error occurred. Please try again.';
  return msg || 'An unexpected error occurred.';
}

function normalizeRoomCandidate(value = '') {
  return String(value || '').toLowerCase().replace(/^room\s+/i, '').replace(/[^a-z0-9]/g, '');
}

function levenshteinDistance(a = '', b = '') {
  const left = String(a);
  const right = String(b);
  const dp = Array.from({ length: left.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= right.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      dp[i][j] = left[i - 1] === right[j - 1] ?
      dp[i - 1][j - 1] :
      Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]) + 1;
    }
  }
  return dp[left.length][right.length];
}

function suggestRoomNumbers(inputRoomNumber, rooms = []) {
  const target = normalizeRoomCandidate(inputRoomNumber);
  if (!target) return [];
  return rooms.
  map((room) => {
    const label = String(room.room_number || '').trim();
    const normalized = normalizeRoomCandidate(label);
    const containsBonus = normalized.includes(target) || target.includes(normalized) ? -2 : 0;
    return { room_number: label, score: levenshteinDistance(target, normalized) + containsBonus };
  }).
  filter((entry) => entry.room_number && entry.score <= Math.max(2, Math.ceil(target.length / 2))).
  sort((a, b) => a.score - b.score || a.room_number.localeCompare(b.room_number)).
  slice(0, 3).
  map((entry) => entry.room_number);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

export function recordActivity(action, description) {
  logActivity(action, description);
}

export function getActivityLog(limit = 200) {
  try {
    const logPath = path.join(state.cacheDir, 'activity-log.json');
    const log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    return log.slice(0, limit);
  } catch {
    return [];
  }
}

export function clearActivityLog() {
  try {
    fs.writeFileSync(path.join(state.cacheDir, 'activity-log.json'), '[]', 'utf-8');
  } catch (e) {
    console.error('Clear activity log failed:', e);
  }
}

export function getCriticalErrorLog(limit = 100) {
  return readAuxiliaryLog(CRITICAL_ERROR_LOG_FILE).
  filter((entry) => !isNonCriticalOperationalError(entry?.scope, entry?.message)).
  slice(0, limit);
}

export function clearCriticalErrorLog() {
  writeAuxiliaryLog(CRITICAL_ERROR_LOG_FILE, []);
  return { success: true };
}

export function getSupportedImportTypes() {
  return [
  { key: 'bookings', label: 'Bookings', executable: true },
  { key: 'guests', label: 'Guests', executable: true },
  { key: 'rooms', label: 'Rooms', executable: true },
  { key: 'inventory', label: 'Inventory Items', executable: true },
  { key: 'supplies', label: 'Room Supply Items', executable: true },
  { key: 'expenses', label: 'Expenses', executable: true },
  { key: 'menu_items', label: 'Menu Items', executable: true },
  { key: 'customers', label: 'Customers', executable: true },
  { key: 'ingredients', label: 'Ingredients / Inventory', executable: true },
  { key: 'recipes', label: 'Recipes', executable: true },
  { key: 'suppliers', label: 'Suppliers', executable: true },
  { key: 'staff', label: 'Staff', executable: true }];

}

export function generateImportTemplate(type = 'bookings') {
  return IMPORT_TEMPLATES[type] || IMPORT_TEMPLATES.bookings;
}

export async function checkImportDuplicates(rows) {
  const rooms = readCache('rooms');
  const bookings = readCache('bookings');
  const roomMap = {};
  rooms.forEach((r) => {roomMap[String(r.room_number).trim()] = r.id;});

  return rows.filter((row) => {
    const roomId = roomMap[String(row.room_number).trim()];
    if (!roomId) return false;
    return bookings.some(
      (b) =>
      b.room_id === roomId &&
      b.status !== 'cancelled' &&
      b.check_in < row.check_out &&
      b.check_out > row.check_in
    );
  });
}

export function dryRunBookingImport(rows = []) {
  const rooms = readCache('rooms');
  const bookings = readCache('bookings');
  const customers = readCache('customers');
  const roomMap = {};
  rooms.forEach((r) => {roomMap[String(r.room_number).trim()] = r;});

  const report = {
    total: Array.isArray(rows) ? rows.length : 0,
    valid: 0,
    would_create_customers: 0,
    would_reuse_customers: 0,
    overlaps: 0,
    errors: [],
    warnings: []
  };

  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const rowNum = index + 1;
    const guestName = String(row.guest_name || '').trim();
    const room = roomMap[String(row.room_number || '').trim()];
    const rowErrors = [];
    if (!guestName) rowErrors.push('Guest name is required.');
    const roomSuggestions = !room ? suggestRoomNumbers(row.room_number, rooms) : [];
    if (!room) rowErrors.push('Room number was not found.');
    if (!row.check_in || !row.check_out) rowErrors.push('Check-in and check-out dates are required.');
    if (row.check_in && row.check_out && row.check_in >= row.check_out) rowErrors.push('Check-out must be after check-in.');

    const overlap = room && bookings.some((booking) =>
    booking.room_id === room.id &&
    booking.status !== 'cancelled' &&
    booking.check_in < row.check_out &&
    booking.check_out > row.check_in
    );
    if (overlap) {
      report.overlaps += 1;
      rowErrors.push('Room overlaps with an existing booking.');
    }

    const emailNorm = String(row.email || '').trim().toLowerCase();
    const existingCustomer = emailNorm ?
    customers.find((c) => c.email?.toLowerCase() === emailNorm) :
    customers.find((c) => c.name?.toLowerCase() === guestName.toLowerCase() || c.full_name?.toLowerCase() === guestName.toLowerCase());

    if (rowErrors.length > 0) {
      report.errors.push({
        row: rowNum,
        guest: guestName,
        errors: rowErrors,
        ...(roomSuggestions.length > 0 ? { suggestions: { room_number: roomSuggestions } } : {})
      });
    } else {
      report.valid += 1;
      if (existingCustomer) report.would_reuse_customers += 1;else
      report.would_create_customers += 1;
    }
  });

  return report;
}

export function dryRunImport(type = 'bookings', rows = []) {
  const normalizedType = normalizeImportType(type);
  if (normalizedType === 'bookings') return dryRunBookingImport(rows);

  const report = {
    type: normalizedType,
    total: Array.isArray(rows) ? rows.length : 0,
    valid: 0,
    duplicates: 0,
    would_create: 0,
    errors: []
  };

  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const errors = validateImportRow(normalizedType, row);
    if (errors.length > 0) {
      report.errors.push({ row: index + 1, guest: importRowValue(row, 'name', 'guest_name', 'room_number', 'description'), errors });
      return;
    }
    if (findImportDuplicate(normalizedType, row)) {
      report.duplicates += 1;
      return;
    }
    report.valid += 1;
    report.would_create += 1;
  });

  return report;
}

export async function bulkImportBookings(rows, { filename = '', onProgress } = {}) {
  if (!state.isOnline) throw new Error('Internet connection required to import bookings.');

  const rooms = readCache('rooms');
  const roomMap = {};
  rooms.forEach((r) => {roomMap[String(r.room_number).trim()] = r.id;});

  const batchId = randomUUID();
  const importedIds = [];
  const errors = [];
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (onProgress) onProgress({ current: i + 1, total: rows.length });

    const rowNum = i + 1;
    const guestName = String(row.guest_name || '').trim();
    const roomNumberKey = String(row.room_number || '').trim();
    const roomId = roomMap[roomNumberKey];

    try {
      if (!guestName) throw new Error('Guest name is required');
      if (!roomId) throw new Error(`Room "${roomNumberKey}" not found`);
      if (!row.check_in || !row.check_out) throw new Error('Check-in and check-out dates are required');
      if (row.check_in >= row.check_out) throw new Error('Check-out must be after check-in');

      // Find or create customer
      const customers = readCache('customers');
      const emailNorm = String(row.email || '').trim().toLowerCase();
      let customer = emailNorm ?
      customers.find((c) => c.email?.toLowerCase() === emailNorm) :
      customers.find((c) => c.name?.toLowerCase() === guestName.toLowerCase());

      let customerId;
      if (customer) {
        customerId = customer.id;
      } else {
        customerId = await createCustomer({
          name: guestName,
          email: row.email || '',
          phone: row.phone || '',
          id_number: row.id_number || '',
          nationality: row.nationality || ''
        });
      }

      // Create booking via RPC (status starts as 'confirmed', amount_paid = 0)
      const amountPaid = Number(row.amount_paid) || 0;
      const bookingId = await createBooking({
        customer_id: customerId,
        room_id: roomId,
        check_in: row.check_in,
        check_out: row.check_out,
        adults: Number(row.adults) || 1,
        children: Number(row.children) || 0,
        total_amount: Number(row.total_amount) || undefined,
        allow_total_override: !!row.total_amount,
        notes: row.notes || '',
        created_by: state.currentUser?.id || null
      });

      // Record payment via RPC if any was paid
      if (amountPaid > 0) {
        await updateBookingPayment(
          bookingId,
          amountPaid,
          row.payment_method || 'cash',
          'payment',
          null,
          `import-${batchId}-row-${rowNum}`
        );
      }

      // Update status to match historical record — best-effort, does not fail the row
      const targetStatus = String(row.status || '').trim().toLowerCase();
      const validStatuses = ['confirmed', 'checked_in', 'checked_out', 'cancelled'];
      if (targetStatus && targetStatus !== 'confirmed' && validStatuses.includes(targetStatus)) {
        try {
          const { error: statusErr } = await state.supabase.
          from('bookings').
          update({ status: targetStatus, updated_at: new Date().toISOString() }).
          eq('id', bookingId).
          eq('lodge_id', state.lodgeId);
          if (!statusErr) await refreshCache('bookings');
        } catch {

          // Non-fatal — booking and payment are already saved correctly
        }}

      importedIds.push(bookingId);
      imported++;
    } catch (e) {
      errors.push({ row: rowNum, guest: guestName, error: friendlyImportError(e.message) });
      skipped++;
    }
  }

  // Persist batch for undo
  const batches = readCache('import-batches');
  batches.unshift({
    id: batchId,
    filename: filename || 'unknown',
    entity_type: 'bookings',
    row_count: imported,
    error_count: errors.length,
    booking_ids: importedIds,
    created_at: new Date().toISOString()
  });
  writeCache('import-batches', batches);

  await refreshCache('bookings');
  await refreshCache('customers');

  logActivity('data_imported', `Imported ${imported} bookings from "${filename || 'file'}" (${errors.length} errors)`);

  return { imported, skipped, errors, batchId: imported > 0 ? batchId : null };
}

async function createImportedEntity(type, row) {
  if (type === 'guests') {
    return await createCustomer({
      name: importRowValue(row, 'name', 'guest_name'),
      email: importRowValue(row, 'email'),
      phone: importRowValue(row, 'phone'),
      id_number: importRowValue(row, 'id_number'),
      nationality: importRowValue(row, 'nationality')
    });
  }
  if (type === 'rooms') {
    return await createRoom({
      room_number: importRowValue(row, 'room_number'),
      room_type: importRowValue(row, 'room_type') || 'Standard',
      rate_per_night: importNumber(row, ['rate_per_night', 'rate'], 0),
      max_occupancy: Math.max(1, importNumber(row, ['max_occupancy', 'max_adults'], 2) + importNumber(row, ['max_children'], 0)),
      status: 'available'
    });
  }
  if (type === 'inventory') {
    const result = await createInventoryItem({
      name: importRowValue(row, 'name', 'item_name'),
      category: importRowValue(row, 'category') || 'Bar',
      unit: importRowValue(row, 'unit') || 'unit',
      current_stock: importNumber(row, ['current_stock'], 0),
      reorder_level: importNumber(row, ['reorder_level'], 0),
      selling_price: importNumber(row, ['selling_price'], 0)
    });
    return result?.id || null;
  }
  if (type === 'supplies') {
    const result = await createSupplyItem({
      name: importRowValue(row, 'name', 'item_name'),
      category: importRowValue(row, 'category') || 'Bathroom',
      unit: importRowValue(row, 'unit') || 'piece',
      current_stock: importNumber(row, ['current_stock'], 0),
      reorder_level: importNumber(row, ['reorder_level'], 0)
    });
    return result?.id || null;
  }
  if (type === 'expenses') {
    const result = await createExpense({
      date: importRowValue(row, 'date'),
      category: importRowValue(row, 'category'),
      description: importRowValue(row, 'description') || 'Imported expense',
      amount: importNumber(row, ['amount'], 0),
      notes: importRowValue(row, 'notes', 'paid_by')
    });
    return result?.id || null;
  }
  throw new Error('Unsupported import type.');
}

export async function bulkImportTyped(type = 'bookings', rows, { filename = '', onProgress } = {}) {
  const normalizedType = normalizeImportType(type);
  if (normalizedType === 'bookings') return bulkImportBookings(rows, { filename, onProgress });
  if (!state.isOnline) throw new Error(`Internet connection required to import ${normalizedType}.`);

  const batchId = randomUUID();
  const createdIds = [];
  const errors = [];
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (onProgress) onProgress({ current: i + 1, total: rows.length });
    try {
      const rowErrors = validateImportRow(normalizedType, row);
      if (rowErrors.length > 0) throw new Error(rowErrors.join(' '));
      if (findImportDuplicate(normalizedType, row)) {
        skipped += 1;
        continue;
      }
      const id = await createImportedEntity(normalizedType, row);
      if (id) createdIds.push(id);
      imported += 1;
    } catch (error) {
      errors.push({
        row: i + 1,
        guest: importRowValue(row, 'name', 'guest_name', 'room_number', 'description'),
        error: friendlyImportError(error.message)
      });
      skipped += 1;
    }
  }

  const batches = readCache('import-batches');
  batches.unshift({
    id: batchId,
    filename: filename || 'unknown',
    entity_type: normalizedType,
    row_count: imported,
    error_count: errors.length,
    created_ids: createdIds,
    created_at: new Date().toISOString()
  });
  writeCache('import-batches', batches);

  logActivity('data_imported', `Imported ${imported} ${normalizedType} records from "${filename || 'file'}" (${errors.length} errors, ${skipped} skipped)`);
  return { imported, skipped, errors, batchId: imported > 0 ? batchId : null };
}

export async function getImportBatches() {
  return readCache('import-batches');
}

export async function undoImportBatch(batchId) {
  if (!state.isOnline) throw new Error('Internet connection required to undo an import.');

  const batches = readCache('import-batches');
  const batch = batches.find((b) => b.id === batchId);
  if (!batch) return { error: 'Import batch not found.' };

  const type = normalizeImportType(batch.entity_type || 'bookings');
  const bookingIds = batch.booking_ids || [];
  const createdIds = batch.created_ids || [];
  const errors = [];

  if (type === 'bookings') {
    for (const bookingId of bookingIds) {
      const { error } = await state.supabase.
      from('bookings').
      delete().
      eq('id', bookingId).
      eq('lodge_id', state.lodgeId);
      if (error) errors.push(bookingId);
    }
  } else if (type === 'guests') {
    for (const id of createdIds) {
      const hasBookings = readCache('bookings').some((booking) => booking.customer_id === id);
      if (hasBookings) {
        errors.push(id);
        continue;
      }
      const { error } = await state.supabase.from('customers').delete().eq('id', id).eq('lodge_id', state.lodgeId);
      if (error) errors.push(id);
    }
  } else if (type === 'rooms') {
    for (const id of createdIds) {
      const hasBookings = readCache('bookings').some((booking) => booking.room_id === id);
      if (hasBookings) {
        errors.push(id);
        continue;
      }
      try {await deleteRoom(id);} catch {errors.push(id);}
    }
  } else if (type === 'inventory') {
    for (const id of createdIds) {
      try {await deleteInventoryItem(id);} catch {errors.push(id);}
    }
  } else if (type === 'supplies') {
    for (const id of createdIds) {
      try {await deleteSupplyItem(id);} catch {errors.push(id);}
    }
  } else if (type === 'expenses') {
    for (const id of createdIds) {
      try {await deleteExpense(id);} catch {errors.push(id);}
    }
  }

  const targetIds = type === 'bookings' ? bookingIds : createdIds;
  if (errors.length === targetIds.length && targetIds.length > 0) {
    return { error: `Could not delete any ${type} records from this batch.` };
  }

  // Remove batch from local store
  writeCache('import-batches', batches.filter((b) => b.id !== batchId));

  await refreshAllCaches().catch(() => {});
  await refreshCache('inventory-items', 'supply-items', 'expenses').catch(() => {});

  logActivity('import_undone', `Undid import batch "${batch.filename}" (${targetIds.length - errors.length} ${type} records deleted)`);

  return { success: true, deleted: targetIds.length - errors.length, failed: errors.length };
}

export function getManagedBackupPolicy() {
  return readManagedBackupPolicy();
}

export function saveManagedBackupPolicy(updates = {}) {
  const current = getManagedBackupPolicy();
  const next = normalizeManagedBackupPolicy({ ...current, ...updates });
  writeJsonFile(getManagedBackupPolicyPath(), next);
  return buildManagedBackupStatus(next);
}

export function recordManagedBackupRun(result = {}) {
  const current = getManagedBackupPolicy();
  const now = new Date().toISOString();
  const next = normalizeManagedBackupPolicy({
    ...current,
    last_run_at: now,
    last_success_at: result.success ? now : current.last_success_at,
    last_error: result.success ? '' : String(result.error || 'Managed backup failed.'),
    last_json_path: result.jsonPath || current.last_json_path,
    last_excel_path: result.excelPath || current.last_excel_path
  });
  writeJsonFile(getManagedBackupPolicyPath(), next);
  return buildManagedBackupStatus(next);
}

export function getBackupInfo() {
  try {
    const backupDir = path.join(app.getPath('userData'), 'boroko-backups');
    if (!fs.existsSync(backupDir)) return { backupDir, backups: [], policy: buildManagedBackupStatus(getManagedBackupPolicy()) };

    const files = fs.readdirSync(backupDir).
    filter((f) => f.startsWith('backup-') && f.endsWith('.json')).
    sort().
    reverse().
    slice(0, 10);

    const backups = files.map((f) => {
      const stats = fs.statSync(path.join(backupDir, f));
      return { name: f, size: stats.size, created: stats.mtime.toISOString() };
    });

    return { backupDir, backups, policy: buildManagedBackupStatus(getManagedBackupPolicy()) };
  } catch {
    return { backupDir: '', backups: [], policy: buildManagedBackupStatus(getManagedBackupPolicy()) };
  }
}

function getBackupHealthSummary(backupsInfo = getBackupInfo()) {
  const policy = backupsInfo?.policy || buildManagedBackupStatus(getManagedBackupPolicy());
  const newestLocalBackup = Array.isArray(backupsInfo?.backups) && backupsInfo.backups.length > 0 ?
  backupsInfo.backups[0] :
  null;
  const warnings = [];
  if (policy.enabled && policy.compliance_state !== 'healthy') {
    warnings.push(policy.requires_setup ?
    'Weekly managed backup is enabled but no synced folder is selected.' :
    'Weekly managed backup is overdue or has not completed yet.');
  }
  if (!policy.enabled) {
    warnings.push('Weekly managed backup is disabled.');
  }
  if (!newestLocalBackup) {
    warnings.push('No local JSON backup has been created on this computer.');
  }
  return {
    ok: warnings.length === 0,
    warnings,
    newest_local_backup: newestLocalBackup,
    policy
  };
}

export function verifyLocalBackup(name) {
  try {
    const safeName = path.basename(String(name || ''));
    if (!safeName || !safeName.endsWith('.json')) {
      return { success: false, error: 'Choose a local JSON backup to verify.' };
    }

    const backupDir = path.join(app.getPath('userData'), 'boroko-backups');
    const backupPath = path.join(backupDir, safeName);
    if (!fs.existsSync(backupPath)) {
      return { success: false, error: 'Backup file was not found on this computer.' };
    }

    const stats = fs.statSync(backupPath);
    const raw = fs.readFileSync(backupPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const tables = parsed?.tables && typeof parsed.tables === 'object' ? parsed.tables : {};
    const requiredTables = ['settings', 'rooms', 'customers', 'bookings'];
    const missingTables = requiredTables.filter((key) => !(key in tables));
    const counts = Object.fromEntries(
      Object.entries(tables).map(([key, value]) => [key, Array.isArray(value) ? value.length : value && typeof value === 'object' ? 1 : 0])
    );
    const issues = [];
    if (!parsed?.timestamp) issues.push('Missing backup timestamp.');
    if (!parsed?.lodge_id) issues.push('Missing lodge id.');
    if (missingTables.length > 0) issues.push(`Missing required table snapshots: ${missingTables.join(', ')}.`);

    return {
      success: issues.length === 0,
      filePath: backupPath,
      name: safeName,
      created: stats.mtime.toISOString(),
      size: stats.size,
      timestamp: parsed?.timestamp || null,
      version: parsed?.version || 'unknown',
      lodge_id: parsed?.lodge_id || null,
      table_count: Object.keys(tables).length,
      counts,
      issues
    };
  } catch (error) {
    return { success: false, error: error?.message || 'Backup verification failed.' };
  }
}

export function previewLocalBackupRestore(name) {
  const verification = verifyLocalBackup(name);
  if (!verification.name) return verification;
  const destructiveTables = Object.entries(verification.counts || {}).
  filter(([, count]) => Number(count || 0) > 0).
  map(([table, count]) => ({ table, count }));
  return {
    ...verification,
    mode: 'preview',
    can_restore_live: false,
    recommendation: 'Restore is intentionally preview-only in this build. Use this report to confirm contents before support-led recovery.',
    restore_plan: destructiveTables
  };
}

export function createRestoreRehearsalPackage(name) {
  const preview = previewLocalBackupRestore(name);
  if (!preview.name) return preview;
  try {
    const backupDir = path.join(app.getPath('userData'), 'boroko-backups');
    const sourcePath = path.join(backupDir, preview.name);
    const rehearsalDir = path.join(backupDir, 'restore-rehearsals');
    ensureDir(rehearsalDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const targetPath = path.join(rehearsalDir, `restore-preview-${stamp}-${preview.name}`);
    fs.copyFileSync(sourcePath, targetPath);
    const reportPath = path.join(rehearsalDir, `restore-preview-${stamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(preview, null, 2), 'utf-8');
    return { success: true, filePath: targetPath, reportPath, preview };
  } catch (error) {
    return { success: false, error: error?.message || 'Could not create restore rehearsal package.' };
  }
}

// ─── EXPANDED / MANUAL BACKUPS ────────────────────────────────────────────────

async function buildExpandedBackupPayload() {
  if (!state.lodgeId) throw new Error('No lodge profile selected');
  const [
  settings,
  rooms,
  customers,
  bookings,
  quotations,
  expenses,
  maintenance,
  bookingInvoices,
  conferenceBookings,
  dayUseEntries] =
  await Promise.all([
  Promise.resolve(readCache('settings')[0] || {}),
  getAllRooms().catch(() => []),
  getAllCustomers().catch(() => []),
  getAllBookings().catch(() => []),
  getAllQuotations().catch(() => []),
  getExpenses('2000-01-01', '2099-12-31').catch(() => []),
  getMaintenanceTickets().catch(() => []),
  getBookingInvoices().catch(() => []),
  getConferenceBookings('2000-01-01', '2099-12-31').catch(() => []),
  getPoolDayUse('2000-01-01', '2099-12-31').catch(() => [])]
  );

  const inventoryItems = await getInventoryItems().catch(() => []);
  const supplyItems = await getSupplyItems().catch(() => []);
  const posOrders = await getPosOrders('2000-01-01', '2099-12-31').catch(() => []);

  const inventoryPurchases = [];
  for (const item of inventoryItems) {
    const purchases = await getInventoryPurchases(item.id).catch(() => []);
    inventoryPurchases.push(...(purchases || []).map((purchase) => ({
      ...purchase,
      item_name: item.name || item.item_name || ''
    })));
  }

  const supplyPurchases = [];
  for (const item of supplyItems) {
    const purchases = await getSupplyPurchases(item.id).catch(() => []);
    supplyPurchases.push(...(purchases || []).map((purchase) => ({
      ...purchase,
      item_name: item.name || item.item_name || ''
    })));
  }

  const backup = {
    timestamp: new Date().toISOString(),
    version: '2.0',
    lodge_id: state.lodgeId,
    mode: 'manual-expanded',
    tables: {
      settings,
      rooms,
      customers,
      bookings,
      quotations,
      booking_invoices: bookingInvoices,
      expenses,
      maintenance,
      pos_orders: posOrders,
      inventory_items: inventoryItems,
      inventory_purchases: inventoryPurchases,
      supply_items: supplyItems,
      supply_purchases: supplyPurchases,
      conference_bookings: conferenceBookings,
      pool_day_use: dayUseEntries,
      sync_status: getSyncStatus()
    }
  };

  return backup;
}

export async function writeExpandedBackupToPath(filePath) {
  const backup = await buildExpandedBackupPayload();
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf-8');
  return { success: true, filePath };
}

export async function createManualBackup() {
  if (!state.lodgeId) throw new Error('No lodge profile selected');
  const backupDir = path.join(app.getPath('userData'), 'boroko-backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = path.join(backupDir, `manual-backup-${ts}.json`);
  return await writeExpandedBackupToPath(backupPath);
}
