const fs = require('fs');

const infraPath = 'src/main/domains/infrastructure.js';
let content = fs.readFileSync(infraPath, 'utf8');

const buildStart = content.indexOf('async function buildExpandedBackupPayload() {');
const manualBackupEnd = content.indexOf('// ─── INIT ─────────────────────────────────────────────────────────────────────');
const backupBlock = content.slice(buildStart, manualBackupEnd);

content = content.replace(backupBlock, '');
fs.writeFileSync(infraPath, content, 'utf8');

const miscPath = 'src/main/domains/misc.js';
let miscContent = fs.readFileSync(miscPath, 'utf8');

const reExportBlock1 = `export {
  writeExpandedBackupToPath,
  createManualBackup
} from './infrastructure.js'`;
const reExportBlock2 = `export {
  writeExpandedBackupToPath,
  createManualBackup
} from './infrastructure.js'\n`;
const reExportBlock3 = `export {
  writeExpandedBackupToPath,
  createManualBackup
} from './infrastructure.js'\r\n`;

miscContent = miscContent.replace(reExportBlock3, '');
miscContent = miscContent.replace(reExportBlock2, '');
miscContent = miscContent.replace(reExportBlock1, '');

const backupImports = `
import { getSettings } from './settings.js';
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
import { getSyncStatus } from './infrastructure.js';
`;

miscContent = miscContent.replace("import { state } from '../state.js'", "import { state } from '../state.js'" + backupImports);
miscContent += `\n// ─── EXPANDED / MANUAL BACKUPS ────────────────────────────────────────────────\n\n` + backupBlock;

fs.writeFileSync(miscPath, miscContent, 'utf8');
console.log("Refactoring complete");
