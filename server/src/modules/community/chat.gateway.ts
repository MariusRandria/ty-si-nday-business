import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
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
export type ChatMessageData = {
  id: number;
  conversationId: number;
  senderId: number;
  content: string;
  readAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
  mediaMimeType: string | null;
  mediaUrl: string | null;
};

type SendAck = (result: { data?: ChatMessageData; error?: string }) => void;
type VoiceCall = {
  id: string;
  conversationId: number;
  callerId: number;
  callerSocketId: string;
  calleeId: number;
  calleeSocketId: string | null;
  status: 'ringing' | 'accepted';
  timeout: NodeJS.Timeout;
  callerName: string;
  connectedAt: Date | null;
};
type VoiceCallAck = (result: { callId?: string; error?: string }) => void;
type VoiceSignalAck = (result: { error?: string } | undefined) => void;

const voiceCallStartSchema = z.object({ conversationId: z.number().int().positive() });
const voiceCallIdSchema = z.object({ callId: z.string().uuid() });
const voiceCallSignalSchema = z.discriminatedUnion('type', [
  z.object({ callId: z.string().uuid(), type: z.literal('offer'), sdp: z.string().min(1).max(20000) }),
  z.object({ callId: z.string().uuid(), type: z.literal('answer'), sdp: z.string().min(1).max(20000) }),
  z.object({
    callId: z.string().uuid(),
    type: z.literal('ice'),
    candidate: z.object({
      candidate: z.string().max(4096),
      sdpMid: z.string().max(256).nullable().optional(),
      sdpMLineIndex: z.number().int().min(0).max(256).nullable().optional(),
      usernameFragment: z.string().max(256).nullable().optional(),
    }),
  }),
]);

let chatIo: Server | null = null;
const voiceCalls = new Map<string, VoiceCall>();

function finishVoiceCall(
  io: Server,
  call: VoiceCall,
  reason: 'cancelled' | 'declined' | 'ended' | 'timeout' | 'disconnected',
) {
  clearTimeout(call.timeout);
  if (voiceCalls.get(call.id) !== call) return;
  voiceCalls.delete(call.id);
  const event = { callId: call.id, reason };
  io.to(`agent:${call.callerId}`).emit('voice-call:ended', event);
  io.to(`agent:${call.calleeId}`).emit('voice-call:ended', event);

  const durationSeconds = call.connectedAt
    ? Math.max(0, Math.floor((Date.now() - call.connectedAt.getTime()) / 1000))
    : null;
  const label = call.connectedAt
    ? `Appel passé · ${Math.floor((durationSeconds ?? 0) / 60).toString().padStart(2, '0')}:${((durationSeconds ?? 0) % 60).toString().padStart(2, '0')}`
    : reason === 'timeout'
      ? 'Appel manqué'
      : reason === 'declined'
        ? 'Appel refusé'
        : reason === 'cancelled'
          ? 'Appel annulé'
          : 'Appel interrompu';

  void prisma.$transaction(async (transaction) => {
    const message = await transaction.directMessage.create({
      data: {
        conversationId: call.conversationId,
        senderId: call.callerId,
        content: label,
      },
    });
    await transaction.conversation.update({
      where: { id: call.conversationId },
      data: {
        updatedAt: message.createdAt,
        participantOneArchivedAt: null,
        participantTwoArchivedAt: null,
        participantOneDeletedAt: null,
        participantTwoDeletedAt: null,
      },
    });
    return message;
  }).then((message) => {
    const data = serializeChatMessage(message);
    io.to(`agent:${call.callerId}`).emit('message:new', data);
    io.to(`agent:${call.calleeId}`).emit('message:new', data);
  }).catch((error: unknown) => {
    console.error('Unable to save private voice call history:', error);
    const historyError = {
      callId: call.id,
      conversationId: call.conversationId,
      message: 'Impossible d’enregistrer la trace de cet appel dans la conversation.',
    };
    io.to(`agent:${call.callerId}`).emit('voice-call:history-error', historyError);
    io.to(`agent:${call.calleeId}`).emit('voice-call:history-error', historyError);
  });
}

function isVoiceCallParticipant(call: VoiceCall, userId: number, socketId: string) {
  return (call.callerId === userId && call.callerSocketId === socketId)
    || (call.calleeId === userId && call.calleeSocketId === socketId);
}

export function serializeChatMessage(message: {
  id: number;
  conversationId: number;
  senderId: number;
  content: string;
  readAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
  mediaStorageKey: string | null;
  mediaMimeType: string | null;
}): ChatMessageData {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    content: message.content,
    readAt: message.readAt,
    createdAt: message.createdAt,
    deletedAt: message.deletedAt,
    mediaMimeType: message.mediaMimeType,
    mediaUrl: message.mediaStorageKey && message.mediaMimeType
      ? `/api/community/chat/conversations/${message.conversationId}/messages/${message.id}/media`
      : null,
  };
}

export function emitConversationArchiveChanged(userId: number, conversationId: number, archivedAt: Date | null) {
  chatIo?.to(`agent:${userId}`).emit('conversation:archive-changed', {
    conversationId,
    archivedAt: archivedAt?.toISOString() ?? null,
  });
}

export function emitConversationDeleted(userIds: number[], conversationId: number, deletedForEveryone: boolean) {
  for (const userId of userIds) {
    chatIo?.to(`agent:${userId}`).emit('conversation:deleted', { conversationId, deletedForEveryone });
  }
}

export function emitChatMessageDeleted(
  recipients: {
    userId: number;
    lastMessage: ChatMessageData | null;
    unreadCount: number;
  }[],
  conversationId: number,
  messageId: number,
  deletedMessage: ChatMessageData,
  updatedAt: Date,
) {
  for (const recipient of recipients) {
    chatIo?.to(`agent:${recipient.userId}`).emit('message:deleted', {
      conversationId,
      messageId,
      deletedMessage,
      lastMessage: recipient.lastMessage,
      updatedAt: updatedAt.toISOString(),
      unreadCount: recipient.unreadCount,
    });
  }
}

export function emitChatMessageHidden(
  userId: number,
  conversationId: number,
  messageId: number,
  lastMessage: ChatMessageData | null,
  unreadCount: number,
) {
  chatIo?.to(`agent:${userId}`).emit('message:hidden', {
    conversationId,
    messageId,
    lastMessage,
    unreadCount,
  });
}

export function emitChatMediaMessage(userId: number, message: ChatMessageData) {
  chatIo?.to(`agent:${userId}`).emit('message:new', message);
}

export function attachChatGateway(server: HttpServer) {
  const io = new Server(server, { cors: { origin: env.clientOrigins } });
  chatIo = io;
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

    socket.on('voice-call:start', async (payload: unknown, acknowledge?: VoiceCallAck) => {
      const result = voiceCallStartSchema.safeParse(payload);
      if (!result.success) {
        acknowledge?.({ error: 'Conversation invalide.' });
        return;
      }
      try {
        const [caller, conversation] = await Promise.all([
          prisma.user.findFirst({
            where: { id: userId, role: 'AGENT', status: 'ACTIF' },
            select: { id: true, agentProfile: { select: { firstName: true, lastName: true } } },
          }),
          prisma.conversation.findFirst({
            where: {
              id: result.data.conversationId,
              OR: [
                { participantOneId: userId, participantOneDeletedAt: null },
                { participantTwoId: userId, participantTwoDeletedAt: null },
              ],
            },
            select: {
              id: true,
              participantOneId: true,
              participantTwoId: true,
              participantOneDeletedAt: true,
              participantTwoDeletedAt: true,
            },
          }),
        ]);
        if (!caller || !conversation) {
          acknowledge?.({ error: 'Conversation introuvable ou accès refusé.' });
          return;
        }
        const calleeId = conversation.participantOneId === userId
          ? conversation.participantTwoId
          : conversation.participantOneId;
        const calleeDeletedAt = conversation.participantOneId === userId
          ? conversation.participantTwoDeletedAt
          : conversation.participantOneDeletedAt;
        if (calleeDeletedAt) {
          acknowledge?.({ error: 'Cette conversation n’est plus disponible.' });
          return;
        }
        const callee = await prisma.user.findFirst({
          where: { id: calleeId, role: 'AGENT', status: 'ACTIF' },
          select: { id: true },
        });
        if (!callee) {
          acknowledge?.({ error: 'Cet agent n’est plus actif.' });
          return;
        }
        if ([...voiceCalls.values()].some((call) =>
          call.callerId === userId || call.calleeId === userId || call.callerId === calleeId || call.calleeId === calleeId
        )) {
          acknowledge?.({ error: 'Un des agents est déjà en appel.' });
          return;
        }
        if ((await io.in(`agent:${calleeId}`).fetchSockets()).length === 0) {
          acknowledge?.({ error: 'Cet agent n’est pas connecté au chat pour le moment.' });
          return;
        }
        const callId = randomUUID();
        const callerName = [caller.agentProfile?.firstName, caller.agentProfile?.lastName].filter(Boolean).join(' ') || `Agent #${userId}`;
        const call: VoiceCall = {
          id: callId,
          conversationId: conversation.id,
          callerId: userId,
          callerSocketId: socket.id,
          calleeId,
          calleeSocketId: null,
          status: 'ringing',
          timeout: setTimeout(() => {
            if (voiceCalls.get(callId) === call) finishVoiceCall(io, call, 'timeout');
          }, 30_000),
          callerName,
          connectedAt: null,
        };
        call.timeout.unref();
        voiceCalls.set(callId, call);
        io.to(`agent:${calleeId}`).emit('voice-call:incoming', {
          callId,
          conversationId: conversation.id,
          callerId: userId,
          callerName,
        });
        acknowledge?.({ callId });
      } catch (error) {
        console.error('Unable to start private voice call:', error);
        acknowledge?.({ error: 'Impossible de démarrer l’appel vocal.' });
      }
    });

    socket.on('voice-call:accept', (payload: unknown, acknowledge?: VoiceCallAck) => {
      const result = voiceCallIdSchema.safeParse(payload);
      const call = result.success ? voiceCalls.get(result.data.callId) : undefined;
      if (!call || call.calleeId !== userId || call.status !== 'ringing') {
        acknowledge?.({ error: 'Cet appel n’est plus disponible.' });
        return;
      }
      clearTimeout(call.timeout);
      call.status = 'accepted';
      call.calleeSocketId = socket.id;
      io.to(`agent:${call.calleeId}`).except(socket.id).emit('voice-call:ended', {
        callId: call.id,
        reason: 'answered-elsewhere',
      });
      io.to(call.callerSocketId).emit('voice-call:accepted', { callId: call.id });
      acknowledge?.({ callId: call.id });
    });

    socket.on('voice-call:connected', (payload: unknown, acknowledge?: VoiceSignalAck) => {
      const result = voiceCallIdSchema.safeParse(payload);
      const call = result.success ? voiceCalls.get(result.data.callId) : undefined;
      if (!call || call.status !== 'accepted' || !isVoiceCallParticipant(call, userId, socket.id)) {
        acknowledge?.({ error: 'Cet appel n’est plus disponible.' });
        return;
      }
      call.connectedAt ??= new Date();
      acknowledge?.(undefined);
    });

    socket.on('voice-call:decline', (payload: unknown, acknowledge?: VoiceSignalAck) => {
      const result = voiceCallIdSchema.safeParse(payload);
      const call = result.success ? voiceCalls.get(result.data.callId) : undefined;
      if (!call || call.calleeId !== userId || call.status !== 'ringing') {
        acknowledge?.({ error: 'Cet appel n’est plus disponible.' });
        return;
      }
      finishVoiceCall(io, call, 'declined');
      acknowledge?.(undefined);
    });

    socket.on('voice-call:end', (payload: unknown, acknowledge?: VoiceSignalAck) => {
      const result = voiceCallIdSchema.safeParse(payload);
      const call = result.success ? voiceCalls.get(result.data.callId) : undefined;
      if (!call || (call.callerId !== userId && call.calleeId !== userId)) {
        acknowledge?.({ error: 'Cet appel n’est plus disponible.' });
        return;
      }
      const reason = call.status === 'ringing'
        ? call.callerId === userId ? 'cancelled' : 'declined'
        : 'ended';
      finishVoiceCall(io, call, reason);
      acknowledge?.(undefined);
    });

    socket.on('voice-call:signal', (payload: unknown, acknowledge?: VoiceSignalAck) => {
      const result = voiceCallSignalSchema.safeParse(payload);
      const call = result.success ? voiceCalls.get(result.data.callId) : undefined;
      if (!result.success || !call || call.status !== 'accepted') {
        acknowledge?.({ error: 'Signal d’appel invalide ou appel terminé.' });
        return;
      }
      if (!isVoiceCallParticipant(call, userId, socket.id)) {
        acknowledge?.({ error: 'Vous ne participez pas à cet appel.' });
        return;
      }
      const recipientSocketId = call.callerId === userId
        ? call.calleeSocketId
        : call.callerSocketId;
      if (!recipientSocketId) {
        acknowledge?.({ error: 'Le participant n’est plus connecté à l’appel.' });
        return;
      }
      io.to(recipientSocketId).emit('voice-call:signal', result.data);
      acknowledge?.(undefined);
    });

    socket.on('disconnect', () => {
      for (const call of voiceCalls.values()) {
        if (call.callerSocketId === socket.id || call.calleeSocketId === socket.id) {
          finishVoiceCall(io, call, 'disconnected');
        }
      }
    });

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
            OR: [
              { participantOneId: userId, participantOneDeletedAt: null },
              { participantTwoId: userId, participantTwoDeletedAt: null },
            ],
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
            data: {
              updatedAt: created.createdAt,
              participantOneArchivedAt: null,
              participantTwoArchivedAt: null,
              participantOneDeletedAt: null,
              participantTwoDeletedAt: null,
            },
          });
          return created;
        });

        const data = serializeChatMessage(message);
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
