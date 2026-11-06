import { createHash } from 'node:crypto'

export type AuditChainEntry = {
  id: number
  sequence: bigint
  chainVersion: number
  actorId: number | null
  actorRole: string | null
  dealId: number | null
  action: string
  entityType: string
  entityId: number | null
  metadata: unknown
  oldValues: unknown
  newValues: unknown
  ip: string | null
  userAgent: string | null
  occurredAtLocal: string | null
  previousHash: string | null
  entryHash: string
  createdAt: Date
}

export type AuditChainIssue = {
  sequence: string | null
  code: 'SEQUENCE_GAP' | 'PREVIOUS_HASH_MISMATCH' | 'ENTRY_HASH_MISMATCH' | 'HEAD_MISMATCH'
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  return value
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function legacyAuditEntryHash(entry: AuditChainEntry): string {
  return digest({
    actorId: entry.actorId,
    dealId: entry.dealId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata,
    ip: entry.ip,
    userAgent: entry.userAgent,
    previousHash: entry.previousHash,
    createdAt: entry.createdAt.toISOString(),
  })
}

export function auditEntryHash(entry: AuditChainEntry): string {
  if (entry.chainVersion === 1) return legacyAuditEntryHash(entry)
  return digest(canonicalize({
    sequence: entry.sequence.toString(),
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    dealId: entry.dealId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata,
    oldValues: entry.oldValues,
    newValues: entry.newValues,
    ip: entry.ip,
    userAgent: entry.userAgent,
    occurredAtLocal: entry.occurredAtLocal,
    previousHash: entry.previousHash,
    createdAt: entry.createdAt.toISOString(),
  }))
}

export function localAuditTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Indian/Antananarivo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}.${values.fractionalSecond}`
}

export function verifyAuditChain(
  entries: readonly AuditChainEntry[],
  head: { sequence: bigint; headHash: string | null },
): AuditChainIssue[] {
  const issues: AuditChainIssue[] = []
  let expectedSequence = 1n
  let expectedPreviousHash: string | null = null
  for (const entry of entries) {
    if (entry.sequence !== expectedSequence) {
      issues.push({ sequence: entry.sequence.toString(), code: 'SEQUENCE_GAP' })
    }
    if (entry.previousHash !== expectedPreviousHash) {
      issues.push({ sequence: entry.sequence.toString(), code: 'PREVIOUS_HASH_MISMATCH' })
    }
    if (auditEntryHash(entry) !== entry.entryHash) {
      issues.push({ sequence: entry.sequence.toString(), code: 'ENTRY_HASH_MISMATCH' })
    }
    expectedSequence = entry.sequence + 1n
    expectedPreviousHash = entry.entryHash
  }
  if (head.sequence !== BigInt(entries.length)
    || head.headHash !== expectedPreviousHash) {
    issues.push({ sequence: head.sequence.toString(), code: 'HEAD_MISMATCH' })
  }
  return issues
}
