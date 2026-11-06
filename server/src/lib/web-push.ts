import { createHash } from 'node:crypto';
import webpush, { type PushSubscription as WebPushSubscription } from 'web-push';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';

type PushPayload = { title: string; body: string; notificationId: number };

let vapidSetupAttempted = false;
let vapidSetupSucceeded = false;

function configureVapid() {
  if (!env.webPushPublicKey || !env.webPushPrivateKey || !env.webPushSubject) return false;
  if (!vapidSetupAttempted) {
    vapidSetupAttempted = true;
    try {
      webpush.setVapidDetails(env.webPushSubject, env.webPushPublicKey, env.webPushPrivateKey);
      vapidSetupSucceeded = true;
    } catch (error) {
      console.error('Web Push VAPID configuration is invalid:', error);
    }
  }
  return vapidSetupSucceeded;
}

export function getWebPushPublicKey() {
  return configureVapid() ? env.webPushPublicKey : null;
}

export async function sendPushNotification(userId: number, payload: PushPayload) {
  if (!configureVapid()) return;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId, user: { role: 'AGENT', status: 'ACTIF' } },
    select: { endpoint: true, endpointHash: true, p256dh: true, auth: true },
  });
  if (!subscriptions.length) return;

  const results = await Promise.allSettled(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        } satisfies WebPushSubscription,
        JSON.stringify({
          ...payload,
          title: payload.title.slice(0, 120),
          body: payload.body.slice(0, 250),
        }),
      );
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'statusCode' in error
        && (error.statusCode === 404 || error.statusCode === 410)) {
        await prisma.pushSubscription.deleteMany({ where: { endpointHash: subscription.endpointHash } });
        return;
      }
      throw error;
    }
  }));
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(`Push delivery failed for agent ${userId}:`, result.reason);
    }
  }
}

export function hashPushEndpoint(endpoint: string) {
  return createHash('sha256').update(endpoint).digest('hex');
}
