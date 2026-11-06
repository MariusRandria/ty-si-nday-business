import { createHmac, randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Response } from 'express'
import { env } from '../../config/env.js'

const privateDirectory = fileURLToPath(new URL('../../../../private-uploads/collaboration/', import.meta.url))
const maxFileSize = 10 * 1024 * 1024
const urlLifetimeSeconds = 5 * 60

const fileTypes = {
  'application/pdf': { extension: 'pdf', signature: (buffer: Buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-' },
  'image/jpeg': { extension: 'jpg', signature: (buffer: Buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  'image/png': { extension: 'png', signature: (buffer: Buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  'image/webp': { extension: 'webp', signature: (buffer: Buffer) => buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP' },
} as const

export type CollaborationFileInput = {
  buffer: Buffer
  mimetype: string
  originalname: string
  size: number
}

export function getMaxCollaborationFileSize(): number {
  return maxFileSize
}

export function hashEvidence(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export async function persistCollaborationFile(file: CollaborationFileInput) {
  if (file.size < 1 || file.size > maxFileSize || file.buffer.length !== file.size) {
    throw new Error('Collaboration evidence must be between 1 byte and 10 MiB.')
  }
  const type = fileTypes[file.mimetype as keyof typeof fileTypes]
  if (!type || !type.signature(file.buffer)) {
    throw new Error('Only valid PDF, JPEG, PNG or WebP evidence is accepted.')
  }
  const storageKey = `${randomUUID()}.${type.extension}`
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 })
  await writeFile(join(privateDirectory, storageKey), file.buffer, { flag: 'wx', mode: 0o600 })
  return {
    storageKey,
    fileName: file.originalname.replace(/[\r\n"]/g, '_').slice(0, 255) || `evidence.${type.extension}`,
    mimeType: file.mimetype,
    fileSize: file.size,
    sha256: hashEvidence(file.buffer),
  }
}

function signingKey(): Buffer {
  const key = Buffer.from(env.collaborationEncryptionKey, 'base64')
  if (!env.collaborationEncryptionKey || key.length !== 32) {
    throw new Error('COLLABORATION_ENCRYPTION_KEY must be configured before generating private file links.')
  }
  return key
}

function signature(evidenceId: number, storageKey: string, expiresAt: number): string {
  return createHmac('sha256', signingKey()).update(`${evidenceId}:${storageKey}:${expiresAt}`).digest('hex')
}

export function isValidSignedEvidenceUrl(
  evidenceId: number,
  storageKey: string,
  expiresAt: number,
  suppliedSignature: string,
  now = Date.now(),
): boolean {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)
    || expiresAt > Math.floor(now / 1000) + urlLifetimeSeconds
    || !/^[a-f0-9-]{36}\.(pdf|jpg|png|webp)$/.test(storageKey)
    || !/^[a-f0-9]{64}$/.test(suppliedSignature)) return false
  const expected = signature(evidenceId, storageKey, expiresAt)
  return timingSafeEqual(Buffer.from(expected), Buffer.from(suppliedSignature))
}

export function createSignedEvidenceUrl(evidenceId: number, storageKey: string, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + urlLifetimeSeconds
  const sig = signature(evidenceId, storageKey, expiresAt)
  return `/api/collaboration/public/files/${evidenceId}?expires=${expiresAt}&sig=${sig}`
}

export async function sendSignedEvidence(
  evidenceId: number,
  storageKey: string,
  expiresAt: number,
  suppliedSignature: string,
  response: Response,
  now = Date.now(),
) {
  if (!isValidSignedEvidenceUrl(evidenceId, storageKey, expiresAt, suppliedSignature, now)) {
    response.status(403).json({ error: 'Lien de téléchargement invalide ou expiré.' })
    return
  }
  const buffer = await readFile(join(privateDirectory, storageKey))
  response.setHeader('Content-Type', storageKey.endsWith('.pdf') ? 'application/pdf'
    : storageKey.endsWith('.jpg') ? 'image/jpeg'
      : storageKey.endsWith('.png') ? 'image/png' : 'image/webp')
  response.setHeader('Content-Length', buffer.length)
  response.setHeader('Content-Disposition', 'attachment')
  response.setHeader('Cache-Control', 'private, no-store, max-age=0')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.status(200).send(buffer)
}

export async function removeCollaborationFile(storageKey: string) {
  if (!/^[a-f0-9-]{36}\.(pdf|jpg|png|webp)$/.test(storageKey)) {
    throw new Error('Invalid collaboration file storage key.')
  }
  const { unlink } = await import('node:fs/promises')
  await unlink(join(privateDirectory, storageKey))
}

export function createClientConfirmationCode(): string {
  return randomBytes(4).readUInt32BE(0).toString().padStart(8, '0').slice(-8)
}

export function createClientConfirmationPublicToken(): string {
  return randomBytes(24).toString('base64url')
}

export function isClientConfirmationPublicToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(value)
}

export function hashClientConfirmationPublicToken(value: string): string {
  if (!isClientConfirmationPublicToken(value)) throw new Error('Invalid public confirmation token.')
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function compareClientConfirmationTokenHashes(left: string, right: string): boolean {
  const leftIsHash = /^[a-f0-9]{64}$/.test(left)
  const rightIsHash = /^[a-f0-9]{64}$/.test(right)
  const leftBuffer = leftIsHash ? Buffer.from(left, 'hex') : Buffer.alloc(32)
  const rightBuffer = rightIsHash ? Buffer.from(right, 'hex') : Buffer.alloc(32)
  return timingSafeEqual(leftBuffer, rightBuffer) && leftIsHash && rightIsHash
}

export function hashClientConfirmationCode(code: string, confirmationId: number): string {
  const key = signingKey()
  return createHmac('sha256', key).update(`${confirmationId}:${code}`).digest('hex')
}
