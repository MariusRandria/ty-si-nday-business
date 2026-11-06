import { prisma } from '../../lib/prisma.js';
import type { Notification } from '@prisma/client';
import { isEmailDeliveryConfigured, sendNewProspectEmail } from '../../lib/email.js';
import { sendPushNotification } from '../../lib/web-push.js';
import { emitNotification } from './notifications.gateway.js';

type NotificationInput = { type: string; title: string; body: string; link?: string; pushBody?: string; actorId?: number };
const notificationActorSelect = {
  id: true,
  role: true,
  agentProfile: { select: { firstName: true, lastName: true, imageUrl: true } },
} as const;

export function publishNotification(notification: Notification & { actor?: { id: number; role: string; agentProfile: { firstName: string; lastName: string; imageUrl: string | null } | null } | null }, pushBody = notification.body) {
  emitNotification(notification);
  void sendPushNotification(notification.userId, {
    title: notification.title,
    body: pushBody,
    notificationId: notification.id,
  }).catch((error: unknown) => console.error('Failed to send push notification:', error));
}

export async function notifyUser(userId: number, input: NotificationInput) {
  try {
    const { pushBody, ...notificationData } = input;
    const notification = await prisma.notification.create({
      data: { userId, ...notificationData },
      include: { actor: { select: notificationActorSelect } },
    });
    publishNotification(notification, pushBody);
  }
  catch (error) { console.error('Failed to create user notification:', error); }
}

export async function notifyAdmins(input: NotificationInput) {
  try {
    const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIF' }, select: { id: true } });
    if (!admins.length) return;
    const { pushBody: _pushBody, ...notificationData } = input;
    const notifications = await Promise.all(admins.map(({ id }) => prisma.notification.create({
      data: { userId: id, ...notificationData },
      include: { actor: { select: notificationActorSelect } },
    })));
    notifications.forEach(emitNotification);
  } catch (error) { console.error('Failed to notify administrators:', error); }
}

export async function notifyAgents(input: NotificationInput, excludeUserId?: number) {
  try {
    const agents = await prisma.user.findMany({
      where: {
        role: 'AGENT',
        status: 'ACTIF',
        ...(excludeUserId === undefined ? {} : { id: { not: excludeUserId } }),
      },
      select: { id: true },
    });
    if (!agents.length) return;
    const { pushBody, ...notificationData } = input;
    const notifications = await Promise.all(agents.map(({ id }) => prisma.notification.create({
      data: { userId: id, ...notificationData },
      include: { actor: { select: notificationActorSelect } },
    })));
    notifications.forEach(emitNotification);
    void Promise.allSettled(notifications.map((notification) =>
      sendPushNotification(notification.userId, {
        title: notification.title,
        body: pushBody ?? notification.body,
        notificationId: notification.id,
      }),
    )).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') console.error('Failed to send agent push notification:', result.reason);
      }
    });
  } catch (error) {
    console.error('Failed to notify agents:', error);
  }
}

export async function notifyBadgeSubscribers(input: NotificationInput, newProspectCompanyName?: string) {
  try {
    const now = new Date();
    const agents = await prisma.user.findMany({
      where: {
        role: 'AGENT',
        status: 'ACTIF',
        subscriptionRequests: {
          some: {
            status: 'APPROVED',
            startsAt: { lte: now },
            expiresAt: { gt: now },
          },
        },
      },
      select: {
        id: true,
        ...(newProspectCompanyName ? {
          email: true,
          agentProfile: { select: { firstName: true, lastName: true } },
        } : {}),
      },
    });
    if (!agents.length) return;
    const { pushBody, ...notificationData } = input;
    const notifications = await Promise.all(agents.map(({ id }) =>
      prisma.notification.create({ data: { userId: id, ...notificationData } }),
    ));
    notifications.forEach(emitNotification);
    if (newProspectCompanyName) {
      if (!isEmailDeliveryConfigured()) {
        console.error('Unable to send new prospect emails: SMTP is not configured');
      } else {
        void Promise.allSettled(agents.map((agent) => {
          const fullName = 'agentProfile' in agent
            ? [agent.agentProfile?.firstName, agent.agentProfile?.lastName].filter(Boolean).join(' ') || agent.email
            : '';
          return 'email' in agent
            ? sendNewProspectEmail(agent.email, fullName, newProspectCompanyName)
            : Promise.resolve();
        })).then((results) => {
          for (const result of results) {
            if (result.status === 'rejected') console.error('Failed to email a new prospect to a badge subscriber:', result.reason);
          }
        });
      }
    }
    void Promise.allSettled(notifications.map((notification) =>
      sendPushNotification(notification.userId, {
        title: notification.title,
        body: pushBody ?? notification.body,
        notificationId: notification.id,
      }),
    )).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') console.error('Failed to send subscriber push notification:', result.reason);
      }
    });
  } catch (error) {
    console.error('Failed to notify badge subscribers:', error);
  }
}