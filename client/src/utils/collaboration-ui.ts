export type CollaborationStatus =
  | 'DECLARED'
  | 'ACCESS_GRANTED'
  | 'ACCESS_EXPIRES'
  | 'ACCESS_REQUESTED'
  | 'IN_PROGRESS'
  | 'CLOSING_REPORTED'
  | 'CLIENT_CONFIRMED'
  | 'CONFIRMED_BY_CLIENT'
  | 'NO_RESPONSE'
  | 'CONFIRMED'
  | 'CONTRACT_SIGNED'
  | 'COMMISSIONS_PAID'
  | 'LOST'
  | 'REJECTED'
  | 'DISPUTED'
  | 'EXPIRED'
  | 'CLOSED_SIGNED'
  | 'PENDING'
  | 'PAID'
  | 'CANCELLED'
  | 'ON_HOLD'

export type StatusPresentation = {
  label: string
  tone: 'neutral' | 'info' | 'warning' | 'success' | 'error'
  icon: 'circle' | 'clock' | 'alert' | 'check' | 'x'
}

export const collaborationStatuses: Record<CollaborationStatus, StatusPresentation> = {
  DECLARED: { label: 'Déclaré', tone: 'neutral', icon: 'circle' },
  ACCESS_GRANTED: { label: 'Accès accordé', tone: 'info', icon: 'check' },
  ACCESS_EXPIRES: { label: 'Fin prévue de l’accès', tone: 'warning', icon: 'clock' },
  ACCESS_REQUESTED: { label: 'Demande reçue', tone: 'warning', icon: 'alert' },
  IN_PROGRESS: { label: 'En cours', tone: 'info', icon: 'clock' },
  CLOSING_REPORTED: { label: 'Clôture à vérifier', tone: 'warning', icon: 'alert' },
  CLIENT_CONFIRMED: { label: 'Confirmation client reçue', tone: 'info', icon: 'check' },
  CONFIRMED_BY_CLIENT: { label: 'Confirmé par le client', tone: 'info', icon: 'check' },
  NO_RESPONSE: { label: 'Sans réponse client', tone: 'warning', icon: 'clock' },
  CONFIRMED: { label: 'Validé', tone: 'success', icon: 'check' },
  CONTRACT_SIGNED: { label: 'Contrat signé', tone: 'success', icon: 'check' },
  COMMISSIONS_PAID: { label: 'Commissions payées', tone: 'success', icon: 'check' },
  LOST: { label: 'Non conclu', tone: 'neutral', icon: 'x' },
  REJECTED: { label: 'Rejeté', tone: 'error', icon: 'x' },
  DISPUTED: { label: 'En litige', tone: 'error', icon: 'alert' },
  EXPIRED: { label: 'Expiré', tone: 'error', icon: 'clock' },
  CLOSED_SIGNED: { label: 'Déjà signé par l’admin', tone: 'success', icon: 'check' },
  PENDING: { label: 'Créditée au portefeuille', tone: 'success', icon: 'check' },
  PAID: { label: 'Payée', tone: 'success', icon: 'check' },
  CANCELLED: { label: 'Annulée', tone: 'neutral', icon: 'x' },
  ON_HOLD: { label: 'En attente de décision', tone: 'warning', icon: 'alert' },
}

export function formatAr(amount: string | number | bigint): string {
  const parsed = typeof amount === 'string'
    ? /^-?\d+$/.test(amount)
      ? BigInt(amount)
      : Number(amount)
    : amount
  if (typeof parsed === 'number' && !Number.isFinite(parsed)) throw new Error('Montant invalide.')
  return `${new Intl.NumberFormat('fr-FR').format(parsed).replace(/[\u00a0\u202f]/g, ' ')} Ar`
}

export function formatAntananarivoDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date indisponible'
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Indian/Antananarivo',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function formatCountdown(expiresAt: string | Date, now = Date.now()): string {
  const expiration = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime()
  if (Number.isNaN(expiration)) return 'Échéance inconnue'
  const remainingMinutes = Math.ceil((expiration - now) / 60_000)
  if (remainingMinutes <= 0) return 'Expirée'
  if (remainingMinutes < 60) {
    return remainingMinutes === 1 ? 'Expire dans 1 min' : `Expire dans ${remainingMinutes} min`
  }
  const hours = Math.floor(remainingMinutes / 60)
  const minutes = remainingMinutes % 60
  return minutes === 0
    ? `Expire dans ${hours} h`
    : `Expire dans ${hours} h ${minutes} min`
}
