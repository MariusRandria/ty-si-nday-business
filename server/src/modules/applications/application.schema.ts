import { z } from 'zod';

export const applicationSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  email: z.string().email(),
  phone: z.string().trim().min(7).max(30),
  city: z.string().trim().min(2).max(100),
  motivation: z.string().trim().min(10),
  password: z.string().min(8).max(128),
  consent: z.literal(true),
});
