import assert from 'node:assert/strict'
import test from 'node:test'

process.env.COLLABORATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

const {
  decryptPii,
  encryptPii,
  hashNormalizedEmail,
  hashNormalizedPhone,
  serializeMaskedCollaborationReport,
} = await import('./report-pii.js')

test('report PII is encrypted with authenticated encryption and round-trips', () => {
  const phone = '+261 34 12 345 67'
  const encrypted = encryptPii(phone)
  assert.notEqual(encrypted, phone)
  assert.equal(encrypted.includes(phone), false)
  assert.equal(decryptPii(encrypted), phone)
})

test('modified encrypted PII cannot be decrypted', () => {
  const encrypted = encryptPii('contact@example.test')
  const replacement = encrypted.endsWith('A') ? 'B' : 'A'
  const tampered = `${encrypted.slice(0, -1)}${replacement}`
  assert.throws(() => decryptPii(tampered), /decryption failed/)
})

test('normalized phone and email values produce stable hashes', () => {
  assert.equal(hashNormalizedPhone('+261 (34) 12-345 67'), hashNormalizedPhone('261341234567'))
  assert.equal(hashNormalizedEmail(' Agent@Example.test '), hashNormalizedEmail('agent@example.test'))
})

test('masked collaboration serialization excludes private report fields', () => {
  const serialized = serializeMaskedCollaborationReport({
    dealId: 7,
    id: 12,
    contactName: 'Rakoto Andrianina',
    city: 'Antananarivo',
    reportNature: 'CONTACT',
    reportType: 'LEAD',
    meetingAt: new Date('2026-11-04T10:00:00.000Z'),
    createdAt: new Date('2026-11-04T09:00:00.000Z'),
    status: 'DECLARED',
    agent: { id: 3, agentProfile: { firstName: 'Agent', lastName: 'Fournisseur' } },
  })

  assert.equal(serialized.prospectName, 'R*** A.')
  assert.equal('contactName' in serialized, false)
  assert.equal('contactPhone' in serialized, false)
  assert.equal('contactEmail' in serialized, false)
  assert.equal('address' in serialized, false)
  assert.equal('summary' in serialized, false)
})
