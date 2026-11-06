import { createHmac } from 'node:crypto'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { env } from '../../config/env.js'
import { prisma } from '../../lib/prisma.js'

type RateLimitOptions = {
  scope: string
  limit: number
  windowMs: number
  blockMs?: number
  key?: (request: Request) => string
}

function makeBucketKey(scope: string, identity: string): string {
  return createHmac('sha256', env.jwtSecret).update(`${scope}:${identity}`).digest('hex')
}

async function consume(bucketKey: string, options: RateLimitOptions, now: Date): Promise<boolean> {
  const windowStartedAt = new Date(now.getTime() - options.windowMs)
  const blockUntil = new Date(now.getTime() + (options.blockMs ?? options.windowMs))
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const bucket = await prisma.collaborationRateLimitBucket.findUnique({ where: { bucketKey } })
    if (!bucket) {
      try {
        await prisma.collaborationRateLimitBucket.create({
          data: { bucketKey, attempts: 1, windowStartedAt: now },
        })
        return true
      } catch (error) {
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002')) throw error
        continue
      }
    }
    if (bucket.blockedUntil && bucket.blockedUntil > now) return false
    if (bucket.windowStartedAt <= windowStartedAt) {
      const reset = await prisma.collaborationRateLimitBucket.updateMany({
        where: { id: bucket.id, windowStartedAt: bucket.windowStartedAt },
        data: { attempts: 1, windowStartedAt: now, blockedUntil: null },
      })
      if (reset.count === 1) return true
      continue
    }
    const incremented = await prisma.collaborationRateLimitBucket.updateMany({
      where: {
        id: bucket.id,
        attempts: { lt: options.limit },
        OR: [{ blockedUntil: null }, { blockedUntil: { lte: now } }],
      },
      data: { attempts: { increment: 1 } },
    })
    if (incremented.count === 1) return true
    await prisma.collaborationRateLimitBucket.updateMany({
      where: { id: bucket.id, attempts: { gte: options.limit } },
      data: { blockedUntil: blockUntil },
    })
    return false
  }
  return false
}

export async function consumeCollaborationRateLimit(
  scope: string,
  identity: string,
  limit: number,
  windowMs: number,
  blockMs = windowMs,
  now = new Date(),
): Promise<boolean> {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new Error('Collaboration rate limit configuration is invalid.')
  }
  const options = { scope, limit, windowMs, blockMs }
  return consume(makeBucketKey(scope, identity), options, now)
}

export function collaborationRateLimit(options: RateLimitOptions): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const identity = options.key?.(request) ?? request.ip ?? 'unknown'
    void consumeCollaborationRateLimit(options.scope, identity, options.limit, options.windowMs, options.blockMs)
      .then((allowed) => {
        if (!allowed) {
          response.status(429).json({ error: 'Trop de requêtes. Réessayez plus tard.' })
          return
        }
        next()
      })
      .catch(next)
  }
}
