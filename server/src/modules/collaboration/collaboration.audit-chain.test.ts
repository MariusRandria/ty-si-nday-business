import assert from 'node:assert/strict'
import test from 'node:test'
import { auditEntryHash, legacyAuditEntryHash, localAuditTimestamp, verifyAuditChain } from './collaboration.audit-chain.js'
import type { AuditChainEntry } from './collaboration.audit-chain.js'

function entry(sequence: bigint, previousHash: string | null, action: string): AuditChainEntry {
  const value: AuditChainEntry = {
    id: Number(sequence),
    sequence,
    chainVersion: 2,
    actorId: 7,
    actorRole: 'AGENT',
    dealId: 12,
    action,
    entityType: 'CollaborationDeal',
    entityId: 12,
    metadata: { safe: true },
    oldValues: null,
    newValues: { status: 'IN_PROGRESS' },
    ip: '192.0.2.1',
    userAgent: 'test',
    occurredAtLocal: '2026-11-05 00:00:00.000',
    previousHash,
    entryHash: '',
    createdAt: new Date('2026-11-04T21:00:00.000Z'),
  }
  value.entryHash = auditEntryHash(value)
  return value
}

test('audit chain verifies append order and links', () => {
  const first = entry(1n, null, 'FIRST')
  const second = entry(2n, first.entryHash, 'SECOND')
  assert.deepEqual(verifyAuditChain([first, second], { sequence: 2n, headHash: second.entryHash }), [])
})

test('audit chain continues to verify legacy entries after migration', () => {
  const first = { ...entry(1n, null, 'LEGACY_FIRST'), chainVersion: 1, actorRole: null, oldValues: null, newValues: null, occurredAtLocal: null }
  first.entryHash = legacyAuditEntryHash(first)
  const second = { ...entry(2n, first.entryHash, 'LEGACY_SECOND'), chainVersion: 1, actorRole: null, oldValues: null, newValues: null, occurredAtLocal: null }
  second.entryHash = legacyAuditEntryHash(second)
  assert.deepEqual(verifyAuditChain([first, second], { sequence: 2n, headHash: second.entryHash }), [])
})

test('audit chain detects modified and deleted entries', () => {
  const first = entry(1n, null, 'FIRST')
  const second = entry(2n, first.entryHash, 'SECOND')
  const modified = { ...first, action: 'TAMPERED' }
  assert.ok(verifyAuditChain([modified, second], { sequence: 2n, headHash: second.entryHash })
    .some(({ code }) => code === 'ENTRY_HASH_MISMATCH'))
  assert.ok(verifyAuditChain([second], { sequence: 2n, headHash: second.entryHash })
    .some(({ code }) => code === 'SEQUENCE_GAP'))
  assert.ok(verifyAuditChain([first], { sequence: 2n, headHash: second.entryHash })
    .some(({ code }) => code === 'HEAD_MISMATCH'))
})

test('local audit timestamps use the Antananarivo timezone', () => {
  assert.equal(localAuditTimestamp(new Date('2026-11-04T21:00:00.000Z')), '2026-11-05 00:00:00.000')
})
