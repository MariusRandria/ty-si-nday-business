import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../auth/auth.middleware.js';
import { notifyBadgeSubscribers } from '../notifications/notifications.service.js';

export const agentProspectRouter = Router();
export const adminProspectRouter = Router();

const prospectSchema = z.object({
  companyName: z.string().trim().min(2).max(200),
  responsibleName: z.string().trim().max(150).nullable().optional().transform((value) => value || null),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional().transform((value) => value || null),
  contact: z.string().trim().max(255).nullable().optional().transform((value) => value || null),
}).refine((value) => (value.latitude == null) === (value.longitude == null), {
  message: 'La latitude et la longitude doivent être renseignées ensemble.',
  path: ['latitude'],
});

const prospectSelect = {
  id: true,
  companyName: true,
  responsibleName: true,
  latitude: true,
  longitude: true,
  address: true,
  contact: true,
  createdAt: true,
};

agentProspectRouter.get('/', async (request: AuthRequest, response) => {
  if (request.user?.role !== 'AGENT' || request.user.status !== 'ACTIF') {
    response.status(403).json({ error: 'Cette liste est réservée aux agents actifs.' });
    return;
  }
  const activeBadge = await prisma.subscriptionRequest.findFirst({
    where: { userId: request.user.id, status: 'APPROVED', startsAt: { lte: new Date() }, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (!activeBadge) {
    response.status(403).json({ error: 'Un badge abonné actif est nécessaire pour accéder aux contacts prospects.' });
    return;
  }
  const prospects = await prisma.prospectContact.findMany({
    orderBy: { createdAt: 'desc' },
    select: prospectSelect,
  });
  response.json({ data: prospects });
});

adminProspectRouter.get('/', async (_request, response) => {
  const prospects = await prisma.prospectContact.findMany({
    orderBy: { createdAt: 'desc' },
    select: prospectSelect,
  });
  response.json({ data: prospects });
});

adminProspectRouter.post('/', async (request: AuthRequest, response) => {
  const result = prospectSchema.safeParse(request.body);
  if (!result.success) {
    response.status(400).json({
      error: 'Vérifiez les informations du prospect et ses coordonnées GPS.',
      details: result.error.flatten(),
    });
    return;
  }
  const prospect = await prisma.prospectContact.create({
    data: { ...result.data, createdBy: request.user!.id },
    select: prospectSelect,
  });
  await notifyBadgeSubscribers({
    type: 'NEW_PROSPECT',
    title: 'Nouveau contact de prospection',
    body: `${prospect.companyName} a été ajouté à vos prospects.`,
    pushBody: 'Un nouveau contact de prospection est disponible.',
    link: '/prospects',
  }, prospect.companyName);
  response.status(201).json({ data: prospect });
});

adminProspectRouter.patch('/:id', async (request: AuthRequest, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id < 1) {
    response.status(400).json({ error: 'Identifiant de prospect invalide.' });
    return;
  }
  const result = prospectSchema.safeParse(request.body);
  if (!result.success) {
    response.status(400).json({
      error: 'Vérifiez les informations du prospect et ses coordonnées GPS.',
      details: result.error.flatten(),
    });
    return;
  }
  const existing = await prisma.prospectContact.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    response.status(404).json({ error: 'Ce prospect est introuvable ou a déjà été supprimé.' });
    return;
  }
  const prospect = await prisma.prospectContact.update({
    where: { id },
    data: result.data,
    select: prospectSelect,
  });
  await notifyBadgeSubscribers({
    type: 'PROSPECT_UPDATED',
    title: 'Contact prospect mis à jour',
    body: `Les informations de ${prospect.companyName} ont été mises à jour.`,
    pushBody: 'Un contact de prospection a été mis à jour.',
    link: '/prospects',
  });
  response.json({ data: prospect });
});

adminProspectRouter.delete('/:id', async (request: AuthRequest, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id < 1) {
    response.status(400).json({ error: 'Identifiant de prospect invalide.' });
    return;
  }
  const existing = await prisma.prospectContact.findUnique({
    where: { id },
    select: { id: true, companyName: true },
  });
  if (!existing) {
    response.status(404).json({ error: 'Ce prospect est introuvable ou a déjà été supprimé.' });
    return;
  }
  await prisma.prospectContact.delete({ where: { id } });
  await notifyBadgeSubscribers({
    type: 'PROSPECT_REMOVED',
    title: 'Contact prospect retiré',
    body: `${existing.companyName} a été retiré de la liste des prospects.`,
    pushBody: 'Un contact de prospection a été retiré.',
    link: '/prospects',
  });
  response.json({ message: 'Prospect supprimé.' });
});
