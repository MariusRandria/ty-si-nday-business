import assert from 'node:assert/strict'
import test from 'node:test'
import { antananarivoDateToIso, antananarivoDayBoundaryToIso, auditChainTone, canResolveAdminDispute, isAllowedCollaborationUpload, MAX_COLLABORATION_UPLOAD_BYTES } from './admin-collaboration-workflows.ts'

test('contract and payment evidence only accept the supported formats within 10 MiB', () => {
  assert.equal(isAllowedCollaborationUpload({ type: 'application/pdf', size: MAX_COLLABORATION_UPLOAD_BYTES }), true)
  assert.equal(isAllowedCollaborationUpload({ type: 'image/webp', size: 1 }), true)
  assert.equal(isAllowedCollaborationUpload({ type: 'text/plain', size: 1 }), false)
  assert.equal(isAllowedCollaborationUpload({ type: 'image/png', size: MAX_COLLABORATION_UPLOAD_BYTES + 1 }), false)
})

test('contract date input is interpreted in the Antananarivo timezone', () => {
  assert.equal(antananarivoDateToIso('2026-11-05'), '2026-11-05T09:00:00.000Z')
})

test('audit date filters include the full Antananarivo calendar day', () => {
  assert.equal(antananarivoDayBoundaryToIso('2026-11-05', false), '2026-11-04T21:00:00.000Z')
  assert.equal(antananarivoDayBoundaryToIso('2026-11-05', true), '2026-11-05T20:59:59.999Z')
})

test('only a valid audit chain receives the positive status tone', () => {
  assert.equal(auditChainTone('VALID'), 'valid')
  assert.equal(auditChainTone('BROKEN'), 'broken')
  assert.equal(auditChainTone('STALE'), 'uncertain')
  assert.equal(auditChainTone('UNKNOWN'), 'uncertain')
  assert.equal(auditChainTone(null), 'uncertain')
})

test('dispute resolution requires a known state with no held commissions', () => {
  assert.equal(canResolveAdminDispute(false, 0), false)
  assert.equal(canResolveAdminDispute(true, 1), false)
  assert.equal(canResolveAdminDispute(true, 0), true)
})
