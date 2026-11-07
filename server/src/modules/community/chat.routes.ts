import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../auth/auth.middleware.js';
import { emitChatMessageDeleted, emitChatMessageHidden, emitConversationArchiveChanged, emitConversationDeleted } from './chat.gateway.js';

export const chatRouter = Router();

function requireActiveAgent(request: AuthRequest, response: Response) {
  if (request.user?.role !== 'AGENT' || request.user.status !== 'ACTIF') {
    response.status(403).json({ error: 'La messagerie est réservée aux agents actifs.' });
    return false;
  }
  return true;
}

function participantIds(firstId: number, secondId: number) {
  return firstId < secondId
    ? { participantOneId: firstId, participantTwoId: secondId }
    : { participantOneId: secondId, participantTwoId: firstId };
}

function agentSelect(now: Date) {
  return {
    id: true,
    agentProfile: { select: { firstName: true, lastName: true, city: true, imageUrl: true } },
    subscriptionRequests: {
      where: { status: 'APPROVED', startsAt: { lte: now }, expiresAt: { gt: now } },
      select: { id: true },
      take: 1,
    },
  };
}

function withSubscriberBadge<T extends { subscriptionRequests: unknown[] }>(agent: T) {
  const { subscriptionRequests, ...publicAgent } = agent;
  return { ...publicAgent, isSubscriber: subscriptionRequests.length > 0 };
}

chatRouter.get('/agents', async (request: AuthRequest, response) => {
  if (!requireActiveAgent(request, response)) return;
  const now = new Date();
  const agents = await prisma.user.findMany({
    where: { id: { not: request.user!.id }, role: 'AGENT', status: 'ACTIF' },
    orderBy: { agentProfile: { firstName: 'asc' } },
    select: agentSelect(now),
  });
  response.json({ data: agents.map(withSubscriberBadge) });
});

chatRouter.get('/conversations', async (request: AuthRequest, response) => {
  if (!requireActiveAgent(request, response)) return;
  const userId = request.user!.id;
  const selectedAgent = agentSelect(new Date());
  const conversations = await prisma.conversation.findMany({
    where: {
      OR: [
        { participantOneId: userId, participantOneDeletedAt: null },
        { participantTwoId: userId, participantTwoDeletedAt: null },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      participantOne: { select: selectedAgent },
      participantTwo: { select: selectedAgent },
      messages: {
        where: { hiddenFor: { none: { userId } } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      _count: { select: { messages: { where: { senderId: { not: userId }, readAt: null, hiddenFor: { none: { userId } } } } } },
    },
  });
  response.json({
    data: conversations.map((conversation) => ({
      id: conversation.id,
      agent: withSubscriberBadge(conversation.participantOneId === userId ? conversation.participantTwo : conversation.participantOne),
      lastMessage: conversation.messages[0] ?? null,
      unreadCount: conversation._count.messages,
      updatedAt: conversation.updatedAt,
      archivedAt: (conversation.participantOneId === userId
        ? conversation.participantOneArchivedAt
        : conversation.participantTwoArchivedAt)?.toISOString() ?? null,
    })),
  });
});

chatRouter.post('/conversations', async (request: AuthRequest, response) => {
  if (!requireActiveAgent(request, response)) return;
  const result = z.object({ agentId: z.number().int().positive() }).safeParse(request.body);
  if (!result.success || result.data.agentId === request.user!.id) {
    response.status(400).json({ error: 'Agent destinataire invalide.' });
    return;
  }
  const recipient = await prisma.user.findFirst({
    where: { id: result.data.agentId, role: 'AGENT', status: 'ACTIF' },
    select: { id: true },
  });
  if (!recipient) { response.status(404).json({ error: 'Cet agent est introuvable ou inactif.' }); return; }

  const ids = participantIds(request.user!.id, recipient.id);
  const conversation = await prisma.conversation.upsert({
    where: { participantOneId_participantTwoId: ids },
    update: request.user!.id === ids.participantOneId
      ? { participantOneArchivedAt: null, participantOneDeletedAt: null }
      : { participantTwoArchivedAt: null, participantTwoDeletedAt: null },
    create: ids,
  });
  response.status(200).json({ data: { id: conversation.id } });
});

chatRouter.get('/conversations/:id/messages', async (request: AuthRequest, response) => {
  if (!requireActiveAgent(request, response)) return;
  const conversationId = Number(request.params.id);
  if (!Number.isInteger(conversationId) || conversationId < 1) {
    response.status(400).json({ error: 'Identifiant de conversation invalide.' });
    return;
  }
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      OR: [
        { participantOneId: request.user!.id, participantOneDeletedAt: null },
        { participantTwoId: request.user!.id, participantTwoDeletedAt: null },
      ],
    },
    select: { id: true },
  });
  if (!conversation) { response.status(404).json({ error: 'Conversation introuvable.' }); return; }

  await prisma.directMessage.updateMany({
    where: { conversationId, senderId: { not: request.user!.id }, readAt: null },
    data: { readAt: new Date() },
  });
  const messages = await prisma.directMessage.findMany({
    where: { conversationId, hiddenFor: { none: { userId: request.user!.id } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  response.json({ data: messages.reverse() });
});

chatRouter.delete('/conversations/:id/messages/:messageId/me', async (request: AuthRequest, response) => {
  if (!requireActiveAgent(request, response)) return;
  const conversationId = Number(request.params.id);
  const messageId = Number(request.params.messageId);
  if (!Number.isInteger(conversationId) || conversationId < 1 || !Number.isInteger(messageId) || messageId < 1) {
    response.status(400).json({ error: 'Identifiant de message invalide.' });
    return;
  }
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      OR: [
        { participantOneId: request.user!.id, participantOneDeletedAt: null },
        { participantTwoId: request.user!.id, participantTwoDeletedAt: null },
      ],
    },
    select: { updatedAt: true },
  });
  if (!conversation) { response.status(404).json({ error: 'Conversation introuvable.' }); return; }
  const message = await prisma.directMessage.findFirst({
    where: { id: messageId, conversationId },
    select: { id: true, senderId: true, readAt: true },
  });
  if (!message) { response.status(404).json({ error: 'Message introuvable.' }); return; }

  await prisma.directMessageHidden.upsert({
    where: { messageId_userId: { messageId, userId: request.user!.id } },
    update: {},
    create: { messageId, userId: request.user!.id },
  });
  const [lastMessage, unreadCount] = await Promise.all([
    prisma.directMessage.findFirst({
      where: { conversationId, hiddenFor: { none: { userId: request.user!.id } } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, conversationId: true, senderId: true, content: true, readAt: true, createdAt: true },
    }),
    prisma.directMessage.count({
      where: {
        conversationId,
        senderId: { not: request.user!.id },
        readAt: null,
        hiddenFor: { none: { userId: request.user!.id } },
      },
    }),
  ]);
  emitChatMessageHidden(request.user!.id, conversationId, messageId, lastMessage, unreadCount);
  response.json({ data: { deleted: true, messageId, lastMessage, updatedAt: conversation.updatedAt, unreadCount } });
});

chatRouter.patch('/conversations/:id/read', async (request: AuthRequest, response) => {
  if (!requireActiveAgent(request, response)) return;
  const conversationId = Number(request.params.id);
  if (!Number.isInteger(conversationId) || conversationId < 1) {
    response.status(400).json({ error: 'Identifiant de conversation invalide.' });
    return;
  }
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      OR: [
        { participantOneId: request.user!.id, participantOneDeletedAt: null },
        { participantTwoId: request.user!.id, participantTwoDeletedAt: null },
      ],
    },
    select: { id: true },
  });
  if (!conversation) { response.status(404).json({ error: 'Conversation introuvable.' }); return; }
  await prisma.directMessage.updateMany({
    where: { conversationId, senderId: { not: request.user!.id }, readAt: null },
    data: { readAt: new Date() },
  });
  response.json({ data: { read: true } });
});

chatRouter.patch('/conversations/:id/archive', async (request: AuthRequest, response) => {
  if (!requireActiveAgent(request, response)) return;
  const conversationId = Number(request.params.id);
  const result = z.object({ archived: z.boolean() }).safeParse(request.body);
  if (!Number.isInteger(conversationId) || conversationId < 1 || !result.success) {
    response.status(400).json({ error: 'Requête d’archivage invalide.' });
    return;
  }
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      OR: [
        { participantOneId: request.user!.id, participantOneDeletedAt: null },
        { participantTwoId: request.user!.id, participantTwoDeletedAt: null },
      ],
    },
    select: { participantOneId: true, participantTwoId: true },
  });
  if (!conversation) { response.status(404).json({ error: 'Conversation introuvable.' }); return; }

  const archivedAt = result.data.archived ? new Date() : null;
  const isParticipantOne = conversation.participantOneId === request.user!.id;
  await prisma.conversation.update({
    where: { id: conversationId },
    data: isParticipantOne
      ? { participantOneArchivedAt: archivedAt }
      : { participantTwoArchivedAt: archivedAt },
  });
  emitConversationArchiveChanged(request.user!.id, conversationId, archivedAt);
  response.json({ data: { archivedAt: archivedAt?.toISOString() ?? null } });
});

chatRouter.delete('/conversations/:id/messages/:messageId', async (request: AuthRequest, response) => {
  if (!requireActiveAgent(request, response)) return;
  const conversationId = Number(request.params.id);
  const messageId = Number(request.params.messageId);
  if (!Number.isInteger(conversationId) || conversationId < 1 || !Number.isInteger(messageId) || messageId < 1) {
    response.status(400).json({ error: 'Identifiant de message invalide.' });
    return;
  }
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      OR: [
        { participantOneId: request.user!.id, participantOneDeletedAt: null },
        { participantTwoId: request.user!.id, participantTwoDeletedAt: null },
      ],
    },
    select: { participantOneId: true, participantTwoId: true, updatedAt: true },
  });
  if (!conversation) { response.status(404).json({ error: 'Conversation introuvable.' }); return; }
  const message = await prisma.directMessage.findFirst({
    where: { id: messageId, conversationId, senderId: request.user!.id, deletedAt: null },
    select: { id: true, senderId: true, readAt: true },
  });
  if (!message) { response.status(404).json({ error: 'Message introuvable ou suppression non autorisée.' }); return; }

  const result = await prisma.$transaction(async (transaction) => {
    const deletedMessage = await transaction.directMessage.update({
      where: { id: messageId },
      data: { content: '', deletedAt: new Date() },
    });
    return deletedMessage;
  });
  const recipients = await Promise.all([conversation.participantOneId, conversation.participantTwoId].map(async (userId) => {
    const [lastMessage, unreadCount] = await Promise.all([
      prisma.directMessage.findFirst({
        where: { conversationId, hiddenFor: { none: { userId } } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, conversationId: true, senderId: true, content: true, readAt: true, createdAt: true, deletedAt: true },
      }),
      prisma.directMessage.count({
        where: {
          conversationId,
          senderId: { not: userId },
          readAt: null,
          hiddenFor: { none: { userId } },
        },
      }),
    ]);
    return { userId, lastMessage, unreadCount };
  }));
  emitChatMessageDeleted(
    recipients,
    conversationId,
    messageId,
    result,
    conversation.updatedAt,
  );
  const recipientResult = recipients.find((recipient) => recipient.userId === request.user!.id)!;
  response.json({ data: { deleted: true, messageId, deletedMessage: result, lastMessage: recipientResult.lastMessage, unreadCount: recipientResult.unreadCount, updatedAt: conversation.updatedAt } });
});

chatRouter.delete('/conversations/:id', async (request: AuthRequest, response) => {
  if (!requireActiveAgent(request, response)) return;
  const conversationId = Number(request.params.id);
  const result = z.object({ scope: z.literal('me') }).safeParse(request.body);
  if (!Number.isInteger(conversationId) || conversationId < 1 || !result.success) {
    response.status(400).json({ error: 'Requête de suppression invalide.' });
    return;
  }
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      OR: [{ participantOneId: request.user!.id }, { participantTwoId: request.user!.id }],
    },
    select: { participantOneId: true, participantTwoId: true },
  });
  if (!conversation) { response.status(404).json({ error: 'Conversation introuvable.' }); return; }
  const isParticipantOne = conversation.participantOneId === request.user!.id;
  await prisma.$transaction(async (transaction) => {
    await transaction.conversation.update({
      where: { id: conversationId },
      data: isParticipantOne
        ? { participantOneDeletedAt: new Date(), participantOneArchivedAt: null }
        : { participantTwoDeletedAt: new Date(), participantTwoArchivedAt: null },
    });
    await transaction.notification.deleteMany({
      where: {
        userId: request.user!.id,
        type: 'PRIVATE_MESSAGE',
        link: `/messages?conversationId=${conversationId}`,
      },
    });
  });
  emitConversationDeleted([request.user!.id], conversationId, false);
  response.json({ data: { deleted: true, scope: 'me' } });
});
