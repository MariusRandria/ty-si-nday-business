import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
}).refine((value) => value.currentPassword !== value.newPassword, {
  path: ['newPassword'],
  message: 'Le nouveau mot de passe doit être différent du mot de passe actuel.',
})

export const activateSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  token: z.string().min(32).max(128),
  password: z.string().min(8).max(128),
});

export const registerSchema = z.object({
  firstName: z.string().trim().min(2).max(100),
  lastName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  phone: z.string().trim().min(7).max(30),
  city: z.string().trim().min(2).max(100),
  password: z.string().min(8).max(128),
  consent: z.literal(true),
});

export const registrationOtpVerificationSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  code: z.string().regex(/^\d{6}$/),
});

export const registrationOtpResendSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
});

export const googleAuthSchema = z.object({
  credential: z.string().min(20).max(8192),
  firstName: z.string().trim().min(2).max(100).optional(),
  lastName: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().min(7).max(30).optional(),
  city: z.string().trim().min(2).max(100).optional(),
  consent: z.boolean().optional(),
});
