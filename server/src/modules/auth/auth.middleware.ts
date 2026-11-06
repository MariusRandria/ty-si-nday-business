import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

export type AuthUser = { id: number; role: 'AGENT' | 'ADMIN' | 'SUPER_ADMIN'; status: string };
export type AuthRequest = Request & { user?: AuthUser };

export function requireAuth(request: AuthRequest, response: Response, next: NextFunction) {
  const token = request.headers.authorization?.startsWith('Bearer ')
    ? request.headers.authorization.slice(7)
    : undefined;
  if (!token) { response.status(401).json({ error: 'Authentification requise' }); return; }
  try {
    request.user = jwt.verify(token, env.jwtSecret) as AuthUser;
    next();
  } catch { response.status(401).json({ error: 'Session invalide ou expirée' }); }
}

export function requireAdmin(request: AuthRequest, response: Response, next: NextFunction) {
  if (!request.user || !['ADMIN', 'SUPER_ADMIN'].includes(request.user.role)) { response.status(403).json({ error: 'Accès administrateur requis' }); return; }
  next();
}
