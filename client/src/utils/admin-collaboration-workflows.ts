const collaborationFileTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
export const MAX_COLLABORATION_UPLOAD_BYTES = 10 * 1024 * 1024
export type AdminAuditChainStatus = 'VALID' | 'BROKEN' | 'STALE' | 'UNKNOWN'

export function auditChainTone(status: AdminAuditChainStatus | null): 'valid' | 'broken' | 'uncertain' {
  if (status === 'VALID') return 'valid'
  if (status === 'BROKEN') return 'broken'
  return 'uncertain'
}

export function canResolveAdminDispute(stateKnown: boolean, heldCommissions: number): boolean {
  return stateKnown && heldCommissions === 0
}

export function isAllowedCollaborationUpload(file: { type: string; size: number }): boolean {
  return collaborationFileTypes.has(file.type) && file.size <= MAX_COLLABORATION_UPLOAD_BYTES
}

export function antananarivoDateToIso(value: string): string {
  return new Date(`${value}T12:00:00+03:00`).toISOString()
}

export function antananarivoDayBoundaryToIso(value: string, endOfDay: boolean): string {
  const time = endOfDay ? '23:59:59.999' : '00:00:00.000'
  return new Date(`${value}T${time}+03:00`).toISOString()
}
