import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test, { after } from 'node:test'
import type { CollaborationDealStatus } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { processContractSignedEvent } from './collaboration.commissions.service.js'
import { writeCollaborationAudit } from './collaboration.audit.js'
import { verifyCollaborationAuditChain } from './collaboration.audit-verification.js'
import { getAvailableCollaborationCommissionAmount } from '../workspace/wallet.service.js'

const databaseUrl = process.env.DATABASE_URL
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.split('/').pop()?.toLowerCase() : undefined
const enabled = databaseName?.includes('test') === true
const lifecycleStatuses: CollaborationDealStatus[] = [
  'DECLARED',
  'ACCESS_REQUESTED',
  'IN_PROGRESS',
  'CLOSING_REPORTED',
  'CLIENT_CONFIRMED',
  'CONFIRMED_BY_CLIENT',
  'NO_RESPONSE',
  'CONFIRMED',
  'CONTRACT_SIGNED',
  'COMMISSIONS_PAID',
  'LOST',
  'REJECTED',
  'DISPUTED',
  'EXPIRED',
]

after(async () => {
  await prisma.$disconnect()
})

test('concurrent generation is idempotent and credits the agent wallets once', {
  skip: !enabled,
}, async () => {
  const suffix = randomUUID()
  const now = new Date()
  const [supplier, closer, admin] = await Promise.all([
    prisma.user.create({
      data: { email: `collab-supplier-${suffix}@test.invalid`, passwordHash: 'test-only', role: 'AGENT', status: 'ACTIF' },
      select: { id: true },
    }),
    prisma.user.create({
      data: { email: `collab-closer-${suffix}@test.invalid`, passwordHash: 'test-only', role: 'AGENT', status: 'ACTIF' },
      select: { id: true },
    }),
    prisma.user.create({
      data: { email: `collab-admin-${suffix}@test.invalid`, passwordHash: 'test-only', role: 'ADMIN', status: 'ACTIF' },
      select: { id: true },
    }),
  ])
  const report = await prisma.report.create({
    data: {
      agentId: supplier.id,
      companyName: `Concurrent test ${suffix}`,
      companyNameNormalized: `concurrent test ${suffix}`,
      contactPhone: 'encrypted-test-placeholder',
      summary: 'Synthetic record for the isolated concurrency test.',
      city: 'Test',
      address: 'Synthetic test address',
      contactName: 'Test Contact',
      contactRole: 'Test',
      contactType: 'APPEL',
      meetingAt: now,
      interestLevel: 'MOYEN',
    },
    select: { id: true },
  })
  const deal = await prisma.collaborationDeal.create({
    data: {
      reportId: report.id,
      supplierId: supplier.id,
      closerId: closer.id,
      status: 'CONTRACT_SIGNED',
      contractSignedAt: now,
      saleNumber: `TEST-${suffix}`,
    },
    select: { id: true },
  })
  await prisma.collaborationDealStatusHistory.createMany({
    data: lifecycleStatuses.map((status) => ({
      dealId: deal.id,
      fromStatus: status,
      toStatus: status,
      changedBy: admin.id,
      comment: `Enum compatibility test: ${status}`,
    })),
  })
  assert.equal(await prisma.collaborationDealStatusHistory.count({
    where: { dealId: deal.id, toStatus: { in: lifecycleStatuses } },
  }), lifecycleStatuses.length)
  const event = await prisma.collaborationDomainEvent.create({
    data: {
      dealId: deal.id,
      eventType: 'contract.signed',
      idempotencyKey: `contract.signed:test:${suffix}`,
      payload: {
        commissionConfig: { providerAmount: '50000', closerAmount: '100000', currency: 'Ar' },
      },
    },
    select: { id: true },
  })

  await Promise.all([
    processContractSignedEvent(event.id),
    processContractSignedEvent(event.id),
  ])
  const commissions = await prisma.collaborationCommission.findMany({
    where: { dealId: deal.id },
    select: { id: true, role: true, status: true },
  })
  assert.deepEqual(commissions.map(({ role }) => role).sort(), ['CLOSER', 'SUPPLIER'])
  assert.ok(commissions.every(({ status }) => status === 'PENDING'))
  assert.equal(await getAvailableCollaborationCommissionAmount(prisma, supplier.id), 50_000n)
  assert.equal(await getAvailableCollaborationCommissionAmount(prisma, closer.id), 100_000n)

  await Promise.all(Array.from({ length: 10 }, (_, index) =>
    prisma.$transaction((transaction) => writeCollaborationAudit(transaction, {
      actorId: admin.id,
      actorRole: 'ADMIN',
      dealId: deal.id,
      action: 'COLLABORATION_AUDIT_CONCURRENCY_TEST',
      entityType: 'CollaborationDeal',
      entityId: deal.id,
      metadata: { index },
    })),
  ))
  const chain = await verifyCollaborationAuditChain()
  assert.equal(chain.valid, true)
  assert.deepEqual(chain.issues, [])

  const auditEntry = await prisma.collaborationAuditLog.findFirstOrThrow({
    where: { dealId: deal.id },
    orderBy: { sequence: 'desc' },
    select: { id: true },
  })
  await assert.rejects(() => prisma.collaborationAuditLog.update({
    where: { id: auditEntry.id },
    data: { action: 'TAMPERED' },
  }))
  await assert.rejects(() => prisma.collaborationAuditLog.delete({ where: { id: auditEntry.id } }))
})
