import { networkInterfaces } from 'node:os'

export function privateIpv4(value: string): boolean {
  const parts = value.split('.').map(Number)
  return parts.length === 4 && parts.every(v => Number.isInteger(v) && v >= 0 && v <= 255)
    && (parts[0] === 10 || parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31 || parts[0] === 192 && parts[1] === 168)
}

export function lanEndpoints(host: string, port: number, tls: boolean, interfaces = networkInterfaces()): string[] {
  if (!tls || host === '127.0.0.1' || host === 'localhost' || host === '::1') return []
  return [...new Set(Object.values(interfaces).flatMap(rows => rows ?? [])
    .filter(row => row.family === 'IPv4' && !row.internal && privateIpv4(row.address)
      && (host === '0.0.0.0' || host === '::' || host === row.address))
    .map(row => `https://${row.address}:${port}`))].sort()
}
