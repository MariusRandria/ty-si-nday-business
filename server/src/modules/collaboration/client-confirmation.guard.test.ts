import assert from 'node:assert/strict'
import test from 'node:test'

process.env.COLLABORATION_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString('base64')

const { assessClientConfirmationAttempt } = await import('./client-confirmation.guard.js')
const { hashClientConfirmationCode } = await import('./collaboration.files.js')

const now = new Date('2026-11-04T12:00:00.000Z')
const code = '00421873'
const id = 31

function makeConfirmation(overrides: Partial<{
  status: string
  attempts: number
  expiresAt: Date
  blockedUntil: Date | null
  codeHash: string
}> = {}) {
  return {
    id,
    status: 'PENDING',
    attempts: 0,
    codeHash: hashClientConfirmationCode(code, id),
    expiresAt: new Date('2026-11-06T12:00:00.000Z'),
    blockedUntil: null,
    ...overrides,
  }
}

test('client confirmation code is stored only as an HMAC and accepted once before expiration', () => {
  const storedHash = hashClientConfirmationCode(code, id)
  assert.equal(storedHash.includes(code), false)
  assert.equal(assessClientConfirmationAttempt(makeConfirmation(), code, now).outcome, 'VALID')
  assert.equal(
    assessClientConfirmationAttempt(makeConfirmation({ status: 'CONFIRMED_BY_CLIENT' }), code, now).outcome,
    'ALREADY_USED',
  )
})

test('expired and temporarily blocked client codes are rejected', () => {
  assert.equal(
    assessClientConfirmationAttempt(makeConfirmation({ expiresAt: now }), code, now).outcome,
    'EXPIRED',
  )
  assert.equal(
    assessClientConfirmationAttempt(makeConfirmation({ blockedUntil: new Date(now.getTime() + 60_000) }), code, now).outcome,
    'BLOCKED',
  )
})

test('the fifth incorrect code attempt activates a temporary block', () => {
  let attempts = 0
  let result = assessClientConfirmationAttempt(makeConfirmation({ attempts }), '99999999', now)
  while (result.outcome === 'INVALID' && result.attempts < 5) {
    attempts = result.attempts
    result = assessClientConfirmationAttempt(makeConfirmation({ attempts }), '99999999', now)
  }
  assert.equal(result.outcome, 'INVALID')
  if (result.outcome === 'INVALID') {
    assert.equal(result.attempts, 5)
    assert.equal(result.blockedUntil?.getTime(), now.getTime() + 15 * 60_000)
  }
})
