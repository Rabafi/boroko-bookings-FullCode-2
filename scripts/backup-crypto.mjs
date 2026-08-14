import {
  constants,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes
} from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const MAGIC = Buffer.from('TSABONNO-BACKUP-V1\n', 'utf8')
const HEADER_LENGTH_BYTES = 4
const AUTH_TAG_BYTES = 16

function requireValue(value, label) {
  if (!value) throw new Error(`${label} is required.`)
  return value
}

async function writeChunk(stream, chunk) {
  if (!chunk || chunk.length === 0) return
  if (stream.write(chunk)) return
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.removeListener('drain', onDrain)
      stream.removeListener('error', onError)
    }
    const onDrain = () => {
      cleanup()
      resolve()
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    stream.once('drain', onDrain)
    stream.once('error', onError)
  })
}

async function closeWritable(stream) {
  await new Promise((resolve, reject) => {
    stream.once('finish', resolve)
    stream.once('error', reject)
    stream.end()
  })
}

async function removePartial(filePath) {
  await fs.rm(filePath, { force: true }).catch(() => {})
}

export function generateBackupKeyPair(passphrase) {
  requireValue(passphrase, 'A private-key passphrase')
  return generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase
    }
  })
}

export async function encryptBackupFile({ inputPath, outputPath, publicKeyPem }) {
  requireValue(inputPath, 'Input path')
  requireValue(outputPath, 'Output path')
  requireValue(publicKeyPem, 'Backup public key')

  const source = await fs.stat(inputPath)
  if (!source.isFile() || source.size <= 0) throw new Error('Backup input must be a non-empty file.')

  const dataKey = randomBytes(32)
  const iv = randomBytes(12)
  const encryptedKey = publicEncrypt({
    key: publicKeyPem,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256'
  }, dataKey)
  const header = Buffer.from(JSON.stringify({
    version: 1,
    algorithm: 'AES-256-GCM',
    key_wrap: 'RSA-OAEP-SHA256',
    encrypted_key: encryptedKey.toString('base64'),
    iv: iv.toString('base64'),
    original_name: path.basename(inputPath),
    original_size: source.size,
    created_at: new Date().toISOString()
  }), 'utf8')
  const headerLength = Buffer.alloc(HEADER_LENGTH_BYTES)
  headerLength.writeUInt32BE(header.length)

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const output = createWriteStream(outputPath, { flags: 'wx' })
  const cipher = createCipheriv('aes-256-gcm', dataKey, iv)
  cipher.setAAD(Buffer.concat([MAGIC, headerLength, header]))

  try {
    await writeChunk(output, MAGIC)
    await writeChunk(output, headerLength)
    await writeChunk(output, header)
    for await (const chunk of createReadStream(inputPath)) {
      await writeChunk(output, cipher.update(chunk))
    }
    await writeChunk(output, cipher.final())
    await writeChunk(output, cipher.getAuthTag())
    await closeWritable(output)
    return { outputPath, originalSize: source.size }
  } catch (error) {
    output.destroy()
    await removePartial(outputPath)
    throw error
  } finally {
    dataKey.fill(0)
  }
}

export async function decryptBackupFile({ inputPath, outputPath, privateKeyPem, passphrase }) {
  requireValue(inputPath, 'Encrypted input path')
  requireValue(outputPath, 'Output path')
  requireValue(privateKeyPem, 'Backup private key')
  requireValue(passphrase, 'Private-key passphrase')

  const source = await fs.stat(inputPath)
  const minimumSize = MAGIC.length + HEADER_LENGTH_BYTES + AUTH_TAG_BYTES + 1
  if (!source.isFile() || source.size < minimumSize) throw new Error('Encrypted backup is truncated.')

  const handle = await fs.open(inputPath, 'r')
  let header
  let ciphertextStart
  let authTag
  try {
    const prefix = Buffer.alloc(MAGIC.length + HEADER_LENGTH_BYTES)
    await handle.read(prefix, 0, prefix.length, 0)
    if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a Tsa Bonno encrypted backup.')
    const headerSize = prefix.readUInt32BE(MAGIC.length)
    if (headerSize <= 0 || headerSize > 64 * 1024) throw new Error('Encrypted backup header is invalid.')
    ciphertextStart = prefix.length + headerSize
    if (ciphertextStart + AUTH_TAG_BYTES >= source.size) throw new Error('Encrypted backup payload is truncated.')
    const headerBuffer = Buffer.alloc(headerSize)
    await handle.read(headerBuffer, 0, headerSize, prefix.length)
    header = JSON.parse(headerBuffer.toString('utf8'))
    authTag = Buffer.alloc(AUTH_TAG_BYTES)
    await handle.read(authTag, 0, AUTH_TAG_BYTES, source.size - AUTH_TAG_BYTES)
  } finally {
    await handle.close()
  }

  if (header?.version !== 1 || header?.algorithm !== 'AES-256-GCM') {
    throw new Error('Encrypted backup format is unsupported.')
  }

  const dataKey = privateDecrypt({
    key: privateKeyPem,
    passphrase,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256'
  }, Buffer.from(header.encrypted_key, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(header.iv, 'base64'))
  const encodedHeader = Buffer.from(JSON.stringify(header), 'utf8')
  const encodedHeaderLength = Buffer.alloc(HEADER_LENGTH_BYTES)
  encodedHeaderLength.writeUInt32BE(encodedHeader.length)
  decipher.setAAD(Buffer.concat([MAGIC, encodedHeaderLength, encodedHeader]))
  decipher.setAuthTag(authTag)

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const output = createWriteStream(outputPath, { flags: 'wx' })
  try {
    const ciphertextEnd = source.size - AUTH_TAG_BYTES - 1
    for await (const chunk of createReadStream(inputPath, { start: ciphertextStart, end: ciphertextEnd })) {
      await writeChunk(output, decipher.update(chunk))
    }
    await writeChunk(output, decipher.final())
    await closeWritable(output)
    const restored = await fs.stat(outputPath)
    if (Number.isFinite(header.original_size) && restored.size !== header.original_size) {
      throw new Error('Decrypted backup size does not match its authenticated header.')
    }
    return { outputPath, originalName: header.original_name, restoredSize: restored.size }
  } catch (error) {
    output.destroy()
    await removePartial(outputPath)
    throw error
  } finally {
    dataKey.fill(0)
  }
}

function parseOptions(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index]
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`)
    const name = token.slice(2)
    const value = values[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}.`)
    result[name] = value
    index += 1
  }
  return result
}

async function promptSecret(label) {
  if (!process.stdin.isTTY) throw new Error(`${label} must be provided through TSA_BONNO_BACKUP_KEY_PASSPHRASE.`)
  process.stdout.write(label)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  return await new Promise((resolve, reject) => {
    let value = ''
    const finish = () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onData)
      process.stdout.write('\n')
      resolve(value)
    }
    const onData = (character) => {
      if (character === '\u0003') {
        process.stdin.setRawMode(false)
        process.stdin.pause()
        reject(new Error('Cancelled.'))
      } else if (character === '\r' || character === '\n') {
        finish()
      } else if (character === '\u007f' || character === '\b') {
        value = value.slice(0, -1)
      } else {
        value += character
      }
    }
    process.stdin.on('data', onData)
  })
}

async function getPassphrase({ confirm = false } = {}) {
  const configured = process.env.TSA_BONNO_BACKUP_KEY_PASSPHRASE
  if (configured) return configured
  const first = await promptSecret('Private-key passphrase: ')
  if (!confirm) return first
  const second = await promptSecret('Confirm private-key passphrase: ')
  if (first !== second) throw new Error('Passphrases do not match.')
  return first
}

async function runCli() {
  const [command, ...rawOptions] = process.argv.slice(2)
  const options = parseOptions(rawOptions)
  if (command === 'generate') {
    const publicKeyPath = requireValue(options['public-key'], '--public-key')
    const privateKeyPath = requireValue(options['private-key'], '--private-key')
    const passphrase = await getPassphrase({ confirm: true })
    if (passphrase.length < 12) throw new Error('Use a private-key passphrase of at least 12 characters.')
    const pair = generateBackupKeyPair(passphrase)
    await fs.mkdir(path.dirname(publicKeyPath), { recursive: true })
    await fs.mkdir(path.dirname(privateKeyPath), { recursive: true })
    await fs.writeFile(publicKeyPath, pair.publicKey, { flag: 'wx', mode: 0o644 })
    await fs.writeFile(privateKeyPath, pair.privateKey, { flag: 'wx', mode: 0o600 })
    console.log(`Backup public key created: ${publicKeyPath}`)
    console.log(`Encrypted backup private key created: ${privateKeyPath}`)
    return
  }
  if (command === 'encrypt') {
    const publicKeyPem = await fs.readFile(requireValue(options['public-key'], '--public-key'), 'utf8')
    await encryptBackupFile({
      inputPath: requireValue(options.input, '--input'),
      outputPath: requireValue(options.output, '--output'),
      publicKeyPem
    })
    console.log(`Encrypted backup created: ${options.output}`)
    return
  }
  if (command === 'decrypt') {
    const privateKeyPem = await fs.readFile(requireValue(options['private-key'], '--private-key'), 'utf8')
    await decryptBackupFile({
      inputPath: requireValue(options.input, '--input'),
      outputPath: requireValue(options.output, '--output'),
      privateKeyPem,
      passphrase: await getPassphrase()
    })
    console.log(`Backup decrypted: ${options.output}`)
    return
  }
  throw new Error('Usage: backup-crypto.mjs <generate|encrypt|decrypt> [options]')
}

const isCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isCli) {
  runCli().catch((error) => {
    console.error(`Backup crypto failed: ${error.message}`)
    process.exitCode = 1
  })
}
