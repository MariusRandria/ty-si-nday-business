import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import jwt from 'jsonwebtoken'
import test, { after } from 'node:test'

if (!process.env.COLLABORATION_ENCRYPTION_KEY) {
  process.env.COLLABORATION_ENCRYPTION_KEY = randomBytes(32).toString('base64')
}

const [{ createApp }, { env }, { prisma }, { encryptTotpSecret }] = await Promise.all([
  import('../../app.js'),
  import('../../config/env.js'),
  import('../../lib/prisma.js'),
  import('../collaboration/admin-totp.js'),
])

const databaseUrl = new URL(env.databaseUrl)
const enabled = ['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname.toLowerCase())
  && databaseUrl.pathname.replace(/^\//, '').toLowerCase() === 'bases_test'

let server: Server | null = null
let baseUrl = ''
if (enabled) {
  server = createServer(createApp())
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.')
  baseUrl = `http://127.0.0.1:${address.port}`
}

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => error ? reject(error) : resolve())
      server!.closeAllConnections()
    })
  }
  await prisma.$disconnect()
})

function encodeBase32(value: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let buffer = 0
  let output = ''
  for (const byte of value) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += alphabet[(buffer >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits) output += alphabet[(buffer << (5 - bits)) & 31]
  return output
}

function totpCode(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)))
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let buffer = 0
  const bytes: number[] = []
  for (const character of secret) {
    buffer = (buffer << 5) | alphabet.indexOf(character)
    bits += 5
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest()
  const offset = digest[digest.length - 1] & 15
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(value).padStart(6, '0')
}

test('withdrawal payment confirmation requires a fresh admin TOTP', { skip: !enabled }, async () => {
  const suffix = randomUUID()
  const secret = encodeBase32(randomBytes(20))
  const admin = await prisma.user.create({
    data: {
      email: `withdrawal-totp-${suffix}@test.invalid`,
      passwordHash: 'test-only-not-a-real-password',
      role: 'ADMIN',
      status: 'ACTIF',
      totpEnabled: true,
      totpSecretCiphertext: encryptTotpSecret(secret),
    },
    select: { id: true },
  })
  const token = jwt.sign({ id: admin.id, role: 'ADMIN', status: 'ACTIF' }, env.jwtSecret, { expiresIn: '10m' })
  const path = '/api/admin/withdrawals/2147483647'
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  }

  const unrelatedDecision = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'INVALID' }),
  })
  assert.equal(unrelatedDecision.status, 400)

  const payment = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'PAYE', paymentReference: 'PAY-12345' }),
  })
  assert.equal(payment.status, 403)
  const payload = await payment.json() as { error?: string }
  assert.match(payload.error ?? '', /Code TOTP invalide/i)

  const code = totpCode(secret)
  const authenticatedPayment = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { ...headers, 'x-admin-totp': code },
    body: JSON.stringify({ status: 'PAYE', paymentReference: 'PAY-12345' }),
  })
  assert.ok([409, 503].includes(authenticatedPayment.status))

  const reusedCodePayment = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { ...headers, 'x-admin-totp': code },
    body: JSON.stringify({ status: 'PAYE', paymentReference: 'PAY-12345' }),
  })
  assert.equal(reusedCodePayment.status, 403)
  const reusedCodePayload = await reusedCodePayment.json() as { error?: string }
  assert.match(reusedCodePayload.error ?? '', /Code TOTP invalide, expiré ou déjà utilisé/i)
})
