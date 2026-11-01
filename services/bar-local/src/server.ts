import http from 'node:http'
import https from 'node:https'
import type { RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { drainRecoveryJobs, startRecoverySchedule } from './operations/recoveryJobs.js'
import { loadConfig } from './config.js'
import type { ServiceConfig } from './config.js'
import { createPool, closePool } from './db.js'
import type { JsonRecord } from './db.js'
import { createApp } from './app.js'
import { createCloudSyncController } from './operations/cloudSync.js'
import { createFailoverController } from './operations/failover.js'

export interface ServiceLogger {
  info?(record: JsonRecord): void
  error?(record: JsonRecord): void
}

export function createHttpServer(config: ServiceConfig, app: RequestListener): http.Server | https.Server {
  const server = config.http.tls
    ? https.createServer({
        key: readFileSync(config.http.tls.keyFile),
        cert: readFileSync(config.http.tls.certFile),
        minVersion: 'TLSv1.2'
      }, app)
    : http.createServer(app)
  server.requestTimeout = config.http.requestTimeoutMs
  server.headersTimeout = Math.min(config.http.requestTimeoutMs, 15000)
  server.keepAliveTimeout = 5000
  server.maxHeadersCount = 50
  return server
}

export interface StartServerOptions {
  config?: ServiceConfig
  logger?: ServiceLogger
  port?: number
  requestRestart?: (() => void) | null
}

export async function startServer(options: StartServerOptions = {}) {
  const config = options.config ?? loadConfig()
  // The current witness controller cannot yet fence every write path or prove
  // that an admitted transaction finishes before a lease expires. Refuse the
  // entire witness mode before opening a database connection or listening.
  if (config.failover.mode === 'witness') {
    throw new Error('Witness automatic failover is unavailable until transaction fencing and promotion safety are verified. Use the separately controlled recovery procedure.')
  }
  const logger = options.logger ?? console
  const port = options.port ?? config.http.port
  const pool = createPool(config)
  const cloudSync = createCloudSyncController({ config, pool, logger })
  const failover = createFailoverController({ config, pool, logger })
  const app = createApp({ config, pool, logger, cloudSync, failover, requestRestart: options.requestRestart })
  const server = createHttpServer(config, app)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, config.http.host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  cloudSync.start()
  failover.start()
  const stopRecoverySchedule = startRecoverySchedule(config, logger)
  const address = server.address()
  logger.info?.({
    event: 'service.started',
    host: config.http.host,
    port: typeof address === 'object' && address ? address.port : port,
    tls: Boolean(config.http.tls),
    version: config.service.version,
    failover_mode: config.failover.mode,
    failover_role: config.failover.role,
    write_gate_open: failover.gate.allowWrites()
  })
  return {
    server,
    pool,
    config,
    address,
    failover,
    async close(): Promise<void> {
      stopRecoverySchedule()
      await drainRecoveryJobs()
      await failover.stop()
      await cloudSync.stop()
      const closed = new Promise<void>((resolve) => server.close(() => resolve()))
      await closed
      await closePool(pool)
    }
  }
}

const entry = process.argv[1]
const isEntryPoint = Boolean(entry) && import.meta.url === pathToFileURL(entry as string).href

if (isEntryPoint) {
  let running: Awaited<ReturnType<typeof startServer>> | undefined
  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.info(JSON.stringify({ event: 'service.stopping', signal }))
    try {
      await running?.close()
      process.exitCode = 0
    } catch (error) {
      console.error(JSON.stringify({ event: 'service.stop_failed', message: error instanceof Error ? error.message : String(error) }))
      process.exitCode = 1
    }
  }
  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  try {
    running = await startServer({ requestRestart: () => { void shutdown('UPDATE_APPLY') } })
  } catch (error) {
    console.error(JSON.stringify({ event: 'service.start_failed', message: error instanceof Error ? error.message : String(error) }))
    process.exitCode = 1
  }
}
