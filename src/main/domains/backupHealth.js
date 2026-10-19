// @ts-check
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { buildManagedBackupStatus, readManagedBackupPolicy } from './backupPolicy.js';
import { getBarTradingBackupHealth, readBarTradingBackupTarget } from './barTradingBackup.js';
import { readBarTradingBackupAutomationTargetForHealth } from './barTradingBackupAutomation.js';

function getManagedBackupPolicyForHealth() {
  return readManagedBackupPolicy();
}

function getBarTradingBackupHealthForHealth() {
  try {
    // The automation config is the operator-facing source of truth; the
    // engine-level target config remains a fallback for setups made directly
    // through the domain API.
    const configDir = app.getPath('userData');
    const targetDir = readBarTradingBackupAutomationTargetForHealth() || readBarTradingBackupTarget({ configDir });
    return getBarTradingBackupHealth({ targetDir });
  } catch (error) {
    return { ok: false, state: 'unavailable', warnings: [error?.message || 'Bar trading recovery status is unavailable.'], limitations: [] };
  }
}

export function getBackupInfoForHealth() {
  const bar_trading = getBarTradingBackupHealthForHealth();
  try {
    const backupDir = path.join(app.getPath('userData'), 'boroko-backups');
    if (!fs.existsSync(backupDir)) return { backupDir, backups: [], policy: buildManagedBackupStatus(getManagedBackupPolicyForHealth()), bar_trading };

    const files = fs.readdirSync(backupDir).
    filter((f) => f.startsWith('backup-') && f.endsWith('.json')).
    sort().
    reverse().
    slice(0, 10);

    const backups = files.map((f) => {
      const stats = fs.statSync(path.join(backupDir, f));
      return { name: f, size: stats.size, created: stats.mtime.toISOString() };
    });

    return { backupDir, backups, policy: buildManagedBackupStatus(getManagedBackupPolicyForHealth()), bar_trading };
  } catch {
    return { backupDir: '', backups: [], policy: buildManagedBackupStatus(getManagedBackupPolicyForHealth()), bar_trading };
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
  const barTradingWarnings = Array.isArray(backupsInfo?.bar_trading?.warnings) ? backupsInfo.bar_trading.warnings : [];
  for (const warning of barTradingWarnings) {
    warnings.push(`Bar trading recovery: ${warning}`);
  }
  return {
    ok: warnings.length === 0,
    warnings,
    newest_local_backup: newestLocalBackup,
    policy,
    bar_trading: backupsInfo?.bar_trading || null
  }
}
