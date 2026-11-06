import { env } from '../../config/env.js'
import { prisma } from '../../lib/prisma.js'
import { notifyAdmins } from '../notifications/notifications.service.js'
import { writeCollaborationAudit } from './collaboration.audit.js'
import { holdPendingCommissionsForDeal } from './collaboration.commissions.service.js'
import { CollaborationAccessError, transitionCollaborationDeal } from './collaboration.policy.js'

const lastBypassRunKey = 'collaboration_bypass_check_last_run'

function localDayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Indian/Antananarivo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

export async function detectSignedContactBypass(now = new Date()) {
  const days = env.collaborationBypassCheckDays
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    throw new Error('COLLABORATION_BYPASS_CHECK_DAYS must be an integer from 1 to 3650.')
  }
  const lastRun = await prisma.setting.findUnique({ where: { key: lastBypassRunKey }, select: { value: true } })
  const dayKey = localDayKey(now)
  if (lastRun?.value === dayKey) return { matches: 0, skipped: true }
  const cutoff = new Date(now.getTime() - days * 86_400_000)
  let matches = 0
  let lastId = 0
  while (true) {
    const signedDeals = await prisma.collaborationDeal.findMany({
      where: { id: { gt: lastId }, contractSignedAt: { not: null }, status: { not: 'DISPUTED' } },
      orderBy: { id: 'asc' },
      take: 200,
      select: {
        id: true,
        supplierId: true,
        status: true,
        saleNumber: true,
        secret: { select: { phoneHash: true, emailHash: true } },
      },
    })
    if (signedDeals.length === 0) break
    for (const signedDeal of signedDeals) {
      lastId = signedDeal.id
      if (!signedDeal.secret) continue
      const bypass = await prisma.collaborationProspectSecret.findFirst({
        where: {
          dealId: { not: signedDeal.id },
          OR: [
            { phoneHash: signedDeal.secret.phoneHash },
            ...(signedDeal.secret.emailHash ? [{ emailHash: signedDeal.secret.emailHash }] : []),
          ],
          deal: {
            is: {
              accessGrantedAt: { lte: cutoff },
              closerId: { not: null },
              status: { notIn: ['LOST', 'REJECTED'] },
              accessRequests: { some: { status: 'APPROVED' } },
              closingReport: { is: null },
            },
          },
        },
        select: { dealId: true },
      })
      if (!bypass) continue
      const flagged = await prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM collaboration_deals WHERE id = ${signedDeal.id} FOR UPDATE`
        const current = await transaction.collaborationDeal.findUnique({
          where: { id: signedDeal.id },
          select: { id: true, status: true, supplierId: true },
        })
        if (!current || current.status === 'DISPUTED') return false
        const previous = await transaction.collaborationAuditLog.findFirst({
          where: { action: 'COLLABORATION_PERIODIC_CONTACT_BYPASS_DETECTED', entityId: signedDeal.id },
          select: { id: true },
        })
        if (previous) return false
        try {
          await transitionCollaborationDeal(
            transaction,
            { role: 'SYSTEM' },
            signedDeal.id,
            'DISPUTED',
            undefined,
            now,
          )
        } catch (error) {
          if (error instanceof CollaborationAccessError) return false
          throw error
        }
        await transaction.collaborationDeal.update({
          where: { id: signedDeal.id },
          data: { disputeReason: 'Correspondance de coordonnées avec un accès accordé sans rapport de clôture.' },
        })
        await holdPendingCommissionsForDeal(transaction, signedDeal.id, 'PERIODIC_CONTACT_BYPASS', {}, now)
        await writeCollaborationAudit(transaction, {
          actorId: null,
          actorRole: 'SYSTEM',
          dealId: signedDeal.id,
          action: 'COLLABORATION_PERIODIC_CONTACT_BYPASS_DETECTED',
          entityType: 'CollaborationDeal',
          entityId: signedDeal.id,
          metadata: { bypassDealId: bypass.dealId, saleNumber: signedDeal.saleNumber, accessAgeDays: days },
          createdAt: now,
        })
        return true
      })
      if (flagged) {
        matches += 1
        await notifyAdmins({
          type: 'COLLABORATION_PERIODIC_CONTACT_BYPASS',
          title: 'Contournement potentiel détecté',
          body: `Une vente ${signedDeal.saleNumber ?? signedDeal.id} correspond aux coordonnées d’un prospect partagé sans rapport de clôture; le dossier est en litige.`,
          link: `/admin/collaboration/${signedDeal.id}`,
        })
      }
    }
  }
  await prisma.setting.upsert({
    where: { key: lastBypassRunKey },
    create: { key: lastBypassRunKey, value: dayKey },
    update: { value: dayKey },
  })
  return { matches, skipped: false }
}

export async function alertContactExtractionAnomalies(now = new Date()) {
  for (const [name, value] of [
    ['COLLABORATION_CONTACT_DENIED_ALERT_THRESHOLD', env.collaborationContactDeniedAlertThreshold],
    ['COLLABORATION_ACCESS_WITHOUT_REPORT_THRESHOLD', env.collaborationAccessWithoutReportThreshold],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer.`)
  }
  const dayKey = localDayKey(now)
  const cutoff = new Date(now.getTime() - 24 * 60 * 60_000)
  const denied = await prisma.collaborationAuditLog.groupBy({
    by: ['actorId'],
    where: {
      action: 'COLLABORATION_CONTACT_ACCESS_DENIED',
      actorId: { not: null },
      createdAt: { gte: cutoff },
    },
    _count: { _all: true },
  })
  for (const { actorId, _count } of denied) {
    if (actorId === null || _count._all < env.collaborationContactDeniedAlertThreshold) continue
    await notifyContactAnomalyOnce(
      actorId,
      'denied',
      dayKey,
      `L’agent ${actorId} a effectué ${_count._all} consultations de coordonnées sans accès autorisé au cours des dernières 24 heures.`,
      now,
    )
  }

  const approved = await prisma.collaborationAccessRequest.groupBy({
    by: ['requesterId'],
    where: { status: 'APPROVED', decidedAt: { gte: cutoff } },
    _count: { _all: true },
  })
  for (const { requesterId, _count } of approved) {
    if (_count._all < env.collaborationAccessWithoutReportThreshold) continue
    const reports = await prisma.collaborationClosingReport.count({
      where: { closerId: requesterId, status: 'SUBMITTED', submittedAt: { gte: cutoff } },
    })
    if (reports !== 0) continue
    await notifyContactAnomalyOnce(
      requesterId,
      'no-reports',
      dayKey,
      `L’agent ${requesterId} a obtenu ${_count._all} accès approuvés sans rapport de clôture soumis sur la période.`,
      now,
    )
  }
}

async function notifyContactAnomalyOnce(agentId: number, kind: string, dayKey: string, body: string, now: Date) {
  const key = `collaboration_contact_anomaly:${agentId}:${kind}:${dayKey}`
  const inserted = await prisma.setting.createMany({
    data: [{ key, value: now.toISOString() }],
    skipDuplicates: true,
  })
  if (inserted.count !== 1) return
  await notifyAdmins({
    type: 'COLLABORATION_CONTACT_ACCESS_ANOMALY',
    title: 'Risque d’extraction de coordonnées',
    body,
    link: '/admin/collaboration/audit',
  })
}
