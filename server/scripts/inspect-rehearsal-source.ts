import { resolve } from 'node:path'
import dotenv from 'dotenv'

const loaded = dotenv.config({ path: resolve(process.cwd(), '.env.local'), override: false, quiet: true })
if (loaded.error || !process.env.DATABASE_URL) {
  throw new Error('Unable to load isolated local configuration or DATABASE_URL.')
}

const [{ env }, { prisma }] = await Promise.all([
  import('../src/config/env.js'),
  import('../src/lib/prisma.js'),
])

async function main() {
  const configured = new URL(env.databaseUrl)
  if (!['localhost', '127.0.0.1', '::1'].includes(configured.hostname.toLowerCase())
    || configured.pathname.replace(/^\/+/, '').toLowerCase() !== 'cominnovt') {
    throw new Error('Refusing inspection: DATABASE_URL must target localhost/cominnovt.')
  }

  const selected = await prisma.$queryRaw<{ databaseName: string | null }[]>`SELECT DATABASE() AS databaseName`
  if (selected[0]?.databaseName?.toLowerCase() !== 'cominnovt') {
    throw new Error('Refusing inspection: SELECT DATABASE() did not return cominnovt.')
  }

  const tables = await prisma.$queryRaw<{ tableName: string }[]>`
    SELECT table_name AS tableName
    FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `
  const tableNames = new Set(tables.map(({ tableName }) => tableName))
  const counts: Record<string, number> = {}
  for (const tableName of [
    'users',
    'agent_profiles',
    'applications',
    'reports',
    'prospect_contacts',
    'subscription_requests',
    'products',
  ]) {
    if (!tableNames.has(tableName)) continue
    const result = await prisma.$queryRawUnsafe<{ rowCount: bigint }[]>(
      `SELECT COUNT(*) AS rowCount FROM \`${tableName}\``,
    )
    counts[tableName] = Number(result[0]?.rowCount ?? 0n)
  }

  let reportContactStatus: Record<string, number | boolean> | null = null
  if (tableNames.has('reports')) {
    const columns = await prisma.$queryRaw<{ columnName: string }[]>`
      SELECT column_name AS columnName
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'reports'
    `
    const columnNames = new Set(columns.map(({ columnName }) => columnName))
    for (const required of ['contact_phone', 'address']) {
      if (!columnNames.has(required)) {
        throw new Error(`Cannot determine report contact encryption: missing column ${required}.`)
      }
    }
    const hasContactEmail = columnNames.has('contact_email')
    const emailExpression = hasContactEmail
      ? `SUM(contact_email IS NOT NULL AND contact_email LIKE 'v1:%') AS encryptedEmail`
      : '0 AS encryptedEmail'
    const nullEmailExpression = hasContactEmail
      ? 'SUM(contact_email IS NULL) AS nullEmail'
      : '0 AS nullEmail'
    const plaintextEmailExpression = hasContactEmail
      ? `SUM(contact_email IS NOT NULL AND contact_email NOT LIKE 'v1:%') AS plaintextEmail`
      : '0 AS plaintextEmail'
    const result = await prisma.$queryRawUnsafe<{
      reports: bigint
      encryptedAddress: bigint
      encryptedPhone: bigint
      encryptedEmail: bigint
      nullEmail: bigint
      plaintextAddress: bigint
      plaintextPhone: bigint
      plaintextEmail: bigint
    }[]>(`
      SELECT
        COUNT(*) AS reports,
        SUM(address LIKE 'v1:%') AS encryptedAddress,
        SUM(address IS NOT NULL AND address NOT LIKE 'v1:%') AS plaintextAddress,
        SUM(contact_phone LIKE 'v1:%') AS encryptedPhone,
        SUM(contact_phone IS NOT NULL AND contact_phone NOT LIKE 'v1:%') AS plaintextPhone,
        ${emailExpression},
        ${nullEmailExpression},
        ${plaintextEmailExpression}
      FROM reports
    `)
    const row = result[0]
    if (!row) throw new Error('Unable to inspect report encryption markers.')
    reportContactStatus = {
      reports: Number(row.reports),
      encryptedAddress: Number(row.encryptedAddress),
      plaintextAddress: Number(row.plaintextAddress),
      encryptedPhone: Number(row.encryptedPhone),
      plaintextPhone: Number(row.plaintextPhone),
      encryptedEmail: Number(row.encryptedEmail),
      plaintextEmail: Number(row.plaintextEmail),
      nullEmail: Number(row.nullEmail),
    }
  }

  let prospectContactStatus: Record<string, number> | null = null
  if (tableNames.has('prospect_contacts')) {
    const columns = await prisma.$queryRaw<{ columnName: string }[]>`
      SELECT column_name AS columnName
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'prospect_contacts'
    `
    const columnNames = new Set(columns.map(({ columnName }) => columnName))
    for (const required of ['address', 'contact']) {
      if (!columnNames.has(required)) {
        throw new Error(`Cannot determine prospect contact encryption: missing column ${required}.`)
      }
    }
    const result = await prisma.$queryRawUnsafe<{
      totalRows: bigint
      encryptedAddress: bigint | null
      plaintextAddress: bigint | null
      encryptedContact: bigint | null
      plaintextContact: bigint | null
    }[]>(`
      SELECT
        COUNT(*) AS totalRows,
        SUM(address LIKE 'v1:%') AS encryptedAddress,
        SUM(address IS NOT NULL AND address NOT LIKE 'v1:%') AS plaintextAddress,
        SUM(contact LIKE 'v1:%') AS encryptedContact,
        SUM(contact IS NOT NULL AND contact NOT LIKE 'v1:%') AS plaintextContact
      FROM prospect_contacts
    `)
    const row = result[0]
    if (!row) throw new Error('Unable to inspect prospect contact encryption markers.')
    prospectContactStatus = {
      rows: Number(row.totalRows),
      encryptedAddress: Number(row.encryptedAddress ?? 0n),
      plaintextAddress: Number(row.plaintextAddress ?? 0n),
      encryptedContact: Number(row.encryptedContact ?? 0n),
      plaintextContact: Number(row.plaintextContact ?? 0n),
    }
  }

  console.log(JSON.stringify({
    configuredTarget: `${configured.hostname}/${configured.pathname.replace(/^\/+/, '')}`,
    selectedDatabase: selected[0]?.databaseName,
    tables: [...tableNames],
    counts,
    reportContactStatus,
    prospectContactStatus,
    smtpConfigured: Boolean(env.smtpHost || env.smtpUser || env.smtpPassword),
    schedulerEnabled: env.collaborationSchedulerEnabled,
  }, null, 2))
}

try {
  await main()
} finally {
  await prisma.$disconnect()
}
