import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { rename, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import dotenv from 'dotenv'

const serverRoot = resolve(process.cwd())
const loadedEnv = dotenv.config({ path: resolve(serverRoot, '.env.local'), override: false, quiet: true })
if (loadedEnv.error) {
  throw new Error('Unable to load isolated server/.env.local configuration.')
}

const [{ env }, { prisma }] = await Promise.all([
  import('../src/config/env.js'),
  import('../src/lib/prisma.js'),
])

function assertLocalDatabaseTarget() {
  const target = new URL(env.databaseUrl)
  const database = target.pathname.replace(/^\/+/, '').toLowerCase()
  if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname.toLowerCase()) || database !== 'cominnovt') {
    throw new Error('Refusing to create local test users: DATABASE_URL must target localhost/cominnovt.')
  }
}

function makePassword() {
  return randomBytes(32).toString('base64url')
}

const runId = randomBytes(4).toString('hex')
const identities = [
  { key: 'admin', email: `collab-admin-${runId}@example.invalid`, role: 'ADMIN' as const, firstName: 'Admin', lastName: 'Test' },
  { key: 'agentA', email: `collab-agent-a-${runId}@example.invalid`, role: 'AGENT' as const, firstName: 'Agent', lastName: 'A' },
  { key: 'agentB', email: `collab-agent-b-${runId}@example.invalid`, role: 'AGENT' as const, firstName: 'Agent', lastName: 'B' },
  { key: 'agentC', email: `collab-agent-c-${runId}@example.invalid`, role: 'AGENT' as const, firstName: 'Agent', lastName: 'C' },
]
const credentials = Object.fromEntries(identities.map(({ key, email }) => [
  key,
  { email, password: makePassword() },
]))
const credentialPath = resolve(serverRoot, `.test-collaboration-accounts-${runId}.json`)
const temporaryCredentialPath = `${credentialPath}.tmp`

async function main() {
  assertLocalDatabaseTarget()
  if (!env.collaborationEncryptionKey) {
    throw new Error('COLLABORATION_ENCRYPTION_KEY must be configured before creating local test users.')
  }

  const databaseRows = await prisma.$queryRaw<{ databaseName: string | null }[]>`SELECT DATABASE() AS databaseName`
  if (databaseRows[0]?.databaseName?.toLowerCase() !== 'cominnovt') {
    throw new Error('Refusing to create local test users: connected database is not cominnovt.')
  }

  const existing = await prisma.user.findMany({
    where: { email: { in: identities.map(({ email }) => email) } },
    select: { id: true },
  })
  if (existing.length) {
    throw new Error('Refusing to create local test users because a generated email already exists.')
  }

  const passwordHashes = await Promise.all(
    identities.map(({ key }) => bcrypt.hash(credentials[key]!.password, 12)),
  )

  await writeFile(temporaryCredentialPath, JSON.stringify({
    warning: 'Local test credentials only. Do not commit or share this file.',
    accounts: credentials,
  }, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' })

  try {
    const users = await prisma.$transaction(async (transaction) => {
      const created = []
      for (const [index, identity] of identities.entries()) {
        const user = await transaction.user.create({
          data: {
            email: identity.email,
            passwordHash: passwordHashes[index]!,
            role: identity.role,
            status: 'ACTIF',
            ...(identity.role === 'AGENT' ? {
              agentProfile: {
                create: {
                  firstName: identity.firstName,
                  lastName: identity.lastName,
                  phone: `+26100000${runId}${index}`,
                  city: 'Antananarivo',
                },
              },
            } : {}),
          },
          select: { id: true, email: true, role: true },
        })
        created.push(user)
      }
      return created
    })

    await rename(temporaryCredentialPath, credentialPath)
    for (const user of users) {
      console.log(`${user.role} id=${user.id} email=${user.email}`)
    }
    console.log(`Generated test passwords are stored locally in: ${credentialPath}`)
  } catch (error) {
    await unlink(temporaryCredentialPath).catch(() => undefined)
    throw error
  }
}

try {
  await main()
} finally {
  await prisma.$disconnect()
}
