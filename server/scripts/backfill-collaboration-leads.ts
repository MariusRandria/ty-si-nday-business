import { prisma } from '../src/lib/prisma.js'
import {
  decryptPii,
  encryptPii,
  hashNormalizedCompanyName,
  hashNormalizedEmail,
  hashNormalizedPhone,
  isEncryptedPii,
} from '../src/modules/collaboration/report-pii.js'

const applyableStatuses = ['SOUMIS', 'EN_VERIFICATION', 'A_COMPLETER'] as const

function option(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
}

function reportIds(): number[] | undefined {
  const raw = option('report-ids')
  if (!raw) return undefined
  const ids = raw.split(',').map((value) => Number(value.trim()))
  if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error('--report-ids must be a comma-separated list of positive integers.')
  }
  return [...new Set(ids)]
}

function validateBatchId(value: string | undefined): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('Apply/rollback requires --batch-id=<UUID> so the backfill can be safely reversed.')
  }
  return value
}

async function preview(ids?: number[]) {
  const reports = await prisma.report.findMany({
    where: {
      reportType: 'LEAD',
      collaborationDeal: null,
      ...(ids ? { id: { in: ids } } : {}),
    },
    orderBy: { id: 'asc' },
    select: { id: true, status: true },
  })
  const summary = Object.fromEntries(
    [...new Set(reports.map(({ status }) => status))].map((status) => [
      status,
      reports.filter((report) => report.status === status).length,
    ]),
  )
  console.log(JSON.stringify({
    mode: 'preview',
    candidates: reports.length,
    applyableStatuses,
    byStatus: summary,
    reportIds: reports.map(({ id }) => id),
  }, null, 2))
}

async function applyBackfill(ids: number[], batchId: string) {
  if (!ids.length) throw new Error('Apply requires --report-ids; do not backfill legacy leads implicitly.')
  const reports = await prisma.report.findMany({
    where: {
      id: { in: ids },
      reportType: 'LEAD',
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      agentId: true,
      status: true,
      companyName: true,
      contactName: true,
      contactPhone: true,
      contactEmail: true,
      address: true,
      collaborationDeal: { select: { id: true, legacyBackfillBatchId: true } },
    },
  })
  if (reports.length !== ids.length) {
    throw new Error('Some selected IDs are missing or are not LEAD reports.')
  }
  for (const report of reports) {
    if (report.collaborationDeal?.legacyBackfillBatchId === batchId) continue
    if (report.collaborationDeal) {
      throw new Error(`Report ${report.id} is already linked to a different collaboration deal or backfill batch.`)
    }
    if (!applyableStatuses.some((status) => status === report.status)) {
      throw new Error(`Report ${report.id} has a finalized or ineligible status (${report.status}).`)
    }
    if (![report.contactPhone, report.address, ...(report.contactEmail ? [report.contactEmail] : [])].every(isEncryptedPii)) {
      throw new Error(`Report ${report.id} is not encrypted. Run db:encrypt-report-pii before this backfill.`)
    }
  }

  const processed: { reportId: number; dealId: number; alreadyPresent: boolean }[] = []
  for (const report of reports) {
    if (report.collaborationDeal?.legacyBackfillBatchId === batchId) {
      processed.push({ reportId: report.id, dealId: report.collaborationDeal.id, alreadyPresent: true })
      continue
    }
    const phone = decryptPii(report.contactPhone)
    const email = report.contactEmail === null ? null : decryptPii(report.contactEmail)
    const address = decryptPii(report.address)
    const deal = await prisma.$transaction(async (transaction) => {
      const current = await transaction.report.findUnique({
        where: { id: report.id },
        select: {
          status: true,
          collaborationDeal: { select: { id: true, legacyBackfillBatchId: true } },
        },
      })
      if (!current) throw new Error(`Report ${report.id} disappeared during backfill.`)
      if (current.collaborationDeal?.legacyBackfillBatchId === batchId) {
        return { id: current.collaborationDeal.id, alreadyPresent: true }
      }
      if (current.collaborationDeal
        || !applyableStatuses.some((status) => status === current.status)) {
        throw new Error(`Report ${report.id} changed or was linked during backfill.`)
      }
      const createdDeal = await transaction.collaborationDeal.create({
        data: {
          reportId: report.id,
          supplierId: report.agentId,
          legacyBackfillBatchId: batchId,
          secret: {
            create: {
              companyNameCiphertext: encryptPii(report.companyName),
              contactNameCiphertext: encryptPii(report.contactName),
              phoneCiphertext: encryptPii(phone),
              emailCiphertext: email ? encryptPii(email) : null,
              addressCiphertext: encryptPii(address),
              companyNameHash: hashNormalizedCompanyName(report.companyName),
              phoneHash: hashNormalizedPhone(phone),
              emailHash: email ? hashNormalizedEmail(email) : null,
            },
          },
        },
      })
      await transaction.collaborationDealStatusHistory.create({
        data: {
          dealId: createdDeal.id,
          toStatus: 'DECLARED',
          comment: 'Dossier créé par le backfill des rapports LEAD historiques.',
        },
      })
      return { id: createdDeal.id, alreadyPresent: false }
    })
    processed.push({ reportId: report.id, dealId: deal.id, alreadyPresent: deal.alreadyPresent })
    if (!deal.alreadyPresent) console.log(`Created collaboration deal ${deal.id} for LEAD report ${report.id}.`)
  }
  console.log(JSON.stringify({ mode: 'apply', batchId, processed }, null, 2))
}

async function rollback(batchId: string) {
  const deals = await prisma.collaborationDeal.findMany({
    where: { legacyBackfillBatchId: batchId },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      status: true,
      closerId: true,
      accessGrantedAt: true,
      accessExpiresAt: true,
      _count: {
        select: {
          accessRequests: true,
          evidence: true,
          commissions: true,
          emailJobs: true,
          auditEntries: true,
          domainEvents: true,
        },
      },
      closingReport: { select: { id: true } },
      clientConfirmation: { select: { id: true } },
      statusHistory: { select: { toStatus: true, changedBy: true } },
    },
  })
  const unsafe = deals.filter((deal) =>
    deal.status !== 'DECLARED'
    || deal.closerId !== null
    || deal.accessGrantedAt !== null
    || deal.accessExpiresAt !== null
    || Object.values(deal._count).some((count) => count !== 0)
    || deal.closingReport !== null
    || deal.clientConfirmation !== null
    || deal.statusHistory.length !== 1
    || deal.statusHistory[0].toStatus !== 'DECLARED'
    || deal.statusHistory[0].changedBy !== null,
  )
  if (unsafe.length) {
    throw new Error(`Rollback refused: deals have live activity or changed state: ${unsafe.map(({ id }) => id).join(', ')}.`)
  }
  await prisma.$transaction(async (transaction) => {
    const ids = deals.map(({ id }) => id)
    if (!ids.length) return
    await transaction.collaborationDealStatusHistory.deleteMany({ where: { dealId: { in: ids } } })
    await transaction.collaborationProspectSecret.deleteMany({ where: { dealId: { in: ids } } })
    await transaction.collaborationDeal.deleteMany({ where: { id: { in: ids }, legacyBackfillBatchId: batchId } })
  })
  console.log(JSON.stringify({ mode: 'rollback', batchId, removedDealIds: deals.map(({ id }) => id) }, null, 2))
}

async function main() {
  const mode = option('mode') ?? 'preview'
  const ids = reportIds()
  if (mode === 'preview') {
    await preview(ids)
    return
  }
  const batchId = validateBatchId(option('batch-id'))
  if (mode === 'apply') {
    if (!ids) throw new Error('Apply requires --report-ids=1,2,...')
    await applyBackfill(ids, batchId)
    return
  }
  if (mode === 'rollback') {
    await rollback(batchId)
    return
  }
  throw new Error('--mode must be preview, apply or rollback.')
}

void main()
  .catch((error: unknown) => {
    console.error('Collaboration LEAD backfill failed:', error instanceof Error ? error.message : 'unknown error')
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
