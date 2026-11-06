import { Prisma, type Prisma as PrismaTypes } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

type WalletDatabase = PrismaTypes.TransactionClient | typeof prisma

export const DEFAULT_WITHDRAWAL_MINIMUM = 100_000

export async function getWithdrawalMinimum(database: WalletDatabase) {
  const setting = await database.setting.findUnique({
    where: { key: 'withdrawal_minimum' },
    select: { value: true },
  })
  if (!setting) return DEFAULT_WITHDRAWAL_MINIMUM
  if (!/^\d+$/.test(setting.value) || !Number.isSafeInteger(Number(setting.value))) {
    throw new Error('The configured withdrawal minimum must be a non-negative safe integer.')
  }
  return Number(setting.value)
}

async function sumCollaborationCommissions(
  database: WalletDatabase,
  agentId: number,
  statuses: Array<'PENDING' | 'ON_HOLD' | 'PAID'>,
) {
  const [result] = await database.$queryRaw<{ amount: string }[]>`
    SELECT CAST(COALESCE(SUM(commission.amount + COALESCE(adjustments.total, 0)), 0) AS CHAR) AS amount
    FROM collaboration_commissions AS commission
    LEFT JOIN (
      SELECT commission_id, SUM(amount) AS total
      FROM collaboration_commission_adjustments
      GROUP BY commission_id
    ) AS adjustments ON adjustments.commission_id = commission.id
    WHERE commission.agent_id = ${agentId}
      AND commission.status IN (${Prisma.join(statuses)})
      AND commission.currency = 'Ar'
  `
  return BigInt(result?.amount ?? '0')
}

export function getAvailableCollaborationCommissionAmount(database: WalletDatabase, agentId: number) {
  return sumCollaborationCommissions(database, agentId, ['PENDING'])
}

export function getTotalCollaborationCommissionAmount(database: WalletDatabase, agentId: number) {
  return sumCollaborationCommissions(database, agentId, ['PENDING', 'ON_HOLD', 'PAID'])
}
