import { prisma } from '../src/lib/prisma.js'
import { verifyCollaborationAuditChain } from '../src/modules/collaboration/collaboration.audit-verification.js'

try {
  const result = await verifyCollaborationAuditChain()
  console.log(JSON.stringify(result, null, 2))
  if (!result.valid) process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
