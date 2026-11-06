import { createHash } from 'node:crypto'
import { prisma } from '../../lib/prisma.js'
import { notifyAdmins } from '../notifications/notifications.service.js'
import { verifyAuditChain } from './collaboration.audit-chain.js'

const verificationSettingKey = 'collaboration_audit_chain_last_verification'
const alertSettingKey = 'collaboration_audit_chain_last_alert'
const staleAfterMs = 36 * 60 * 60_000

export type AuditChainVerificationStatus = {
  status: 'VALID' | 'BROKEN' | 'UNKNOWN' | 'STALE'
  lastResult: 'VALID' | 'BROKEN' | null
  checkedAt: string | null
  sequence: string | null
  issueCount: number | null
}

export function parseAuditChainVerificationStatus(value: string | null, now = new Date()): AuditChainVerificationStatus {
  if (!value) {
    return { status: 'UNKNOWN', lastResult: null, checkedAt: null, sequence: null, issueCount: null }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return { status: 'UNKNOWN', lastResult: null, checkedAt: null, sequence: null, issueCount: null }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { status: 'UNKNOWN', lastResult: null, checkedAt: null, sequence: null, issueCount: null }
  }
  const record = parsed as Record<string, unknown>
  const checkedAt = typeof record.checkedAt === 'string' ? new Date(record.checkedAt) : null
  const sequence = typeof record.sequence === 'string' && /^\d+$/.test(record.sequence) ? record.sequence : null
  const issueCount = typeof record.issueCount === 'number' && Number.isSafeInteger(record.issueCount) && record.issueCount >= 0
    ? record.issueCount
    : null
  if (
    (record.status !== 'VALID' && record.status !== 'BROKEN')
    || !checkedAt
    || Number.isNaN(checkedAt.getTime())
    || sequence === null
    || issueCount === null
  ) {
    return { status: 'UNKNOWN', lastResult: null, checkedAt: null, sequence: null, issueCount: null }
  }
  const lastResult = record.status
  if (now.getTime() - checkedAt.getTime() > staleAfterMs || checkedAt.getTime() > now.getTime() + 5 * 60_000) {
    return { status: 'STALE', lastResult, checkedAt: checkedAt.toISOString(), sequence, issueCount }
  }
  return { status: lastResult, lastResult, checkedAt: checkedAt.toISOString(), sequence, issueCount }
}

export async function getLatestAuditChainVerificationStatus(now = new Date()): Promise<AuditChainVerificationStatus> {
  const setting = await prisma.setting.findUnique({
    where: { key: verificationSettingKey },
    select: { value: true },
  })
  return parseAuditChainVerificationStatus(setting?.value ?? null, now)
}

function localDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Indian/Antananarivo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

export async function verifyCollaborationAuditChain() {
  const [head, entries] = await prisma.$transaction(async (transaction) => Promise.all([
    transaction.collaborationAuditHead.findUnique({ where: { id: 1 }, select: { sequence: true, headHash: true } }),
    transaction.collaborationAuditLog.findMany({
      orderBy: { sequence: 'asc' },
      select: {
        id: true,
        sequence: true,
        chainVersion: true,
        actorId: true,
        actorRole: true,
        dealId: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        oldValues: true,
        newValues: true,
        ip: true,
        userAgent: true,
        occurredAtLocal: true,
        previousHash: true,
        entryHash: true,
        createdAt: true,
      },
    }),
  ]), { isolationLevel: 'RepeatableRead' })

  if (!head) throw new Error('Collaboration audit chain head is missing.')
  const issues = verifyAuditChain(entries, head)
  return { valid: issues.length === 0, sequence: head.sequence.toString(), issues }
}

export async function runNightlyAuditChainVerification(ownerToken: string, now = new Date()) {
  const lease = await prisma.collaborationSchedulerLock.findUnique({
    where: { name: 'collaboration-scheduler' },
    select: { ownerToken: true, expiresAt: true },
  })
  if (lease?.ownerToken !== ownerToken || !lease.expiresAt || lease.expiresAt <= now) {
    throw new Error('Audit chain verification requires the active collaboration scheduler lease.')
  }
  const dayKey = localDateKey(now)
  const previous = await prisma.setting.findUnique({
    where: { key: verificationSettingKey },
    select: { value: true },
  })
  const previousStatus = parseAuditChainVerificationStatus(previous?.value ?? null, now)
  if (previousStatus.checkedAt && localDateKey(new Date(previousStatus.checkedAt)) === dayKey) return null

  const result = await verifyCollaborationAuditChain()
  await prisma.setting.upsert({
    where: { key: verificationSettingKey },
    create: {
      key: verificationSettingKey,
      value: JSON.stringify({
        status: result.valid ? 'VALID' : 'BROKEN',
        checkedAt: now.toISOString(),
        sequence: result.sequence,
        issueCount: result.issues.length,
      }),
    },
    update: {
      value: JSON.stringify({
        status: result.valid ? 'VALID' : 'BROKEN',
        checkedAt: now.toISOString(),
        sequence: result.sequence,
        issueCount: result.issues.length,
      }),
    },
  })
  if (result.valid) return result

  const fingerprint = createHash('sha256')
    .update(JSON.stringify(result.issues))
    .digest('hex')
  const priorAlert = await prisma.setting.findUnique({
    where: { key: alertSettingKey },
    select: { value: true },
  })
  if (priorAlert?.value !== fingerprint) {
    await notifyAdmins({
      type: 'COLLABORATION_AUDIT_CHAIN_BROKEN',
      title: 'Rupture détectée dans la chaîne d’audit',
      body: `La vérification nocturne a détecté ${result.issues.length} anomalie(s) dans la chaîne d’audit collaboratif.`,
      link: '/admin/collaboration/audit',
    })
    await prisma.setting.upsert({
      where: { key: alertSettingKey },
      create: { key: alertSettingKey, value: fingerprint },
      update: { value: fingerprint },
    })
  }
  return result
}

export async function verifyAuditChainIfNightlyWindow(ownerToken: string, now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Indian/Antananarivo',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now))
  if (hour < 2) return null
  return runNightlyAuditChainVerification(ownerToken, now)
}
