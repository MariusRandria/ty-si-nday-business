import type { AdminCollaborationDealSummary } from '../api/client'

function priority(deal: AdminCollaborationDealSummary): number {
  if (deal.status === 'DISPUTED' || deal.disputeReason) return 0
  if (deal.clientConfirmationOverrideReason) return 1
  return 2
}

export function sortAdminCollaborationDeals(deals: AdminCollaborationDealSummary[]): AdminCollaborationDealSummary[] {
  return [...deals].sort((a, b) => priority(a) - priority(b)
    || new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    || a.id - b.id)
}
