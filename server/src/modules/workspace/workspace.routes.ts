import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, type AuthRequest } from '../auth/auth.middleware.js';
import { prisma } from '../../lib/prisma.js';
import { getWebPushPublicKey, hashPushEndpoint } from '../../lib/web-push.js';
import { notifyAdmins, notifyUser } from '../notifications/notifications.service.js';
import { getAvailableCollaborationCommissionAmount, getWithdrawalMinimum } from './wallet.service.js';

export const workspaceRouter = Router();
const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(20).max(255),
    auth: z.string().min(10).max(255),
  }),
}).refine(({ endpoint }) => {
  const host = new URL(endpoint).hostname.toLowerCase();
  return new URL(endpoint).protocol === 'https:' && (
    host === 'fcm.googleapis.com'
    || host.endsWith('.push.services.mozilla.com')
    || host === 'push.services.mozilla.com'
    || host === 'web.push.apple.com'
    || host.endsWith('.notify.windows.com')
  );
}, { message: 'Point de terminaison de notification non pris en charge.' });

workspaceRouter.get('/push/public-key', (_request, response) => {
  const publicKey = getWebPushPublicKey();
  if (!publicKey) {
    response.status(503).json({ error: 'Les notifications système ne sont pas encore configurées sur le serveur.' });
    return;
  }
  response.json({ publicKey });
});
workspaceRouter.post('/push/subscriptions', async (request: AuthRequest, response) => {
  if (request.user?.role !== 'AGENT' || request.user.status !== 'ACTIF') {
    response.status(403).json({ error: 'Les notifications push sont réservées aux agents actifs.' });
    return;
  }
  if (!getWebPushPublicKey()) {
    response.status(503).json({ error: 'Les notifications système ne sont pas encore configurées sur le serveur.' });
    return;
  }
  const result = pushSubscriptionSchema.safeParse(request.body);
  if (!result.success) {
    response.status(400).json({ error: 'Abonnement de notification invalide.' });
    return;
  }
  const endpointHash = hashPushEndpoint(result.data.endpoint);
  await prisma.pushSubscription.upsert({
    where: { endpointHash },
    create: {
      userId: request.user.id,
      endpoint: result.data.endpoint,
      endpointHash,
      p256dh: result.data.keys.p256dh,
      auth: result.data.keys.auth,
    },
    update: {
      userId: request.user.id,
      endpoint: result.data.endpoint,
      p256dh: result.data.keys.p256dh,
      auth: result.data.keys.auth,
    },
  });
  response.status(201).json({ message: 'Notifications système activées sur cet appareil.' });
});
workspaceRouter.delete('/push/subscriptions', async (request: AuthRequest, response) => {
  if (request.user?.role !== 'AGENT') {
    response.status(403).json({ error: 'Cette action est réservée aux agents.' });
    return;
  }
  const endpoint = z.string().url().max(2048).safeParse(request.body?.endpoint);
  if (!endpoint.success) {
    response.status(400).json({ error: 'Abonnement de notification invalide.' });
    return;
  }
  const endpointHash = hashPushEndpoint(endpoint.data);
  await prisma.pushSubscription.deleteMany({ where: { endpointHash, userId: request.user.id } });
  response.json({ message: 'Notifications système désactivées sur cet appareil.' });
});

workspaceRouter.get('/search', async (request: AuthRequest, response) => {
  const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 80) : '';
  if (query.length < 2) { response.json({ data: [] }); return; }
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(request.user!.role);
  if (isAdmin) {
    const [reports, applications, products] = await Promise.all([
      prisma.report.findMany({ where: { companyName: { contains: query } }, take: 5, orderBy: { createdAt: 'desc' }, select: { id: true, companyName: true, status: true } }),
      prisma.application.findMany({ where: { OR: [{ fullName: { contains: query } }, { email: { contains: query } }] }, take: 5, orderBy: { createdAt: 'desc' }, select: { id: true, fullName: true, email: true, status: true } }),
      prisma.product.findMany({ where: { title: { contains: query } }, take: 5, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, status: true } }),
    ]);
    response.json({ data: [
      ...reports.map((item) => ({ id: `report-${item.id}`, title: item.companyName, detail: `Rapport · ${item.status.toLowerCase()}`, view: 'admin-reports' })),
      ...applications.map((item) => ({ id: `application-${item.id}`, title: item.fullName, detail: `${item.email} · ${item.status.toLowerCase()}`, view: 'admin-applications' })),
      ...products.map((item) => ({ id: `product-${item.id}`, title: item.title, detail: `Produit · ${item.status.toLowerCase()}`, view: 'admin-products' })),
    ] });
    return;
  }
  const [reports, products] = await Promise.all([
    prisma.report.findMany({ where: { agentId: request.user!.id, companyName: { contains: query } }, take: 5, orderBy: { createdAt: 'desc' }, select: { id: true, companyName: true, status: true } }),
    prisma.product.findMany({ where: { status: 'PUBLIE', title: { contains: query } }, take: 5, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, status: true } }),
  ]);
  response.json({ data: [
    ...reports.map((item) => ({ id: `report-${item.id}`, title: item.companyName, detail: `Rapport · ${item.status.toLowerCase()}`, view: 'reports' })),
    ...products.map((item) => ({ id: `product-${item.id}`, title: item.title, detail: 'Produit du catalogue', view: 'products' })),
  ] });
});
workspaceRouter.get('/notifications', async (request: AuthRequest, response) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: request.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: { actor: { select: { id: true, role: true, lastActiveAt: true, agentProfile: { select: { firstName: true, lastName: true, imageUrl: true } } } } },
  });
  const legacyActorNames = new Map<number, string>();
  const actorNamePattern = /^(.+?)\s+(?:a\s+(?:commenté|publié|déclaré)|demande l’accès)\b/u;
  for (const notification of notifications) {
    if (notification.actor || !['COMMUNITY_POST', 'COMMUNITY_COMMENT', 'COMMUNITY_REPLY', 'COLLABORATION_ACCESS_REQUESTED'].includes(notification.type)) continue;
    const name = notification.body.match(actorNamePattern)?.[1]?.trim();
    if (name) legacyActorNames.set(notification.id, name);
  }
  const nameParts = [...new Set(legacyActorNames.values())].map((name) => {
    const splitAt = name.lastIndexOf(' ');
    return splitAt > 0 ? { firstName: name.slice(0, splitAt), lastName: name.slice(splitAt + 1) } : null;
  }).filter((part): part is { firstName: string; lastName: string } => part !== null);
  const matchedUsers = nameParts.length
    ? await prisma.user.findMany({
      where: {
        role: 'AGENT',
        agentProfile: { is: { OR: nameParts } },
      },
      select: { id: true, role: true, lastActiveAt: true, agentProfile: { select: { firstName: true, lastName: true, imageUrl: true } } },
    })
    : [];
  const usersByName = new Map<string, typeof matchedUsers>();
  for (const agent of matchedUsers) {
    if (!agent.agentProfile) continue;
    const name = `${agent.agentProfile.firstName} ${agent.agentProfile.lastName}`.trim();
    usersByName.set(name, [...(usersByName.get(name) ?? []), agent]);
  }
  response.json({ data: notifications.map((notification) => {
    if (notification.actor) return notification;
    const name = legacyActorNames.get(notification.id);
    const matches = name ? usersByName.get(name) : undefined;
    return matches?.length === 1 ? { ...notification, actor: matches[0] } : notification;
  }) });
});
workspaceRouter.patch('/notifications/:id/read', async (request: AuthRequest, response) => {
  const notification = await prisma.notification.updateMany({ where: { id: Number(request.params.id), userId: request.user!.id }, data: { readAt: new Date() } });
  response.json({ data: notification });
});
workspaceRouter.delete('/notifications/:id', async (request: AuthRequest, response) => {
  const result = await prisma.notification.deleteMany({ where: { id: Number(request.params.id), userId: request.user!.id } });
  response.json({ data: result });
});
workspaceRouter.post('/withdrawals', async (request: AuthRequest, response) => {
  if (request.user?.role !== 'AGENT') { response.status(403).json({ error: 'Seuls les agents peuvent demander un retrait' }); return; }
  const amount = Number(request.body.amount);
  const operator = typeof request.body.operator === 'string' ? request.body.operator.trim() : '';
  const phoneNumber = typeof request.body.phoneNumber === 'string' ? request.body.phoneNumber.trim() : '';
  const withdrawalMinimum = await getWithdrawalMinimum(prisma);
  if (!Number.isSafeInteger(amount) || amount < withdrawalMinimum || amount <= 0 || !['MVola', 'Orange Money', 'Airtel Money'].includes(operator) || phoneNumber.length < 7 || phoneNumber.length > 30) {
    response.status(400).json({ error: 'Montant, opérateur ou numéro de paiement invalide' });
    return;
  }
  const withdrawal = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM users WHERE id = ${request.user!.id} FOR UPDATE`
    const [gains, collaborationCommissionBalance, withdrawals] = await Promise.all([
      transaction.transaction.aggregate({ where: { agentId: request.user!.id }, _sum: { amount: true } }),
      getAvailableCollaborationCommissionAmount(transaction, request.user!.id),
      transaction.withdrawal.aggregate({
        where: { agentId: request.user!.id, status: { in: ['DEMANDE', 'APPROUVE', 'PAYE'] } },
        _sum: { amount: true },
      }),
    ])
    const availableBalance = (gains._sum.amount ?? 0n)
      + collaborationCommissionBalance
      - (withdrawals._sum.amount ?? 0n)
    if (BigInt(amount) > availableBalance) {
      response.status(400).json({ error: 'Le montant demandé dépasse votre solde disponible' })
      return null
    }
    return transaction.withdrawal.create({ data: { agentId: request.user!.id, amount: BigInt(amount), operator, phoneNumber } })
  })
  if (!withdrawal) return
  await notifyAdmins({ type: 'WITHDRAWAL_REQUESTED', title: 'Nouvelle demande de retrait', body: `${amount.toLocaleString('fr-FR')} Ar demandés par l’agent ${request.user.id}.`, link: '/admin-withdrawals' });
  response.status(201).json({ data: { ...withdrawal, amount: withdrawal.amount.toString() } });
});
workspaceRouter.get('/settings', async (request: AuthRequest, response) => {
  if (!request.user) {
    response.status(401).json({ error: 'Authentification requise' });
    return;
  }
  const settings = await prisma.setting.findMany({ orderBy: { key: 'asc' } });
  response.json({ data: settings });
});
workspaceRouter.put('/settings/:key', requireAdmin, async (request, response) => {
  const key = String(request.params.key);
  const value = String(request.body.value ?? '');
  if (['report_lead_amount', 'report_sale_amount', 'withdrawal_minimum'].includes(key) && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
    response.status(400).json({ error: 'Le montant doit être un nombre entier positif ou nul.' });
    return;
  }
  if (key === 'badge_price' && value !== '' && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2_147_483_647)) {
    response.status(400).json({ error: 'Le prix du badge doit être un montant entier supérieur à zéro.' });
    return;
  }
  if (key === 'badge_duration_days' && value !== '' && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 3650)) {
    response.status(400).json({ error: 'La durée doit être comprise entre 1 et 3650 jours.' });
    return;
  }
  if (['badge_payment_operator', 'badge_payment_name', 'badge_payment_number'].includes(key)
    && ((value.trim() !== '' && value.trim().length < 2) || value.trim().length > 100)) {
    response.status(400).json({ error: 'Renseignez des coordonnées Mobile Money valides (2 à 100 caractères).' });
    return;
  }
  const setting = await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  response.json({ data: setting });
});
