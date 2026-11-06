import bcrypt from 'bcryptjs'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import dotenv from 'dotenv'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const serverRoot = resolve(process.cwd())
const loadedEnv = dotenv.config({ path: resolve(serverRoot, '.env.local'), override: false, quiet: true })
if (loadedEnv.error) {
  throw new Error('Unable to load isolated server/.env.local configuration.')
}

const [{ env }, { prisma }, { createTotpEnrollment, encryptTotpSecret, verifyTotp }, { writeCollaborationAudit }] =
  await Promise.all([
    import('../src/config/env.js'),
    import('../src/lib/prisma.js'),
    import('../src/modules/collaboration/admin-totp.js'),
    import('../src/modules/collaboration/collaboration.audit.js'),
  ])

const rawAdminId = process.argv.find((argument) => argument.startsWith('--admin-id='))?.slice('--admin-id='.length)
const adminId = Number(rawAdminId)
if (!rawAdminId || !Number.isSafeInteger(adminId) || adminId < 1) {
  throw new Error('Usage: tsx scripts/enroll-local-test-admin-totp.ts --admin-id=<ID>')
}

type TestCredentialFile = {
  accounts?: {
    admin?: { email?: string; password?: string }
  }
}

function assertLocalDatabaseTarget() {
  const target = new URL(env.databaseUrl)
  const database = target.pathname.replace(/^\/+/, '').toLowerCase()
  if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname.toLowerCase()) || database !== 'cominnovt') {
    throw new Error('Refusing to enroll TOTP: DATABASE_URL must target localhost/cominnovt.')
  }
}

async function findAdminTestCredential(email: string) {
  const entries = await readdir(serverRoot)
  const credentialFiles = entries.filter((entry) => /^\.test-collaboration-accounts-.+\.json$/.test(entry))
  for (const filename of credentialFiles) {
    const contents = await readFile(resolve(serverRoot, filename), 'utf8')
    const parsed = JSON.parse(contents) as TestCredentialFile
    const credential = parsed.accounts?.admin
    if (credential?.email?.toLowerCase() === email.toLowerCase() && credential.password) {
      return credential.password
    }
  }
  throw new Error('No matching local test admin credentials file was found.')
}

async function promptForEnrollmentCode(secret: string) {
  const terminal = createInterface({ input: stdin, output: stdout })
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = (await terminal.question('Saisissez le code à 6 chiffres affiché dans votre application : ')).trim()
      const step = verifyTotp(secret, code)
      if (step !== null) return step
      stdout.write('Code invalide ou expiré; réessayez avec le code courant.\n')
    }
  } finally {
    terminal.close()
  }
  throw new Error('TOTP enrollment was not verified; no database change was made.')
}

async function main() {
  assertLocalDatabaseTarget()
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Run this script in an interactive terminal so the otpauth URI is shown only once.')
  }

  const databaseRows = await prisma.$queryRaw<{ databaseName: string | null }[]>`SELECT DATABASE() AS databaseName`
  if (databaseRows[0]?.databaseName?.toLowerCase() !== 'cominnovt') {
    throw new Error('Refusing to enroll TOTP: connected database is not cominnovt.')
  }

  const admin = await prisma.user.findUnique({
    where: { id: adminId },
    select: { id: true, email: true, role: true, status: true, passwordHash: true, totpEnabled: true },
  })
  if (!admin || admin.role !== 'ADMIN' || admin.status !== 'ACTIF') {
    throw new Error(`Active ADMIN account ${adminId} was not found.`)
  }
  if (admin.totpEnabled) {
    throw new Error(`TOTP is already enabled for admin ${adminId}; refusing to replace its secret.`)
  }

  const password = await findAdminTestCredential(admin.email)
  if (!(await bcrypt.compare(password, admin.passwordHash))) {
    throw new Error('The local credential file does not match the admin account.')
  }

  const enrollment = createTotpEnrollment(admin.email)
  stdout.write(`Scan this URI once with your authenticator app:\n${enrollment.uri}\n`)
  const verifiedStep = await promptForEnrollmentCode(enrollment.secret)

  await prisma.$transaction(async (transaction) => {
    const updated = await transaction.user.updateMany({
      where: { id: adminId, role: 'ADMIN', status: 'ACTIF', totpEnabled: false },
      data: {
        totpSecretCiphertext: encryptTotpSecret(enrollment.secret),
        totpEnabled: true,
        totpLastUsedStep: verifiedStep,
      },
    })
    if (updated.count !== 1) {
      throw new Error('Admin status changed during enrollment; no TOTP secret was saved.')
    }
    await writeCollaborationAudit(transaction, {
      actorId: adminId,
      actorRole: 'ADMIN',
      action: 'ADMIN_TOTP_ENABLED',
      entityType: 'User',
      entityId: adminId,
      metadata: { method: 'LOCAL_TEST_ENROLLMENT' },
      userAgent: 'enroll-local-test-admin-totp.ts',
    })
  })

  stdout.write(`TOTP enabled and verified for local test admin ${adminId}. Use a fresh code for the next admin action.\n`)
}

try {
  await main()
} finally {
  await prisma.$disconnect()
}
