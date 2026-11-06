import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyTotp } from './admin-totp.js'

test('TOTP validates the RFC SHA-1 vector and rejects reuse of a step', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  assert.equal(verifyTotp(secret, '287082', 59_000), 1n)
  assert.equal(verifyTotp(secret, '287082', 59_000, 1n), null)
  assert.equal(verifyTotp(secret, '000000', 59_000), null)
})
