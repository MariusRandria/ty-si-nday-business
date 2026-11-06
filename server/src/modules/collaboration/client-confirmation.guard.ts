import { timingSafeEqual } from 'node:crypto'
import { hashClientConfirmationCode } from './collaboration.files.js'

export type ClientConfirmationSnapshot = {
  id: number
  status: string
  attempts: number
  codeHash: string
  expiresAt: Date
  blockedUntil: Date | null
}

export type ClientConfirmationAttempt =
  | { outcome: 'ALREADY_USED' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'BLOCKED' }
  | { outcome: 'INVALID'; attempts: number; blockedUntil: Date | null }
  | { outcome: 'VALID'; resetAttempts: boolean }

export function assessClientConfirmationAttempt(
  confirmation: ClientConfirmationSnapshot,
  code: string,
  now: Date,
): ClientConfirmationAttempt {
  if (confirmation.status !== 'PENDING') return { outcome: 'ALREADY_USED' }
  if (confirmation.expiresAt <= now) return { outcome: 'EXPIRED' }
  if (confirmation.blockedUntil && confirmation.blockedUntil > now) return { outcome: 'BLOCKED' }
  const resetAttempts = confirmation.blockedUntil !== null && confirmation.blockedUntil <= now
  const attempts = resetAttempts ? 0 : confirmation.attempts
  const supplied = Buffer.from(hashClientConfirmationCode(code, confirmation.id), 'hex')
  const expected = Buffer.from(confirmation.codeHash, 'hex')
  const valid = supplied.length === expected.length && timingSafeEqual(supplied, expected)
  if (valid) return { outcome: 'VALID', resetAttempts }
  const nextAttempts = attempts + 1
  return {
    outcome: 'INVALID',
    attempts: nextAttempts,
    blockedUntil: nextAttempts >= 5 ? new Date(now.getTime() + 15 * 60_000) : null,
  }
}
