import type { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { notifyUser } from '../notifications/notifications.service.js';
import { setNotificationServer } from '../notifications/notifications.gateway.js';

const messageSchema = z.object({
  conversationId: z.number().int().positive(),
  content: z.string().trim().min(1).max(2000),
});

type ChatSocketData = { userId: number; expiresAt: number };
type SendAck = (result: { data?: { id: number; conversationId: number; senderId: number; content: string; createdAt: Date }; error?: string }) => void;

export function attachChatGateway(server: HttpServer) {
  const io = new Server(server, { cors: { origin: env.clientOrigins } });
  setNotificationServer(io);

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (typeof token !== 'string') { next(new Error('Authentification requise.')); return; }
      const decoded = jwt.verify(token, env.jwtSecret);
      if (typeof decoded === 'string' || typeof decoded.id !== 'number') {
        next(new Error('Session invalide.'));
        return;
      }
      if (typeof decoded.exp !== 'number' || decoded.exp * 1000 <= Date.now()) {
        next(new Error('Session invalide ou expirée.'));
        return;
      }
      const user = await prisma.user.findFirst({
        where: { id: decoded.id, role: 'AGENT', status: 'ACTIF' },
        select: { id: true },
      });
      if (!user) { next(new Error('Messagerie réservée aux agents actifs.')); return; }
      Object.assign(socket.data, { userId: user.id, expiresAt: decoded.exp * 1000 } satisfies ChatSocketData);
      next();
    } catch {
      next(new Error('Session invalide ou expirée.'));
    }
  });

  io.on('connection', (socket) => {
    const userId = (socket.data as ChatSocketData).userId;
    socket.join(`agent:${userId}`);
    const expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(0, (socket.data as ChatSocketData).expiresAt - Date.now()));
    expiryTimer.unref();
    socket.once('disconnect', () => clearTimeout(expiryTimer));

    socket.on('message:send', async (payload: unknown, acknowledge?: SendAck) => {
      const result = messageSchema.safeParse(payload);
      if (!result.success) {
        acknowledge?.({ error: 'Le message est vide ou trop long.' });
        return;
      }

      try {
        const sender = await prisma.user.findFirst({
          where: { id: userId, role: 'AGENT', status: 'ACTIF' },
          select: { id: true, agentProfile: { select: { firstName: true, lastName: true } } },
        });
        if (!sender) {
          socket.disconnect(true);
          acknowledge?.({ error: 'Votre compte n’est plus actif.' });
          return;
        }
        const conversation = await prisma.conversation.findFirst({
          where: {
            id: result.data.conversationId,
            OR: [{ participantOneId: userId }, { participantTwoId: userId }],
          },
          select: { id: true, participantOneId: true, participantTwoId: true },
        });
        if (!conversation) {
          acknowledge?.({ error: 'Conversation introuvable.' });
          return;
        }
        const recipientId = conversation.participantOneId === userId
          ? conversation.participantTwoId
          : conversation.participantOneId;
        const recipient = await prisma.user.findFirst({
          where: { id: recipientId, role: 'AGENT', status: 'ACTIF' },
          select: { id: true },
        });
        if (!recipient) {
          acknowledge?.({ error: 'Cet agent n’est plus actif.' });
          return;
        }

        const message = await prisma.$transaction(async (transaction) => {
          const created = await transaction.directMessage.create({
            data: {
              conversationId: conversation.id,
              senderId: userId,
              content: result.data.content,
            },
          });
          await transaction.conversation.update({
            where: { id: conversation.id },
            data: { updatedAt: created.createdAt },
          });
          return created;
        });

        const data = {
          id: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          content: message.content,
          createdAt: message.createdAt,
        };
        const senderName = [sender.agentProfile?.firstName, sender.agentProfile?.lastName].filter(Boolean).join(' ') || `Agent #${userId}`;
        await notifyUser(recipientId, {
          type: 'PRIVATE_MESSAGE',
          title: `Nouveau message de ${senderName}`,
          body: result.data.content,
          pushBody: 'Vous avez reçu un nouveau message privé. Connectez-vous pour le consulter.',
          link: `/messages?conversationId=${conversation.id}`,
          actorId: userId,
        });
        acknowledge?.({ data });
        io.to(`agent:${recipientId}`).emit('message:new', data);
      } catch (error) {
        console.error('Unable to send private message:', error);
        acknowledge?.({ error: 'Impossible d’envoyer le message. Réessayez.' });
      }
    });
  });

  return io;
}
