import { prisma } from '../../lib/prisma.js'
import { notifyUser } from '../notifications/notifications.service.js'

export async function expireUnpaidMarketplaceOrders(now = new Date()) {
  const candidates = await prisma.marketplaceOrder.findMany({
    where: {
      paymentStatus: 'A_CONFIRMER',
      status: { notIn: ['ANNULEE', 'EXPEDIEE', 'LIVREE'] },
      OR: [
        { totalAmount: null, quoteExpiresAt: { lte: now } },
        { totalAmount: { not: null }, paymentExpiresAt: { lte: now } },
      ],
    },
    select: { id: true, totalAmount: true },
    orderBy: [{ quoteExpiresAt: 'asc' }, { paymentExpiresAt: 'asc' }],
    take: 100,
  })

  let expiredCount = 0
  for (const candidate of candidates) {
    const expiredOrder = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.marketplaceOrder.updateMany({
        where: {
          id: candidate.id,
          paymentStatus: 'A_CONFIRMER',
          status: { notIn: ['ANNULEE', 'EXPEDIEE', 'LIVREE'] },
          OR: [
            { totalAmount: null, quoteExpiresAt: { lte: now } },
            { totalAmount: { not: null }, paymentExpiresAt: { lte: now } },
          ],
        },
        data: {
          status: 'ANNULEE',
          cancellationReason: candidate.totalAmount === null
            ? 'Délai de 24 heures pour le devis dépassé.'
            : 'Délai de paiement de 24 heures dépassé.',
        },
      })
      if (updated.count !== 1) return null

      const order = await transaction.marketplaceOrder.findUniqueOrThrow({
        where: { id: candidate.id },
        select: { id: true, agentId: true },
      })
      const items = await transaction.marketplaceOrderItem.findMany({
        where: { orderId: candidate.id, variantId: { not: null } },
        select: { variantId: true, quantity: true },
      })
      for (const item of items) {
        if (item.variantId !== null) {
          await transaction.marketplaceProductVariant.updateMany({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          })
        }
      }
      return order
    })

    if (!expiredOrder) continue
    expiredCount += 1
    try {
      await notifyUser(expiredOrder.agentId, {
        type: 'MARKETPLACE_ORDER_EXPIRED',
        title: 'Commande annulée',
        body: `La commande #${expiredOrder.id} a été annulée, car le délai de ${candidate.totalAmount === null ? 'devis' : 'paiement'} de 24 heures est dépassé. Le stock est de nouveau disponible.`,
        link: '/marketplace',
      })
    } catch (error) {
      console.error(`Unable to notify agent about expired marketplace order #${expiredOrder.id}:`, error)
    }
  }
  return expiredCount
}

export function startMarketplaceOrderExpiryScheduler() {
  let currentCycle: Promise<void> | undefined
  const runCycle = () => {
    if (currentCycle) return
    currentCycle = (async () => {
      try {
        const expiredCount = await expireUnpaidMarketplaceOrders()
        if (expiredCount > 0) console.info(`Expired ${expiredCount} unpaid marketplace order(s).`)
      } catch (error) {
        console.error('Marketplace order expiry cycle failed:', error)
      }
    })().finally(() => { currentCycle = undefined })
  }

  const timer = setInterval(runCycle, 60_000)
  runCycle()
  return async () => {
    clearInterval(timer)
    await currentCycle
  }
}
