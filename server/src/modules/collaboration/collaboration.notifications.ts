import type { Prisma } from '@prisma/client'

export async function createAvailabilityNotifications(
  transaction: Prisma.TransactionClient,
  dealId: number,
  excludedAgentIds: number[],
) {
  const requests = await transaction.collaborationAccessRequest.findMany({
    where: { dealId },
    select: { requesterId: true },
  })
  const requesterIds = [...new Set(requests
    .map(({ requesterId }) => requesterId)
    .filter((userId) => !excludedAgentIds.includes(userId)))]
  return Promise.all(requesterIds.map((userId) =>
    transaction.notification.create({
      data: {
        userId,
        type: 'COLLABORATION_DEAL_AVAILABLE',
        title: 'Prospect de nouveau disponible',
        body: 'Ce prospect est de nouveau disponible pour une demande d’accès.',
        link: '/collaboration/prospects',
      },
    }),
  ))
}
