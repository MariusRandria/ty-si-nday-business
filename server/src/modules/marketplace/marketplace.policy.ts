import type { MarketplaceDeliveryMethod, MarketplaceOrderStatus, MarketplacePaymentMethod } from '@prisma/client'

export const MARKETPLACE_PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000

const nextOrderStatuses: Record<MarketplaceOrderStatus, readonly MarketplaceOrderStatus[]> = {
  DEMANDEE: ['CONFIRMEE', 'ANNULEE'],
  CONFIRMEE: ['EN_PREPARATION', 'ANNULEE'],
  EN_PREPARATION: ['PRETE', 'ANNULEE'],
  PRETE: ['EXPEDIEE', 'LIVREE', 'ANNULEE'],
  EXPEDIEE: ['LIVREE'],
  LIVREE: [],
  ANNULEE: [],
}

export function canTransitionMarketplaceOrder(from: MarketplaceOrderStatus, to: MarketplaceOrderStatus) {
  return nextOrderStatuses[from].includes(to)
}

export function marketplaceDeliveryRequiresAddress(method: MarketplaceDeliveryMethod) {
  return method !== 'RECUPERATION'
}

export function marketplacePaymentMethodAllowed(deliveryMethod: MarketplaceDeliveryMethod, paymentMethod: MarketplacePaymentMethod) {
  return paymentMethod !== 'ESPECES' || deliveryMethod === 'RECUPERATION'
}

export function marketplaceOrderCanPayWithoutDeadline(status: MarketplaceOrderStatus) {
  return status === 'EXPEDIEE' || status === 'LIVREE'
}

export function calculateMarketplaceOrderTotal(
  lines: Array<{ unitPrice: bigint; quantity: number }>,
  deliveryFee = 0n,
) {
  return lines.reduce((total, line) => total + line.unitPrice * BigInt(line.quantity), deliveryFee)
}

export function marketplacePaymentExpiry(startedAt: Date) {
  return new Date(startedAt.getTime() + MARKETPLACE_PAYMENT_WINDOW_MS)
}
