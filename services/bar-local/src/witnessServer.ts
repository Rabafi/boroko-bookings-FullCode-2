import http from 'node:http'
import https from 'node:https'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadWitnessConfig } from './config.js'
import type { WitnessServerSettings } from './config.js'
import { createWitnessRequestHandler, WitnessStore } from './operations/witness.js'

export interface WitnessLogger {
  info?(record: Record<string, unknown>): void
  error?(record: Record<string, unknown>): void
}

function readRawBody(req: IncomingMessage, limitBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limitBytes) {
        reject(Object.assign(new Error('The witness request body is too large.'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function createWitnessServer(config: WitnessServerSettings, store: WitnessStore, logger: WitnessLogger = console): http.Server | https.Server {
  const handle = createWitnessRequestHandler({
    store,
    key: config.secret as string,
    clusterId: config.clusterId as string,
    maxLeaseTtlMs: config.maxLeaseTtlMs,
    logger
  })
  const listener = (req: IncomingMessage, res: ServerResponse): void => {
    const started = Date.now()
    const url = new URL(req.url || '/', 'http://witness.local')
    res.on('finish', () => {
      logger.info?.({
        event: 'bar_local.witness.request',
        method: req.method,
        path: url.pathname,
        status: res.statusCode,
        duration_ms: Date.now() - started
      })
    })
    void (async () => {
      try {
        const handled = await handle(req, res, url, () => readRawBody(req, config.http.bodyLimitBytes))
        if (handled) return
      } catch (error) {
        logger.error?.({
          event: 'bar_local.witness.request_failed',
          path: url.pathname,
          message: error instanceof Error ? error.message : 'Unknown witness failure.'
        })
        if (!res.headersSent) {
          const payload = JSON.stringify({ ok: false, code: 'WITNESS_INTERNAL', message: 'The witness could not complete the request.' })
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) })
          res.end(payload)
        }
        return
      }
      const payload = JSON.stringify({ ok: false, code: 'WITNESS_ROUTE_NOT_FOUND', message: 'No such witness route.' })
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) })
      res.end(payload)
    })()
  }
  const server = config.http.tls
    ? https.createServer({
        key: readFileSync(config.http.tls.keyFile),
        cert: readFileSync(config.http.tls.certFile),
        minVersion: 'TLSv1.2'
      }, listener)
    : http.createServer(listener)
  server.requestTimeout = config.http.requestTimeoutMs
  server.headersTimeout = Math.min(config.http.requestTimeoutMs, 15000)
  server.keepAliveTimeout = 5000
  server.maxHeadersCount = 50
  return server
}

export interface StartWitnessOptions {
  config?: WitnessServerSettings
  store?: WitnessStore
  logger?: WitnessLogger
  port?: number
}

export async function startWitnessServer(options: StartWitnessOptions = {}) {
  const config = options.config ?? loadWitnessConfig()
  const logger = options.logger ?? console
  const store = options.store ?? WitnessStore.open(config.stateFile, config.clusterId as string)
  const server = createWitnessServer(config, store, logger)
  const port = options.port ?? config.http.port
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, config.http.host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  logger.info?.({
    event: 'bar_local.witness.started',
    host: config.http.host,
    port,
    tls: Boolean(config.http.tls),
    cluster_id: config.clusterId,
    epoch: store.snapshot().epoch
  })
  return {
    server,
    store,
    config,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

const entry = process.argv[1]
const isEntryPoint = Boolean(entry) && import.meta.url === pathToFileURL(entry as string).href

if (isEntryPoint) {
  let running: Awaited<ReturnType<typeof startWitnessServer>> | undefined
  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.info(JSON.stringify({ event: 'bar_local.witness.stopping', signal }))
    try {
      await running?.close()
      process.exitCode = 0
    } catch (error) {
      console.error(JSON.stringify({ event: 'bar_local.witness.stop_failed', message: error instanceof Error ? error.message : String(error) }))
      process.exitCode = 1
    }
  }
  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  try {
    running = await startWitnessServer()
  } catch (error) {
    console.error(JSON.stringify({ event: 'bar_local.witness.start_failed', message: error instanceof Error ? error.message : String(error) }))
    process.exitCode = 1
  }
}
