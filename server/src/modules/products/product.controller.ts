import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../auth/auth.middleware.js';
import { notifyUser } from '../notifications/notifications.service.js';

const productSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().min(10),
  targetAudience: z.string().trim().min(2),
  salesPitch: z.string().trim().min(5),
  status: z.enum(['BROUILLON', 'PUBLIE']).default('BROUILLON'),
});

export async function listProducts(_request: Request, response: Response) {
  const products = await prisma.product.findMany({
    where: { status: 'PUBLIE' },
    orderBy: { createdAt: 'desc' },
    include: { files: true },
  });
  response.json({ data: products });
}

export async function listAdminProducts(_request: Request, response: Response) {
  const products = await prisma.product.findMany({ orderBy: { updatedAt: 'desc' } });
  response.json({ data: products });
}

export async function createProduct(request: AuthRequest, response: Response) {
  const result = productSchema.safeParse(request.body);
  if (!result.success) { response.status(400).json({ error: 'Informations du produit invalides', details: result.error.flatten() }); return; }
  const slugBase = result.data.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 200) || 'produit';
  let slug = slugBase;
  let suffix = 2;
  while (await prisma.product.findUnique({ where: { slug }, select: { id: true } })) slug = `${slugBase}-${suffix++}`;
  const product = await prisma.product.create({
    data: { ...result.data, slug, createdBy: request.user!.id, publishedAt: result.data.status === 'PUBLIE' ? new Date() : null },
  });
  if (product.status === 'PUBLIE') await notifyAgents(product.id, product.title, product.createdBy);
  response.status(201).json({ data: product });
}

export async function updateProductStatus(request: AuthRequest, response: Response) {
  const id = Number(request.params.id);
  const status = z.enum(['BROUILLON', 'PUBLIE', 'ARCHIVE']).safeParse(request.body.status);
  if (!Number.isInteger(id) || id < 1 || !status.success) { response.status(400).json({ error: 'Identifiant ou statut invalide' }); return; }
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) { response.status(404).json({ error: 'Produit introuvable' }); return; }
  const product = await prisma.product.update({ where: { id }, data: { status: status.data, publishedAt: status.data === 'PUBLIE' ? existing.publishedAt ?? new Date() : null } });
  if (status.data === 'PUBLIE' && existing.status !== 'PUBLIE') await notifyAgents(product.id, product.title, product.createdBy);
  response.json({ data: product });
}

async function notifyAgents(productId: number, title: string, actorId: number) {
  try {
    const agents = await prisma.user.findMany({ where: { role: 'AGENT', status: 'ACTIF' }, select: { id: true } });
    if (!agents.length) return;
    await Promise.all(agents.map(({ id }) => notifyUser(id, { type: 'PRODUCT_PUBLISHED', title: 'Nouveau produit publié', body: `${title} est disponible dans le catalogue.`, link: `/products/${productId}`, actorId })));
  } catch (error) { console.error('Failed to notify agents about product:', error); }
}
