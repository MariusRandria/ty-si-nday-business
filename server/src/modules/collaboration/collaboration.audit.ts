import type { Prisma } from '@prisma/client'
import { auditEntryHash, localAuditTimestamp } from './collaboration.audit-chain.js'

type AuditInput = {
  actorId?: number | null
  actorRole?: string | null
  dealId?: number | null
  action: string
  entityType: string
  entityId?: number | null
  metadata?: Prisma.InputJsonValue
  oldValues?: Prisma.InputJsonValue
  newValues?: Prisma.InputJsonValue
  ip?: string | null
  userAgent?: string | null
  createdAt?: Date
}

export async function writeCollaborationAudit(
  transaction: Prisma.TransactionClient,
  input: AuditInput,
) {
  const [head] = await transaction.$queryRaw<{ head_hash: string | null; sequence: bigint }[]>`
    SELECT head_hash, sequence FROM collaboration_audit_heads WHERE id = 1 FOR UPDATE
  `
  if (!head) throw new Error('Collaboration audit chain head is not initialized.')
  const createdAt = input.createdAt ?? new Date()
  const previousHash = head.head_hash
  const actor = input.actorRole === undefined && input.actorId
    ? await transaction.user.findUnique({ where: { id: input.actorId }, select: { role: true } })
    : null
  const userAgent = input.userAgent?.slice(0, 500) ?? null
  const entry = {
    id: 0,
    sequence: head.sequence + 1n,
    chainVersion: 2,
    actorId: input.actorId ?? null,
    actorRole: input.actorRole ?? actor?.role ?? (input.actorId === null || input.actorId === undefined ? 'SYSTEM' : null),
    dealId: input.dealId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: input.metadata ?? null,
    oldValues: input.oldValues ?? null,
    newValues: input.newValues ?? null,
    ip: input.ip ?? null,
    userAgent,
    occurredAtLocal: localAuditTimestamp(createdAt),
    previousHash,
    entryHash: '',
    createdAt,
  }
  const entryHash = auditEntryHash(entry)

  const created = await transaction.collaborationAuditLog.create({
    data: {
      sequence: entry.sequence,
      chainVersion: entry.chainVersion,
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      dealId: entry.dealId,
      action: input.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: input.metadata,
      oldValues: input.oldValues,
      newValues: input.newValues,
      ip: entry.ip,
      userAgent,
      occurredAtLocal: entry.occurredAtLocal,
      previousHash,
      entryHash,
      createdAt,
    },
  })
  await transaction.collaborationAuditHead.update({
    where: { id: 1 },
    data: { headHash: entryHash, sequence: entry.sequence },
  })
  return created
}
