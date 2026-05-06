import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { buildManagedBackupStatus, readManagedBackupPolicy } from './backupPolicy.js';

function getManagedBackupPolicyForHealth() {
  return readManagedBackupPolicy();
}

export function getBackupInfoForHealth() {
  try {
    const backupDir = path.join(app.getPath('userData'), 'boroko-backups');
    if (!fs.existsSync(backupDir)) return { backupDir, backups: [], policy: buildManagedBackupStatus(getManagedBackupPolicyForHealth()) };

    const files = fs.readdirSync(backupDir).
    filter((f) => f.startsWith('backup-') && f.endsWith('.json')).
    sort().
    reverse().
    slice(0, 10);

    const backups = files.map((f) => {
      const stats = fs.statSync(path.join(backupDir, f));
      return { name: f, size: stats.size, created: stats.mtime.toISOString() };
    });

    return { backupDir, backups, policy: buildManagedBackupStatus(getManagedBackupPolicyForHealth()) };
  } catch {
    return { backupDir: '', backups: [], policy: buildManagedBackupStatus(getManagedBackupPolicyForHealth()) };
  }
}

export function getBackupHealthSummary(backupsInfo = getBackupInfoForHealth()) {
  const policy = backupsInfo?.policy || buildManagedBackupStatus(getManagedBackupPolicyForHealth());
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
