import { prisma } from '../src/lib/prisma.js'
import {
  decryptLegacyPiiForMigration,
  encryptPii,
  hashNormalizedEmail,
  hashNormalizedPhone,
  isEncryptedPii,
} from '../src/modules/collaboration/report-pii.js'

const batchSize = 100

async function encryptReportPii() {
  let cursor = 0
  let converted = 0

  while (true) {
    const reports = await prisma.report.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: {
        id: true,
        address: true,
        contactPhone: true,
        contactPhoneHash: true,
        contactEmail: true,
        contactEmailHash: true,
      },
    })
    if (!reports.length) break

    for (const report of reports) {
      cursor = report.id
      const phone = decryptLegacyPiiForMigration(report.contactPhone)
      const address = decryptLegacyPiiForMigration(report.address)
      const email = report.contactEmail === null ? null : decryptLegacyPiiForMigration(report.contactEmail)
      const phoneHash = hashNormalizedPhone(phone)
      const emailHash = email ? hashNormalizedEmail(email) : null
      const phoneCiphertext = isEncryptedPii(report.contactPhone) ? report.contactPhone : encryptPii(phone)
      const addressCiphertext = isEncryptedPii(report.address) ? report.address : encryptPii(address)
      const emailCiphertext = email === null || isEncryptedPii(report.contactEmail ?? '')
        ? report.contactEmail
        : encryptPii(email)

      if (phoneCiphertext === report.contactPhone
        && addressCiphertext === report.address
        && emailCiphertext === report.contactEmail
        && phoneHash === report.contactPhoneHash
        && emailHash === report.contactEmailHash) continue

      const updated = await prisma.report.updateMany({
        where: {
          id: report.id,
          address: report.address,
          contactPhone: report.contactPhone,
          contactEmail: report.contactEmail,
        },
        data: {
          address: addressCiphertext,
          contactPhone: phoneCiphertext,
          contactPhoneHash: phoneHash,
          contactEmail: emailCiphertext,
          contactEmailHash: emailHash,
        },
      })
      if (updated.count !== 1) {
        throw new Error(`Concurrent modification while encrypting report ${report.id}; rerun the script after pausing report writes.`)
      }
      converted += 1
    }
  }

  console.log(`Encrypted or verified ${converted} report records.`)
}

void encryptReportPii()
  .catch((error: unknown) => {
    console.error('Report PII encryption failed:', error instanceof Error ? error.message : 'unknown error')
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
