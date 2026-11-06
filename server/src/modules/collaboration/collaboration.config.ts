import type { Prisma } from '@prisma/client'

export type CollaborationConfig = {
  requestWindowHours: number
  reminderAfterHours: number
  accessDurationDays: number
  requestCooldownHours: number
  maxAccessAttempts: number
}

const defaults: CollaborationConfig = {
  requestWindowHours: 24,
  reminderAfterHours: 12,
  accessDurationDays: 14,
  requestCooldownHours: 24,
  maxAccessAttempts: 3,
}

const settingKeys = {
  requestWindowHours: 'collaboration_request_window_hours',
  reminderAfterHours: 'collaboration_request_reminder_hours',
  accessDurationDays: 'collaboration_access_days',
  requestCooldownHours: 'collaboration_request_cooldown_hours',
  maxAccessAttempts: 'collaboration_max_access_attempts',
} as const satisfies Record<keyof CollaborationConfig, string>

export async function getCollaborationConfig(
  transaction: Pick<Prisma.TransactionClient, 'setting'>,
): Promise<CollaborationConfig> {
  const settings = await transaction.setting.findMany({
    where: { key: { in: Object.values(settingKeys) } },
    select: { key: true, value: true },
  })
  const values = new Map(settings.map(({ key, value }) => [key, value]))
  const config = { ...defaults }
  for (const [field, key] of Object.entries(settingKeys) as [keyof CollaborationConfig, string][]) {
    const raw = values.get(key)
    if (raw === undefined) continue
    const parsed = Number(raw)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new Error(`Setting ${key} must be a positive integer.`)
    }
    config[field] = parsed
  }
  if (config.reminderAfterHours >= config.requestWindowHours) {
    throw new Error('Collaboration reminder delay must be shorter than the request window.')
  }
  return config
}
