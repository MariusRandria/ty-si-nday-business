import bcrypt from 'bcryptjs';
import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env.js';
import { isEmailDeliveryConfigured, sendAgentRegistrationCode } from '../../lib/email.js';
import { prisma } from '../../lib/prisma.js';
import {
  activateSchema,
  googleAuthSchema,
  loginSchema,
  registerSchema,
  registrationOtpResendSchema,
  registrationOtpVerificationSchema,
} from './auth.schema.js';
import type { AuthRequest } from './auth.middleware.js';
import { writeCollaborationAudit } from '../collaboration/collaboration.audit.js'

const googleOAuthClient = new OAuth2Client();
const REGISTRATION_OTP_TTL_MS = 10 * 60 * 1000;
const REGISTRATION_OTP_RESEND_MS = 60 * 1000;
const REGISTRATION_OTP_MAX_ATTEMPTS = 5;

type RegistrationOtpInput = {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  city: string;
  candidatePassword: string;
  registrationSource: 'EMAIL' | 'GOOGLE';
};

type PendingOtpData = Omit<RegistrationOtpInput, 'candidatePassword'> & { candidatePasswordHash: string | null };

async function sendRegistrationOtp(
  registration: PendingOtpData,
  response: Response,
  existing?: { id: number; expiresAt: Date; resendAvailableAt: Date },
  isResend = false,
) {
  if (!isEmailDeliveryConfigured()) {
    response.status(503).json({ error: 'L’envoi des codes email n’est pas configuré. Contactez l’administrateur de la plateforme.' });
    return;
  }

  const now = new Date();
  if (existing && existing.expiresAt > now && existing.resendAvailableAt > now) {
    const retryAfterSeconds = Math.ceil((existing.resendAvailableAt.getTime() - now.getTime()) / 1000);
    if (isResend) {
      response.status(429).json({ error: `Vous pourrez demander un nouveau code dans ${retryAfterSeconds} secondes.` });
    } else {
      response.json({
        kind: 'OTP_PENDING',
        email: registration.email,
        message: 'Un code a déjà été envoyé. Consultez votre boite email ou demandez un nouvel envoi après le délai indiqué.',
      });
    }
    return;
  }

  const code = String(randomInt(100_000, 1_000_000));
  const codeHash = await bcrypt.hash(code, 12);
  const registrationData = {
    email: registration.email,
    firstName: registration.firstName,
    lastName: registration.lastName,
    phone: registration.phone,
    city: registration.city,
    registrationSource: registration.registrationSource,
    candidatePasswordHash: registration.candidatePasswordHash,
  };
  const pending = await prisma.pendingAgentRegistration.upsert({
    where: { email: registration.email },
    create: {
      ...registrationData,
      codeHash,
      attempts: 0,
      expiresAt: new Date(now.getTime() + REGISTRATION_OTP_TTL_MS),
      resendAvailableAt: new Date(now.getTime() + REGISTRATION_OTP_RESEND_MS),
    },
    update: {
      ...registrationData,
      codeHash,
      attempts: 0,
      expiresAt: new Date(now.getTime() + REGISTRATION_OTP_TTL_MS),
      resendAvailableAt: new Date(now.getTime() + REGISTRATION_OTP_RESEND_MS),
      consumedAt: null,
    },
  });

  try {
    await sendAgentRegistrationCode(pending.email, pending.firstName, code);
  } catch (error) {
    console.error('Unable to send an agent registration verification email:', error);
    await prisma.pendingAgentRegistration.deleteMany({ where: { id: pending.id, codeHash } });
    response.status(502).json({ error: 'Le code n’a pas pu être envoyé. Vérifiez la configuration email du serveur et réessayez.' });
    return;
  }

  response.json({
    kind: 'OTP_PENDING',
    email: pending.email,
    message: `Un code de vérification a été envoyé à ${pending.email}. Il expire dans 10 minutes.`,
  });
}

async function beginAgentRegistration(input: RegistrationOtpInput, response: Response) {
  const [existingUser, existingApplication, existingProfile, otherPendingPhone, pending] = await Promise.all([
    prisma.user.findUnique({ where: { email: input.email }, select: { id: true } }),
    prisma.application.findFirst({
      where: { OR: [{ email: input.email }, { phone: input.phone }], status: { in: ['RECUE', 'EN_EXAMEN'] } },
      select: { id: true },
    }),
    prisma.agentProfile.findUnique({ where: { phone: input.phone }, select: { id: true } }),
    prisma.pendingAgentRegistration.findFirst({ where: { phone: input.phone, email: { not: input.email } }, select: { id: true } }),
    prisma.pendingAgentRegistration.findUnique({ where: { email: input.email }, select: { id: true, expiresAt: true, resendAvailableAt: true } }),
  ]);
  if (existingUser || existingApplication || existingProfile || otherPendingPhone) {
    response.status(409).json({ error: 'Un compte ou une candidature existe déjà avec cet email ou ce téléphone.' });
    return;
  }

  if (!isEmailDeliveryConfigured()) {
    response.status(503).json({ error: 'L’envoi des codes email n’est pas configuré. Contactez l’administrateur de la plateforme.' });
    return;
  }
  const { candidatePassword, ...registration } = input;
  if (pending && pending.expiresAt > new Date() && pending.resendAvailableAt > new Date()) {
    await sendRegistrationOtp({
      ...registration,
      candidatePasswordHash: null,
    }, response, pending);
    return;
  }

  await prisma.pendingAgentRegistration.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  const candidatePasswordHash = await bcrypt.hash(candidatePassword, 12);
  await sendRegistrationOtp({ ...registration, candidatePasswordHash }, response, pending ?? undefined);
}

export async function resendRegistrationOtp(request: Request, response: Response) {
  const result = registrationOtpResendSchema.safeParse(request.body);
  if (!result.success) {
    response.status(400).json({ error: 'Adresse email invalide.' });
    return;
  }
  if (!isEmailDeliveryConfigured()) {
    response.status(503).json({ error: 'L’envoi des codes email n’est pas configuré. Contactez l’administrateur de la plateforme.' });
    return;
  }

  const pending = await prisma.pendingAgentRegistration.findUnique({ where: { email: result.data.email } });
  if (!pending || pending.consumedAt) {
    response.json({ message: 'Si une inscription est en attente pour cette adresse, un code pourra être envoyé.' });
    return;
  }
  await sendRegistrationOtp({
    email: pending.email,
    firstName: pending.firstName,
    lastName: pending.lastName,
    phone: pending.phone,
    city: pending.city,
    registrationSource: pending.registrationSource === 'GOOGLE' ? 'GOOGLE' : 'EMAIL',
    candidatePasswordHash: pending.candidatePasswordHash,
  }, response, pending, true);
}

export async function verifyRegistrationOtp(request: Request, response: Response) {
  const result = registrationOtpVerificationSchema.safeParse(request.body);
  if (!result.success) {
    response.status(400).json({ error: 'Saisissez l’adresse email et le code à 6 chiffres.' });
    return;
  }

  const { email, code } = result.data;
  const pending = await prisma.pendingAgentRegistration.findUnique({ where: { email } });
  if (!pending || pending.consumedAt || pending.expiresAt <= new Date()) {
    if (pending?.expiresAt && pending.expiresAt <= new Date()) {
      await prisma.pendingAgentRegistration.deleteMany({ where: { id: pending.id } });
    }
    response.status(400).json({ error: 'Ce code est invalide ou expiré. Demandez un nouveau code.' });
    return;
  }
  if (pending.attempts >= REGISTRATION_OTP_MAX_ATTEMPTS) {
    response.status(429).json({ error: 'Trop de tentatives. Demandez un nouveau code après le délai de renvoi.' });
    return;
  }

  if (!(await bcrypt.compare(code, pending.codeHash))) {
    await prisma.pendingAgentRegistration.updateMany({
      where: { id: pending.id, consumedAt: null, attempts: { lt: REGISTRATION_OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    response.status(pending.attempts + 1 >= REGISTRATION_OTP_MAX_ATTEMPTS ? 429 : 400).json({
      error: pending.attempts + 1 >= REGISTRATION_OTP_MAX_ATTEMPTS
        ? 'Trop de tentatives. Demandez un nouveau code après le délai de renvoi.'
        : 'Le code saisi est incorrect.',
    });
    return;
  }

  try {
    const application = await prisma.$transaction(async (transaction) => {
      const [existingUser, existingApplication, existingProfile] = await Promise.all([
        transaction.user.findUnique({ where: { email }, select: { id: true } }),
        transaction.application.findFirst({
          where: { OR: [{ email }, { phone: pending.phone }], status: { in: ['RECUE', 'EN_EXAMEN'] } },
          select: { id: true },
        }),
        transaction.agentProfile.findUnique({ where: { phone: pending.phone }, select: { id: true } }),
      ]);
      if (existingUser || existingApplication || existingProfile) return null;

      const claimed = await transaction.pendingAgentRegistration.updateMany({
        where: {
          id: pending.id,
          codeHash: pending.codeHash,
          consumedAt: null,
          expiresAt: { gt: new Date() },
          attempts: { lt: REGISTRATION_OTP_MAX_ATTEMPTS },
        },
        data: { consumedAt: new Date() },
      });
      if (claimed.count !== 1) return null;

      const createdApplication = await transaction.application.create({
        data: {
          fullName: `${pending.firstName} ${pending.lastName}`,
          email: pending.email,
          phone: pending.phone,
          city: pending.city,
          motivation: pending.registrationSource === 'GOOGLE'
            ? 'Candidature envoyée avec Google depuis l’espace agent.'
            : 'Inscription envoyée depuis l’espace agent.',
          consent: true,
          candidatePasswordHash: pending.candidatePasswordHash,
        },
      });
      await transaction.pendingAgentRegistration.delete({ where: { id: pending.id } });
      return createdApplication;
    });

    if (!application) {
      response.status(409).json({ error: 'Un compte ou une candidature existe déjà avec cet email ou ce téléphone, ou le code a déjà été utilisé.' });
      return;
    }
    response.status(201).json({
      message: 'Adresse email confirmée. Votre candidature sera examinée par notre équipe.',
      applicationId: application.id,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      response.status(409).json({ error: 'Un compte ou une candidature existe déjà avec cet email ou ce téléphone.' });
      return;
    }
    throw error;
  }
}

function publicUser(user: { id: number; email: string; role: string; status: string; agentProfile?: { firstName: string; lastName: string; phone: string; city: string; imageUrl: string | null } | null }) {
  return { id: user.id, email: user.email, role: user.role, status: user.status, profile: user.agentProfile ?? null };
}
function signUser(user: { id: number; role: 'AGENT' | 'ADMIN' | 'SUPER_ADMIN'; status: string }) {
  return jwt.sign({ id: user.id, role: user.role, status: user.status }, env.jwtSecret, { expiresIn: '3h' });
}
async function recordAuthentication(
  request: Request,
  input: { actorId: number | null; actorRole: string; success: boolean; reason?: string },
) {
  await prisma.$transaction((transaction) => writeCollaborationAudit(transaction, {
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: input.success ? 'AUTH_LOGIN_SUCCEEDED' : 'AUTH_LOGIN_FAILED',
    entityType: 'User',
    entityId: input.actorId,
    metadata: { method: 'GOOGLE', ...(input.reason ? { reason: input.reason } : {}) },
    ip: request.ip ?? null,
    userAgent: request.get('user-agent') ?? null,
  }))
}
function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function getImageExtension(buffer: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export async function uploadProfilePhoto(request: AuthRequest, response: Response) {
  if (!request.user || request.user.role !== 'AGENT') {
    response.status(403).json({ error: 'Cette action est réservée aux agents.' });
    return;
  }
  const file = request.file;
  if (!file) {
    response.status(400).json({ error: 'Sélectionnez une photo à envoyer.' });
    return;
  }
  const extension = getImageExtension(file.buffer);
  if (!extension) {
    response.status(400).json({ error: 'Le fichier doit être une image JPEG, PNG ou WebP valide.' });
    return;
  }

  const userId = request.user.id;
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { agentProfile: true } });
  if (!user?.agentProfile) {
    response.status(404).json({ error: 'Profil agent introuvable.' });
    return;
  }
  const filename = `${userId}-${randomUUID()}.${extension}`;
  const uploadDirectory = fileURLToPath(new URL('../../../uploads/profile-photos/', import.meta.url));
  const filePath = join(uploadDirectory, filename);
  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(filePath, file.buffer, { flag: 'wx' });
  let profile;
  try {
    profile = await prisma.agentProfile.update({
      where: { userId },
      data: { imageUrl: `/api/uploads/profile-photos/${filename}` },
    });
  } catch (error) {
    await unlink(filePath).catch((cleanupError: unknown) => {
      console.error('Unable to remove an unreferenced profile photo:', cleanupError);
    });
    throw error;
  }

  const previousImageUrl = user.agentProfile.imageUrl;
  if (previousImageUrl?.startsWith(`/api/uploads/profile-photos/${userId}-`)) {
    const previousFilename = basename(previousImageUrl);
    if (previousFilename !== filename && /^\d+-[0-9a-f-]+\.(?:jpg|png|webp)$/.test(previousFilename)) {
      await unlink(join(uploadDirectory, previousFilename)).catch((error: unknown) => {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code !== 'ENOENT') {
          console.error('Unable to remove the replaced profile photo:', error);
        }
      });
    }
  }
  response.json({ user: publicUser({ ...user, agentProfile: profile }) });
}

export async function login(request: Request, response: Response) {
  const result = loginSchema.safeParse(request.body);
  if (!result.success) { response.status(400).json({ error: 'Identifiants invalides' }); return; }
  const user = await prisma.user.findUnique({ where: { email: result.data.email }, include: { agentProfile: true } });
  const validPassword = user !== null && await bcrypt.compare(result.data.password, user.passwordHash);
  if (!user || user.status !== 'ACTIF' || !validPassword) {
    try {
      await prisma.$transaction((transaction) => writeCollaborationAudit(transaction, {
        actorId: user?.id ?? null,
        actorRole: user?.role ?? 'ANONYMOUS',
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'User',
        entityId: user?.id ?? null,
        metadata: { method: 'PASSWORD', reason: !user ? 'UNKNOWN_ACCOUNT' : user.status !== 'ACTIF' ? 'INACTIVE_ACCOUNT' : 'INVALID_CREDENTIALS' },
        ip: request.ip ?? null,
        userAgent: request.get('user-agent') ?? null,
      }))
    } catch (error) {
      console.error('Unable to audit failed password login:', error)
    }
    response.status(401).json({ error: 'Email ou mot de passe incorrect' });
    return;
  }
  await prisma.$transaction(async (transaction) => {
    await transaction.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await writeCollaborationAudit(transaction, {
      actorId: user.id,
      actorRole: user.role,
      action: 'AUTH_LOGIN_SUCCEEDED',
      entityType: 'User',
      entityId: user.id,
      metadata: { method: 'PASSWORD' },
      ip: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
    })
  })
  response.json({ token: signUser(user), user: publicUser(user) });
}

export async function googleAuth(request: Request, response: Response) {
  if (!env.googleClientId) {
    response.status(503).json({ error: 'La connexion Google n’est pas encore configurée.' });
    return;
  }
  const result = googleAuthSchema.safeParse(request.body);
  if (!result.success) {
    response.status(400).json({ error: 'Données de connexion Google invalides.' });
    return;
  }

  let googlePayload;
  try {
    const ticket = await googleOAuthClient.verifyIdToken({
      idToken: result.data.credential,
      audience: env.googleClientId,
    });
    googlePayload = ticket.getPayload();
  } catch (error) {
    console.warn('Google ID token verification failed:', error);
    await recordAuthentication(request, { actorId: null, actorRole: 'ANONYMOUS', success: false, reason: 'INVALID_GOOGLE_TOKEN' })
      .catch((auditError: unknown) => console.error('Unable to audit failed Google login:', auditError))
    response.status(401).json({ error: 'Le jeton Google est invalide ou expiré. Réessayez.' });
    return;
  }

  if (!googlePayload?.email || googlePayload.email_verified !== true || !googlePayload.sub) {
    await recordAuthentication(request, { actorId: null, actorRole: 'ANONYMOUS', success: false, reason: 'UNVERIFIED_GOOGLE_EMAIL' })
      .catch((auditError: unknown) => console.error('Unable to audit unverified Google login:', auditError))
    response.status(401).json({ error: 'Google doit confirmer votre adresse email avant de continuer.' });
    return;
  }

  const email = googlePayload.email.trim().toLowerCase();
  const existingUser = await prisma.user.findUnique({ where: { email }, include: { agentProfile: true } });
  if (existingUser) {
    if (existingUser.role !== 'AGENT') {
      await recordAuthentication(request, { actorId: existingUser.id, actorRole: existingUser.role, success: false, reason: 'ROLE_NOT_ALLOWED' })
        .catch((auditError: unknown) => console.error('Unable to audit rejected Google login:', auditError))
      response.status(403).json({ error: 'La connexion Google est réservée aux comptes agent.' });
      return;
    }
    if (existingUser.status !== 'ACTIF') {
      await recordAuthentication(request, { actorId: existingUser.id, actorRole: existingUser.role, success: false, reason: 'INACTIVE_ACCOUNT' })
        .catch((auditError: unknown) => console.error('Unable to audit inactive Google login:', auditError))
      response.status(403).json({
        error: existingUser.status === 'SUSPENDU'
          ? 'Ce compte agent est suspendu. Contactez l’administration.'
          : 'Votre compte agent n’est pas encore actif. Attendez la validation de votre candidature.',
      });
      return;
    }
    await prisma.$transaction(async (transaction) => {
      await transaction.user.update({ where: { id: existingUser.id }, data: { lastLoginAt: new Date() } })
      await writeCollaborationAudit(transaction, {
        actorId: existingUser.id,
        actorRole: existingUser.role,
        action: 'AUTH_LOGIN_SUCCEEDED',
        entityType: 'User',
        entityId: existingUser.id,
        metadata: { method: 'GOOGLE' },
        ip: request.ip ?? null,
        userAgent: request.get('user-agent') ?? null,
      })
    })
    response.json({ kind: 'LOGIN', token: signUser(existingUser), user: publicUser(existingUser) });
    return;
  }

  const pendingApplication = await prisma.application.findFirst({
    where: { email, status: { in: ['RECUE', 'EN_EXAMEN'] } },
    select: { id: true },
  });
  if (pendingApplication) {
    response.status(409).json({ error: 'Votre candidature est déjà en attente de validation par l’administration.' });
    return;
  }

  const { firstName, lastName, phone, city, consent } = result.data;
  if (!firstName && !lastName && !phone && !city && consent === undefined) {
    response.status(404).json({ error: 'Aucun compte agent actif ne correspond à cette adresse. Choisissez « Inscription agent » pour déposer une candidature avec Google.' });
    return;
  }
  if (!firstName || !lastName || !phone || !city || consent !== true) {
    response.status(400).json({ error: 'Pour créer une candidature, renseignez prénom, nom, téléphone, ville et acceptez les conditions.' });
    return;
  }

  await beginAgentRegistration({
    email,
    firstName,
    lastName,
    phone,
    city,
    candidatePassword: randomUUID(),
    registrationSource: 'GOOGLE',
  }, response);
}

export async function activate(request: Request, response: Response) {
  const result = activateSchema.safeParse(request.body);
  if (!result.success) { response.status(400).json({ error: 'Informations d’activation invalides' }); return; }
  const user = await prisma.user.findUnique({
    where: { email: result.data.email },
    include: {
      agentProfile: true,
      activationTokens: { where: { type: 'ACTIVATION', usedAt: null, expiresAt: { gt: new Date() } } },
    },
  });
  if (!user || user.status !== 'EN_ATTENTE_ACTIVATION') { response.status(400).json({ error: 'Lien d’activation invalide ou expiré' }); return; }
  const activationToken = await Promise.all(user.activationTokens.map(async (item) => ({ item, matches: await bcrypt.compare(result.data.token, item.tokenHash) }))).then((matches) => matches.find(({ matches: isMatch }) => isMatch)?.item);
  if (!activationToken) { response.status(400).json({ error: 'Lien d’activation invalide ou expiré' }); return; }
  const passwordHash = await bcrypt.hash(result.data.password, 12);
  const activatedUser = await prisma.$transaction(async (transaction) => {
    await transaction.activationToken.update({ where: { id: activationToken.id }, data: { usedAt: new Date() } });
    return transaction.user.update({ where: { id: user.id }, data: { passwordHash, status: 'ACTIF' }, include: { agentProfile: true } });
  });
  response.json({ token: signUser(activatedUser), user: publicUser(activatedUser) });
}

export async function register(request: Request, response: Response) {
  const result = registerSchema.safeParse(request.body);
  if (!result.success) { response.status(400).json({ error: 'Données d’inscription invalides', details: result.error.flatten() }); return; }
  const { firstName, lastName, email, phone, city, password } = result.data;
  await beginAgentRegistration({
    email,
    firstName,
    lastName,
    phone,
    city,
    candidatePassword: password,
    registrationSource: 'EMAIL',
  }, response);
}

export async function me(request: Request, response: Response) {
  const id = Number(request.headers['x-user-id']);
  const user = await prisma.user.findUnique({ where: { id }, include: { agentProfile: true } });
  if (!user) { response.status(404).json({ error: 'Utilisateur introuvable' }); return; }
  response.json({ user: publicUser(user) });
}
