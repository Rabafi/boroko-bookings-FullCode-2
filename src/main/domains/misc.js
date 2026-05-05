import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { state } from '../state.js'
import {
  isNonCriticalOperationalError,
  logActivity,
  readAuxiliaryLog,
  writeAuxiliaryLog
} from './infrastructure.js'

export {
  getSystemHealth,
  writeExpandedBackupToPath,
  createManualBackup,
  getSupportedImportTypes,
  generateImportTemplate,
  checkImportDuplicates,
  dryRunBookingImport,
  dryRunImport,
  bulkImportBookings,
  bulkImportTyped,
  getImportBatches,
  undoImportBatch
} from './infrastructure.js'

const CRITICAL_ERROR_LOG_FILE = 'critical-errors.json';

const BACKUP_POLICY_DEFAULT = {
  enabled: false,
  target_dir: '',
  export_json: true,
  export_excel: true,
  frequency_days: 7,
  last_run_at: null,
  last_success_at: null,
  last_error: '',
  last_json_path: '',
  last_excel_path: ''
};

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

function getManagedBackupPolicyPath() {
  return path.join(app.getPath('userData'), 'managed-backup-policy.json');
}

function normalizeManagedBackupPolicy(raw = {}) {
  return {
    enabled: raw?.enabled === true,
    target_dir: typeof raw?.target_dir === 'string' ? raw.target_dir.trim() : '',
    export_json: raw?.export_json !== false,
    export_excel: raw?.export_excel !== false,
    frequency_days: Number(raw?.frequency_days) > 0 ? Number(raw.frequency_days) : 7,
    last_run_at: raw?.last_run_at || null,
    last_success_at: raw?.last_success_at || null,
    last_error: typeof raw?.last_error === 'string' ? raw.last_error : '',
    last_json_path: typeof raw?.last_json_path === 'string' ? raw.last_json_path : '',
    last_excel_path: typeof raw?.last_excel_path === 'string' ? raw.last_excel_path : ''
  };
}

function buildManagedBackupStatus(policy) {
  const normalized = normalizeManagedBackupPolicy(policy);
  const now = new Date();
  const lastSuccessAt = normalized.last_success_at ? new Date(normalized.last_success_at) : null;
  const nextDueAt = lastSuccessAt ?
  new Date(lastSuccessAt.getTime() + normalized.frequency_days * 24 * 60 * 60 * 1000) :
  null;
  const overdue = normalized.enabled && normalized.target_dir ?
  !lastSuccessAt || nextDueAt && nextDueAt.getTime() < now.getTime() :
  false;
  const requiresSetup = normalized.enabled && !normalized.target_dir;
  const hasRecentSuccess = !!lastSuccessAt;

  return {
    ...normalized,
    next_due_at: nextDueAt ? nextDueAt.toISOString() : null,
    overdue,
    requires_setup: requiresSetup,
    has_recent_success: hasRecentSuccess,
    compliance_state: requiresSetup ?
    'setup_required' :
    overdue ?
    'overdue' :
    hasRecentSuccess ?
    'healthy' :
    normalized.enabled ? 'pending_first_run' : 'disabled'
  };
}

export function getManagedBackupPolicy() {
  return normalizeManagedBackupPolicy(readJsonFile(getManagedBackupPolicyPath(), BACKUP_POLICY_DEFAULT));
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
