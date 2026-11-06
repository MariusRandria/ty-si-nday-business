import { prisma } from '../src/lib/prisma.js'
import { findCommissionReconciliationIssues } from '../src/modules/collaboration/collaboration.commissions.service.js'

async function main() {
  const issues = await findCommissionReconciliationIssues()
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    signedSalesWithCommissionIssues: issues.length,
    issues,
  }, null, 2))
  if (issues.length > 0) process.exitCode = 1
}

void main()
  .catch((error: unknown) => {
    console.error('Collaboration commission reconciliation failed:', error instanceof Error ? error.message : 'unknown error')
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
