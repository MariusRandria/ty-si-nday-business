import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { attachChatGateway } from './modules/community/chat.gateway.js';
import { startCollaborationScheduler } from './modules/collaboration/collaboration.scheduler.js';

const app = createApp();
const server = createServer(app);
const chatGateway = attachChatGateway(server);
const stopCollaborationScheduler = env.collaborationSchedulerEnabled
  ? startCollaborationScheduler()
  : async () => {};
if (!env.collaborationSchedulerEnabled) {
  console.log('Collaboration scheduler is disabled by configuration.');
}
server.listen(env.port, () => {
  console.log(`InnovCom API listening on http://localhost:${env.port}`);
});

async function shutdown() {
  await stopCollaborationScheduler();
  await new Promise<void>((resolve) => chatGateway.close(() => resolve()));
  await prisma.$disconnect();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);