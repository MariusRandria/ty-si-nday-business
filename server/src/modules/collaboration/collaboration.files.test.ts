import assert from 'node:assert/strict'
import test from 'node:test'

process.env.COLLABORATION_ENCRYPTION_KEY = Buffer.alloc(32, 18).toString('base64')

const { createClientConfirmationCode, createSignedEvidenceUrl, hashEvidence } = await import('./collaboration.files.js')

test('collaboration evidence uses SHA-256 and private links expire after five minutes', () => {
  assert.equal(hashEvidence(Buffer.from('evidence')), 'ee8250fb76e094b34b471f13a73dbbe51d1ae142e9df59d7c0d31ec20f0a0a8e')
  const url = createSignedEvidenceUrl(5, '123e4567-e89b-12d3-a456-426614174000.pdf', 1_000_000)
  assert.match(url, /^\/api\/collaboration\/public\/files\/5\?expires=1300&sig=[a-f0-9]{64}$/)
})

test('client confirmation codes are eight decimal digits', () => {
  assert.match(createClientConfirmationCode(), /^\d{8}$/)
})
