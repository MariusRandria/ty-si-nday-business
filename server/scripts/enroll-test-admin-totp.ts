import bcrypt from 'bcryptjs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const adminId = 194
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(serverRoot, '.env.test')
const loadedEnv = dotenv.config({ path: envPath, override: true, quiet: true })
if (loadedEnv.error || !loadedEnv.parsed?.DATABASE_URL) {
  throw new Error('Unable to load DATABASE_URL from server/.env.test.')
}

process.env.DOTENV_CONFIG_QUIET = 'true'

const [{ env }, { prisma }, { createTotpEnrollment, encryptTotpSecret, verifyTotp }, { writeCollaborationAudit }] =
  await Promise.all([
    import('../src/config/env.js'),
    import('../src/lib/prisma.js'),
    import('../src/modules/collaboration/admin-totp.js'),
    import('../src/modules/collaboration/collaboration.audit.js'),
  ])

type TestCredentialFile = {
  accounts?: {
    admin?: { email?: string; password?: string }
  }
}

function assertTestDatabaseTarget() {
  const target = new URL(env.databaseUrl)
  const database = target.pathname.replace(/^\/+/, '').toLowerCase()
  if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname.toLowerCase()) || database !== 'bases_test') {
    throw new Error('Refusing to enroll TOTP: DATABASE_URL must target localhost/bases_test.')
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
  assertTestDatabaseTarget()
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Run this script in an interactive terminal so the otpauth URI is shown only once.')
  }

  const databaseRows = await prisma.$queryRaw<{ databaseName: string | null }[]>`SELECT DATABASE() AS databaseName`
  if (databaseRows[0]?.databaseName?.toLowerCase() !== 'bases_test') {
    throw new Error('Refusing to enroll TOTP: the connected database is not bases_test.')
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
      userAgent: 'enroll-test-admin-totp.ts',
    })
  })

  stdout.write(`TOTP enabled and verified for test admin ${adminId}. Use a fresh code for the next admin action.\n`)
}

try {
  await main()
} finally {
  await prisma.$disconnect()
}
