import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { processPendingContractSignedEvents } from '../src/modules/collaboration/collaboration.commissions.service.js'

function assertLocalDatabaseTarget() {
  const target = new URL(env.databaseUrl)
  const database = target.pathname.replace(/^\/+/, '').toLowerCase()
  if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname.toLowerCase()) || database !== 'cominnovt') {
    throw new Error('Refusing to process commission events: DATABASE_URL must target localhost/cominnovt.')
  }
}

async function main() {
  assertLocalDatabaseTarget()
  const [database] = await prisma.$queryRaw<{ databaseName: string | null }[]>`SELECT DATABASE() AS databaseName`
  if (database?.databaseName?.toLowerCase() !== 'cominnovt') {
    throw new Error('Refusing to process commission events: connected database is not cominnovt.')
  }

  const now = new Date()
  const pendingBefore = await prisma.collaborationDomainEvent.count({
    where: { eventType: 'contract.signed', consumedAt: null },
  })
  await processPendingContractSignedEvents(now)
  const remaining = await prisma.collaborationDomainEvent.count({
    where: { eventType: 'contract.signed', consumedAt: null },
  })
  console.log(`Contract events processed: ${pendingBefore - remaining}. Pending contract events remaining: ${remaining}.`)
}

void main()
  .catch((error: unknown) => {
    console.error('Pending collaboration commission processing failed:', error instanceof Error ? error.message : 'unknown error')
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
