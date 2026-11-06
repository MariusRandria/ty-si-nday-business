import { z } from 'zod';

export const reportNatureSchema = z.enum(['CONTACT', 'RENDEZ_VOUS', 'CONTRAT']);
export const reportTypeSchema = z.enum(['LEAD', 'PROVIDED_CONTACT', 'FULL_CYCLE']);

export const reportSchema = z.object({
  productId: z.number().int().positive().nullable(),
  customServiceDescription: z.string().trim().min(5).max(2000).optional(),
  companyName: z.string().trim().min(2).max(255),
  city: z.string().trim().min(2).max(100),
  address: z.string().trim().min(2).max(255),
  contactName: z.string().trim().min(2).max(150),
  contactRole: z.string().trim().min(2).max(100),
  contactPhone: z.string().trim().min(7).max(30),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactType: z.enum(['PRESENTIEL', 'APPEL', 'VISIO']),
  reportNature: reportNatureSchema.default('CONTACT'),
  reportType: reportTypeSchema,
  meetingAt: z.coerce.date(),
  summary: z.string().trim().min(10),
  interestLevel: z.enum(['FAIBLE', 'MOYEN', 'FORT']),
  nextStep: z.string().trim().max(2000).optional(),
}).superRefine((data, context) => {
  if (data.productId === null && !data.customServiceDescription) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['customServiceDescription'], message: 'La description de la prestation sur mesure est obligatoire.' });
  }
  if (data.productId !== null && data.customServiceDescription) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['customServiceDescription'], message: 'La description sur mesure ne concerne que cette option.' });
  }
});

export type ReportNature = 'CONTACT' | 'RENDEZ_VOUS' | 'CONTRAT';
export type ReportStatus = 'BROUILLON' | 'SOUMIS' | 'EN_VERIFICATION' | 'VALIDE' | 'REJETE' | 'A_COMPLETER' | 'PAYE';
export type ReportType = 'LEAD' | 'PROVIDED_CONTACT' | 'FULL_CYCLE';
