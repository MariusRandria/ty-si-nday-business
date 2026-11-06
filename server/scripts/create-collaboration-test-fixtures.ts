import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { writeFile, rename, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import dotenv from 'dotenv'

const testEnvPath = resolve(process.cwd(), '.env.test')
const loadedTestEnv = dotenv.config({ path: testEnvPath, override: true })
if (loadedTestEnv.error || !loadedTestEnv.parsed?.DATABASE_URL) {
  throw new Error('Unable to load DATABASE_URL from server/.env.test.')
}

const { env } = await import('../src/config/env.js')
const { prisma } = await import('../src/lib/prisma.js')
const {
  encryptPii,
  hashNormalizedCompanyName,
  hashNormalizedEmail,
  hashNormalizedPhone,
  normalizeCompanyNameForHash,
} = await import('../src/modules/collaboration/report-pii.js')

function assertTestDatabase() {
  const url = new URL(env.databaseUrl)
  const database = url.pathname.replace(/^\/+/, '').toLowerCase()
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase()) || database !== 'bases_test') {
    throw new Error('Refusing to create test fixtures: DATABASE_URL must target localhost/bases_test.')
  }
}

function makePassword() {
  return randomBytes(32).toString('base64url')
}

const runId = randomBytes(4).toString('hex')
const identities = [
  { key: 'admin', email: `test-admin-${runId}@example.invalid`, role: 'ADMIN' as const, firstName: 'Admin', lastName: 'Test' },
  { key: 'agentA', email: `test-agent-a-${runId}@example.invalid`, role: 'AGENT' as const, firstName: 'Agent', lastName: 'A' },
  { key: 'agentB', email: `test-agent-b-${runId}@example.invalid`, role: 'AGENT' as const, firstName: 'Agent', lastName: 'B' },
  { key: 'agentC', email: `test-agent-c-${runId}@example.invalid`, role: 'AGENT' as const, firstName: 'Agent', lastName: 'C' },
]

const credentials = Object.fromEntries(identities.map(({ key, email }) => [
  key,
  { email, password: makePassword() },
]))
const credentialPath = resolve(process.cwd(), `.test-collaboration-accounts-${runId}.json`)
const temporaryCredentialPath = `${credentialPath}.tmp`

async function main() {
  assertTestDatabase()
  if (!env.collaborationEncryptionKey) {
    throw new Error('COLLABORATION_ENCRYPTION_KEY must be configured before creating prospect fixtures.')
  }

  const passwordHashes = await Promise.all(
    identities.map(({ key }) => bcrypt.hash(credentials[key]!.password, 12)),
  )

  await writeFile(temporaryCredentialPath, JSON.stringify({
    warning: 'Local test credentials only. Do not commit or share this file.',
    accounts: credentials,
  }, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' })

  try {
    const fixtures = await prisma.$transaction(async (transaction) => {
      const users = []
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
        users.push(user)
      }

      const agents = users.filter(({ role }) => role === 'AGENT')
      const prospects = []
      for (const [index, agent] of agents.entries()) {
        const label = String.fromCharCode(65 + index)
        const companyName = `Entreprise Fictive ${label} ${runId}`
        const contactName = `Contact Démo ${label}`
        const phone = `+261000001${runId}${index}`
        const email = `prospect-${label.toLowerCase()}-${runId}@example.invalid`
        const address = `Adresse fictive ${label}, Antananarivo`
        const phoneHash = hashNormalizedPhone(phone)
        const emailHash = hashNormalizedEmail(email)
        const now = new Date()
        const report = await transaction.report.create({
          data: {
            agentId: agent.id,
            companyName,
            companyNameNormalized: normalizeCompanyNameForHash(companyName),
            contactPhone: encryptPii(phone),
            contactPhoneHash: phoneHash,
            contactEmail: encryptPii(email),
            contactEmailHash: emailHash,
            summary: `Rapport de test fictif ${label}. Aucune société ni personne réelle.`,
            status: 'SOUMIS',
            city: 'Antananarivo',
            address: encryptPii(address),
            contactName,
            contactRole: 'Contact de démonstration',
            contactType: 'APPEL',
            reportNature: 'CONTACT',
            reportType: 'LEAD',
            meetingAt: now,
            interestLevel: 'MOYEN',
            nextStep: 'Donnée de démonstration uniquement.',
          },
          select: { id: true },
        })
        const deal = await transaction.collaborationDeal.create({
          data: {
            reportId: report.id,
            supplierId: agent.id,
            secret: {
              create: {
                companyNameCiphertext: encryptPii(companyName),
                contactNameCiphertext: encryptPii(contactName),
                phoneCiphertext: encryptPii(phone),
                emailCiphertext: encryptPii(email),
                addressCiphertext: encryptPii(address),
                companyNameHash: hashNormalizedCompanyName(companyName),
                phoneHash,
                emailHash,
              },
            },
            statusHistory: {
              create: {
                toStatus: 'DECLARED',
                changedBy: agent.id,
                comment: 'Création de fixture de test fictive.',
              },
            },
          },
          select: { id: true },
        })
        await transaction.collaborationProspectHashClaim.createMany({
          data: [
            { contactType: 'PHONE', contactHash: phoneHash, dealId: deal.id, supplierId: agent.id },
            { contactType: 'EMAIL', contactHash: emailHash, dealId: deal.id, supplierId: agent.id },
          ],
        })
        prospects.push({ label, dealId: deal.id, reportId: report.id, supplierId: agent.id, companyName })
      }

      return { users, prospects }
    })

    await rename(temporaryCredentialPath, credentialPath)
    console.log(`Created test fixture run: ${runId}`)
    for (const user of fixtures.users) {
      console.log(`${user.role} id=${user.id} email=${user.email}`)
    }
    for (const prospect of fixtures.prospects) {
      console.log(`Prospect ${prospect.label}: dealId=${prospect.dealId} reportId=${prospect.reportId} supplierId=${prospect.supplierId} company=${prospect.companyName}`)
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
