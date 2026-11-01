// @ts-check
import { useCallback, useEffect, useState } from 'react'
import { adminBackupPackages, adminNetworkRows, adminReplicationPayload, adminStatusPayload } from './bar-local/adminResponse.js'
import { HposNotice } from './HposUi.jsx'
import BarRecoveryPanel from './BarRecoveryPanel'

function messageOf(error) {
  return error && typeof error === 'object' && typeof error.message === 'string'
    ? error.message
    : 'The local Bar service could not complete that administration request.'
}

function displayBytes(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return '—'
  if (number < 1024) return `${number} B`
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KiB`
  if (number < 1024 * 1024 * 1024) return `${(number / (1024 * 1024)).toFixed(1)} MiB`
  return `${(number / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}

function readPath(body, names) {
  let source = body && typeof body === 'object' && !Array.isArray(body) ? /** @type {Record<string, unknown>} */ (body) : null
  for (let index = 0; index < names.length; index += 1) {
    if (!source) return undefined
    const value = source[names[index]]
    if (index === names.length - 1) return value
    source = value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null
  }
  return undefined
}

function field(body, ...names) {
  const direct = readPath(body, names)
  if (direct !== undefined) return direct
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const wrapped = /** @type {Record<string, unknown>} */ (body)
    for (const key of ['data', 'result']) {
      const value = readPath(wrapped[key], names)
      if (value !== undefined) return value
    }
  }
  return undefined
}

/** @param {{blocked: boolean, canExport?: boolean, refreshKey?: number, onCommand?: (command: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>|null>, onError: (message: string) => void, onNotice: (message: string) => void}} props */
export default function BarLocalAdminPanel({ blocked, canExport = false, refreshKey = 0, onCommand, onError, onNotice }) {
  const [practiceBusy, setPracticeBusy] = useState(false)
  const [training, setTraining] = useState(true)
  const openPractice = async () => {
    setPracticeBusy(true)
    try { await window.api.barLocal.trainingLaunch(); onNotice('Practice opens in a separate window. Live trading data stays here.') }
    catch (error) { onError(messageOf(error)) }
    finally { setPracticeBusy(false) }
  }
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [backups, setBackups] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [backupSchedule, setBackupSchedule] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [replication, setReplication] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [update, setUpdate] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [updateRestartPending, setUpdateRestartPending] = useState(false)
  const [updatePackageName, setUpdatePackageName] = useState('')
  const [updateAuthorizedBy, setUpdateAuthorizedBy] = useState('')
  const [updateReason, setUpdateReason] = useState('')
  const [updateApplyConfirm, setUpdateApplyConfirm] = useState('')
  const [exportStatus, setExportStatus] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [loyaltyPrograms, setLoyaltyPrograms] = useState(/** @type {Array<Record<string, unknown>>} */ ([]))
  const [loyaltyOutletId, setLoyaltyOutletId] = useState('')
  const [loyaltyLoadError, setLoyaltyLoadError] = useState('')
  const [loyaltyProgramId, setLoyaltyProgramId] = useState('')
  const [loyaltyName, setLoyaltyName] = useState('')
  const [loyaltyEarnRate, setLoyaltyEarnRate] = useState('1')
  const [loyaltyRedeemValue, setLoyaltyRedeemValue] = useState('0')
  const [loyaltyMinimum, setLoyaltyMinimum] = useState('0')
  const [loyaltyActive, setLoyaltyActive] = useState(true)
  const [exportLoadError, setExportLoadError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [backupLabel, setBackupLabel] = useState('')
  const [verifyTarget, setVerifyTarget] = useState('')
  const [drillFileName, setDrillFileName] = useState('')
  const [drillReason, setDrillReason] = useState('')
  const [drillAuthorizedBy, setDrillAuthorizedBy] = useState('')
  const [drillConfirm, setDrillConfirm] = useState('')
  const [drillResult, setDrillResult] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [durabilityProfile, setDurabilityProfile] = useState('')
  const [switchConfirm, setSwitchConfirm] = useState('')
  const [switchReason, setSwitchReason] = useState('')
  const [exportBatchId, setExportBatchId] = useState('')
  const [cloudSync, setCloudSync] = useState(/** @type {Record<string, unknown>|null} */ (null))
  const [cloudLoadError, setCloudLoadError] = useState('')
  const [cloudEnabled, setCloudEnabled] = useState(false)
  const [cloudReceiverUrl, setCloudReceiverUrl] = useState('')
  const [cloudScheduleMode, setCloudScheduleMode] = useState('fifteen_minutes')
  const [cloudDailyAt, setCloudDailyAt] = useState('23:30')
  const [cloudBatchLimit, setCloudBatchLimit] = useState('200')
  const [cloudSigningKeyId, setCloudSigningKeyId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const localProfile = await window.api.barLocal.getStatus()
    const isTraining = localProfile && typeof localProfile === 'object' && localProfile.training === true
    setTraining(isTraining)
    const [statusResult, backupsResult, replicationResult, updateResult, exportResult, loyaltyResult, cloudResult] = await Promise.allSettled([
      window.api.barLocal.adminStatus(),
      window.api.barLocal.adminBackups(),
      isTraining ? Promise.resolve(null) : window.api.barLocal.adminReplicationStatus(),
      isTraining ? Promise.resolve(null) : window.api.barLocal.adminUpdateStatus(),
      canExport ? window.api.barLocal.query('outbox.status', {}) : Promise.resolve(null),
      window.api.barLocal.query('loyalty.programs.list', {}),
      isTraining ? Promise.resolve(null) : window.api.barLocal.adminCloudSyncStatus()
    ])
    setStatus(statusResult.status === 'fulfilled' ? adminStatusPayload(statusResult.value) : null)
    setBackups(backupsResult.status === 'fulfilled' ? adminBackupPackages(backupsResult.value) : [])
    setBackupSchedule(backupsResult.status === 'fulfilled' && field(backupsResult.value, 'schedule') ? /** @type {Record<string, unknown>} */ (field(backupsResult.value, 'schedule')) : null)
    setReplication(replicationResult.status === 'fulfilled' ? adminReplicationPayload(replicationResult.value) : null)
    setUpdate(updateResult.status === 'fulfilled' ? updateResult.value : null)
    if (updateResult.status === 'fulfilled' && field(updateResult.value, 'restart_required') === false) setUpdateRestartPending(false)
    setExportStatus(exportResult.status === 'fulfilled' ? field(exportResult.value, 'data') : null)
    setExportLoadError(exportResult.status === 'rejected' ? messageOf(exportResult.reason) : '')
    const programs = loyaltyResult.status === 'fulfilled' ? field(loyaltyResult.value, 'data') : null
    setLoyaltyPrograms(Array.isArray(programs) ? programs : [])
    setLoyaltyOutletId(String(field(loyaltyResult.value, 'scope', 'outlet_id') ?? ''))
    setLoyaltyLoadError(loyaltyResult.status === 'rejected'
      ? messageOf(loyaltyResult.reason)
      : Array.isArray(programs) ? '' : 'The local authority returned an invalid programme list. Refresh before changing loyalty settings.')
    if (loyaltyResult.status === 'fulfilled' && Array.isArray(programs)) {
      const selected = programs.find((program) => field(program, 'outlet_id')) ?? programs[0]
      if (selected) {
        setLoyaltyProgramId(String(field(selected, 'program_id') ?? ''))
        setLoyaltyName(String(field(selected, 'name') ?? ''))
        setLoyaltyEarnRate(String(field(selected, 'earn_rate') ?? '1'))
        setLoyaltyRedeemValue(String(field(selected, 'redeem_value') ?? '0'))
        setLoyaltyMinimum(String(field(selected, 'min_redeem_points') ?? '0'))
        setLoyaltyActive(field(selected, 'active') !== false)
      }
    }
    const cloud = cloudResult.status === 'fulfilled' ? field(cloudResult.value, 'status') : null
    const cloudBody = cloud && typeof cloud === 'object' && !Array.isArray(cloud)
      ? /** @type {Record<string, unknown>} */ (cloud)
      : null
    setCloudSync(cloudBody)
    setCloudLoadError(cloudResult.status === 'rejected'
      ? messageOf(cloudResult.reason)
      : cloudBody ? '' : 'The local authority returned an unverified cloud synchronisation status.')
    if (cloudBody) {
      setCloudEnabled(field(cloudBody, 'enabled') === true)
      setCloudScheduleMode(field(cloudBody, 'schedule_mode') === 'daily' ? 'daily' : 'fifteen_minutes')
      const daily = field(cloudBody, 'daily_at')
      setCloudDailyAt(typeof daily === 'string' && /^\d{2}:\d{2}$/.test(daily) ? daily : '23:30')
      const limit = Number(field(cloudBody, 'batch_limit'))
      setCloudBatchLimit(Number.isSafeInteger(limit) && limit > 0 ? String(limit) : '200')
      // Receiver URL and signing key are entered only when changing them. The
      // authority's current values are shown in the status block, so a
      // refresh never puts receiver credentials back into renderer state.
      setCloudReceiverUrl('')
      setCloudSigningKeyId('')
    }
    const failures = [statusResult, backupsResult, replicationResult, updateResult]
      .filter((result) => result.status === 'rejected')
      .map((result) => messageOf(/** @type {PromiseRejectedResult} */ (result).reason))
    setLoadError(failures.length === 0 ? '' : Array.from(new Set(failures)).join(' '))
    setLoading(false)
  }, [canExport, refreshKey])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!updateRestartPending) return undefined
    const timer = window.setInterval(() => { void load() }, 5000)
    return () => window.clearInterval(timer)
  }, [updateRestartPending, load])

  const run = async (name, operation, success) => {
    if (busy || blocked) return
    setBusy(name)
    try {
      const result = await operation()
      onNotice(success)
      await load()
      return result
    } catch (cause) {
      const message = messageOf(cause)
      if (name === 'update-apply') {
        await load()
        onError(`${message} Refresh the local update status and inspect the last apply report before retrying. Retry only if the same signed package is still shown as staged.`)
      } else {
        onError(message)
      }
      return null
    } finally {
      setBusy('')
    }
  }

  const runBackup = () => void run(
    'backup',
    () => window.api.barLocal.adminRunBackup(backupLabel.trim() ? { label: backupLabel.trim() } : {}),
    'A new local backup was requested. Verify it before relying on it for recovery.'
  )

  const stageOfflineUpdate = () => void run(
    'update-stage',
    () => window.api.barLocal.adminStageUpdate({ package: updatePackageName.trim(), confirm: 'STAGE_UPDATE' }),
    'The offline update package passed signature and compatibility checks and is staged.'
  )

  const importOfflineUpdate = async () => {
    if (busy || blocked) return
    setBusy('update-import')
    try {
      const result = await window.api.barLocal.adminImportUpdatePackage()
      if (field(result, 'canceled') === true) return
      const packageName = field(result, 'package')
      if (typeof packageName !== 'string' || packageName.length === 0) throw new Error('The selected update package was not copied into the local inbox.')
      setUpdatePackageName(packageName)
      onNotice(`Update package copied into the local inbox (${String(field(result, 'files') ?? 0)} files). Verify its signature before staging.`)
      await load()
    } catch (cause) {
      onError(messageOf(cause))
    } finally {
      setBusy('')
    }
  }

  const applyOfflineUpdate = async () => {
    if (busy || blocked) return
    setUpdateRestartPending(true)
    await run(
      'update-apply',
      () => window.api.barLocal.adminApplyUpdate({
      confirm: updateApplyConfirm,
      authorized_by: updateAuthorizedBy.trim(),
      reason: updateReason.trim()
      }),
      'The update files were applied. Wait for the Bar service to restart, refresh its version and readiness, and review the checkpoint report before returning to trade.'
    )
  }

  const verifyBackup = (fileName) => void run(
    'verify',
    () => window.api.barLocal.adminVerifyBackup({ file_name: fileName }),
    `Backup ${fileName} was checked by the local authority.`
  )

  const restoreDrill = () => {
    const fileName = drillFileName.trim()
    const authorizedBy = drillAuthorizedBy.trim()
    const reason = drillReason.trim()
    if (!fileName) {
      onError('Choose a backup package from the verified package list before running a restore drill.')
      return
    }
    if (authorizedBy.length < 3) {
      onError('Enter the name of the owner or manager authorising this restore drill.')
      return
    }
    if (reason.length < 8) {
      onError('Describe why this restore drill is being run (at least 8 characters).')
      return
    }
    if (drillConfirm !== 'RESTORE_DRILL') {
      onError('Type RESTORE_DRILL exactly to confirm the drill.')
      return
    }
    void run(
      'restore-drill',
      async () => {
        const result = await window.api.barLocal.adminRestoreDrill({
          confirm: 'RESTORE_DRILL',
          file_name: fileName,
          authorized_by: authorizedBy,
          reason
        })
        setDrillResult(result && typeof result === 'object' && !Array.isArray(result) ? /** @type {Record<string, unknown>} */ (result) : null)
        return result
      },
      `Restore drill for ${fileName} passed in an isolated same-PC cluster. The live database and backups were not replaced.`
    )
  }

  const setDurability = () => {
    const profile = durabilityProfile.trim()
    if (!profile) {
      onError('Enter a replication durability profile before applying it.')
      return
    }
    void run(
      'durability',
      () => window.api.barLocal.adminSetDurability({ profile }),
      `Replication durability was set to ${profile}.`
    )
  }

  const switchover = () => {
    if (switchConfirm !== 'SWITCHOVER') {
      onError('Type SWITCHOVER exactly to confirm a replication switchover.')
      return
    }
    if (switchReason.trim().length < 3) {
      onError('Enter the operational reason for this switchover.')
      return
    }
    void run(
      'switchover',
      () => window.api.barLocal.adminSwitchover({ confirm: 'SWITCHOVER', reason: switchReason.trim() }),
      'The replication switchover was requested. Recheck status before trading.'
    )
  }

  const saveCloudSyncConfig = () => {
    const limit = Number(cloudBatchLimit)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      onError('The upload batch limit must be a whole number between 1 and 1000.')
      return
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cloudDailyAt)) {
      onError('The daily upload time must use 24-hour HH:MM, for example 23:30.')
      return
    }
    const payload = {
      enabled: cloudEnabled,
      schedule_mode: cloudScheduleMode,
      daily_at: cloudDailyAt,
      batch_limit: limit
    }
    const receiverUrl = cloudReceiverUrl.trim()
    if (receiverUrl) payload.receiver_url = receiverUrl
    const signingKeyId = cloudSigningKeyId.trim()
    if (signingKeyId) payload.signing_key_id = signingKeyId
    void run(
      'cloud-config',
      () => window.api.barLocal.adminCloudSyncConfig(payload),
      'Cloud synchronisation settings were saved by the local authority. Enabling upload does not acknowledge any batch until a receiver reports ingested.'
    )
  }

  const syncCloudNow = async () => {
    if (busy || blocked) return
    setBusy('cloud-run')
    try {
      const result = await window.api.barLocal.adminCloudSyncRun({})
      const state = field(result, 'status')
      const uploaded = Number(field(result, 'uploaded_batches') ?? 0)
      const message = field(result, 'last_error_message')
      if (state === 'ok') {
        onNotice(`Upload pass finished: ${uploaded} batch(es) confirmed ingested by the receiver. Pending work remains until a receiver acknowledgement arrives.`)
      } else if (state === 'busy') {
        onNotice('An upload pass is already running. Check cloud synchronisation status again shortly.')
      } else {
        onError(`The upload pass did not complete (${String(state ?? 'unknown')})${message ? `: ${String(message)}` : ''}. Local trade is unaffected and pending work stays on this Bar server.`)
      }
      await load()
    } catch (cause) {
      onError(`${messageOf(cause)} Local trade is unaffected; this is not a cloud acknowledgement. Pending work remains on this Bar server.`)
    } finally {
      setBusy('')
    }
  }

  const readExportBatchId = (result) => {
    const value = field(result, 'batch_id')
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : ''
  }

  const saveExportBundle = async (batchId = exportBatchId, allowBusy = false) => {
    if ((busy && !allowBusy) || blocked || !canExport || !batchId) return
    setBusy('export-save')
    try {
      const response = await window.api.barLocal.query('outbox.bundle.get', { batch_id: batchId })
      const bundle = field(response, 'data')
      const complete = field(response, 'complete') === true
      const unavailable = field(response, 'unavailable')
      if (!complete || !bundle || typeof bundle !== 'object' || Array.isArray(bundle)
        || (Array.isArray(unavailable) && unavailable.length > 0)
        || field(bundle, 'batch_id') !== batchId
        || field(bundle, 'schema') !== 'bar-local-export-bundle'
        || field(bundle, 'signature') !== null
        || field(bundle, 'signature_key_id') !== null
        || (field(bundle, 'signature_algorithm') !== undefined && field(bundle, 'signature_algorithm') !== null)
        || field(bundle, 'signature_status') !== 'unavailable'
        || field(bundle, 'transport_status') !== 'integration_disabled'
        || field(bundle, 'status') !== 'integration_disabled'
        || !Array.isArray(field(bundle, 'events'))
        || field(bundle, 'event_count') !== field(bundle, 'events')?.length
        || !Number.isSafeInteger(field(bundle, 'checkpoint'))
        || !Number.isSafeInteger(field(bundle, 'event_count'))) {
        throw new Error('The local authority did not return a complete, unsigned bundle for this batch. Keep the batch ID and refresh the authority status before retrying.')
      }
      const file = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json' })
      const objectUrl = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `bar-export-${batchId}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
      onNotice(`Download requested for unsigned local export ${batchId}. Confirm the file appears in Downloads; it has not been uploaded or acknowledged.`)
    } catch (cause) {
      onError(`${messageOf(cause)} The batch ID is retained so you can retry retrieving this same export without creating another checkpoint.`)
    } finally {
      setBusy('')
    }
  }

  const createAndSaveExport = async () => {
    const batches = field(exportStatus, 'batches')
    const statusHealthy = !exportLoadError && Boolean(exportStatus) && Array.isArray(batches)
      && batches.every((batch) => field(batch, 'integrity_valid') === true)
    if (busy || blocked || !canExport || !statusHealthy || typeof onCommand !== 'function') return
    setBusy('export-create')
    try {
      const result = await onCommand('export.bundle.create', { limit: 200 })
      const batchId = readExportBatchId(result)
      if (!batchId) {
        onError('The export command did not return a confirmed batch ID. Resolve any pending operation using its original operation ID before creating another export.')
        return
      }
      setExportBatchId(batchId)
      await saveExportBundle(batchId, true)
    } finally {
      setBusy('')
    }
  }

  const chooseLoyaltyProgram = (id) => {
    setLoyaltyProgramId(id)
    if (id === '' || id === 'new-outlet') {
      setLoyaltyName('')
      setLoyaltyEarnRate('1')
      setLoyaltyRedeemValue('0')
      setLoyaltyMinimum('0')
      setLoyaltyActive(true)
      return
    }
    const selected = loyaltyPrograms.find((program) => field(program, 'program_id') === id)
    setLoyaltyName(String(field(selected, 'name') ?? ''))
    setLoyaltyEarnRate(String(field(selected, 'earn_rate') ?? '0'))
    setLoyaltyRedeemValue(String(field(selected, 'redeem_value') ?? '0'))
    setLoyaltyMinimum(String(field(selected, 'min_redeem_points') ?? '0'))
    setLoyaltyActive(field(selected, 'active') !== false)
  }

  const saveLoyaltyProgram = () => {
    const name = loyaltyName.trim()
    const earnRate = Number(loyaltyEarnRate)
    const redeemValue = Number(loyaltyRedeemValue)
    const minimum = Number(loyaltyMinimum)
    if (!name || name.length > 120 || !Number.isFinite(earnRate) || earnRate < 0
      || !Number.isFinite(redeemValue) || redeemValue < 0 || !Number.isSafeInteger(minimum) || minimum < 0) {
      onError('Enter a programme name and non-negative rates; the minimum points must be a whole number.')
      return
    }
    const selected = loyaltyPrograms.find((program) => field(program, 'program_id') === loyaltyProgramId)
    const payload = {
      name, earn_rate: earnRate, redeem_value: redeemValue,
      min_redeem_points: minimum, active: loyaltyActive
    }
    if (loyaltyProgramId === 'new-outlet') payload.outlet_id = loyaltyOutletId
    if (selected) {
      payload.program_id = field(selected, 'program_id')
      payload.expected_version = field(selected, 'version')
    }
    void run('loyalty', () => onCommand('loyalty.program.upsert', payload),
      'Loyalty programme settings were saved by the local authority. Refresh customer accounts before quoting a points balance.')
  }

  const statusRows = status
    ? [
        ['Role', field(status, 'role') ?? field(status, 'network', 'role')],
        ['Durability', field(status, 'durability') ?? field(status, 'replication', 'durability')],
        ['Schema migration', field(status, 'update', 'schema_migration')],
        ['Contract', field(status, 'update', 'contract_version')],
        ['Database', field(status, 'database', 'database')],
        ['Backup destination', field(status, 'backup', 'destination_status')],
        ['Secondary backup copy', field(status, 'backup', 'copy_destination_status')]
      ].filter(([, value]) => value !== undefined && value !== null && value !== '')
    : []
  const networkRows = status ? adminNetworkRows(status) : []
  const backupDestinationUnavailable = field(status, 'backup', 'destination_status') === 'unavailable'
  const backupDestinationError = field(status, 'backup', 'destination_error')
  const backupCopyUnavailable = field(status, 'backup', 'copy_destination_status') === 'unavailable'
  const exportBatches = field(exportStatus, 'batches')
  const exportStatusHealthy = !exportLoadError && Boolean(exportStatus) && Array.isArray(exportBatches)
    && exportBatches.every((batch) => field(batch, 'integrity_valid') === true)
  const hasGlobalLoyaltyProgram = loyaltyPrograms.some((program) => !field(program, 'outlet_id'))
  const hasOutletLoyaltyProgram = loyaltyPrograms.some((program) => Boolean(field(program, 'outlet_id')))
  const cloudTransport = field(cloudSync, 'transport')
  const cloudAvailable = field(cloudSync, 'available') === true
  const cloudLatestBatch = field(cloudSync, 'latest_batch')
  const cloudTransportNote = cloudTransport === 'local_test'
    ? 'Cloud upload is limited to a loopback test receiver on this machine. No hosted or internet receiver is used, and this is not a Supabase connection.'
    : cloudTransport === 'approved'
      ? 'Cloud upload is configured for an approved receiver. Only the receiver’s own ingested acknowledgement counts as accepted.'
      : 'Cloud upload is disabled in this Bar server configuration. Local trade and cash-up remain authoritative and nothing is sent to a receiver.'

  return (
    <section className="mt-5 space-y-4">
      {!training && <BarRecoveryPanel blocked={blocked} />}
      <div className="rounded-xl border border-amber-700 bg-amber-950/20 p-4">
        <h2 className="font-semibold">Practice Bar</h2>
        <p className="mt-2 text-sm text-slate-300">Train staff in a separate window and database. Practice sales do not affect live stock, cash-ups or cloud reports.</p>
        <button type="button" disabled={blocked || practiceBusy} onClick={() => void openPractice()} className="mt-3 rounded bg-amber-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">{practiceBusy ? 'Opening practice…' : 'Open isolated practice Bar'}</button>
      </div>
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Local authority administration</h2>
            <p className="mt-1 text-xs text-slate-400">Backups, replication and update evidence are read from this Bar authority. Destructive actions require explicit confirmation and remain server-enforced.</p>
          </div>
          <button type="button" disabled={loading || busy !== ''} onClick={() => void load()} className="rounded border border-slate-600 px-3 py-1 text-xs disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh administration'}</button>
        </div>
        {loadError && <HposNotice tone="error">{loadError} Administration data may be unavailable until the local service is connected.</HposNotice>}
        {statusRows.length > 0 && <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">{statusRows.map(([label, value]) => <div key={String(label)} className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">{String(label)}</dt><dd className="mt-1 break-all font-mono text-xs">{String(value)}</dd></div>)}</dl>}
        {networkRows.length > 0 && <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950 p-3">
          <h3 className="text-sm font-semibold">Local Bar network diagnostics</h3>
          <p className="mt-1 text-xs text-slate-400">These are live service diagnostics. A reachable endpoint does not mean trading is ready, and automatic failover stays unavailable unless independently verified.</p>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">{networkRows.map(([label, value]) => <div key={label} className="rounded border border-slate-800 bg-slate-900 p-2"><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 break-words text-xs">{value}</dd></div>)}</dl>
        </div>}
      </div>

      <article className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h2 className="font-semibold">Loyalty programme</h2>
        <p className="mt-1 text-xs text-slate-400">Programme changes use the local authority’s version-checked command. Existing customer points are ledger-backed and are not changed by editing these rates.</p>
        {loyaltyLoadError && <p role="alert" className="mt-2 rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-100">Programme settings are unavailable: {loyaltyLoadError}</p>}
        <label className="mt-3 block text-xs">Programme scope
          <select value={loyaltyProgramId} onChange={(event) => chooseLoyaltyProgram(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm">
            <option value="" disabled={hasGlobalLoyaltyProgram}>New business-wide programme{hasGlobalLoyaltyProgram ? ' (already configured)' : ''}</option>
            <option value="new-outlet" disabled={!loyaltyOutletId || hasOutletLoyaltyProgram}>New programme for this outlet{hasOutletLoyaltyProgram ? ' (already configured)' : ''}</option>
            {loyaltyPrograms.map((program) => <option key={String(field(program, 'program_id'))} value={String(field(program, 'program_id'))}>{String(field(program, 'name'))} · {field(program, 'outlet_id') ? 'This outlet' : 'All outlets'} · v{String(field(program, 'version'))}</option>)}
          </select>
        </label>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs">Name<input maxLength={120} value={loyaltyName} onChange={(event) => setLoyaltyName(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
          <label className="text-xs">Points earned per currency unit<input inputMode="decimal" value={loyaltyEarnRate} onChange={(event) => setLoyaltyEarnRate(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
          <label className="text-xs">Redemption value per point<input inputMode="decimal" value={loyaltyRedeemValue} onChange={(event) => setLoyaltyRedeemValue(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
          <label className="text-xs">Minimum points to redeem<input inputMode="numeric" value={loyaltyMinimum} onChange={(event) => setLoyaltyMinimum(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={loyaltyActive} onChange={(event) => setLoyaltyActive(event.target.checked)} />Programme is active</label>
        <p className="mt-2 text-xs text-amber-200">New business-wide programmes affect all outlets; new outlet programmes affect only this outlet. Existing programmes can be selected for edits. Concurrent edits are refused and must be refreshed.</p>
        <button type="button" disabled={blocked || busy !== '' || Boolean(loyaltyLoadError) || typeof onCommand !== 'function' || (loyaltyProgramId === '' && hasGlobalLoyaltyProgram) || (loyaltyProgramId === 'new-outlet' && (!loyaltyOutletId || hasOutletLoyaltyProgram))} onClick={saveLoyaltyProgram} className="mt-3 rounded bg-sky-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy === 'loyalty' ? 'Saving…' : 'Save programme'}</button>
      </article>

      <div className="grid gap-4 lg:grid-cols-2">
        {canExport && <article className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <h2 className="font-semibold">Local export bundle</h2>
          <p className="mt-1 text-xs text-slate-400">Create a checkpoint and save its complete event bundle as JSON. The file is unsigned and stays on this device. Saving a file is not an upload or an acknowledgement; only a cloud receiver’s own ingested acknowledgement counts as accepted. Highest sequences show the highest observed event numbers; gaps and pending work may remain before them.</p>
          {exportLoadError && <p role="alert" className="mt-2 rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-100">Export status is unavailable: {exportLoadError} Refresh before relying on backlog or checkpoint totals.</p>}
          {Array.isArray(exportBatches) && exportBatches.some((batch) => field(batch, 'integrity_valid') !== true) && <p role="alert" className="mt-2 rounded border border-red-800 bg-red-950/40 p-2 text-xs text-red-100">An export batch failed integrity reconciliation. New exports are paused; keep the batch ID and contact your local Bar administrator before continuing.</p>}
          {field(exportStatus, 'batches_truncated') === true && <p role="status" className="mt-2 rounded border border-slate-700 bg-slate-950 p-2 text-xs text-slate-300">Only the 50 most recent batches are listed here. Totals and highest sequences cover the full current scope.</p>}
          {exportStatus && <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><p className="rounded border border-slate-800 bg-slate-950 p-2">Pending events: {String(field(exportStatus, 'pending_events') ?? '—')}</p><p className="rounded border border-slate-800 bg-slate-950 p-2">Exported, unacknowledged: {String(field(exportStatus, 'exported_unacknowledged') ?? '—')}</p><p className="rounded border border-slate-800 bg-slate-950 p-2">Highest exported sequence: {String(field(exportStatus, 'exported_watermark') ?? '—')}</p><p className="rounded border border-slate-800 bg-slate-950 p-2">Highest acknowledged sequence: {String(field(exportStatus, 'acknowledged_watermark') ?? '—')}</p></div>}
          {Array.isArray(field(exportStatus, 'batches')) && field(exportStatus, 'batches').length > 0 && <div className="mt-3 space-y-2"><p className="text-xs text-slate-400">Recent batches (up to 50)</p>{field(exportStatus, 'batches').map((batch) => <div key={String(field(batch, 'batch_id'))} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950 p-2 text-xs"><span className="min-w-0 break-all font-mono">{String(field(batch, 'batch_id'))}</span><span className={field(batch, 'integrity_valid') === true ? 'text-emerald-300' : 'text-rose-300'}>{field(batch, 'integrity_valid') === true ? 'Integrity checked' : 'Integrity failed'} · {field(batch, 'acknowledged_at') ? 'Acknowledged' : 'Not acknowledged'}</span><button type="button" disabled={blocked || busy !== '' || field(batch, 'integrity_valid') !== true} onClick={() => { const id = String(field(batch, 'batch_id') ?? ''); setExportBatchId(id); void saveExportBundle(id) }} className="rounded border border-slate-600 px-2 py-1 disabled:opacity-40">Download</button></div>)}</div>}
          <button type="button" disabled={blocked || busy !== '' || !exportStatusHealthy || typeof onCommand !== 'function'} onClick={() => void createAndSaveExport()} className="mt-3 rounded bg-sky-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy === 'export-create' ? 'Creating…' : 'Create and save export'}</button>
          {exportBatchId && <div className="mt-3 rounded border border-slate-800 bg-slate-950 p-3">
            <p className="text-xs text-slate-400">Last confirmed batch ID</p><p className="mt-1 break-all font-mono text-xs">{exportBatchId}</p>
            <button type="button" disabled={blocked || busy !== ''} onClick={() => void saveExportBundle()} className="mt-2 rounded border border-slate-600 px-3 py-1 text-xs disabled:opacity-50">Save this batch again</button>
          </div>}
          <p className="mt-2 text-xs text-amber-200">Saving the file does not mark it as uploaded or acknowledged. Retain the batch ID if file saving is interrupted.</p>
        </article>}
        <article className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <h2 className="font-semibold">Backups</h2>
          <p className="mt-1 text-xs text-slate-400">Create a labelled backup, then verify its integrity. A backup that has not been verified is not recovery evidence.</p>
          {field(status, 'backup', 'copy_destination_status') !== 'not_configured' && <p className="mt-2 text-xs text-slate-400">Secondary copy destination: {String(field(status, 'backup', 'copy_destination') ?? 'unavailable')} · {String(field(status, 'backup', 'copy_destination_status') ?? 'unknown')}. A second folder on the same physical drive is not an independent backup.</p>}
          {backupDestinationUnavailable && <p role="alert" className="mt-3 rounded border border-amber-700 bg-amber-950/40 p-2 text-sm text-amber-100">The backup destination is unavailable{backupDestinationError ? ` (${String(backupDestinationError)})` : ''}. The listed packages may be incomplete. Check the configured backup folder and service permissions, then refresh before creating or relying on a backup.</p>}
          {backupCopyUnavailable && <p role="alert" className="mt-3 rounded border border-amber-700 bg-amber-950/40 p-2 text-sm text-amber-100">The configured secondary backup copy cannot be read. New copies may fail; reconnect the destination and confirm the Bar service account can write there before relying on it.</p>}
          <div className="mt-3 rounded border border-slate-800 bg-slate-950 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Scheduled backups</h3>
              <span className={`rounded px-2 py-1 font-semibold ${
                field(backupSchedule, 'health') === 'healthy'
                  ? 'bg-emerald-950 text-emerald-200'
                  : field(backupSchedule, 'health') === 'never' || field(backupSchedule, 'health') === 'schedule_missing'
                    ? 'bg-amber-950 text-amber-100'
                    : 'bg-rose-950 text-rose-100'
              }`}>{loading && !backupSchedule ? 'Checking…' : String(field(backupSchedule, 'health') ?? 'unknown').replace(/_/g, ' ')}</span>
            </div>
            <p className="mt-2 text-slate-300">{String(field(backupSchedule, 'schedule_message') ?? 'Scheduled backup health is unavailable; refresh before relying on the schedule.')}</p>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              <div><dt className="text-slate-400">Task</dt><dd className="mt-1">{String(field(backupSchedule, 'task_name') ?? 'Not installed')}</dd></div>
              <div><dt className="text-slate-400">Cadence</dt><dd className="mt-1">{field(backupSchedule, 'hourly_every_hours') ? `Every ${String(field(backupSchedule, 'hourly_every_hours'))} hour(s), daily at ${String(field(backupSchedule, 'daily_at') ?? '—')}` : 'Unknown'}</dd></div>
              <div><dt className="text-slate-400">Last scheduled run</dt><dd className="mt-1">{String(field(backupSchedule, 'last_run_at') ?? 'Never recorded')} · {String(field(backupSchedule, 'last_run_result') ?? 'unknown')}</dd></div>
              <div><dt className="text-slate-400">Latest package age</dt><dd className="mt-1">{field(backupSchedule, 'latest_backup_age_hours') === null || field(backupSchedule, 'latest_backup_age_hours') === undefined ? 'No package listed' : `${String(field(backupSchedule, 'latest_backup_age_hours'))} h (stale after ${String(field(backupSchedule, 'stale_after_hours') ?? '—')} h)`}</dd></div>
            </dl>
            {field(backupSchedule, 'last_run_message') && <p className="mt-2 text-slate-400">{String(field(backupSchedule, 'last_run_message'))}</p>}
            <p role="note" className="mt-2 rounded border border-amber-800 bg-amber-950/40 p-2 text-amber-100">{String(field(backupSchedule, 'warning') ?? 'Scheduled backups are not point-in-time recovery. Keep a verified copy on independent media.')}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <input maxLength={120} value={backupLabel} onChange={(event) => setBackupLabel(event.target.value)} placeholder="Label (optional)" className="min-w-40 flex-1 rounded bg-slate-800 p-2 text-sm" />
            <button type="button" disabled={blocked || busy !== ''} onClick={runBackup} className="rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{busy === 'backup' ? 'Creating…' : 'Run backup'}</button>
          </div>
          {backups.length === 0 ? <p className="mt-3 text-sm text-slate-300">{loading ? 'Loading local backups.' : backupDestinationUnavailable ? 'Backup listing is unavailable; no conclusion can be drawn about packages on disk.' : 'No local backups are listed by this authority.'}</p> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="uppercase tracking-wide text-slate-400"><tr><th className="p-2">File</th><th className="p-2">Created</th><th className="p-2">Size</th><th className="p-2">Verified</th><th className="p-2">Action</th></tr></thead><tbody>{backups.map((backup, index) => {
            const fileName = String(field(backup, 'file_name') ?? field(backup, 'filename') ?? field(backup, 'name') ?? '')
            const verified = field(backup, 'verified') === true
            return <tr key={`${fileName}-${index}`} className="border-t border-slate-800"><td className="break-all p-2 font-mono">{fileName || '—'}</td><td className="p-2 text-slate-400">{String(field(backup, 'created_at') ?? '—')}</td><td className="p-2">{displayBytes(field(backup, 'size_bytes') ?? field(backup, 'bytes'))}</td><td className="p-2">{verified ? 'Yes' : 'Not verified'}</td><td className="p-2"><button type="button" disabled={blocked || busy !== '' || !fileName} onClick={() => { setVerifyTarget(fileName); verifyBackup(fileName) }} className="rounded border border-sky-600 px-2 py-1 disabled:opacity-40">{busy === 'verify' && verifyTarget === fileName ? 'Checking…' : 'Verify'}</button></td></tr>
          })}</tbody></table></div>}
          <div className="mt-4 border-t border-slate-700 pt-3">
            <h3 className="text-sm font-semibold">Guarded restore drill (same PC)</h3>
            <p className="mt-1 text-xs text-slate-400">Restores the selected encrypted package into a disposable bundled PostgreSQL cluster on this PC, checks schema checksums and financial/security invariants, then removes the temporary cluster. The live database, the package and the configured backup folder are not modified. This is not an off-site restoration or a point-in-time recovery test.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="block text-xs">Backup package
                <select value={drillFileName} onChange={(event) => setDrillFileName(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm">
                  <option value="">Select a listed package</option>
                  {backups.map((backup, index) => {
                    const fileName = String(field(backup, 'file_name') ?? field(backup, 'filename') ?? field(backup, 'name') ?? '')
                    return fileName ? <option key={`${fileName}-${index}`} value={fileName}>{fileName}</option> : null
                  })}
                </select>
              </label>
              <label className="block text-xs">Authorised by
                <input maxLength={120} value={drillAuthorizedBy} onChange={(event) => setDrillAuthorizedBy(event.target.value)} placeholder="Owner or manager name" className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" />
              </label>
            </div>
            <label className="mt-2 block text-xs">Reason for drill
              <textarea maxLength={500} value={drillReason} onChange={(event) => setDrillReason(event.target.value)} placeholder="Why this package is being proven" className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" />
            </label>
            <label className="mt-2 block text-xs">Type RESTORE_DRILL to confirm
              <input value={drillConfirm} onChange={(event) => setDrillConfirm(event.target.value)} autoComplete="off" className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" />
            </label>
            <button type="button" disabled={blocked || busy !== '' || drillConfirm !== 'RESTORE_DRILL' || !drillFileName || drillAuthorizedBy.trim().length < 3 || drillReason.trim().length < 8} onClick={restoreDrill} className="mt-2 rounded border border-sky-600 px-4 py-2 text-sm disabled:opacity-40">{busy === 'restore-drill' ? 'Restoring into a disposable cluster…' : 'Run restore drill'}</button>
            {busy === 'restore-drill' && <p className="mt-2 text-xs text-slate-400">This can take several minutes. Keep the app and this PC powered until it finishes; closing the app does not cancel a running drill.</p>}
            {drillResult && <div className="mt-3 rounded border border-emerald-800 bg-emerald-950/40 p-3 text-xs">
              <p className="font-semibold text-emerald-200">Restore drill verified</p>
              <p className="mt-1 text-slate-200">{String(field(drillResult, 'message') ?? 'The package restored and passed verification.')}</p>
              <p className="mt-1 text-slate-300">Checks passed: {String(field(drillResult, 'checks', 'passed') ?? '—')} of {String(field(drillResult, 'checks', 'total') ?? '—')} · completed {String(field(drillResult, 'completed_at') ?? '—')}</p>
              <p className="mt-1 break-all text-slate-400">Evidence: {String(field(drillResult, 'evidence_path') ?? '—')}</p>
              <p className="mt-1 text-slate-400">Temporary cluster stopped: {field(drillResult, 'cleanup', 'cluster_stopped') === true ? 'yes' : 'no'} · temporary data removed: {field(drillResult, 'cleanup', 'data_removed') === true ? 'yes' : 'no'}</p>
            </div>}
            <p className="mt-2 text-xs text-slate-400">A failed drill leaves the package and backups untouched. Correct the reported cause, keep the failed package, and repeat the drill before relying on that package for recovery.</p>
          </div>
        </article>

        <article className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <h2 className="font-semibold">Replication</h2>
          <p className="mt-1 text-xs text-slate-400">Role, durability and replication health come from the local authority. Switchover is an irreversible operational action and needs an exact confirmation.</p>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Role</dt><dd className="mt-1">{String(field(replication, 'role') ?? '—')}</dd></div>
            <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Durability</dt><dd className="mt-1">{String(field(replication, 'durability') ?? field(replication, 'profile') ?? '—')}</dd></div>
            <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Status</dt><dd className="mt-1">{String(field(replication, 'status') ?? field(replication, 'state') ?? '—')}</dd></div>
            <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Lag</dt><dd className="mt-1">{String(field(replication, 'lag_commits') ?? field(replication, 'lag') ?? '—')}</dd></div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <input maxLength={40} value={durabilityProfile} onChange={(event) => setDurabilityProfile(event.target.value)} placeholder="Durability profile" className="min-w-40 flex-1 rounded bg-slate-800 p-2 text-sm" />
            <button type="button" disabled={blocked || busy !== ''} onClick={setDurability} className="rounded border border-sky-600 px-4 py-2 text-sm disabled:opacity-50">{busy === 'durability' ? 'Applying…' : 'Set durability'}</button>
          </div>
          <div className="mt-4 border-t border-slate-700 pt-3">
            <h3 className="text-sm font-semibold">Switch over replication</h3>
            <label className="mt-2 block text-xs">Type SWITCHOVER<input value={switchConfirm} onChange={(event) => setSwitchConfirm(event.target.value)} autoComplete="off" className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <label className="mt-2 block text-xs">Operational reason<textarea maxLength={500} value={switchReason} onChange={(event) => setSwitchReason(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <button type="button" disabled={blocked || busy !== '' || switchConfirm !== 'SWITCHOVER' || switchReason.trim().length < 3} onClick={switchover} className="mt-2 rounded border border-rose-600 px-4 py-2 text-sm text-rose-200 disabled:opacity-40">{busy === 'switchover' ? 'Switching…' : 'Confirm switchover'}</button>
            <p className="mt-2 text-xs text-slate-400">Do not switch over while sales are being committed. Recheck readiness and replication status before resuming trade.</p>
          </div>
        </article>
      </div>

      <article className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Cloud synchronisation</h2>
            <p className="mt-1 text-xs text-slate-400">Local PostgreSQL remains the financial authority. This section describes the durable outbox upload state. The highest acknowledged sequence can have gaps or pending work before it and does not confirm complete ingestion.</p>
          </div>
          <button type="button" disabled={blocked || busy !== '' || !cloudAvailable || cloudTransport === 'disabled'} onClick={() => void syncCloudNow()} className="rounded bg-sky-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy === 'cloud-run' ? 'Uploading…' : 'Sync now'}</button>
        </div>
        {cloudLoadError && <p role="alert" className="mt-3 rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-100">Cloud synchronisation status is unavailable: {cloudLoadError} No conclusion can be drawn about uploads from this screen.</p>}
        {cloudSync && !cloudAvailable && <p role="status" className="mt-3 rounded border border-slate-700 bg-slate-950 p-2 text-xs text-slate-300">The upload worker is not running in this process, so upload state cannot be inspected here.</p>}
        {cloudSync && <p role="note" className={`mt-3 rounded border p-2 text-xs ${cloudTransport === 'disabled' ? 'border-slate-700 bg-slate-950 text-slate-300' : 'border-sky-800 bg-sky-950/40 text-sky-100'}`}>{cloudTransportNote}</p>}
        {cloudAvailable && field(cloudSync, 'signing_secret_configured') !== true && <p role="alert" className="mt-2 rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-100">This Bar server has no cloud signing secret configured. Upload attempts fail closed and nothing is sent; local trade is unaffected. Your Bar server administrator must provision the secret outside the till.</p>}
        {cloudAvailable && <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Configured</dt><dd className="mt-1">{field(cloudSync, 'configured') === true ? 'Yes' : 'No'}</dd></div>
          <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Upload enabled</dt><dd className="mt-1">{field(cloudSync, 'enabled') === true ? 'Yes' : 'No'}</dd></div>
          <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Signing secret</dt><dd className="mt-1">{field(cloudSync, 'signing_secret_configured') === true ? 'Configured' : 'Missing'}</dd></div>
          <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Schedule</dt><dd className="mt-1">{field(cloudSync, 'schedule_mode') === 'daily' ? `Daily at ${String(field(cloudSync, 'daily_at') ?? '—')}` : 'Every 15 minutes'}</dd></div>
          <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Pending events</dt><dd className="mt-1">{String(field(cloudSync, 'pending_events') ?? '—')}</dd></div>
          <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Prepared batches</dt><dd className="mt-1">{String(field(cloudSync, 'prepared_batches') ?? '—')}</dd></div>
          <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Failed batches</dt><dd className={`mt-1 ${Number(field(cloudSync, 'failed_batches') ?? 0) > 0 ? 'text-rose-300' : ''}`}>{String(field(cloudSync, 'failed_batches') ?? '—')}</dd></div>
          <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Highest acknowledged sequence</dt><dd className="mt-1">{String(field(cloudSync, 'acknowledged_watermark') ?? '—')}</dd></div>
          <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Last checked</dt><dd className="mt-1 break-all font-mono text-xs">{String(field(cloudSync, 'last_check_at') ?? '—')}</dd></div>
          <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Last success</dt><dd className="mt-1 break-all font-mono text-xs">{String(field(cloudSync, 'last_success_at') ?? '—')}</dd></div>
          <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Next due</dt><dd className="mt-1 break-all font-mono text-xs">{String(field(cloudSync, 'next_due_at') ?? '—')}</dd></div>
          <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Cash-up final sync</dt><dd className="mt-1">{String(field(cloudSync, 'last_final_sync_state') ?? '—')} · {String(field(cloudSync, 'last_final_sync_at') ?? 'not requested')}</dd></div>
        </dl>}
        {cloudAvailable && field(cloudSync, 'last_error_code') !== null && field(cloudSync, 'last_error_code') !== undefined && <p role="alert" className="mt-2 rounded border border-rose-800 bg-rose-950/40 p-2 text-xs text-rose-100">Last upload failure {String(field(cloudSync, 'last_error_code'))}: {String(field(cloudSync, 'last_error_message') ?? 'no detail was returned')}. Pending work is retained and will retry; local trade is unaffected.</p>}
        {cloudAvailable && cloudLatestBatch && <p className="mt-2 rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-300">Latest batch {String(field(cloudLatestBatch, 'batch_id') ?? '—')} · {String(field(cloudLatestBatch, 'status') ?? '—')} · {String(field(cloudLatestBatch, 'transport_status') ?? '—')} · {String(field(cloudLatestBatch, 'attempts') ?? '0')} attempt(s) · {field(cloudLatestBatch, 'acknowledged_at') ? `acknowledged ${String(field(cloudLatestBatch, 'acknowledged_at'))}` : 'not acknowledged'}</p>}
        {cloudAvailable && <div className="mt-4 border-t border-slate-700 pt-3">
          <h3 className="text-sm font-semibold">Upload configuration</h3>
          <p className="mt-1 text-xs text-slate-400">Leave the receiver URL and signing key identifier blank to keep the values already committed on the Bar server. Enabling upload requires both to be present; the service still fails closed without its signing secret.</p>
          <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={cloudEnabled} onChange={(event) => setCloudEnabled(event.target.checked)} />Enable cloud upload on the designated Bar server</label>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs">New receiver URL<input maxLength={500} value={cloudReceiverUrl} onChange={(event) => setCloudReceiverUrl(event.target.value)} placeholder={typeof field(cloudSync, 'receiver_url') === 'string' ? `Current: ${String(field(cloudSync, 'receiver_url'))}` : 'https://receiver.example/bar-local'} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <label className="text-xs">New signing key identifier<input maxLength={120} value={cloudSigningKeyId} onChange={(event) => setCloudSigningKeyId(event.target.value)} placeholder={typeof field(cloudSync, 'signing_key_id') === 'string' ? `Current: ${String(field(cloudSync, 'signing_key_id'))}` : 'e.g. bar-prod-1'} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <label className="text-xs">Schedule<select value={cloudScheduleMode} onChange={(event) => setCloudScheduleMode(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm"><option value="fifteen_minutes">Every 15 minutes</option><option value="daily">Once daily</option></select></label>
            <label className="text-xs">Daily time (HH:MM)<input maxLength={5} value={cloudDailyAt} onChange={(event) => setCloudDailyAt(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
            <label className="text-xs">Batch limit per pass<input inputMode="numeric" value={cloudBatchLimit} onChange={(event) => setCloudBatchLimit(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
          </div>
          <button type="button" disabled={blocked || busy !== ''} onClick={saveCloudSyncConfig} className="mt-3 rounded bg-sky-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy === 'cloud-config' ? 'Saving…' : 'Save upload settings'}</button>
        </div>}
      </article>

      <article className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h2 className="font-semibold">Offline service update</h2>
        <p className="mt-1 text-xs text-slate-400">Copy the signed release package folder into the service update inbox shown below, then refresh this panel. Staging verifies its Ed25519 signature and service, schema, and contract compatibility. Applying requires an authorised operator, no unresolved financial work, and an encrypted checkpoint.</p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Service version</dt><dd className="mt-1 break-all font-mono text-xs">{String(field(update, 'service_version') ?? '—')}</dd></div>
          <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Schema version</dt><dd className="mt-1 break-all font-mono text-xs">{String(field(update, 'schema_migration') ?? '—')}</dd></div>
          <div className="rounded border border-slate-800 bg-slate-950 p-2"><dt className="text-xs text-slate-400">Pinned signing key</dt><dd className="mt-1">{field(update, 'trust', 'configured') === true ? `Configured (${String(field(update, 'trust', 'key_id') ?? 'key ID unavailable')})` : 'Not configured'}</dd></div>
        </dl>
        <p className="mt-3 rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-300">Select the signed release package folder from an offline drive. The app copies it into this service inbox without following links: <span className="break-all font-mono">{String(field(update, 'inbox_dir') ?? 'unavailable')}</span></p>
        <button type="button" disabled={blocked || busy !== '' || field(update, 'restart_required') === true} onClick={() => void importOfflineUpdate()} className="mt-3 rounded border border-slate-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy === 'update-import' ? 'Copying package…' : 'Choose offline package folder'}</button>
        {field(update, 'inbox_error') && <p role="alert" className="mt-2 rounded border border-rose-800 bg-rose-950/40 p-2 text-xs text-rose-100">{String(field(update, 'inbox_error'))}</p>}
        {field(update, 'staged_error_code') && <p role="alert" className="mt-2 rounded border border-rose-800 bg-rose-950/40 p-2 text-xs text-rose-100">Staged-package check failed ({String(field(update, 'staged_error_code'))}). {String(field(update, 'staged_message') ?? 'Refresh status and verify the package before retrying.')}</p>}
        {field(update, 'lock_present') === true && <p role="alert" className="mt-2 rounded border border-amber-800 bg-amber-950/40 p-2 text-xs text-amber-100">An update operation lock is present. Wait for the operation to finish; if interrupted, inspect service status and the recovery report before any retry.</p>}
        {field(update, 'restart_required') === true && <p role="alert" className="mt-2 rounded border border-amber-800 bg-amber-950/40 p-2 text-xs text-amber-100">{field(update, 'restart_scheduled') === true ? 'The installed service is restarting with the new files. Wait until it is ready, refresh this panel, and confirm the service version before trading.' : 'Updated files are installed but the service is still running its previous version. An owner must restart the Bar service from Windows Services, then confirm readiness before trading.'}</p>}
        {Array.isArray(field(update, 'inbox')) && <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <label className="text-xs">Signed package in inbox<select value={updatePackageName} onChange={(event) => setUpdatePackageName(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm">
            <option value="">Choose package</option>
            {/** @type {Array<Record<string, unknown>>} */ (field(update, 'inbox')).map((entry) => <option key={String(entry.package)} value={String(entry.package)}>{String(entry.package)}{entry.version ? ` · v${String(entry.version)}` : ''}{entry.error ? ` · ${String(entry.error)}` : ''}</option>)}
          </select></label>
          <button type="button" disabled={blocked || busy !== '' || field(update, 'restart_required') === true || field(update, 'lock_present') === true || !updatePackageName || field(update, 'trust', 'configured') !== true} onClick={stageOfflineUpdate} className="self-end rounded bg-sky-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy === 'update-stage' ? 'Checking signature…' : 'Verify and stage'}</button>
        </div>}
        <p className="mt-3 rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-300">{String(field(update, 'message') ?? 'The local authority has not returned update status.')}{field(update, 'staged_message') ? ` ${String(field(update, 'staged_message'))}` : ''}</p>
        {field(update, 'staged') && <div className="mt-3 rounded border border-emerald-800 bg-emerald-950/30 p-3 text-xs text-emerald-100"><strong>Verified package staged:</strong> {String(field(update, 'staged', 'package'))} · version {String(field(update, 'staged', 'version'))} · signer {String(field(update, 'staged', 'signature_key_id'))}</div>}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs">Authorised by<input maxLength={120} value={updateAuthorizedBy} onChange={(event) => setUpdateAuthorizedBy(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
          <label className="text-xs">Reason for update<input maxLength={500} minLength={8} value={updateReason} onChange={(event) => setUpdateReason(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
          <label className="text-xs">Type APPLY_UPDATE to confirm<input maxLength={40} value={updateApplyConfirm} onChange={(event) => setUpdateApplyConfirm(event.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2 text-sm" /></label>
          <button type="button" disabled={blocked || busy !== '' || field(update, 'restart_required') === true || field(update, 'staged_state') !== 'staged' || field(update, 'lock_present') === true || field(update, 'apply_enabled') !== true || updateApplyConfirm !== 'APPLY_UPDATE' || updateAuthorizedBy.trim().length < 3 || updateReason.trim().length < 8} onClick={applyOfflineUpdate} className="self-end rounded bg-amber-700 px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy === 'update-apply' ? 'Applying update…' : 'Apply staged update'}</button>
        </div>
        {field(update, 'last_apply') && <p className="mt-3 rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-300">Last apply report: {String(field(update, 'last_apply', 'status') ?? field(update, 'last_apply', 'version') ?? 'available for review')} · checkpoint {String(field(update, 'last_apply', 'checkpoint_path') ?? 'details held by service')}</p>}
        {field(update, 'last_failure') && <div role="alert" className="mt-3 rounded border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-100"><strong>Last apply attempt needs review · {String(field(update, 'last_failure', 'code') ?? 'UPDATE_FAILED')}</strong><p className="mt-1">{String(field(update, 'last_failure', 'message') ?? 'The service recorded an interrupted update attempt.')}</p><p className="mt-1">Checkpoint: <span className="break-all font-mono">{String(field(update, 'last_failure', 'checkpoint_path') ?? 'none recorded')}</span></p><p className="mt-1">{String(field(update, 'last_failure', 'recovery') ?? 'Preserve the staged package and checkpoint. Check service health before retrying or restoring.')}</p></div>}
        {field(update, 'apply_enabled') !== true && <p className="mt-2 text-xs text-amber-200">Applying is disabled by the service until update signing and checkpoint recovery are configured and qualified.</p>}
      </article>
    </section>
  )
}
