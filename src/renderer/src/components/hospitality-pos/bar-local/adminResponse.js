// @ts-check

/** @param {unknown} value @returns {Record<string, unknown>|null} */
function objectValue(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : null
}

/** @param {unknown} response */
export function adminStatusPayload(response) {
  const envelope = objectValue(response)
  return objectValue(envelope?.status) ?? envelope ?? {}
}

/** @param {unknown} response @returns {Array<[string, string]>} */
export function adminNetworkRows(response) {
  const status = adminStatusPayload(response)
  const network = objectValue(status.network)
  if (!network) return []
  const address = objectValue(network.address)
  const service = objectValue(network.service)
  const database = objectValue(network.database)
  const databaseMetadata = objectValue(status.database)
  const tls = objectValue(network.tls)
  const writeAuthority = objectValue(network.write_authority)
  const capabilities = objectValue(network.capabilities)
  const automaticFailover = objectValue(capabilities?.automatic_failover)
  /** @param {unknown} value */
  const display = (value) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : ''
  const endpoint = address
    ? `${display(address.host)}${address.port == null ? '' : `:${display(address.port)}`} · ${display(address.scope) || 'scope unknown'}`
    : ''
  const serviceProbe = service
    ? `${service.reachable === true ? 'endpoint reachable' : service.requested === false ? 'not configured' : 'endpoint unreachable'} · liveness ${service.live === true ? 'live' : service.requested === false ? 'not configured' : 'unverified'} · readiness ${display(service.readiness) || 'unknown'}${service.readiness_status_code == null ? '' : ` (HTTP ${display(service.readiness_status_code)})`}`
    : ''
  const databaseState = database
    ? `${display(database.status) || (database.reachable === true ? 'reachable' : 'unknown')}${display(databaseMetadata?.database) ? ` · ${display(databaseMetadata.database)}` : ''}`
    : ''
  const tlsState = tls
    ? tls.enabled === true
      ? `enabled${tls.expired === true ? ' · expired' : tls.expired === false ? ' · current' : ''}`
      : 'not configured'
    : ''
  const writeState = writeAuthority
    ? `${writeAuthority.granted === true ? 'granted' : 'blocked'}${display(writeAuthority.basis) ? ` · ${display(writeAuthority.basis)}` : ''}`
    : ''
  const failoverState = automaticFailover
    ? `${display(automaticFailover.status) || 'unknown'}${display(automaticFailover.detail) ? ` · ${display(automaticFailover.detail)}` : ''}`
    : ''
  return [
    ['Client endpoint', endpoint],
    ['Service probe', serviceProbe],
    ['Database', databaseState],
    ['TLS', tlsState],
    ['Write authority', writeState],
    ['Automatic failover', failoverState]
  ].filter(([, value]) => value !== '')
}

/** @param {unknown} response */
export function adminReplicationPayload(response) {
  const envelope = objectValue(response)
  return objectValue(envelope?.replication) ?? envelope ?? {}
}

/** @param {unknown} response @returns {Array<Record<string, unknown>>} */
export function adminBackupPackages(response) {
  const envelope = objectValue(response)
  const data = objectValue(envelope?.data)
  for (const candidate of [envelope?.packages, envelope?.backups, envelope?.items, data?.packages, data?.backups, data?.items]) {
    if (Array.isArray(candidate)) {
      return candidate.filter((value) => objectValue(value) !== null)
    }
  }
  return []
}
