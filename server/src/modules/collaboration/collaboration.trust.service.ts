import { env } from '../../config/env.js'
import { prisma } from '../../lib/prisma.js'
import { notifyAdmins } from '../notifications/notifications.service.js'
import { calculateTrustScore } from './collaboration.trust-score.js'

const stateKey = (agentId: number) => `collaboration_trust_score_state:${agentId}`
const lastRunKey = 'collaboration_trust_score_last_run'

function dayStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

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

export async function recalculateCollaborationTrustScores(now = new Date()) {
  for (const [name, value] of [
    ['COLLABORATION_TRUST_SCORE_ALERT_THRESHOLD', env.collaborationTrustScoreAlertThreshold],
    ['COLLABORATION_TRUST_SCORE_SUSPENSION_PROPOSAL_THRESHOLD', env.collaborationTrustScoreSuspensionProposalThreshold],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 100) throw new Error(`${name} must be an integer from 0 to 100.`)
  }
  const agents = await prisma.user.findMany({
    where: { role: 'AGENT' },
    select: { id: true, createdAt: true },
    orderBy: { id: 'asc' },
  })
  const dayKey = localDayKey(now)
  const lastRun = await prisma.setting.findUnique({ where: { key: lastRunKey }, select: { value: true } })
  if (lastRun?.value === dayKey) return { scoreDay: dayKey, agentsCalculated: 0 }
  const scoreDay = dayStartUtc(now)
  for (const agent of agents) {
    const deals = await prisma.collaborationDeal.findMany({
      where: { OR: [{ supplierId: agent.id }, { closerId: agent.id }] },
      select: {
        status: true,
        closerId: true,
        accessGrantedAt: true,
        closingReportedAt: true,
        statusHistory: {
          where: {
            OR: [
              { fromStatus: 'DISPUTED', toStatus: 'REJECTED' },
              { toStatus: 'EXPIRED' },
            ],
          },
          select: { fromStatus: true, toStatus: true },
        },
      },
    })
    const concludedStatuses = new Set(['CONFIRMED', 'CONTRACT_SIGNED', 'COMMISSIONS_PAID'])
    const resolvedStatuses = new Set([...concludedStatuses, 'LOST', 'REJECTED', 'EXPIRED'])
    const resolvedDeals = deals.filter(({ status }) => resolvedStatuses.has(status)).length
    const concludedDeals = deals.filter(({ status }) => concludedStatuses.has(status)).length
    const lostDisputes = deals.filter(({ statusHistory }) =>
      statusHistory.some(({ fromStatus, toStatus }) => fromStatus === 'DISPUTED' && toStatus === 'REJECTED'),
    ).length
    const delays = deals
      .filter(({ closerId, accessGrantedAt, closingReportedAt }) =>
        closerId === agent.id && accessGrantedAt !== null && closingReportedAt !== null,
      )
      .map(({ accessGrantedAt, closingReportedAt }) =>
        Math.max(0, (closingReportedAt!.getTime() - accessGrantedAt!.getTime()) / 3_600_000),
      )
    const averageReportDelayHours = delays.length
      ? delays.reduce((sum, delay) => sum + delay, 0) / delays.length
      : null
    const repeatedExpirations = deals.reduce((sum, deal) =>
      sum + deal.statusHistory.filter(({ toStatus }) => toStatus === 'EXPIRED').length, 0)
    const accountAgeDays = Math.max(0, Math.floor((now.getTime() - agent.createdAt.getTime()) / 86_400_000))
    const result = calculateTrustScore({
      concludedDeals,
      resolvedDeals,
      lostDisputes,
      averageReportDelayHours,
      repeatedExpirations,
      accountAgeDays,
    })
    await prisma.collaborationTrustScoreSnapshot.upsert({
      where: { agentId_scoreDay: { agentId: agent.id, scoreDay } },
      create: {
        agentId: agent.id,
        scoreDay,
        score: result.score,
        formulaVersion: 1,
        components: result.components,
        calculatedAt: now,
      },
      update: {
        score: result.score,
        formulaVersion: 1,
        components: result.components,
        calculatedAt: now,
      },
    })

    const state = result.score <= env.collaborationTrustScoreSuspensionProposalThreshold
      ? 'PROPOSAL'
      : result.score < env.collaborationTrustScoreAlertThreshold
        ? 'LOW'
        : 'NORMAL'
    const setting = await prisma.setting.findUnique({ where: { key: stateKey(agent.id) }, select: { value: true } })
    if (setting?.value !== state && state !== 'NORMAL') {
      await notifyAdmins({
        type: state === 'PROPOSAL' ? 'COLLABORATION_TRUST_SUSPENSION_PROPOSED' : 'COLLABORATION_TRUST_SCORE_LOW',
        title: state === 'PROPOSAL' ? 'Suspension à examiner' : 'Score de confiance faible',
        body: state === 'PROPOSAL'
          ? `Le score de confiance de l’agent ${agent.id} est ${result.score}/100. Une suspension est proposée à l’administration, sans suspension automatique.`
          : `Le score de confiance de l’agent ${agent.id} est ${result.score}/100.`,
        link: '/admin/collaboration/trust',
      })
    }
    await prisma.setting.upsert({
      where: { key: stateKey(agent.id) },
      create: { key: stateKey(agent.id), value: state },
      update: { value: state },
    })
  }
  await prisma.setting.upsert({
    where: { key: lastRunKey },
    create: { key: lastRunKey, value: dayKey },
    update: { value: dayKey },
  })
  return { scoreDay: dayKey, agentsCalculated: agents.length }
}
