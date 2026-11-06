import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';

if (!env.adminPassword) {
  throw new Error('Set a unique ADMIN_PASSWORD in server/.env before running the seed script.');
}

const passwordHash = await bcrypt.hash(env.adminPassword, 12);
await prisma.user.upsert({
  where: { email: env.adminEmail.toLowerCase() },
  update: { passwordHash, role: 'SUPER_ADMIN', status: 'ACTIF' },
  create: { email: env.adminEmail.toLowerCase(), passwordHash, role: 'SUPER_ADMIN', status: 'ACTIF' },
});
console.log(`Compte administrateur prêt: ${env.adminEmail}`);
await prisma.$disconnect();
