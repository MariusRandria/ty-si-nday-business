import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  isEmailDeliveryConfigured,
  sendBadgeSubscriptionApprovalEmail,
  sendBadgeSubscriptionPendingEmail,
  sendBadgeSubscriptionRejectionEmail,
} from '../../lib/email.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../auth/auth.middleware.js';
import { notifyAdmins, notifyUser } from '../notifications/notifications.service.js';

export const subscriptionRouter = Router();
export const adminSubscriptionRouter = Router();

const proofUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single('proof');
const subscriptionSettings = ['badge_price', 'badge_duration_days', 'badge_payment_operator', 'badge_payment_name', 'badge_payment_number'];

type BadgeConfig = {
  price: number
  durationDays: number
  paymentOperator: string
  paymentName: string
  paymentNumber: string
  configured: boolean
}

async function getBadgeConfig(): Promise<BadgeConfig> {
  const settings = await prisma.setting.findMany({ where: { key: { in: subscriptionSettings } } });
  const values = Object.fromEntries(settings.map(({ key, value }) => [key, value.trim()]));
  const price = Number(values.badge_price);
  const durationDays = Number(values.badge_duration_days);
  const paymentOperator = values.badge_payment_operator ?? '';
  const paymentName = values.badge_payment_name ?? '';
  const paymentNumber = values.badge_payment_number ?? '';
  return {
    price,
    durationDays,
    paymentOperator,
    paymentName,
    paymentNumber,
    configured: Number.isSafeInteger(price) && price > 0
      && Number.isSafeInteger(durationDays) && durationDays > 0
      && Boolean(paymentOperator && paymentName && paymentNumber),
  };
}

function isActiveAgent(request: AuthRequest) {
  return request.user?.role === 'AGENT' && request.user.status === 'ACTIF';
}

function proofExtension(buffer: Buffer, mimeType: string) {
  if (mimeType === 'application/pdf' && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  if (mimeType === 'image/png' && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (mimeType === 'image/jpeg' && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (mimeType === 'image/webp' && buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function parseProof(request: Parameters<typeof proofUpload>[0], response: Parameters<typeof proofUpload>[1], next: Parameters<typeof proofUpload>[2]) {
  proofUpload(request, response, (error: unknown) => {
    if (!error) { next(); return; }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({ error: 'Le justificatif ne doit pas dépasser 5 Mo.' });
      return;
    }
    response.status(400).json({ error: error instanceof Error ? error.message : 'Impossible de lire le justificatif.' });
  });
}

subscriptionRouter.get('/me', async (request: AuthRequest, response) => {
  if (!isActiveAgent(request)) {
    response.status(403).json({ error: 'Cette fonctionnalité est réservée aux agents actifs.' });
    return;
  }
  const now = new Date();
  const [config, current, latestRequest] = await Promise.all([
    getBadgeConfig(),
    prisma.subscriptionRequest.findFirst({
      where: { userId: request.user!.id, status: 'APPROVED', startsAt: { lte: now }, expiresAt: { gt: now } },
      orderBy: { expiresAt: 'desc' },
      select: { id: true, startsAt: true, expiresAt: true, amount: true, durationDays: true },
    }),
    prisma.subscriptionRequest.findFirst({
      where: { userId: request.user!.id },
      orderBy: { requestedAt: 'desc' },
      select: { id: true, status: true, amount: true, durationDays: true, transactionRef: true, rejectionReason: true, requestedAt: true, reviewedAt: true, startsAt: true, expiresAt: true },
    }),
  ]);
  response.json({ data: { config, current, latestRequest } });
});

subscriptionRouter.post('/', parseProof, async (request: AuthRequest, response) => {
  if (!isActiveAgent(request)) {
    response.status(403).json({ error: 'Cette fonctionnalité est réservée aux agents actifs.' });
    return;
  }
  const config = await getBadgeConfig();
  if (!config.configured) {
    response.status(503).json({ error: 'L’abonnement n’est pas encore configuré. Contactez l’administration.' });
    return;
  }
  const parsed = z.object({ transactionRef: z.string().trim().min(4).max(150) }).safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Saisissez une référence de transaction valide.' });
    return;
  }
  const file = request.file;
  if (!file) {
    response.status(400).json({ error: 'Joignez le reçu ou la capture du paiement (PDF, JPEG, PNG ou WebP).' });
    return;
  }
  const extension = proofExtension(file.buffer, file.mimetype);
  if (!extension) {
    response.status(400).json({ error: 'Le justificatif doit être un PDF, JPEG, PNG ou WebP valide.' });
    return;
  }
  const pendingRequest = await prisma.subscriptionRequest.findFirst({
    where: { userId: request.user!.id, status: 'PENDING' },
    select: { id: true },
  });
  if (pendingRequest) {
    response.status(409).json({ error: 'Une demande d’abonnement est déjà en attente de vérification.' });
    return;
  }

  const filename = `${request.user!.id}-${randomUUID()}.${extension}`;
  const uploadDirectory = fileURLToPath(new URL('../../../uploads/subscription-proofs/', import.meta.url));
  const filePath = join(uploadDirectory, filename);
  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(filePath, file.buffer, { flag: 'wx' });
  let subscriptionRequest;
  try {
    subscriptionRequest = await prisma.subscriptionRequest.create({
      data: {
        userId: request.user!.id,
        amount: config.price,
        durationDays: config.durationDays,
        transactionRef: parsed.data.transactionRef,
        proofFilename: filename,
        proofMimeType: file.mimetype,
      },
      select: { id: true, status: true, amount: true, durationDays: true, transactionRef: true, requestedAt: true },
    });
  } catch (error) {
    await unlink(filePath).catch((cleanupError: unknown) => console.error('Unable to remove an unreferenced subscription proof:', cleanupError));
    throw error;
  }
  const submittingAgent = await prisma.user.findUnique({
    where: { id: request.user!.id },
    select: { email: true, agentProfile: { select: { firstName: true, lastName: true } } },
  });
  if (!submittingAgent) throw new Error('Agent account not found after subscription request creation');
  let emailSent = false;
  try {
    if (!isEmailDeliveryConfigured()) throw new Error('SMTP is not configured');
    await sendBadgeSubscriptionPendingEmail(
      submittingAgent.email,
      [submittingAgent.agentProfile?.firstName, submittingAgent.agentProfile?.lastName].filter(Boolean).join(' ') || submittingAgent.email,
      { amount: config.price, transactionRef: parsed.data.transactionRef, durationDays: config.durationDays },
    );
    emailSent = true;
  } catch (error) {
    console.error('Unable to send badge subscription pending email:', error);
  }
  await notifyAdmins({
    type: 'BADGE_SUBSCRIPTION_REQUEST',
    title: 'Nouvelle demande de badge abonné',
    body: `Un agent a transmis un paiement de ${config.price.toLocaleString('fr-FR')} Ar à vérifier.`,
    link: '/admin-subscriptions',
  });
  response.status(201).json({
    data: subscriptionRequest,
    emailSent,
    message: emailSent ? 'Demande envoyée et email de confirmation transmis.' : 'Demande envoyée, mais l’email de confirmation n’a pas pu être transmis.',
  });
});

adminSubscriptionRouter.get('/', async (_request, response) => {
  const requests = await prisma.subscriptionRequest.findMany({
    orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
    select: {
      id: true, status: true, amount: true, transactionRef: true, proofMimeType: true,
      durationDays: true,
      rejectionReason: true, requestedAt: true, reviewedAt: true, startsAt: true, expiresAt: true,
      user: { select: { id: true, email: true, agentProfile: { select: { firstName: true, lastName: true, phone: true } } } },
    },
  });
  response.json({ data: requests });
});

adminSubscriptionRouter.get('/:id/proof', async (request: AuthRequest, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id < 1) {
    response.status(400).json({ error: 'Identifiant de demande invalide.' });
    return;
  }
  const subscriptionRequest = await prisma.subscriptionRequest.findUnique({
    where: { id },
    select: { proofFilename: true, proofMimeType: true },
  });
  if (!subscriptionRequest || !/^\d+-[0-9a-f-]+\.(?:pdf|jpg|png|webp)$/.test(subscriptionRequest.proofFilename)) {
    response.status(404).json({ error: 'Justificatif introuvable.' });
    return;
  }
  const proofPath = join(fileURLToPath(new URL('../../../uploads/subscription-proofs/', import.meta.url)), subscriptionRequest.proofFilename);
  const proof = await readFile(proofPath);
  response.setHeader('Content-Type', subscriptionRequest.proofMimeType);
  response.setHeader('Content-Disposition', `inline; filename="justificatif-${id}.${subscriptionRequest.proofFilename.split('.').pop()}"`);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'private, no-store');
  response.send(proof);
});

adminSubscriptionRouter.patch('/:id/review', async (request: AuthRequest, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id < 1) {
    response.status(400).json({ error: 'Identifiant de demande invalide.' });
    return;
  }
  const parsed = z.object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().trim().max(1000).optional(),
  }).safeParse(request.body);
  if (!parsed.success || (parsed.data.decision === 'REJECTED' && !parsed.data.reason)) {
    response.status(400).json({ error: 'Un motif est obligatoire pour refuser une demande.' });
    return;
  }
  const subscriptionRequest = await prisma.subscriptionRequest.findUnique({
    where: { id },
    select: {
      id: true, userId: true, amount: true, durationDays: true, transactionRef: true,
      status: true, expiresAt: true,
      user: { select: { email: true, agentProfile: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!subscriptionRequest) {
    response.status(404).json({ error: 'Demande d’abonnement introuvable.' });
    return;
  }
  if (subscriptionRequest.status !== 'PENDING') {
    response.status(409).json({ error: 'Cette demande a déjà été traitée.' });
    return;
  }
  let startsAt: Date | null = null;
  let expiresAt: Date | null = null;
  if (parsed.data.decision === 'APPROVED') {
    if (!Number.isSafeInteger(subscriptionRequest.durationDays) || subscriptionRequest.durationDays < 1) {
      response.status(409).json({ error: 'La durée enregistrée pour cette demande est invalide.' });
      return;
    }
    const latestActive = await prisma.subscriptionRequest.findFirst({
      where: { userId: subscriptionRequest.userId, status: 'APPROVED', expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'desc' },
      select: { expiresAt: true },
    });
    startsAt = latestActive?.expiresAt ?? new Date();
    expiresAt = new Date(startsAt.getTime() + subscriptionRequest.durationDays * 24 * 60 * 60 * 1000);
  }
  const updated = await prisma.subscriptionRequest.updateMany({
    where: { id, status: 'PENDING' },
    data: {
      status: parsed.data.decision,
      rejectionReason: parsed.data.decision === 'REJECTED' ? parsed.data.reason!.trim() : null,
      reviewedBy: request.user!.id,
      reviewedAt: new Date(),
      startsAt,
      expiresAt,
    },
  });
  if (!updated.count) {
    response.status(409).json({ error: 'Cette demande vient d’être traitée par un autre administrateur.' });
    return;
  }
  const approved = parsed.data.decision === 'APPROVED';
  await notifyUser(subscriptionRequest.userId, {
    type: approved ? 'BADGE_SUBSCRIPTION_APPROVED' : 'BADGE_SUBSCRIPTION_REJECTED',
    title: approved ? 'Votre badge abonné est activé' : 'Votre demande de badge a été refusée',
    body: approved
      ? `Votre badge est actif jusqu’au ${expiresAt!.toLocaleDateString('fr-FR')}. Vous pouvez accéder aux contacts prospects.`
      : `Votre demande n’a pas été validée. Motif : ${parsed.data.reason!.trim()}`,
    link: approved ? '/prospects' : '/subscription',
    actorId: request.user!.id,
  });
  if (approved) {
    try {
      if (!isEmailDeliveryConfigured()) throw new Error('SMTP is not configured');
      await sendBadgeSubscriptionApprovalEmail(
        subscriptionRequest.user.email,
        [subscriptionRequest.user.agentProfile?.firstName, subscriptionRequest.user.agentProfile?.lastName].filter(Boolean).join(' ') || subscriptionRequest.user.email,
        {
          amount: subscriptionRequest.amount,
          transactionRef: subscriptionRequest.transactionRef,
          durationDays: subscriptionRequest.durationDays,
          startsAt: startsAt!,
          expiresAt: expiresAt!,
        },
      );
    } catch (error) {
      console.error('Unable to send badge subscription approval email:', error);
      response.status(502).json({
        error: 'Badge activé, mais l’email de confirmation n’a pas pu être envoyé. Vérifiez la configuration SMTP.',
      });
      return;
    }
  } else {
    try {
      if (!isEmailDeliveryConfigured()) throw new Error('SMTP is not configured');
      await sendBadgeSubscriptionRejectionEmail(
        subscriptionRequest.user.email,
        [subscriptionRequest.user.agentProfile?.firstName, subscriptionRequest.user.agentProfile?.lastName].filter(Boolean).join(' ') || subscriptionRequest.user.email,
        {
          amount: subscriptionRequest.amount,
          transactionRef: subscriptionRequest.transactionRef,
          reason: parsed.data.reason!.trim(),
        },
      );
    } catch (error) {
      console.error('Unable to send badge subscription rejection email:', error);
      response.status(502).json({
        error: 'Demande refusée, mais l’email de notification n’a pas pu être envoyé. Vérifiez la configuration SMTP.',
      });
      return;
    }
  }
  response.json({ message: approved ? 'Badge activé.' : 'Demande refusée.' });
});
