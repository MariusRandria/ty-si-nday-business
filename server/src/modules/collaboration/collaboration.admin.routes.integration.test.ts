import assert from 'node:assert/strict'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import jwt from 'jsonwebtoken'
import test, { after } from 'node:test'

if (!process.env.COLLABORATION_ENCRYPTION_KEY) {
  process.env.COLLABORATION_ENCRYPTION_KEY = randomBytes(32).toString('base64')
}

const [{ createApp }, { env }, { prisma }, { encryptTotpSecret }] = await Promise.all([
  import('../../app.js'),
  import('../../config/env.js'),
  import('../../lib/prisma.js'),
  import('./admin-totp.js'),
])
const [{ encryptPii }] = await Promise.all([import('./report-pii.js')])

const databaseUrl = new URL(env.databaseUrl)
const enabled = ['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname.toLowerCase())
  && databaseUrl.pathname.replace(/^\//, '').toLowerCase() === 'bases_test'

let server: Server | null = null
let baseUrl = ''
if (enabled) {
  server = createServer(createApp())
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.')
  baseUrl = `http://127.0.0.1:${address.port}`
}

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => error ? reject(error) : resolve())
      server!.closeAllConnections()
    })
  }
  await prisma.$disconnect()
})

const routePaths = [
  '/api/admin/collaboration/dashboard',
  '/api/admin/collaboration/deals/ready-to-sign',
  '/api/admin/collaboration/alerts',
  '/api/admin/collaboration/audit/verification',
  '/api/admin/collaboration/deals',
  '/api/admin/collaboration/deals?status=DISPUTED',
  '/api/admin/collaboration/deals/overrides',
  '/api/admin/collaboration/trust?page=1&limit=1',
  '/api/admin/collaboration/agents/active?page=1&limit=1',
]

function base32Encode(value: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let buffer = 0
  let output = ''
  for (const byte of value) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += alphabet[(buffer >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits) output += alphabet[(buffer << (5 - bits)) & 31]
  return output
}

function decodeBase32(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let buffer = 0
  const bytes: number[] = []
  for (const character of value) {
    const index = alphabet.indexOf(character)
    if (index < 0) throw new Error('Invalid test TOTP secret.')
    buffer = (buffer << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

function totpCode(secret: string, now = Date.now()): string {
  const step = BigInt(Math.floor(now / 30_000))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(step)
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest()
  const offset = digest[digest.length - 1] & 15
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(number).padStart(6, '0')
}

function tokenFor(id: number, role: 'AGENT' | 'ADMIN'): string {
  return jwt.sign({ id, role, status: 'ACTIF' }, env.jwtSecret, { expiresIn: '10m' })
}

function rateLimitBucketKey(scope: string): string {
  return createHmac('sha256', env.jwtSecret).update(`${scope}:127.0.0.1`).digest('hex')
}

async function request(path: string, token: string, totp?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      ...(totp ? { 'x-admin-totp': totp } : {}),
    },
  })
}

async function createAgent(suffix: string) {
  const user = await prisma.user.create({
    data: {
      email: `admin-routes-agent-${suffix}@test.invalid`,
      passwordHash: 'test-only-not-a-real-password',
      role: 'AGENT',
      status: 'ACTIF',
      agentProfile: {
        create: {
          firstName: 'Integration',
          lastName: suffix.slice(0, 8),
          phone: `032${randomBytes(8).toString('hex')}`,
          city: 'Test',
        },
      },
    },
    select: { id: true },
  })
  return user.id
}

async function createAdmin(suffix: string, totpEnabled: boolean) {
  const user = await prisma.user.create({
    data: {
      email: `admin-routes-admin-${suffix}@test.invalid`,
      passwordHash: 'test-only-not-a-real-password',
      role: 'ADMIN',
      status: 'ACTIF',
      totpEnabled,
      totpSecretCiphertext: totpEnabled ? encryptTotpSecret(base32Encode(randomBytes(20))) : null,
    },
    select: { id: true },
  })
  return user.id
}

async function adminGet(adminId: number, path: string): Promise<Response> {
  const secret = base32Encode(randomBytes(20))
  await prisma.user.update({
    where: { id: adminId },
    data: {
      totpSecretCiphertext: encryptTotpSecret(secret),
      totpEnabled: true,
      totpLastUsedStep: null,
    },
  })
  return request(path, tokenFor(adminId, 'ADMIN'), totpCode(secret))
}

async function adminPatch(adminId: number, path: string, body: unknown): Promise<Response> {
  const secret = base32Encode(randomBytes(20))
  await prisma.user.update({
    where: { id: adminId },
    data: {
      totpSecretCiphertext: encryptTotpSecret(secret),
      totpEnabled: true,
      totpLastUsedStep: null,
    },
  })
  return requestPatch(path, tokenFor(adminId, 'ADMIN'), body, totpCode(secret))
}

async function requestPatch(path: string, token: string, body: unknown, totp?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(totp ? { 'x-admin-totp': totp } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function createDealFixture(
  supplierId: number,
  suffix: string,
  status: 'CLOSING_REPORTED' | 'CONFIRMED' | 'CONTRACT_SIGNED' | 'DISPUTED',
  now: Date,
) {
  return prisma.$transaction(async (transaction) => {
    const report = await transaction.report.create({
      data: {
        agentId: supplierId,
        companyName: `Private Company ${suffix}`,
        companyNameNormalized: `private company ${suffix}`,
        contactPhone: `PRIVATE_PHONE_${suffix}`,
        contactPhoneHash: 'a'.repeat(64),
        contactEmail: `private-${suffix}@test.invalid`,
        contactEmailHash: 'b'.repeat(64),
        summary: `PRIVATE_REPORT_CONTENT_${suffix}`,
        status: 'SOUMIS',
        city: 'Test city',
        address: `PRIVATE_ADDRESS_${suffix}`,
        contactName: `PRIVATE_CONTACT_${suffix}`,
        contactRole: 'Director',
        contactType: 'APPEL',
        reportType: 'LEAD',
        meetingAt: now,
        interestLevel: 'MOYEN',
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    })
    const saleNumber = status === 'CONTRACT_SIGNED' ? `TEST-${randomUUID().replace(/-/g, '')}` : null
    const deal = await transaction.collaborationDeal.create({
      data: {
        reportId: report.id,
        supplierId,
        status,
        declaredAt: now,
        updatedAt: now,
        ...(status === 'CLOSING_REPORTED' ? { closingReportedAt: now } : {}),
        ...(status === 'CONFIRMED' ? { confirmedAt: now } : {}),
        ...(status === 'CONTRACT_SIGNED' ? { contractSignedAt: now, saleNumber } : {}),
        ...(status === 'DISPUTED' ? { disputeReason: `Dispute fixture ${suffix}` } : {}),
      },
      select: { id: true },
    })
    let closingReportId: number | null = null
    if (status !== 'CONTRACT_SIGNED') {
      const closingReport = await transaction.collaborationClosingReport.create({
        data: {
          dealId: deal.id,
          closerId: supplierId,
          status: 'SUBMITTED',
          saleAmount: 987_654_321n,
          saleDate: now,
          details: `PRIVATE_PIECE_CONTENT_${suffix}`,
          submittedAt: now,
          reportedAt: now,
        },
        select: { id: true },
      })
      closingReportId = closingReport.id
    }
    if (status === 'CONTRACT_SIGNED') {
      await transaction.collaborationCommission.create({
        data: {
          dealId: deal.id,
          agentId: supplierId,
          role: 'SUPPLIER',
          amount: 50_123n,
          status: 'PENDING',
          generatedAt: now,
        },
      })
    }
    if (status === 'DISPUTED') {
      await transaction.collaborationDealStatusHistory.create({
        data: {
          dealId: deal.id,
          fromStatus: 'CLOSING_REPORTED',
          toStatus: 'DISPUTED',
          changedBy: supplierId,
          comment: 'Test dispute history',
          createdAt: now,
        },
      })
    }
    return { id: deal.id, reportId: report.id, closingReportId }
  })
}

function queryFor(agentId: number, from: Date, to: Date, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    agentId: String(agentId),
    from: from.toISOString(),
    to: to.toISOString(),
    ...extra,
  }).toString()
}

function assertNoSensitiveFields(json: unknown, privateMarkers: string[]) {
  const raw = JSON.stringify(json)
  for (const field of [
    'email',
    'contactPhone',
    'contactEmail',
    'contactName',
    'companyName',
    'address',
    'phoneHash',
    'emailHash',
    'contractFileSha256',
    'saleAmount',
    'saleDate',
    'amount',
    'storageKey',
    'fileName',
    'sha256',
    'downloadUrl',
    'details',
    'content',
  ]) {
    assert.equal(raw.toLowerCase().includes(field.toLowerCase()), false, `Response contains forbidden field ${field}.`)
  }
  for (const marker of privateMarkers) {
    assert.equal(raw.includes(marker), false, `Response contains private marker ${marker}.`)
  }
}

test('admin collaboration read routes enforce TOTP, protect data, paginate, match dashboard totals, and audit reads', {
  skip: !enabled,
}, async () => {
  const suffix = randomUUID()
  const supplierId = await createAgent(suffix)
  const nonAdminId = await createAgent(`nonadmin-${suffix}`)
  const adminWithoutTotpId = await createAdmin(suffix, false)
  const adminId = await createAdmin(`totp-${suffix}`, true)
  const agentToken = tokenFor(nonAdminId, 'AGENT')
  const adminWithoutTotpToken = tokenFor(adminWithoutTotpId, 'ADMIN')
  const now = new Date()
  const from = new Date(now.getTime() - 2 * 60_000)
  const to = new Date(now.getTime() + 10 * 60_000)
  const filters = queryFor(supplierId, from, to)
  const rowCount = 51
  const reviewFixtures: Array<{ id: number }> = []
  const readyFixtures: Array<{ id: number; closingReportId: number | null }> = []
  const signedFixtures: Array<{ id: number }> = []
  const disputedFixtures: Array<{ id: number }> = []
  const overrideFixtures: Array<{ id: number; status: string }> = []
  const privateMarkers = [
    `PRIVATE_PHONE_${suffix}`,
    `private-${suffix}@test.invalid`,
    `PRIVATE_ADDRESS_${suffix}`,
    `PRIVATE_CONTACT_${suffix}`,
    `PRIVATE_REPORT_CONTENT_${suffix}`,
    `PRIVATE_PIECE_CONTENT_${suffix}`,
    '987654321',
    '50_123',
    'a'.repeat(64),
    'b'.repeat(64),
    `private-file-${suffix}.pdf`,
  ]
  const verificationKey = 'collaboration_audit_chain_last_verification'
  const priorVerification = await prisma.setting.findUnique({
    where: { key: verificationKey },
    select: { value: true },
  })

  try {
    for (const [status, target] of [
      ['CLOSING_REPORTED', reviewFixtures],
      ['CONFIRMED', readyFixtures],
      ['CONTRACT_SIGNED', signedFixtures],
    ] as const) {
      for (let batchStart = 0; batchStart < rowCount; batchStart += 10) {
        const batchEnd = Math.min(rowCount, batchStart + 10)
        const fixtures = await Promise.all(Array.from({ length: batchEnd - batchStart }, (_, index) =>
          createDealFixture(supplierId, `${suffix}-${status}-${batchStart + index}`, status, now),
        ))
        target.push(...fixtures)
      }
    }
    const disputedWithoutCommission = await createDealFixture(supplierId, `${suffix}-disputed-no-commission`, 'DISPUTED', now)
    const disputedWithCommission = await createDealFixture(supplierId, `${suffix}-disputed-with-commission`, 'DISPUTED', now)
    const completeDisputeReason = `Complete dispute reason ${suffix} ${'x'.repeat(260)}`
    await prisma.collaborationDeal.update({
      where: { id: disputedWithoutCommission.id },
      data: { disputeReason: completeDisputeReason },
    })
    await prisma.collaborationCommission.create({
      data: {
        dealId: disputedWithCommission.id,
        agentId: supplierId,
        role: 'SUPPLIER',
        amount: 50_123n,
        status: 'ON_HOLD',
        generatedAt: now,
      },
    })
    disputedFixtures.push(disputedWithoutCommission, disputedWithCommission)
    const overriddenConfirmed = await createDealFixture(supplierId, `${suffix}-override-confirmed`, 'CONFIRMED', now)
    const overriddenSigned = await createDealFixture(supplierId, `${suffix}-override-signed`, 'CONTRACT_SIGNED', now)
    await prisma.collaborationDeal.updateMany({
      where: { id: { in: [overriddenConfirmed.id, overriddenSigned.id] } },
      data: {
        clientConfirmationOverrideReason: `Override reason ${suffix}`,
        reviewedById: adminId,
        resolvedAt: now,
      },
    })
    overrideFixtures.push(
      { id: overriddenConfirmed.id, status: 'CONFIRMED' },
      { id: overriddenSigned.id, status: 'CONTRACT_SIGNED' },
    )
    readyFixtures.push(overriddenConfirmed)
    signedFixtures.push(overriddenSigned)

    const firstEvidenceDeal = readyFixtures[0]
    assert.ok(firstEvidenceDeal?.closingReportId)
    await prisma.collaborationEvidence.create({
      data: {
        dealId: firstEvidenceDeal.id,
        closingReportId: firstEvidenceDeal.closingReportId,
        uploadedById: supplierId,
        type: 'CLOSING_ATTACHMENT',
        storageKey: `private-storage-${suffix}`,
        fileName: `private-file-${suffix}.pdf`,
        mimeType: 'application/pdf',
        fileSize: 123,
        sha256: 'c'.repeat(64),
      },
    })

    for (const path of routePaths) {
      const nonAdminResponse = await request(path, agentToken)
      assert.equal(nonAdminResponse.status, 403, `Non-admin request should be denied at ${path}.`)
      const noTotpResponse = await request(path, adminWithoutTotpToken)
      assert.equal(noTotpResponse.status, 403, `Admin without TOTP should be denied at ${path}.`)
    }
    await prisma.collaborationRateLimitBucket.deleteMany({
      where: {
        bucketKey: {
          in: [
            'admin-collaboration-dashboard',
            'admin-collaboration-ready-to-sign',
            'admin-collaboration-alerts',
            'admin-audit-verification',
            'admin-collaboration-list',
            'admin-collaboration-overrides',
            'admin-collaboration-trust',
            'admin-collaboration-active-agents',
            'admin-commission-list',
          ].map(rateLimitBucketKey),
        },
      },
    })

    const expectedReviewFixtures = [...reviewFixtures, ...disputedFixtures]
    const reviewPageIds: number[] = []
    for (const page of [1, 2]) {
      const response = await adminGet(adminId, `/api/admin/collaboration/deals?${filters}&page=${page}&limit=50`)
      assert.equal(response.status, 200)
      const body = await response.json() as { data: Array<{ id: number }>; pagination: { total: number; limit: number } }
      assert.equal(body.pagination.total, expectedReviewFixtures.length)
      assert.equal(body.pagination.limit, 50)
      reviewPageIds.push(...body.data.map(({ id }) => id))
    }
    assert.equal(reviewPageIds.length, expectedReviewFixtures.length)
    assert.equal(new Set(reviewPageIds).size, expectedReviewFixtures.length)
    assert.deepEqual(new Set(reviewPageIds), new Set(expectedReviewFixtures.map(({ id }) => id)))
    assert.equal((await adminGet(adminId, `/api/admin/collaboration/deals?${filters}&limit=51`)).status, 400)
    assert.equal((await adminGet(adminId, `/api/admin/collaboration/deals?${filters}&status=INVALID`)).status, 400)

    const disputesResponse = await adminGet(adminId, `/api/admin/collaboration/deals?${filters}&status=DISPUTED&limit=50`)
    assert.equal(disputesResponse.status, 200)
    const disputesBody = await disputesResponse.json() as {
      data: Array<{ id: number; disputeReason: string | null; disputedAt: string | null }>
      pagination: { total: number }
    }
    assert.equal(disputesBody.pagination.total, disputedFixtures.length)
    assert.deepEqual(new Set(disputesBody.data.map(({ id }) => id)), new Set(disputedFixtures.map(({ id }) => id)))
    assert.equal(disputesBody.data.find(({ id }) => id === disputedWithoutCommission.id)?.disputeReason?.length, 200)
    assert.equal(disputesBody.data.every(({ disputedAt }) => disputedAt !== null), true)
    assertNoSensitiveFields(disputesBody, privateMarkers)

    const overridesResponse = await adminGet(adminId, `/api/admin/collaboration/deals/overrides?${filters}&limit=50`)
    assert.equal(overridesResponse.status, 200)
    const overridesBody = await overridesResponse.json() as {
      data: Array<{ id: number; status: string; overrideReason: string; overrideAt: string | null; admin: { id: number; name: string } | null }>
      pagination: { total: number }
    }
    assert.equal(overridesBody.pagination.total, overrideFixtures.length)
    assert.deepEqual(new Set(overridesBody.data.map(({ id }) => id)), new Set(overrideFixtures.map(({ id }) => id)))
    assert.deepEqual(new Set(overridesBody.data.map(({ status }) => status)), new Set(['CONFIRMED', 'CONTRACT_SIGNED']))
    assert.ok(overridesBody.data.every(({ overrideReason, overrideAt, admin }) => overrideReason.length > 0 && overrideAt !== null && admin?.id === adminId))
    assertNoSensitiveFields(overridesBody, privateMarkers)

    const trustPageOneResponse = await adminGet(adminId, '/api/admin/collaboration/trust?page=1&limit=1')
    const trustPageTwoResponse = await adminGet(adminId, '/api/admin/collaboration/trust?page=2&limit=1')
    assert.equal(trustPageOneResponse.status, 200)
    assert.equal(trustPageTwoResponse.status, 200)
    const trustPageOne = await trustPageOneResponse.json() as { data: Array<{ id: number; email?: string }>; pagination: { total: number; limit: number; page: number } }
    const trustPageTwo = await trustPageTwoResponse.json() as { data: Array<{ id: number; email?: string }>; pagination: { total: number; limit: number; page: number } }
    assert.equal(trustPageOne.pagination.total, trustPageTwo.pagination.total)
    assert.equal(trustPageOne.pagination.limit, 1)
    assert.equal(trustPageTwo.pagination.page, 2)
    assert.notEqual(trustPageOne.data[0]?.id, trustPageTwo.data[0]?.id)
    assert.equal(trustPageOne.data[0]?.email, undefined)
    assertNoSensitiveFields(trustPageOne, privateMarkers)

    const activePageOneResponse = await adminGet(adminId, '/api/admin/collaboration/agents/active?page=1&limit=1')
    const activePageTwoResponse = await adminGet(adminId, '/api/admin/collaboration/agents/active?page=2&limit=1')
    assert.equal(activePageOneResponse.status, 200)
    assert.equal(activePageTwoResponse.status, 200)
    const activePageOne = await activePageOneResponse.json() as { data: Array<{ id: number; name: string; email?: string }>; pagination: { total: number; limit: number; page: number } }
    const activePageTwo = await activePageTwoResponse.json() as { data: Array<{ id: number; name: string; email?: string }>; pagination: { total: number; limit: number; page: number } }
    assert.equal(activePageOne.pagination.total, activePageTwo.pagination.total)
    assert.equal(activePageOne.pagination.limit, 1)
    assert.equal(activePageTwo.pagination.page, 2)
    assert.notEqual(activePageOne.data[0]?.id, activePageTwo.data[0]?.id)
    assert.equal(activePageOne.data[0]?.email, undefined)
    assertNoSensitiveFields(activePageOne, privateMarkers)

    const readyPageIds: number[] = []
    for (const page of [1, 2]) {
      const response = await adminGet(adminId, `/api/admin/collaboration/deals/ready-to-sign?${filters}&page=${page}&limit=50`)
      assert.equal(response.status, 200)
      const body = await response.json() as { data: Array<{ id: number }>; pagination: { total: number; limit: number } }
      assert.equal(body.pagination.total, readyFixtures.length)
      assert.equal(body.pagination.limit, 50)
      readyPageIds.push(...body.data.map(({ id }) => id))
    }
    assert.equal(readyPageIds.length, readyFixtures.length)
    assert.equal(new Set(readyPageIds).size, readyFixtures.length)
    assert.deepEqual(new Set(readyPageIds), new Set(readyFixtures.map(({ id }) => id)))
    assert.equal((await adminGet(adminId, `/api/admin/collaboration/deals/ready-to-sign?${filters}&limit=51`)).status, 400)

    const dashboardResponse = await adminGet(adminId, `/api/admin/collaboration/dashboard?${filters}`)
    assert.equal(dashboardResponse.status, 200)
    const dashboard = await dashboardResponse.json() as {
      data: { salesToVerify: number; contractsToSign: number; commissionsToPay: number }
    }
    assert.equal(dashboard.data.salesToVerify, expectedReviewFixtures.length)
    assert.equal(dashboard.data.contractsToSign, readyFixtures.length)
    assert.equal(dashboard.data.commissionsToPay, signedFixtures.length)

    const commissionsQuery = queryFor(supplierId, from, to, { status: 'PENDING', page: '1', limit: '1' })
    const commissionsResponse = await adminGet(adminId, `/api/admin/collaboration/commissions?${commissionsQuery}`)
    assert.equal(commissionsResponse.status, 200)
    const commissions = await commissionsResponse.json() as { pagination: { total: number } }
    assert.equal(dashboard.data.commissionsToPay, commissions.pagination.total)

    const rawResponsePaths = [
      `/api/admin/collaboration/dashboard?${filters}`,
      `/api/admin/collaboration/deals/ready-to-sign?${filters}&limit=1`,
      `/api/admin/collaboration/alerts?${filters}&type=BYPASS`,
      '/api/admin/collaboration/audit/verification',
      `/api/admin/collaboration/deals?${filters}&limit=1`,
      `/api/admin/collaboration/deals?${filters}&status=DISPUTED&limit=1`,
      `/api/admin/collaboration/deals/overrides?${filters}&limit=1`,
      '/api/admin/collaboration/trust?page=1&limit=1',
      '/api/admin/collaboration/agents/active?page=1&limit=1',
    ]
    for (const path of rawResponsePaths) {
      const response = await adminGet(adminId, path)
      assert.equal(response.status, 200)
      assertNoSensitiveFields(await response.json(), privateMarkers)
    }

    const statusAgentId = await createAgent(`status-${suffix}`)
    await prisma.user.update({ where: { id: statusAgentId }, data: { status: 'SUSPENDU' } })
    const statusPath = `/api/admin/agents/${statusAgentId}/status`
    const missingReactivateReason = await adminPatch(adminId, statusPath, { status: 'ACTIF' })
    assert.equal(missingReactivateReason.status, 400)
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: statusAgentId }, select: { status: true } })).status, 'SUSPENDU')
    const missingSuspendReason = await adminPatch(adminId, statusPath, { status: 'SUSPENDU' })
    assert.equal(missingSuspendReason.status, 400)
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: statusAgentId }, select: { status: true } })).status, 'SUSPENDU')
    const noTotpStatusRequest = await requestPatch(statusPath, tokenFor(adminId, 'ADMIN'), { status: 'ACTIF', reason: 'Reason provided for test.' })
    assert.equal(noTotpStatusRequest.status, 403)
    const reactivateWithReason = await adminPatch(adminId, statusPath, { status: 'ACTIF', reason: 'Required reactivation reason.' })
    assert.equal(reactivateWithReason.status, 200)
    const suspendWithReason = await adminPatch(adminId, statusPath, { status: 'SUSPENDU', reason: 'Required suspension reason.' })
    assert.equal(suspendWithReason.status, 200)

    const auditStatuses = [
      {
        value: null,
        expected: 'UNKNOWN',
      },
      {
        value: JSON.stringify({
          status: 'VALID',
          checkedAt: new Date(now.getTime() - 37 * 60 * 60_000).toISOString(),
          sequence: '1',
          issueCount: 0,
        }),
        expected: 'STALE',
      },
      {
        value: JSON.stringify({ status: 'VALID', checkedAt: now.toISOString(), sequence: '2', issueCount: 0 }),
        expected: 'VALID',
      },
      {
        value: JSON.stringify({ status: 'BROKEN', checkedAt: now.toISOString(), sequence: '3', issueCount: 1 }),
        expected: 'BROKEN',
      },
    ] as const
    for (const { value, expected } of auditStatuses) {
      if (value === null) {
        await prisma.setting.deleteMany({ where: { key: verificationKey } })
      } else {
        await prisma.setting.upsert({
          where: { key: verificationKey },
          create: { key: verificationKey, value },
          update: { value },
        })
      }
      const response = await adminGet(adminId, '/api/admin/collaboration/audit/verification')
      assert.equal(response.status, 200)
      const body = await response.json() as { data: { status: string } }
      assert.equal(body.data.status, expected)
    }

    const auditedActions = [
      'COLLABORATION_ADMIN_DASHBOARD_VIEWED',
      'COLLABORATION_ADMIN_READY_TO_SIGN_VIEWED',
      'COLLABORATION_ADMIN_ALERTS_VIEWED',
      'COLLABORATION_AUDIT_VERIFICATION_STATUS_VIEWED',
      'COLLABORATION_ADMIN_DEALS_VIEWED',
      'COLLABORATION_ADMIN_OVERRIDES_VIEWED',
      'COLLABORATION_ADMIN_TRUST_VIEWED',
      'COLLABORATION_ADMIN_ACTIVE_AGENTS_VIEWED',
    ]
    const auditEntries = await prisma.collaborationAuditLog.findMany({
      where: { actorId: adminId, action: { in: auditedActions } },
      select: { action: true },
      distinct: ['action'],
    })
    assert.deepEqual(
      new Set(auditEntries.map(({ action }) => action)),
      new Set(auditedActions),
    )
  } finally {
    if (priorVerification) {
      await prisma.setting.upsert({
        where: { key: verificationKey },
        create: { key: verificationKey, value: priorVerification.value },
        update: { value: priorVerification.value },
      })
    } else {
      await prisma.setting.deleteMany({ where: { key: verificationKey } })
    }
  }
})

test('signing atomically closes pending access requests, cancels their email jobs, and notifies each requester once', {
  skip: !enabled,
}, async () => {
  const suffix = randomUUID()
  const adminId = await createAdmin(`sign-${suffix}`, true)
  const supplierId = await createAgent(`sign-supplier-${suffix}`)
  const closerId = await createAgent(`sign-closer-${suffix}`)
  const requesterIds = [await createAgent(`sign-requester-a-${suffix}`), await createAgent(`sign-requester-b-${suffix}`)]
  let dealId: number | null = null

  try {
    const now = new Date()
    const fixture = await createDealFixture(supplierId, `${suffix}-signed`, 'CONFIRMED', now)
    dealId = fixture.id
    await prisma.collaborationDeal.update({
      where: { id: dealId },
      data: {
        closerId,
        accessGrantedAt: now,
        accessExpiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
        clientConfirmationOverrideReason: 'Test override for signature atomicity.',
      },
    })
    await prisma.collaborationClosingReport.update({
      where: { dealId },
      data: { closerId },
    })
    await prisma.collaborationProspectSecret.create({
      data: {
        dealId,
        companyNameCiphertext: encryptPii(`Private Company ${suffix}`),
        contactNameCiphertext: encryptPii(`Private Contact ${suffix}`),
        phoneCiphertext: encryptPii(`039${randomBytes(6).toString('hex')}`),
        emailCiphertext: encryptPii(`client-${suffix}@test.invalid`),
        addressCiphertext: encryptPii(`Private address ${suffix}`),
        companyNameHash: createHash('sha256').update(`company-${suffix}`).digest('hex'),
        phoneHash: createHash('sha256').update(`phone-${suffix}`).digest('hex'),
        emailHash: createHash('sha256').update(`email-${suffix}`).digest('hex'),
      },
    })
    await prisma.collaborationAccessRequest.create({
      data: {
        dealId,
        requesterId: closerId,
        status: 'APPROVED',
        requestedAt: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
        decidedAt: now,
      },
    })
    const pending = await Promise.all(requesterIds.map((requesterId, index) =>
      prisma.collaborationAccessRequest.create({
        data: {
          dealId: dealId!,
          requesterId,
          pendingKey: `${dealId}:${requesterId}`,
          requestedAt: now,
          expiresAt: new Date(now.getTime() + 60 * 60_000),
        },
        select: { id: true, requesterId: true },
      }),
    ))
    await prisma.collaborationEmailJob.createMany({
      data: pending.map(({ id }, index) => ({
        dealId: dealId!,
        type: 'ACCESS_REQUEST_REMINDER' as const,
        recipientCiphertext: encryptPii(`supplier-${index}@test.invalid`),
        payload: {
          audience: 'supplier',
          recipientName: 'Supplier',
          prospectName: 'Prospect',
          requesterName: 'Requester',
          deadline: now.toISOString(),
          link: 'http://localhost:5174',
        },
        idempotencyKey: `access-reminder:${id}`,
      })),
    })
    await prisma.collaborationSaleCounter.upsert({
      where: { id: 1 },
      create: { id: 1, lastValue: 0n },
      update: {},
    })

    const secret = base32Encode(randomBytes(20))
    await prisma.user.update({
      where: { id: adminId },
      data: {
        totpSecretCiphertext: encryptTotpSecret(secret),
        totpEnabled: true,
        totpLastUsedStep: null,
      },
    })
    const form = new FormData()
    form.append('contractReference', `CONTRACT-${suffix}`)
    form.append('contractDate', now.toISOString())
    form.append('file', new Blob(['%PDF-1.4 contract test'], { type: 'application/pdf' }), 'contract.pdf')
    const response = await fetch(`${baseUrl}/api/admin/collaboration/deals/${dealId}/signature`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokenFor(adminId, 'ADMIN')}`,
        'x-admin-totp': totpCode(secret),
      },
      body: form,
    })
    assert.equal(response.status, 201)
    const signedDeal = await prisma.collaborationDeal.findUniqueOrThrow({
      where: { id: dealId },
      select: { status: true },
    })
    assert.equal(signedDeal.status, 'CONTRACT_SIGNED')
    const closedRequests = await prisma.collaborationAccessRequest.findMany({
      where: { id: { in: pending.map(({ id }) => id) } },
      select: { status: true, pendingKey: true },
    })
    assert.deepEqual(closedRequests, pending.map(() => ({ status: 'CLOSED_SIGNED', pendingKey: null })))
    const cancelledEmails = await prisma.collaborationEmailJob.findMany({
      where: { idempotencyKey: { in: pending.map(({ id }) => `access-reminder:${id}`) } },
      select: { status: true },
    })
    assert.deepEqual(cancelledEmails, pending.map(() => ({ status: 'CANCELLED' })))
    const requesterNotifications = await prisma.notification.findMany({
      where: {
        userId: { in: requesterIds },
        type: 'COLLABORATION_DEAL_CLOSED_SIGNED',
        link: '/collaboration/prospects',
      },
      select: { userId: true, body: true },
    })
    assert.equal(requesterNotifications.length, requesterIds.length)
    assert.equal(requesterNotifications.every(({ body }) => body === 'Ce prospect est clôturé : contrat signé'), true)

    const hiddenAgentId = requesterIds[0]
    await prisma.collaborationHiddenDeal.create({ data: { dealId, agentId: hiddenAgentId } })
    const restorePath = `/api/admin/collaboration/deals/${dealId}/hidden-agents/${hiddenAgentId}/restore`
    const agentRestoreAttempt = await requestPatch(restorePath, tokenFor(hiddenAgentId, 'AGENT'), {})
    assert.equal(agentRestoreAttempt.status, 403)

    const restoreAdminId = await createAdmin(`restore-${suffix}`, true)
    const restoreResponse = await adminPatch(restoreAdminId, restorePath, {})
    assert.equal(restoreResponse.status, 200)
    assert.equal(await prisma.collaborationHiddenDeal.count({ where: { dealId, agentId: hiddenAgentId } }), 0)
  } finally {
    await prisma.collaborationRateLimitBucket.deleteMany({
      where: {
        bucketKey: {
          in: [
            rateLimitBucketKey('admin-collaboration-signature'),
            rateLimitBucketKey('admin-collaboration-restore-hidden'),
          ],
        },
      },
    })
  }
})
