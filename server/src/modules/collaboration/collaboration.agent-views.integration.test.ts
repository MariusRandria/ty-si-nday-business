import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import jwt from 'jsonwebtoken'
import test, { after } from 'node:test'
import { createApp } from '../../app.js'
import { env } from '../../config/env.js'
import { prisma } from '../../lib/prisma.js'
import { getCollaborationConfig } from './collaboration.config.js'
import { recordCollaborationContactAccess } from './collaboration.contact-access.js'
import { createClientConfirmationPublicToken, hashClientConfirmationPublicToken } from './collaboration.files.js'
import {
  encryptPii,
  hashNormalizedCompanyName,
  hashNormalizedEmail,
  hashNormalizedPhone,
} from './report-pii.js'

function isLocalBasesTest(): boolean {
  try {
    const url = new URL(env.databaseUrl)
    return url.pathname.replace(/^\//, '').toLowerCase() === 'bases_test'
      && ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

const enabled = isLocalBasesTest()
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
    server.close()
    await once(server, 'close')
  }
  await prisma.$disconnect()
})

async function createAgent(email: string, phone: string, firstName: string, lastName: string) {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: 'test-only-not-a-real-password',
      role: 'AGENT',
      status: 'ACTIF',
      agentProfile: {
        create: { firstName, lastName, phone, city: 'Test' },
      },
    },
    select: { id: true },
  })
  return user.id
}

async function createDeal(
  supplierId: number,
  unique: string,
  status: 'DECLARED' | 'CONFIRMED' | 'CONTRACT_SIGNED' | 'COMMISSIONS_PAID' | 'LOST' | 'EXPIRED',
) {
  const now = new Date()
  const report = await prisma.report.create({
    data: {
      agentId: supplierId,
      companyName: `Private Company ${unique}`,
      companyNameNormalized: `private company ${unique}`,
      contactPhone: `PRIVATE_PHONE_${unique}`,
      summary: `Private report notes ${unique}`,
      status: 'SOUMIS',
      city: 'Test city',
      address: `PRIVATE_ADDRESS_${unique}`,
      contactName: `Private Contact ${unique}`,
      contactRole: 'Director',
      contactEmail: `private-${unique}@test.invalid`,
      contactType: 'APPEL',
      reportType: 'LEAD',
      meetingAt: now,
      interestLevel: 'MOYEN',
    },
    select: { id: true },
  })
  const saleNumber = status === 'CONTRACT_SIGNED' || status === 'COMMISSIONS_PAID'
    ? `TSN-${randomUUID().replace(/-/g, '').slice(0, 30)}`
    : undefined
  const deal = await prisma.collaborationDeal.create({
    data: {
      reportId: report.id,
      supplierId,
      status,
      declaredAt: now,
      ...(status === 'CONTRACT_SIGNED' || status === 'COMMISSIONS_PAID'
        ? { contractSignedAt: now, saleNumber }
        : {}),
    },
    select: { id: true },
  })
  return { id: deal.id, reportId: report.id, saleNumber }
}

function tokenFor(id: number): string {
  return jwt.sign({ id, role: 'AGENT', status: 'ACTIF' }, env.jwtSecret, { expiresIn: '5m' })
}

async function get(path: string, token: string) {
  return fetch(`${baseUrl}/api/collaboration${path}`, {
    headers: { authorization: `Bearer ${token}` },
  })
}

async function post(path: string, token: string, body: unknown) {
  return fetch(`${baseUrl}/api/collaboration${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function put(path: string, token: string, body: unknown) {
  return fetch(`${baseUrl}/api/collaboration${path}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('supplier views stay owner-scoped, masked, and do not count contact access', {
  skip: !enabled,
}, async () => {
  const suffix = randomUUID()
  const ids = { agents: [] as number[], deals: [] as number[], reports: [] as number[] }

  try {
    const supplierA = await createAgent(`supplier-a-${suffix}@test.invalid`, `032${suffix.slice(0, 7)}`, 'Supplier', 'A')
    ids.agents.push(supplierA)
    const supplierB = await createAgent(`supplier-b-${suffix}@test.invalid`, `033${suffix.slice(0, 7)}`, 'Supplier', 'B')
    ids.agents.push(supplierB)
    const requester = await createAgent(`requester-${suffix}@test.invalid`, `034${suffix.slice(0, 7)}`, 'Requester', 'Agent')
    ids.agents.push(requester)

    const openA = await createDeal(supplierA, `${suffix}-open-a`, 'DECLARED')
    const signedA = await createDeal(supplierA, `${suffix}-signed-a`, 'CONTRACT_SIGNED')
    const openB = await createDeal(supplierB, `${suffix}-open-b`, 'DECLARED')
    const successfulSigned = await createDeal(requester, `${suffix}-success-signed`, 'CONTRACT_SIGNED')
    const successfulPaid = await createDeal(requester, `${suffix}-success-paid`, 'COMMISSIONS_PAID')
    const confirmedOnly = await createDeal(requester, `${suffix}-confirmed-only`, 'CONFIRMED')
    const fixtureDeals = [openA, signedA, openB, successfulSigned, successfulPaid, confirmedOnly]
    ids.deals.push(...fixtureDeals.map(({ id }) => id))
    ids.reports.push(...fixtureDeals.map(({ reportId }) => reportId))

    const now = new Date()
    const requests = await Promise.all([
      prisma.collaborationAccessRequest.create({
        data: {
          dealId: openA.id,
          requesterId: requester,
          pendingKey: `test:${suffix}:a`,
          requestedAt: now,
          expiresAt: new Date(now.getTime() + 60 * 60_000),
        },
        select: { id: true },
      }),
      prisma.collaborationAccessRequest.create({
        data: {
          dealId: openB.id,
          requesterId: requester,
          pendingKey: `test:${suffix}:b`,
          requestedAt: now,
          expiresAt: new Date(now.getTime() + 60 * 60_000),
        },
        select: { id: true },
      }),
      prisma.collaborationAccessRequest.create({
        data: {
          dealId: openA.id,
          requesterId: supplierB,
          pendingKey: `test:${suffix}:expired`,
          status: 'PENDING',
          requestedAt: now,
          expiresAt: new Date(now.getTime() - 60_000),
        },
        select: { id: true },
      }),
    ])

    const scoreDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    await prisma.collaborationTrustScoreSnapshot.createMany({
      data: [
        {
          agentId: requester,
          scoreDay: new Date(scoreDay.getTime() - 86_400_000),
          score: 61,
          formulaVersion: 1,
          components: {},
          calculatedAt: new Date(now.getTime() - 86_400_000),
        },
        {
          agentId: requester,
          scoreDay,
          score: 84,
          formulaVersion: 1,
          components: {},
          calculatedAt: now,
        },
      ],
    })

    const accessCountBefore = await prisma.collaborationContactAccessCounter.count({ where: { agentId: supplierA } })
    const supplierAToken = tokenFor(supplierA)
    const supplierBToken = tokenFor(supplierB)

    const suppliedAResponse = await get('/supplied', supplierAToken)
    assert.equal(suppliedAResponse.status, 200)
    const suppliedA = await suppliedAResponse.json() as { data: Array<Record<string, unknown> & { dealId: number; pendingRequestsCount: number }> }
    assert.deepEqual(new Set(suppliedA.data.map(({ dealId }) => dealId)), new Set([openA.id, signedA.id]))
    assert.equal(suppliedA.data.find(({ dealId }) => dealId === openA.id)?.pendingRequestsCount, 1)
    assert.ok(suppliedA.data.every(({ prospectName }) => prospectName === 'Prospect'))

    const suppliedBResponse = await get('/supplied', supplierBToken)
    assert.equal(suppliedBResponse.status, 200)
    const suppliedB = await suppliedBResponse.json() as { data: Array<{ dealId: number }> }
    assert.deepEqual(suppliedB.data.map(({ dealId }) => dealId), [openB.id])

    const pendingAResponse = await get('/access-requests/pending', supplierAToken)
    assert.equal(pendingAResponse.status, 200)
    const pendingA = await pendingAResponse.json() as {
      data: Array<{
        id: number
        requester: { id: number; trustScore: { score: number }; successfulSales: number }
      }>
    }
    assert.deepEqual(pendingA.data.map(({ id }) => id), [requests[0].id])
    assert.equal(pendingA.data[0].requester.id, requester)
    assert.equal(pendingA.data[0].requester.trustScore.score, 84)
    assert.equal(pendingA.data[0].requester.successfulSales, 2)

    const pendingBResponse = await get('/access-requests/pending', supplierBToken)
    assert.equal(pendingBResponse.status, 200)
    const pendingB = await pendingBResponse.json() as { data: Array<{ id: number }> }
    assert.deepEqual(pendingB.data.map(({ id }) => id), [requests[1].id])

    const requestsAResponse = await get(`/${openA.id}/access-requests`, supplierAToken)
    assert.equal(requestsAResponse.status, 200)
    const requestsA = await requestsAResponse.json() as { data: Array<{ requester: { id: number; successfulSales: number } }> }
    assert.equal(requestsA.data.find(({ requester: profile }) => profile.id === requester)?.requester.successfulSales, 2)
    assert.equal((await get(`/${openA.id}/access-requests`, supplierBToken)).status, 404)

    const signedTimelineResponse = await get(`/${signedA.id}/timeline`, supplierAToken)
    assert.equal(signedTimelineResponse.status, 200)
    const signedTimeline = await signedTimelineResponse.json() as { data: { saleNumber?: string } }
    assert.equal(signedTimeline.data.saleNumber, signedA.saleNumber)

    const unsignedTimelineResponse = await get(`/${openA.id}/timeline`, supplierAToken)
    assert.equal(unsignedTimelineResponse.status, 200)
    const unsignedTimeline = await unsignedTimelineResponse.json() as { data: Record<string, unknown> }
    assert.equal('saleNumber' in unsignedTimeline.data, false)
    assert.equal((await get(`/${signedA.id}/timeline`, supplierBToken)).status, 404)

    const allPublicViews = JSON.stringify([suppliedA, suppliedB, pendingA, pendingB, requestsA, signedTimeline, unsignedTimeline])
    for (const marker of ['Private Company', 'Private Contact', 'PRIVATE_PHONE_', 'PRIVATE_ADDRESS_', 'Private report notes', '@test.invalid']) {
      assert.equal(allPublicViews.includes(marker), false, `Response leaked ${marker}`)
    }
    assert.equal(await prisma.collaborationContactAccessCounter.count({ where: { agentId: supplierA } }), accessCountBefore)
  } finally {
    const linkedDeals = ids.agents.length
      ? await prisma.collaborationDeal.findMany({
        where: { OR: [{ supplierId: { in: ids.agents } }, { closerId: { in: ids.agents } }] },
        select: { id: true, reportId: true },
      })
      : []
    const dealIds = [...new Set([...ids.deals, ...linkedDeals.map(({ id }) => id)])]
    const reportIds = [...new Set([...ids.reports, ...linkedDeals.map(({ reportId }) => reportId)])]
    if (dealIds.length) {
      await prisma.collaborationAccessRequest.deleteMany({ where: { dealId: { in: dealIds } } })
      await prisma.collaborationDealStatusHistory.deleteMany({ where: { dealId: { in: dealIds } } })
      await prisma.collaborationDeal.deleteMany({ where: { id: { in: dealIds } } })
    }
    if (reportIds.length || ids.agents.length) {
      await prisma.report.deleteMany({
        where: {
          OR: [
            ...(reportIds.length ? [{ id: { in: reportIds } }] : []),
            ...(ids.agents.length ? [{ agentId: { in: ids.agents } }] : []),
          ],
        },
      })
    }
    if (ids.agents.length) {
      await prisma.collaborationTrustScoreSnapshot.deleteMany({ where: { agentId: { in: ids.agents } } })
      await prisma.agentProfile.deleteMany({ where: { userId: { in: ids.agents } } })
      await prisma.user.deleteMany({ where: { id: { in: ids.agents } } })
    }
  }
})

test('closer access list includes active approved dossiers without exposing contacts or counting views', {
  skip: !enabled,
}, async () => {
  const suffix = randomUUID()
  const ids = { agents: [] as number[], deals: [] as number[], reports: [] as number[], closingReports: [] as number[] }

  try {
    const supplier = await createAgent(`access-supplier-${suffix}@test.invalid`, `036${suffix.slice(0, 7)}`, 'Supplier', 'Owner')
    ids.agents.push(supplier)
    const closer = await createAgent(`access-closer-${suffix}@test.invalid`, `037${suffix.slice(0, 7)}`, 'Closer', 'Owner')
    ids.agents.push(closer)
    const otherCloser = await createAgent(`access-other-${suffix}@test.invalid`, `038${suffix.slice(0, 7)}`, 'Other', 'Closer')
    ids.agents.push(otherCloser)

    const now = new Date()
    const activeDraft = await createDeal(supplier, `${suffix}-active-draft`, 'DECLARED')
    const activeSubmitted = await createDeal(supplier, `${suffix}-active-submitted`, 'DECLARED')
    const activeWithoutReport = await createDeal(supplier, `${suffix}-active-no-report`, 'DECLARED')
    const ownedByOther = await createDeal(supplier, `${suffix}-owned-by-other`, 'DECLARED')
    const expired = await createDeal(supplier, `${suffix}-expired`, 'DECLARED')
    const disputed = await createDeal(supplier, `${suffix}-disputed`, 'DECLARED')
    const fixtures = [activeDraft, activeSubmitted, activeWithoutReport, ownedByOther, expired, disputed]
    ids.deals.push(...fixtures.map(({ id }) => id))
    ids.reports.push(...fixtures.map(({ reportId }) => reportId))

    await prisma.collaborationDeal.updateMany({
      where: { id: { in: fixtures.map(({ id }) => id) } },
      data: {
        accessGrantedAt: new Date(now.getTime() - 60 * 60_000),
        accessExpiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
      },
    })
    await prisma.collaborationDeal.update({
      where: { id: activeDraft.id },
      data: { closerId: closer, status: 'IN_PROGRESS' },
    })
    await prisma.collaborationDeal.update({
      where: { id: activeSubmitted.id },
      data: { closerId: closer, status: 'CLOSING_REPORTED' },
    })
    await prisma.collaborationDeal.update({
      where: { id: activeWithoutReport.id },
      data: { closerId: closer, status: 'IN_PROGRESS' },
    })
    await prisma.collaborationDeal.update({
      where: { id: ownedByOther.id },
      data: { closerId: otherCloser, status: 'IN_PROGRESS' },
    })
    await prisma.collaborationDeal.update({
      where: { id: expired.id },
      data: { closerId: closer, status: 'EXPIRED', accessExpiresAt: new Date(now.getTime() - 60_000) },
    })
    await prisma.collaborationDeal.update({
      where: { id: disputed.id },
      data: { closerId: closer, status: 'DISPUTED' },
    })

    await prisma.collaborationAccessRequest.createMany({
      data: fixtures.map((deal) => ({
        dealId: deal.id,
        requesterId: deal.id === ownedByOther.id ? otherCloser : closer,
        status: 'APPROVED',
        pendingKey: null,
        requestedAt: new Date(now.getTime() - 2 * 60 * 60_000),
        expiresAt: new Date(now.getTime() - 90 * 60_000),
        decidedAt: new Date(now.getTime() - 60 * 60_000),
        decidedById: supplier,
      })),
    })

    const draft = await prisma.collaborationClosingReport.create({
      data: { dealId: activeDraft.id, closerId: closer, status: 'DRAFT', details: `PRIVATE_DRAFT_${suffix}` },
      select: { id: true },
    })
    ids.closingReports.push(draft.id)
    const submitted = await prisma.collaborationClosingReport.create({
      data: {
        dealId: activeSubmitted.id,
        closerId: closer,
        status: 'SUBMITTED',
        details: `PRIVATE_SUBMITTED_${suffix}`,
        saleAmount: 123456n,
        submittedAt: now,
      },
      select: { id: true },
    })
    ids.closingReports.push(submitted.id)

    const contactsBefore = await prisma.collaborationContactAccessCounter.findMany({
      where: { agentId: closer },
      select: { day: true, count: true },
    })
    const listResponse = await get('/closer/accesses', tokenFor(closer))
    assert.equal(listResponse.status, 200)
    assert.equal(listResponse.headers.get('cache-control'), 'no-store')
    const rawResponse = await listResponse.text()
    const payload = JSON.parse(rawResponse) as {
      data: Array<{ dealId: number; dealStatus: string; closingReportStatus: string }>
    }

    assert.deepEqual(new Set(payload.data.map(({ dealId }) => dealId)), new Set([activeDraft.id, activeSubmitted.id, activeWithoutReport.id]))
    assert.equal(payload.data.find(({ dealId }) => dealId === activeDraft.id)?.closingReportStatus, 'DRAFT')
    assert.equal(payload.data.find(({ dealId }) => dealId === activeSubmitted.id)?.closingReportStatus, 'SUBMITTED')
    assert.equal(payload.data.find(({ dealId }) => dealId === activeWithoutReport.id)?.closingReportStatus, 'NONE')
    for (const marker of [
      'Private Company',
      'Private Contact',
      'PRIVATE_PHONE_',
      'PRIVATE_ADDRESS_',
      'Private report notes',
      'PRIVATE_DRAFT_',
      'PRIVATE_SUBMITTED_',
      '@test.invalid',
      'saleAmount',
      'evidence',
    ]) {
      assert.equal(rawResponse.includes(marker), false, `Response leaked ${marker}`)
    }
    assert.deepEqual(
      await prisma.collaborationContactAccessCounter.findMany({
        where: { agentId: closer },
        select: { day: true, count: true },
      }),
      contactsBefore,
    )

    const otherCloserResponse = await get('/closer/accesses', tokenFor(otherCloser))
    assert.equal(otherCloserResponse.status, 200)
    const otherCloserPayload = await otherCloserResponse.json() as { data: Array<{ dealId: number }> }
    assert.deepEqual(otherCloserPayload.data.map(({ dealId }) => dealId), [ownedByOther.id])
    assert.equal((await get('/closer/accesses', tokenFor(supplier))).status, 200)
  } finally {
    if (ids.closingReports.length) {
      await prisma.collaborationClosingReport.deleteMany({ where: { id: { in: ids.closingReports } } })
    }
    if (ids.deals.length) {
      await prisma.collaborationAccessRequest.deleteMany({ where: { dealId: { in: ids.deals } } })
      await prisma.collaborationDealStatusHistory.deleteMany({ where: { dealId: { in: ids.deals } } })
      await prisma.collaborationDeal.deleteMany({ where: { id: { in: ids.deals } } })
    }
    if (ids.reports.length) await prisma.report.deleteMany({ where: { id: { in: ids.reports } } })
    if (ids.agents.length) {
      await prisma.agentProfile.deleteMany({ where: { userId: { in: ids.agents } } })
      await prisma.user.deleteMany({ where: { id: { in: ids.agents } } })
    }
  }
})

test('available prospects include only the latest supplier score and server-derived retry time', {
  skip: !enabled,
}, async () => {
  const suffix = randomUUID()
  const ids = { agents: [] as number[], deals: [] as number[], reports: [] as number[], requests: [] as number[] }

  try {
    const supplier = await createAgent(`prospects-supplier-${suffix}@test.invalid`, `039${suffix.slice(0, 7)}`, 'Scored', 'Supplier')
    ids.agents.push(supplier)
    const requester = await createAgent(`prospects-requester-${suffix}@test.invalid`, `040${suffix.slice(0, 7)}`, 'Requesting', 'Agent')
    ids.agents.push(requester)
    const noScoreSupplier = await createAgent(`prospects-no-score-${suffix}@test.invalid`, `041${suffix.slice(0, 7)}`, 'NoScore', 'Supplier')
    ids.agents.push(noScoreSupplier)
    const config = await getCollaborationConfig(prisma)
    const now = new Date()
    const cooldownDeal = await createDeal(supplier, `${suffix}-cooldown`, 'DECLARED')
    const exhaustedDeal = await createDeal(supplier, `${suffix}-exhausted`, 'DECLARED')
    const pendingDeal = await createDeal(noScoreSupplier, `${suffix}-pending`, 'DECLARED')
    const noRequestDeal = await createDeal(noScoreSupplier, `${suffix}-none`, 'DECLARED')
    const fixtures = [cooldownDeal, exhaustedDeal, pendingDeal, noRequestDeal]
    ids.deals.push(...fixtures.map(({ id }) => id))
    ids.reports.push(...fixtures.map(({ reportId }) => reportId))

    const cooldownAge = Math.max(1_000, Math.floor(config.requestCooldownHours * 60 * 60_000 / 2))
    const cooldownRequest = await prisma.collaborationAccessRequest.create({
      data: {
        dealId: cooldownDeal.id,
        requesterId: requester,
        status: 'REJECTED',
        pendingKey: null,
        requestedAt: new Date(now.getTime() - cooldownAge),
        expiresAt: new Date(now.getTime() - cooldownAge + 60 * 60_000),
      },
      select: { id: true, requestedAt: true },
    })
    ids.requests.push(cooldownRequest.id)

    const exhaustedRequests = await Promise.all(Array.from({ length: config.maxAccessAttempts }, (_, index) =>
      prisma.collaborationAccessRequest.create({
        data: {
          dealId: exhaustedDeal.id,
          requesterId: requester,
          status: 'REJECTED',
          pendingKey: null,
          requestedAt: new Date(now.getTime() - (config.maxAccessAttempts - index) * 90 * 60_000),
          expiresAt: new Date(now.getTime() - (config.maxAccessAttempts - index) * 90 * 60_000 + 60 * 60_000),
        },
        select: { id: true },
      })))
    ids.requests.push(...exhaustedRequests.map(({ id }) => id))
    const pendingRequest = await prisma.collaborationAccessRequest.create({
      data: {
        dealId: pendingDeal.id,
        requesterId: requester,
        status: 'PENDING',
        pendingKey: `${pendingDeal.id}:${requester}`,
        requestedAt: now,
        expiresAt: new Date(now.getTime() + 60 * 60_000),
      },
      select: { id: true },
    })
    ids.requests.push(pendingRequest.id)

    const scoreDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    await prisma.collaborationTrustScoreSnapshot.createMany({
      data: [
        {
          agentId: supplier,
          scoreDay: new Date(scoreDay.getTime() - 86_400_000),
          score: 54,
          formulaVersion: 1,
          components: {},
          calculatedAt: new Date(now.getTime() - 86_400_000),
        },
        {
          agentId: supplier,
          scoreDay,
          score: 91,
          formulaVersion: 1,
          components: { privateCalculation: true },
          calculatedAt: now,
        },
      ],
    })

    const response = await get('/prospects', tokenFor(requester))
    assert.equal(response.status, 200)
    const rawResponse = await response.text()
    const payload = JSON.parse(rawResponse) as {
      data: Array<{
        dealId: number
        supplierTrustScore: { score: number; calculatedAt: string } | null
        myRequest: { status: string; requestedAt: string; nextRequestAt: string | null } | null
      }>
    }
    const byId = new Map(payload.data.map((deal) => [deal.dealId, deal]))
    const cooldownData = byId.get(cooldownDeal.id)
    assert.ok(cooldownData)
    assert.equal(cooldownData.supplierTrustScore?.score, 91)
    assert.equal(cooldownData.supplierTrustScore?.calculatedAt, now.toISOString())
    assert.equal(
      cooldownData.myRequest?.nextRequestAt,
      new Date(cooldownRequest.requestedAt.getTime() + config.requestCooldownHours * 60 * 60_000).toISOString(),
    )
    assert.equal(byId.get(exhaustedDeal.id)?.myRequest?.nextRequestAt, null)
    assert.equal(byId.get(pendingDeal.id)?.myRequest?.nextRequestAt, null)
    assert.equal(byId.get(noRequestDeal.id)?.myRequest, null)
    assert.equal(byId.get(noRequestDeal.id)?.supplierTrustScore, null)

    if (config.maxAccessAttempts > 1) {
      const requestResponse = await post('/' + cooldownDeal.id + '/access-requests', tokenFor(requester), {})
      assert.equal(requestResponse.status, 409, 'POST must enforce the same cooldown reported by nextRequestAt')
    }
    for (const marker of [
      'Private Company',
      'Private Contact',
      'PRIVATE_PHONE_',
      'PRIVATE_ADDRESS_',
      'Private report notes',
      '@test.invalid',
      'privateCalculation',
    ]) {
      assert.equal(rawResponse.includes(marker), false, `Response leaked ${marker}`)
    }
  } finally {
    if (ids.requests.length) {
      await prisma.collaborationAccessRequest.deleteMany({ where: { id: { in: ids.requests } } })
    }
    if (ids.deals.length) {
      await prisma.collaborationDealStatusHistory.deleteMany({ where: { dealId: { in: ids.deals } } })
      await prisma.collaborationDeal.deleteMany({ where: { id: { in: ids.deals } } })
    }
    if (ids.reports.length) await prisma.report.deleteMany({ where: { id: { in: ids.reports } } })
    if (ids.agents.length) {
      await prisma.collaborationTrustScoreSnapshot.deleteMany({ where: { agentId: { in: ids.agents } } })
      await prisma.agentProfile.deleteMany({ where: { userId: { in: ids.agents } } })
      await prisma.user.deleteMany({ where: { id: { in: ids.agents } } })
    }
  }
})

test('contact views enforce a concurrency-safe daily quota and fixed refresh de-duplication', {
  skip: !enabled,
}, async () => {
  if (!env.collaborationEncryptionKey) {
    env.collaborationEncryptionKey = randomBytes(32).toString('base64')
  }
  const suffix = randomUUID()
  const now = new Date()
  const supplier = await createAgent(`quota-supplier-${suffix}@test.invalid`, `042${suffix.slice(0, 7)}`, 'Quota', 'Supplier')
  const closer = await createAgent(`quota-closer-${suffix}@test.invalid`, `043${suffix.slice(0, 7)}`, 'Quota', 'Closer')
  const windowCloser = await createAgent(`quota-window-${suffix}@test.invalid`, `044${suffix.slice(0, 7)}`, 'Window', 'Closer')
  const dealA = await createDeal(supplier, `${suffix}-quota-a`, 'DECLARED')
  const dealB = await createDeal(supplier, `${suffix}-quota-b`, 'DECLARED')
  const windowDeal = await createDeal(supplier, `${suffix}-dedup-window`, 'DECLARED')
  const activeUntil = new Date(now.getTime() + 24 * 60 * 60_000)

  await prisma.collaborationDeal.updateMany({
    where: { id: { in: [dealA.id, dealB.id] } },
    data: {
      closerId: closer,
      status: 'IN_PROGRESS',
      accessGrantedAt: new Date(now.getTime() - 60 * 60_000),
      accessExpiresAt: activeUntil,
    },
  })
  await prisma.collaborationDeal.update({
    where: { id: windowDeal.id },
    data: {
      closerId: windowCloser,
      status: 'IN_PROGRESS',
      accessGrantedAt: new Date(now.getTime() - 60 * 60_000),
      accessExpiresAt: activeUntil,
    },
  })
  await prisma.collaborationAccessRequest.createMany({
    data: [dealA, dealB, windowDeal].map((deal) => ({
      dealId: deal.id,
      requesterId: deal.id === windowDeal.id ? windowCloser : closer,
      status: 'APPROVED',
      pendingKey: null,
      requestedAt: new Date(now.getTime() - 2 * 60 * 60_000),
      expiresAt: new Date(now.getTime() - 60 * 60_000),
      decidedAt: new Date(now.getTime() - 60 * 60_000),
      decidedById: supplier,
    })),
  })

  const contactValues = [dealA, dealB].map((deal, index) => {
    const company = `QUOTA_PRIVATE_COMPANY_${suffix}_${index}`
    const contact = `QUOTA_PRIVATE_CONTACT_${suffix}_${index}`
    const phone = `03400000${index}${suffix.slice(0, 4)}`
    const email = `quota-private-${suffix}-${index}@test.invalid`
    const address = `QUOTA_PRIVATE_ADDRESS_${suffix}_${index}`
    return {
      dealId: deal.id,
      companyNameCiphertext: encryptPii(company),
      contactNameCiphertext: encryptPii(contact),
      phoneCiphertext: encryptPii(phone),
      emailCiphertext: encryptPii(email),
      addressCiphertext: encryptPii(address),
      companyNameHash: hashNormalizedCompanyName(company),
      phoneHash: hashNormalizedPhone(phone),
      emailHash: hashNormalizedEmail(email),
    }
  })
  await prisma.collaborationProspectSecret.createMany({ data: contactValues })

  const dailyLimit = env.collaborationContactDailyLimit
  assert.ok(Number.isSafeInteger(dailyLimit) && dailyLimit > 0)
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  await prisma.collaborationContactAccessCounter.upsert({
    where: { agentId_day: { agentId: closer, day } },
    create: { agentId: closer, day, count: dailyLimit - 1 },
    update: { count: dailyLimit - 1, dailyAlertedAt: null, burstAlertedAt: null },
  })

  const token = tokenFor(closer)
  const [firstResponse, secondResponse] = await Promise.all([
    get(`/${dealA.id}`, token),
    get(`/${dealB.id}`, token),
  ])
  const initialResults = await Promise.all([firstResponse, secondResponse].map(async (response) => ({
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    raw: await response.text(),
  })))
  assert.deepEqual(initialResults.map(({ status }) => status).sort(), [200, 429])
  assert.ok(initialResults.every(({ cacheControl }) => cacheControl === 'no-store'))
  const denied = initialResults.find(({ status }) => status === 429)
  const firstAllowed = initialResults.find(({ status }) => status === 200)
  assert.ok(denied)
  assert.ok(firstAllowed)
  assert.equal(denied.raw.includes('QUOTA_PRIVATE_'), false)
  assert.equal(denied.raw.includes('prospect'), false)
  assert.ok(firstAllowed.raw.includes('QUOTA_PRIVATE_CONTACT_'))
  const allowedDealId = firstAllowed.raw.includes(`QUOTA_PRIVATE_CONTACT_${suffix}_0`) ? dealA.id : dealB.id

  const counterAtLimit = await prisma.collaborationContactAccessCounter.findUniqueOrThrow({
    where: { agentId_day: { agentId: closer, day } },
    select: { count: true },
  })
  assert.equal(counterAtLimit.count, dailyLimit)

  const [refreshA, refreshB] = await Promise.all([
    get(`/${allowedDealId}`, token),
    get(`/${allowedDealId}`, token),
  ])
  assert.deepEqual([refreshA.status, refreshB.status], [200, 200])
  assert.ok(refreshA.headers.get('cache-control') === 'no-store' && refreshB.headers.get('cache-control') === 'no-store')
  const refreshBodies = await Promise.all([refreshA, refreshB].map((response) => response.text()))
  assert.ok(refreshBodies.every((body) => body.includes('QUOTA_PRIVATE_CONTACT_')))
  const counterAfterRefresh = await prisma.collaborationContactAccessCounter.findUniqueOrThrow({
    where: { agentId_day: { agentId: closer, day } },
    select: { count: true },
  })
  assert.equal(counterAfterRefresh.count, dailyLimit)
  const viewAudits = await prisma.collaborationAuditLog.findMany({
    where: {
      actorId: closer,
      dealId: allowedDealId,
      action: 'COLLABORATION_CONTACT_DETAILS_VIEWED',
    },
    orderBy: { createdAt: 'asc' },
    select: { metadata: true },
  })
  assert.equal(viewAudits.length, 3)
  assert.equal(viewAudits.filter(({ metadata }) =>
    typeof metadata === 'object' && metadata !== null && 'quotaDeduplicated' in metadata
      && metadata.quotaDeduplicated === true).length, 2)

  const dedupMinutes = env.contactViewDedupMinutes
  const firstAt = new Date(Date.now() - (dedupMinutes + 2) * 60_000)
  const refreshAt = new Date(firstAt.getTime() + (dedupMinutes - 1) * 60_000)
  const afterFixedWindowAt = new Date(firstAt.getTime() + dedupMinutes * 60_000 + 1_000)
  const firstWindowView = await prisma.$transaction((transaction) => recordCollaborationContactAccess(transaction, {
    agentId: windowCloser,
    dealId: windowDeal.id,
    role: 'CLOSER',
    now: firstAt,
  }))
  const deduplicatedWindowView = await prisma.$transaction((transaction) => recordCollaborationContactAccess(transaction, {
    agentId: windowCloser,
    dealId: windowDeal.id,
    role: 'CLOSER',
    now: refreshAt,
  }))
  const chargedAfterFixedWindow = await prisma.$transaction((transaction) => recordCollaborationContactAccess(transaction, {
    agentId: windowCloser,
    dealId: windowDeal.id,
    role: 'CLOSER',
    now: afterFixedWindowAt,
  }))
  assert.equal(firstWindowView.deduplicated, false)
  assert.equal(deduplicatedWindowView.deduplicated, true)
  assert.equal(chargedAfterFixedWindow.deduplicated, false)
  const windowCounters = await prisma.collaborationContactAccessCounter.findMany({
    where: { agentId: windowCloser },
    select: { count: true },
  })
  assert.equal(windowCounters.reduce((total, counter) => total + counter.count, 0), 2)
})

test('closing report draft fields can be cleared with null but omitted fields stay unchanged', {
  skip: !enabled,
}, async () => {
  const suffix = randomUUID()
  const now = new Date()
  const supplier = await createAgent(`draft-supplier-${suffix}@test.invalid`, `045${suffix.slice(0, 7)}`, 'Draft', 'Supplier')
  const closer = await createAgent(`draft-closer-${suffix}@test.invalid`, `046${suffix.slice(0, 7)}`, 'Draft', 'Closer')
  const deal = await createDeal(supplier, `${suffix}-draft-null`, 'DECLARED')
  await prisma.collaborationDeal.update({
    where: { id: deal.id },
    data: {
      closerId: closer,
      status: 'IN_PROGRESS',
      accessGrantedAt: new Date(now.getTime() - 60 * 60_000),
      accessExpiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
    },
  })
  await prisma.collaborationAccessRequest.create({
    data: {
      dealId: deal.id,
      requesterId: closer,
      status: 'APPROVED',
      pendingKey: null,
      requestedAt: new Date(now.getTime() - 2 * 60 * 60_000),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
      decidedAt: new Date(now.getTime() - 60 * 60_000),
      decidedById: supplier,
    },
  })
  await prisma.collaborationClosingReport.create({
    data: {
      dealId: deal.id,
      closerId: closer,
      status: 'DRAFT',
      saleAmount: 123456n,
      saleDate: new Date('2026-10-12T08:30:00.000Z'),
      details: `Initial draft ${suffix}`,
    },
  })

  const path = `/${deal.id}/closing-report/draft`
  const save = (body: unknown) => put(path, tokenFor(closer), body)
  const parseSaved = async (response: Response) => {
    assert.equal(response.status, 200)
    return await response.json() as {
      data: { saleAmount: string | null; saleDate: string | null; details: string | null }
    }
  }

  let response = await save({ saleAmount: null })
  let saved = await parseSaved(response)
  assert.equal(saved.data.saleAmount, null)
  assert.equal(saved.data.saleDate, '2026-10-12T08:30:00.000Z')
  assert.equal(saved.data.details, `Initial draft ${suffix}`)

  response = await save({ saleDate: null })
  saved = await parseSaved(response)
  assert.equal(saved.data.saleAmount, null)
  assert.equal(saved.data.saleDate, null)
  assert.equal(saved.data.details, `Initial draft ${suffix}`)

  response = await save({ details: null })
  saved = await parseSaved(response)
  assert.equal(saved.data.details, null)

  const replacementDate = '2026-11-06T14:15:00.000Z'
  response = await save({ saleAmount: 876543, saleDate: replacementDate, details: `Updated draft ${suffix}` })
  saved = await parseSaved(response)
  assert.equal(saved.data.saleAmount, '876543')
  assert.equal(saved.data.saleDate, replacementDate)
  assert.equal(saved.data.details, `Updated draft ${suffix}`)

  response = await save({ details: `Partial update ${suffix}` })
  saved = await parseSaved(response)
  assert.equal(saved.data.saleAmount, '876543')
  assert.equal(saved.data.saleDate, replacementDate)
  assert.equal(saved.data.details, `Partial update ${suffix}`)
  assert.equal((await save({ saleAmount: 0 })).status, 400)
  assert.equal((await save({ saleDate: 'not-a-date' })).status, 400)

  await prisma.collaborationClosingReport.update({
    where: { dealId: deal.id },
    data: { status: 'SUBMITTED', submittedAt: new Date() },
  })
  assert.equal((await save({ details: null })).status, 409)
})

test('public confirmation hides unknown, expired and used confirmation tokens equally', {
  skip: !enabled,
}, async (context) => {
  const suffix = randomUUID()
  let agentId: number | null = null
  let dealId: number | null = null
  let reportId: number | null = null
  const confirmationIds: number[] = []

  try {
    agentId = await createAgent(`confirmation-${suffix}@test.invalid`, `035${suffix.slice(0, 7)}`, 'Confirmation', 'Test')
    const deal = await createDeal(agentId, `${suffix}-confirmation`, 'DECLARED')
    dealId = deal.id
    reportId = deal.reportId
    const expiredToken = createClientConfirmationPublicToken()
    const usedToken = createClientConfirmationPublicToken()
    const confirmations = await Promise.all([
      prisma.collaborationClientConfirmation.create({
        data: {
          dealId,
          publicTokenHash: hashClientConfirmationPublicToken(expiredToken),
          codeHash: '0'.repeat(64),
          expiresAt: new Date(Date.now() - 60_000),
        },
        select: { id: true },
      }),
    ])
    confirmationIds.push(...confirmations.map(({ id }) => id))

    const usedDeal = await createDeal(agentId, `${suffix}-used-confirmation`, 'DECLARED')
    const usedConfirmation = await prisma.collaborationClientConfirmation.create({
      data: {
        dealId: usedDeal.id,
        publicTokenHash: hashClientConfirmationPublicToken(usedToken),
        status: 'CONFIRMED_BY_CLIENT',
        codeHash: '0'.repeat(64),
        expiresAt: new Date(Date.now() - 60_000),
      },
      select: { id: true },
    })

    await context.test('signed prospects close pending requests, stay masked, reject actions, and can be hidden idempotently', async () => {
      const suffix = randomUUID()
      const deals: Array<{ id: number; reportId: number }> = []
      let pendingRequestId: number | null = null

      try {
        const supplierId = await createAgent(`signed-supplier-${suffix}@test.invalid`, `036${suffix.slice(0, 7)}`, 'Signed', 'Supplier')
        const closerId = await createAgent(`signed-closer-${suffix}@test.invalid`, `037${suffix.slice(0, 7)}`, 'Signed', 'Closer')
        const otherAgentId = await createAgent(`signed-other-${suffix}@test.invalid`, `038${suffix.slice(0, 7)}`, 'Other', 'Agent')
        const outsiderId = await createAgent(`signed-outsider-${suffix}@test.invalid`, `039${suffix.slice(0, 7)}`, 'Outside', 'Agent')

        const signed = await createDeal(supplierId, `${suffix}-signed`, 'CONTRACT_SIGNED')
        deals.push(signed)
        const lost = await createDeal(supplierId, `${suffix}-lost`, 'LOST')
        deals.push(lost)
        const expired = await createDeal(supplierId, `${suffix}-expired`, 'EXPIRED')
        deals.push(expired)
        for (const [deal, unique] of [[lost, `${suffix}-lost`], [expired, `${suffix}-expired`]] as const) {
          const companyName = `Private Company ${unique}`
          const contactName = `Private Contact ${unique}`
          const phone = `PRIVATE_PHONE_${unique}`
          const email = `private-${unique}@test.invalid`
          await prisma.collaborationProspectSecret.create({
            data: {
              dealId: deal.id,
              companyNameCiphertext: encryptPii(companyName),
              contactNameCiphertext: encryptPii(contactName),
              phoneCiphertext: encryptPii(phone),
              emailCiphertext: encryptPii(email),
              addressCiphertext: encryptPii(`PRIVATE_ADDRESS_${unique}`),
              companyNameHash: hashNormalizedCompanyName(companyName),
              phoneHash: hashNormalizedPhone(phone),
              emailHash: hashNormalizedEmail(email),
            },
          })
        }
        const open = await createDeal(supplierId, `${suffix}-open`, 'DECLARED')
        deals.push(open)

        const now = new Date()
        const pending = await prisma.collaborationAccessRequest.create({
          data: {
            dealId: signed.id,
            requesterId: otherAgentId,
            status: 'CLOSED_SIGNED',
            pendingKey: null,
            requestedAt: now,
            expiresAt: new Date(now.getTime() + 60 * 60_000),
            decidedAt: now,
          },
          select: { id: true },
        })
        pendingRequestId = pending.id
        await prisma.collaborationDeal.update({
          where: { id: signed.id },
          data: {
            closerId,
            accessGrantedAt: now,
            accessExpiresAt: new Date(now.getTime() + 60 * 60_000),
          },
        })
        await prisma.collaborationAccessRequest.create({
          data: {
            dealId: signed.id,
            requesterId: closerId,
            status: 'APPROVED',
            decidedAt: now,
            requestedAt: now,
            expiresAt: new Date(now.getTime() + 60 * 60_000),
          },
        })

        const prospectResponse = await get('/prospects', tokenFor(otherAgentId))
        assert.equal(prospectResponse.status, 200)
        const rawProspectResponse = await prospectResponse.text()
        const prospectPayload = JSON.parse(rawProspectResponse) as { data: Array<Record<string, unknown>> }
        const signedProspect = prospectPayload.data.find((item) => item.dealId === signed.id)
        assert.equal(signedProspect?.dealStatus, 'CLOSED_SIGNED')
        assert.equal(signedProspect?.status, 'CLOSED_SIGNED')
        for (const marker of [
          `Private Company ${suffix}`,
          `Private Contact ${suffix}`,
          `PRIVATE_PHONE_${suffix}`,
          `PRIVATE_ADDRESS_${suffix}`,
          `private-${suffix}@test.invalid`,
          signed.saleNumber ?? 'never',
        ]) {
          assert.equal(rawProspectResponse.includes(marker), false, `Response leaked ${marker}`)
        }
        for (const key of [
          'supplierId',
          'closerId',
          'saleNumber',
          'saleAmount',
          'amount',
          'contactPhone',
          'contactEmail',
          'address',
          'companyName',
          'contactName',
        ]) {
          assert.equal(key in (signedProspect ?? {}), false, `Signed prospect exposed ${key}`)
        }

        const requestResponse = await post(`/${signed.id}/access-requests`, tokenFor(otherAgentId), {})
        assert.equal(requestResponse.status, 409)
        assert.deepEqual(await requestResponse.json(), { error: 'Prospect déjà signé' })
        const acceptResponse = await fetch(`${baseUrl}/api/collaboration/access-requests/${pending.id}`, {
          method: 'PATCH',
          headers: { authorization: `Bearer ${tokenFor(supplierId)}`, 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'APPROVE' }),
        })
        assert.equal(acceptResponse.status, 409)
        assert.deepEqual(await acceptResponse.json(), { error: 'Prospect déjà signé' })
        const lostResponse = await post(`/${signed.id}/lost`, tokenFor(closerId), { reason: 'NO_INTEREST' })
        assert.equal(lostResponse.status, 409)
        assert.deepEqual(await lostResponse.json(), { error: 'Prospect déjà signé' })
        const closingResponse = await post(`/${signed.id}/closing-report/submit`, tokenFor(closerId), { idempotencyKey: randomUUID() })
        assert.equal(closingResponse.status, 409)
        assert.deepEqual(await closingResponse.json(), { error: 'Prospect déjà signé' })

        const hideFirst = await post(`/prospects/${signed.id}/hide`, tokenFor(otherAgentId), {})
        const hideAgain = await post(`/prospects/${signed.id}/hide`, tokenFor(otherAgentId), {})
        assert.equal(hideFirst.status, 200)
        assert.equal(hideAgain.status, 200)
        assert.equal(await prisma.collaborationHiddenDeal.count({ where: { dealId: signed.id, agentId: otherAgentId } }), 1)
        const hiddenProspects = await get('/prospects', tokenFor(otherAgentId))
        const hiddenPayload = await hiddenProspects.json() as { data: Array<Record<string, unknown>> }
        assert.equal(hiddenPayload.data.some((item) => item.dealId === signed.id), false)
        const otherAgentProspects = await get('/prospects', tokenFor(outsiderId))
        const otherPayload = await otherAgentProspects.json() as { data: Array<Record<string, unknown>> }
        assert.equal(otherPayload.data.some((item) => item.dealId === signed.id), true)
        const openHide = await post(`/prospects/${open.id}/hide`, tokenFor(otherAgentId), {})
        assert.equal(openHide.status, 409)

        for (const availableDeal of [lost, expired]) {
          const availableResponse = await get('/prospects', tokenFor(outsiderId))
          const availablePayload = await availableResponse.json() as { data: Array<Record<string, unknown>> }
          assert.equal(availablePayload.data.some((item) => item.dealId === availableDeal.id), true)
          const newRequest = await post(`/${availableDeal.id}/access-requests`, tokenFor(outsiderId), {})
          assert.equal(newRequest.status, 201)
        }

        assert.notEqual(pendingRequestId, null)
        const closedPending = pendingRequestId === null ? null : await prisma.collaborationAccessRequest.findUnique({
          where: { id: pendingRequestId },
          select: { status: true },
        })
        assert.equal(closedPending?.status, 'CLOSED_SIGNED')
      } finally {
        const dealIds = deals.map(({ id }) => id)
        if (dealIds.length) await prisma.collaborationHiddenDeal.deleteMany({ where: { dealId: { in: dealIds } } })
      }
    })
    confirmationIds.push(usedConfirmation.id)

    const unknownToken = createClientConfirmationPublicToken()
    const getToken = (token: string) => fetch(
      `${baseUrl}/api/collaboration/public/confirmations/${token}`,
    )
    const responses = await Promise.all([
      getToken(unknownToken),
      getToken(expiredToken),
      getToken(usedToken),
    ])
    const payloads = await Promise.all(responses.map(async (response) => ({
      status: response.status,
      body: await response.json(),
    })))
    assert.deepEqual(payloads[0], payloads[1])
    assert.deepEqual(payloads[0], payloads[2])
    assert.equal(payloads[0].status, 404)

    const invalidPost = await fetch(
      `${baseUrl}/api/collaboration/public/confirmations/${createClientConfirmationPublicToken()}/respond`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: '00000000', answer: 'CONFIRMED' }),
      },
    )
    assert.equal(invalidPost.status, 404)
    assert.deepEqual(await invalidPost.json(), payloads[0].body)
  } finally {
    if (confirmationIds.length) {
      await prisma.collaborationClientConfirmation.deleteMany({ where: { id: { in: confirmationIds } } })
    }
    if (agentId !== null) {
      const associatedDeals = await prisma.collaborationDeal.findMany({
        where: { supplierId: agentId },
        select: { id: true, reportId: true },
      })
      const associatedDealIds = [...new Set([...(dealId === null ? [] : [dealId]), ...associatedDeals.map(({ id }) => id)])]
      const associatedReportIds = [...new Set([...(reportId === null ? [] : [reportId]), ...associatedDeals.map(({ reportId: id }) => id)])]
      if (associatedDealIds.length) {
        await prisma.collaborationClientConfirmation.deleteMany({ where: { dealId: { in: associatedDealIds } } })
        await prisma.collaborationDeal.deleteMany({ where: { id: { in: associatedDealIds } } })
      }
      if (associatedReportIds.length) await prisma.report.deleteMany({ where: { id: { in: associatedReportIds } } })
      await prisma.agentProfile.deleteMany({ where: { userId: agentId } })
      await prisma.user.deleteMany({ where: { id: agentId } })
    }
  }
})
