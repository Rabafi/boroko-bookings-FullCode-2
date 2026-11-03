import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { BarLocalError, BAR_LOCAL_ERROR_CODES } from '@tsa-bonno/bar-contracts'

const MAX_CORRELATION_LENGTH = 100

export type JsonObject = Record<string, unknown>

export function correlationId(req: IncomingMessage): string {
  const supplied = req.headers['x-correlation-id']
  if (typeof supplied === 'string' && supplied.length > 0 && supplied.length <= MAX_CORRELATION_LENGTH) {
    return supplied
  }
  return randomUUID()
}

export function sendJson(res: ServerResponse, status: number, body: JsonObject, id: string): void {
  const payload = JSON.stringify({ ...body, correlation_id: id })
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Correlation-Id': id
  })
  res.end(payload)
}

export function sendError(res: ServerResponse, error: unknown, id: string): void {
  const normalized = error instanceof BarLocalError
    ? error
    : new BarLocalError(BAR_LOCAL_ERROR_CODES.INTERNAL_ERROR, 'The local Bar service could not complete the request.', { cause: error })
  sendJson(res, normalized.httpStatus, normalized.toResponse(id) as unknown as JsonObject, id)
}

function assertNoDuplicateKeys(text: string): void {
  const frames: Array<{ keys: Set<string> | null; expectingKey: boolean }> = []
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character === '"') {
      const start = index
      index += 1
      while (index < text.length) {
        if (text[index] === '\\') {
          index += 2
          continue
        }
        if (text[index] === '"') break
        index += 1
      }
      index += 1
      const current = frames[frames.length - 1]
      if (current?.keys && current.expectingKey) {
        let key: string
        try {
          key = JSON.parse(text.slice(start, index)) as string
        } catch {
          continue
        }
        if (current.keys.has(key)) {
          throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `The request body contains the duplicate object key "${key}".`)
        }
        current.keys.add(key)
        current.expectingKey = false
      }
      continue
    }
    if (character === '{') {
      frames.push({ keys: new Set(), expectingKey: true })
      index += 1
      continue
    }
    if (character === '[') {
      frames.push({ keys: null, expectingKey: false })
      index += 1
      continue
    }
    if (character === ']' || character === '}') {
      frames.pop()
      index += 1
      continue
    }
    if (character === ',') {
      const current = frames[frames.length - 1]
      if (current?.keys) current.expectingKey = true
    }
    index += 1
  }
}

export async function readJsonWithText(req: IncomingMessage, options: { limitBytes: number }): Promise<{ value: JsonObject; rawText: string }> {
  const type = String(req.headers['content-type'] || '')
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'Content-Type must be application/json.', { httpStatus: 415 })
  }
  const declared = Number(req.headers['content-length'] || 0)
  if (Number.isFinite(declared) && declared > options.limitBytes) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'The request body is too large.', { httpStatus: 413 })
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > options.limitBytes) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'The request body is too large.', { httpStatus: 413 })
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'A JSON request body is required.')
  }
  assertNoDuplicateKeys(text)
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'The request body is not valid JSON.')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'The request body must be a JSON object.')
  }
  return { value: parsed as JsonObject, rawText: text }
}

export async function readJson(req: IncomingMessage, options: { limitBytes: number }): Promise<JsonObject> {
  return (await readJsonWithText(req, options)).value
}

export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization
  if (typeof header !== 'string') return null
  const match = /^Bearer\s+([A-Za-z0-9._~-]+)$/.exec(header.trim())
  return match?.[1] ?? null
}

export function deviceIdHeader(req: IncomingMessage): string | null {
  const value = req.headers['x-bar-device-id']
  return typeof value === 'string' ? value.trim() : null
}

export function deviceTokenHeader(req: IncomingMessage): string | null {
  const value = req.headers['x-bar-device-token']
  return typeof value === 'string' ? value.trim() : null
}

export function isLoopbackRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress || ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

export function applyCors(req: IncomingMessage, res: ServerResponse, allowedOrigins: readonly string[]): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  if (typeof origin !== 'string' || !allowedOrigins.includes(origin)) return false
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Bar-Device-Id, X-Bar-Device-Token, X-Correlation-Id')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Max-Age', '600')
  return true
}
