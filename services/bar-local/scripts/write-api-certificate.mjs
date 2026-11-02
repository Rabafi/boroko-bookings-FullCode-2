// Private key material is accepted on stdin only; stdout contains public identity.
import { createPrivateKey, X509Certificate } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? '')
const certFile = path.join(root, 'api.crt'), keyFile = path.join(root, 'api.key')
if (process.argv[3] !== '--inspect') {
  let input = ''
  for await (const chunk of process.stdin) {
    input += chunk
    if (input.length > 32768) throw new Error('Certificate input exceeds its bound.')
  }
  const body = JSON.parse(input)
  const cert = new X509Certificate(Buffer.from(body.certificate, 'base64'))
  const key = createPrivateKey({ key: body.jwk, format: 'jwk' })
  if (!cert.checkPrivateKey(key)) throw new Error('Certificate and private key do not match.')
  writeFileSync(certFile, cert.toString(), { mode: 0o600, flag: 'wx' })
  writeFileSync(keyFile, key.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' })
}
const cert = new X509Certificate(readFileSync(certFile))
if (!cert.checkPrivateKey(createPrivateKey(readFileSync(keyFile))) || Date.parse(cert.validTo) <= Date.now() + 86400000) {
  throw new Error('The saved API certificate is incomplete, mismatched or expired. Preserve its identity and use certificate recovery.')
}
process.stdout.write(JSON.stringify({ fingerprint: cert.fingerprint256.replaceAll(':', '').toLowerCase(), expires_at: new Date(cert.validTo).toISOString() }))
