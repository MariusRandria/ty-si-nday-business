import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from '../../config/env.js'

const ciphertextPrefix = 'v1:'
const nonceSize = 12
const authTagSize = 16

function getEncryptionKey(): Buffer {
  const encodedKey = env.collaborationEncryptionKey
  const key = Buffer.from(encodedKey, 'base64')
  if (!encodedKey || key.length !== 32 || key.toString('base64') !== encodedKey) {
    throw new Error('COLLABORATION_ENCRYPTION_KEY must be configured as a canonical base64-encoded 32-byte key.')
  }
  return key
}

export function isEncryptedPii(value: string): boolean {
  return value.startsWith(ciphertextPrefix)
}

export function encryptPii(value: string): string {
  const nonce = randomBytes(nonceSize)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), nonce)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const payload = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64')
  return `${ciphertextPrefix}${payload}`
}

export function decryptPii(value: string): string {
  if (!isEncryptedPii(value)) throw new Error('Report PII has not been encrypted. Run the report data migration before serving this record.')
  try {
    const payload = Buffer.from(value.slice(ciphertextPrefix.length), 'base64')
    if (payload.length < nonceSize + authTagSize) throw new Error('Ciphertext payload is too short.')
    const nonce = payload.subarray(0, nonceSize)
    const authTag = payload.subarray(nonceSize, nonceSize + authTagSize)
    const encrypted = payload.subarray(nonceSize + authTagSize)
    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), nonce)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Report PII decryption failed. Verify the configured encryption key and complete data migration.')
  }
}

export function decryptLegacyPiiForMigration(value: string): string {
  return isEncryptedPii(value) ? decryptPii(value) : value
}

export function normalizePhoneForHash(value: string): string {
  return value.replace(/\D/g, '')
}

export function normalizeEmailForHash(value: string): string {
  return value.trim().toLowerCase()
}

export function normalizeCompanyNameForHash(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export function hashNormalizedPhone(value: string): string {
  return createHash('sha256').update(normalizePhoneForHash(value), 'utf8').digest('hex')
}

export function hashNormalizedEmail(value: string): string {
  return createHash('sha256').update(normalizeEmailForHash(value), 'utf8').digest('hex')
}

export function hashNormalizedCompanyName(value: string): string {
  return createHash('sha256').update(normalizeCompanyNameForHash(value), 'utf8').digest('hex')
}

export function decryptReportPii<T extends { address: string; contactPhone: string; contactEmail: string | null }>(report: T): T {
  return {
    ...report,
    address: decryptPii(report.address),
    contactPhone: decryptPii(report.contactPhone),
    contactEmail: report.contactEmail === null ? null : decryptPii(report.contactEmail),
  }
}

export type MaskedCollaborationReportInput = {
  dealId: number
  id: number
  contactName: string
  city: string
  reportNature: string
  reportType: string
  meetingAt: Date
  createdAt: Date
  status: string
  agent: { id: number; agentProfile: { firstName: string; lastName: string } | null }
}

export function maskContactName(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'Prospect'
  const firstInitial = Array.from(parts[0])[0]?.toLocaleUpperCase('fr-FR') ?? '*'
  if (parts.length === 1) return `${firstInitial}***`
  const lastInitial = Array.from(parts[parts.length - 1])[0]?.toLocaleUpperCase('fr-FR') ?? '*'
  return `${firstInitial}*** ${lastInitial}.`
}

export function serializeMaskedCollaborationReport(report: MaskedCollaborationReportInput) {
  const supplierName = report.agent.agentProfile
    ? `${report.agent.agentProfile.firstName} ${report.agent.agentProfile.lastName}`.trim()
    : 'Agent'
  return {
    dealId: report.dealId,
    reportId: report.id,
    prospectName: maskContactName(report.contactName),
    city: report.city,
    reportNature: report.reportNature,
    reportType: report.reportType,
    meetingAt: report.meetingAt,
    createdAt: report.createdAt,
    status: report.status,
    supplier: { id: report.agent.id, name: supplierName },
  }
}
