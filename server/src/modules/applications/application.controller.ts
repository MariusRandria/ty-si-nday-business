import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { applicationSchema } from './application.schema.js';

export async function createApplication(request: Request, response: Response) {
  const result = applicationSchema.safeParse(request.body);
  if (!result.success) {
    response.status(400).json({ error: 'Données de candidature invalides', details: result.error.flatten() });
    return;
  }

  const { password, ...applicationData } = result.data;
  const candidatePasswordHash = await bcrypt.hash(password, 12);
  const application = await prisma.application.create({ data: { ...applicationData, candidatePasswordHash } });
  response.status(201).json({ data: { id: application.id, status: application.status, createdAt: application.createdAt } });
}
