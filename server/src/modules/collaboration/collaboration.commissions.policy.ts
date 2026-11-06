import type { CollaborationCommissionRole, CollaborationCommissionStatus } from '@prisma/client'

export type CollaborationCommissionConfig = {
  providerAmount: number
  closerAmount: number
  currency: string
}

export function validateCommissionConfig(config: CollaborationCommissionConfig): CollaborationCommissionConfig {
  for (const [name, value] of [
    ['COMMISSION_PROVIDER_AMOUNT', config.providerAmount],
    ['COMMISSION_CLOSER_AMOUNT', config.closerAmount],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer.`)
  }
  if (!/^[A-Za-z]{2,8}$/.test(config.currency)) throw new Error('COMMISSION_CURRENCY must be a short alphabetic code.')
  return config
}

export function amountForCommissionRole(
  role: CollaborationCommissionRole,
  config: Pick<CollaborationCommissionConfig, 'providerAmount' | 'closerAmount'>,
): bigint {
  return BigInt(role === 'SUPPLIER' ? config.providerAmount : config.closerAmount)
}

export function canResolveHeldCommission(status: CollaborationCommissionStatus): boolean {
  return status === 'PENDING' || status === 'ON_HOLD'
}

export function shouldCompleteCommissionsPaid(statuses: CollaborationCommissionStatus[]): boolean {
  return statuses.length === 2 && statuses.every((status) => status === 'PAID')
}

export function disputeResolutionStatus(
  statuses: CollaborationCommissionStatus[],
): 'CONTRACT_SIGNED' | 'COMMISSIONS_PAID' | null {
  if (statuses.length !== 2 || statuses.some((status) => status === 'PENDING' || status === 'ON_HOLD')) {
    return null
  }
  return shouldCompleteCommissionsPaid(statuses) ? 'COMMISSIONS_PAID' : 'CONTRACT_SIGNED'
}

export function hasExactlyExpectedCommissionRecipients(
  commissions: { role: CollaborationCommissionRole; agentId: number }[],
  supplierId: number,
  closerId: number | null,
): boolean {
  if (closerId === null || commissions.length !== 2) return false
  return commissions.some(({ role, agentId }) => role === 'SUPPLIER' && agentId === supplierId)
    && commissions.some(({ role, agentId }) => role === 'CLOSER' && agentId === closerId)
}

export function isCommissionGenerationReady(input: {
  contractSignedAt: Date | null
  saleNumber: string | null
  closerId: number | null
}): boolean {
  return input.contractSignedAt !== null && Boolean(input.saleNumber) && input.closerId !== null
}
