import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Response } from 'express'
import type { AuthRequest } from '../auth/auth.middleware.js'
import { prisma } from '../../lib/prisma.js'
import { decryptPii, encryptPii } from './report-pii.js'
import { writeCollaborationAudit } from './collaboration.audit.js'

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const stepSeconds = 30

function encodeBase32(value: Buffer): string {
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

function decodeBase32(value: string): Buffer {
  let bits = 0
  let buffer = 0
  const bytes: number[] = []
  for (const character of value.toUpperCase().replace(/=+$/g, '')) {
    const index = alphabet.indexOf(character)
    if (index < 0) throw new Error('Invalid base32 secret.')
    buffer = (buffer << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

function totpAtStep(secret: string, step: bigint): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(step)
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest()
  const offset = digest[digest.length - 1] & 15
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(number).padStart(6, '0')
}

export function verifyTotp(secret: string, token: string, now = Date.now(), lastUsedStep?: bigint | null): bigint | null {
  if (!/^\d{6}$/.test(token)) return null
  const currentStep = BigInt(Math.floor(now / 1000 / stepSeconds))
  for (const step of [currentStep - 1n, currentStep, currentStep + 1n]) {
    if (lastUsedStep !== null && lastUsedStep !== undefined && step <= lastUsedStep) continue
    const expected = totpAtStep(secret, step)
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(token))) return step
  }
  return null
}

export function createTotpEnrollment(email: string) {
  const secret = encodeBase32(randomBytes(20))
  const label = encodeURIComponent(`Ty sy Nday:${email}`)
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=Ty%20sy%20Nday&digits=6&period=${stepSeconds}`
  return { secret, uri }
}

export async function requireAdminTotp(request: AuthRequest, response: Response, next: NextFunction) {
  if (!request.user || !['ADMIN', 'SUPER_ADMIN'].includes(request.user.role)) {
    response.status(403).json({ error: 'Accès administrateur requis.' })
    return
  }
  const auditFailure = async (reason: string) => prisma.$transaction((transaction) =>
    writeCollaborationAudit(transaction, {
      actorId: request.user!.id,
      actorRole: request.user!.role,
      action: 'AUTH_TOTP_FAILED',
      entityType: 'User',
      entityId: request.user!.id,
      metadata: { reason },
      ip: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
    }),
  )
  const token = request.get('x-admin-totp') ?? ''
  const user = await prisma.user.findFirst({
    where: { id: request.user.id, role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIF', totpEnabled: true },
    select: { totpSecretCiphertext: true, totpLastUsedStep: true },
  })
  if (!user?.totpSecretCiphertext) {
    await auditFailure('TOTP_NOT_ENABLED')
    response.status(403).json({ error: 'Activez la double authentification TOTP avant cette action.' })
    return
  }
  const secret = decryptPii(user.totpSecretCiphertext)
  const step = verifyTotp(secret, token, Date.now(), user.totpLastUsedStep)
  if (step === null) {
    await auditFailure('INVALID_EXPIRED_OR_REUSED_CODE')
    response.status(403).json({ error: 'Code TOTP invalide, expiré ou déjà utilisé.' })
    return
  }
  const updated = await prisma.user.updateMany({
    where: {
      id: request.user.id,
      totpEnabled: true,
      OR: [
        { totpLastUsedStep: null },
        { totpLastUsedStep: { lt: step } },
      ],
    },
    data: { totpLastUsedStep: step },
  })
  if (updated.count !== 1) {
    await auditFailure('REUSED_CODE')
    response.status(403).json({ error: 'Code TOTP déjà utilisé.' })
    return
  }
  next()
}

export function encryptTotpSecret(secret: string): string {
  return encryptPii(secret)
}
