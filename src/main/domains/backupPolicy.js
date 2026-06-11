import { app } from 'electron';
import path from 'path';
import { readJsonFile } from './fileStore.js';

export const BACKUP_POLICY_DEFAULT = {
  enabled: false,
  target_dir: '',
  export_json: true,
  export_excel: true,
  frequency_days: 7,
  last_run_at: null,
  last_success_at: null,
  last_error: '',
  last_json_path: '',
  last_excel_path: '',
  enforcement_level: 'reminder'
};

export function getManagedBackupPolicyPath() {
  return path.join(app.getPath('userData'), 'managed-backup-policy.json');
}

export function normalizeManagedBackupPolicy(raw = {}) {
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
    last_excel_path: typeof raw?.last_excel_path === 'string' ? raw.last_excel_path : '',
    enforcement_level: ['reminder', 'warning', 'strict'].includes(raw?.enforcement_level) ? raw.enforcement_level : 'reminder'
  };
}

export function buildManagedBackupStatus(policy) {
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

export function readManagedBackupPolicy() {
  return normalizeManagedBackupPolicy(readJsonFile(getManagedBackupPolicyPath(), BACKUP_POLICY_DEFAULT));
}
