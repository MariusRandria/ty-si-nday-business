type TimelineInput = {
  id: number
  status: string
  declaredAt: Date
  accessGrantedAt: Date | null
  accessExpiresAt: Date | null
  closingReportedAt: Date | null
  clientConfirmedAt: Date | null
  confirmedAt: Date | null
  contractSignedAt: Date | null
  saleNumber?: string | null
  statusHistory: { toStatus: string | null; createdAt: Date }[]
}

export function serializeSupplierCollaborationTimeline(deal: TimelineInput) {
  const steps = [
    { status: 'DECLARED', at: deal.declaredAt },
    ...deal.statusHistory
      .filter((entry): entry is { toStatus: string; createdAt: Date } => entry.toStatus !== null)
      .map(({ toStatus, createdAt }) => ({ status: toStatus, at: createdAt })),
    ...(deal.accessGrantedAt ? [{ status: 'ACCESS_GRANTED', at: deal.accessGrantedAt }] : []),
    ...(deal.accessExpiresAt ? [{ status: 'ACCESS_EXPIRES', at: deal.accessExpiresAt }] : []),
    ...(deal.closingReportedAt ? [{ status: 'CLOSING_REPORTED', at: deal.closingReportedAt }] : []),
    ...(deal.clientConfirmedAt ? [{ status: 'CONFIRMED_BY_CLIENT', at: deal.clientConfirmedAt }] : []),
    ...(deal.confirmedAt ? [{ status: 'CONFIRMED', at: deal.confirmedAt }] : []),
    ...(deal.contractSignedAt ? [{ status: 'CONTRACT_SIGNED', at: deal.contractSignedAt }] : []),
  ].sort((a, b) => a.at.getTime() - b.at.getTime())
  const signedSaleNumber = ['CONTRACT_SIGNED', 'COMMISSIONS_PAID'].includes(deal.status)
    && deal.contractSignedAt !== null
    ? deal.saleNumber
    : null
  return {
    dealId: deal.id,
    status: deal.status,
    steps,
    ...(signedSaleNumber ? { saleNumber: signedSaleNumber } : {}),
  }
}
