import type { Server } from 'socket.io';
import type { Notification } from '@prisma/client';

let socketServer: Server | null = null;

export function setNotificationServer(server: Server) {
  socketServer = server;
}

export function emitNotification(notification: Notification) {
  socketServer?.to(`agent:${notification.userId}`).emit('notification:new', notification);
}
