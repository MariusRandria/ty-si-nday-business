import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import type { NextFunction, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../auth/auth.middleware.js';
import { chatRouter } from './chat.routes.js';
import { notifyAgents, notifyUser } from '../notifications/notifications.service.js';

export const communityRouter = Router();
communityRouter.use('/chat', chatRouter);

const postMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'].includes(file.mimetype)) {
      callback(new Error('Le média doit être une image JPEG, PNG, WebP ou une vidéo MP4/WebM.'));
      return;
    }
    callback(null, true);
  },
}).single('media');

function parsePostMedia(request: AuthRequest, response: Response, next: NextFunction) {
  postMediaUpload(request, response, (error: unknown) => {
    if (!error) { next(); return; }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({ error: 'Une vidéo ne doit pas dépasser 50 Mo.' });
      return;
    }
    response.status(400).json({ error: error instanceof Error ? error.message : 'Impossible de lire le média envoyé.' });
  });
}

function communityMediaExtension(buffer: Buffer, mimeType: string): 'jpg' | 'png' | 'webp' | 'mp4' | 'webm' | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (mimeType === 'video/mp4' && buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  if (mimeType === 'video/webm' && buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  return null;
}

const COMMUNITY_IMAGE_MAX_SIZE = 5 * 1024 * 1024;
const COMMUNITY_VIDEO_MAX_SIZE = 50 * 1024 * 1024;

const postSchema = z.object({
  title: z.string().trim().min(3).max(200),
  content: z.string().trim().min(1).max(3000),
  category: z.enum(['Discussion', 'Question', 'Astuce']),
});
const commentSchema = z.object({
  content: z.string().trim().min(1).max(2000),
  parentCommentId: z.number().int().positive().nullable().optional(),
});
const postUpdateSchema = postSchema;
const commentUpdateSchema = z.object({ content: z.string().trim().min(1).max(2000) });
const visibilitySchema = z.object({ hidden: z.boolean() });
const reportSchema = z.object({
  targetType: z.enum(['POST', 'COMMENT']),
  targetId: z.number().int().positive(),
  reason: z.string().trim().min(5).max(500),
});

function requireAgent(request: AuthRequest, response: Response) {
  if (request.user?.role !== 'AGENT' || request.user.status !== 'ACTIF') {
    response.status(403).json({ error: 'Cette action est réservée aux agents actifs.' });
    return false;
  }
  return true;
}

function authorSelect(now: Date) {
  return {
    id: true,
    role: true,
    lastActiveAt: true,
    agentProfile: { select: { firstName: true, lastName: true, imageUrl: true } },
    subscriptionRequests: {
      where: { status: 'APPROVED', startsAt: { lte: now }, expiresAt: { gt: now } },
      select: { id: true },
      take: 1,
    },
  };
}

function withSubscriberBadge<T extends { subscriptionRequests: unknown[] }>(author: T) {
  const { subscriptionRequests, ...publicAuthor } = author;
  return { ...publicAuthor, isSubscriber: subscriptionRequests.length > 0 };
}

function postInclude(now: Date, authorId: number) {
  const selectedAuthor = authorSelect(now);
  return {
  author: { select: selectedAuthor },
  category: { select: { name: true } },
  comments: {
    where: {
      OR: [
        { isHidden: false, authorHidden: false },
        { isHidden: false, authorId },
      ],
    },
    orderBy: { createdAt: 'asc' as const },
    take: 50,
    include: { author: { select: selectedAuthor } },
  },
  _count: { select: { likes: true } },
  likes: { select: { userId: true } },
  };
}

communityRouter.get('/feed', async (request: AuthRequest, response) => {
  if (request.user?.status !== 'ACTIF') { response.status(403).json({ error: 'Un compte actif est requis pour consulter le forum.' }); return; }
  const [posts, offers] = await Promise.all([
    prisma.post.findMany({
      where: {
        category: { adminOnly: false },
        OR: [
          { isHidden: false, authorHidden: false },
          { isHidden: false, authorId: request.user!.id },
        ],
      },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      include: postInclude(new Date(), request.user!.id),
    }),
    prisma.product.findMany({
      where: { status: 'PUBLIE' },
      orderBy: { publishedAt: 'desc' },
      take: 20,
      select: { id: true, title: true, description: true, targetAudience: true, salesPitch: true, publishedAt: true },
    }),
  ]);
  response.json({
    data: {
      posts: posts.map(({ authorHidden, ...post }) => ({
        ...post,
        isAuthorHidden: authorHidden,
        author: withSubscriberBadge(post.author),
        comments: post.comments.map(({ authorHidden: commentAuthorHidden, ...comment }) => ({
          ...comment,
          isAuthorHidden: commentAuthorHidden,
          author: withSubscriberBadge(comment.author),
        })),
        likesCount: post._count.likes,
        likedByMe: post.likes.some((like) => like.userId === request.user?.id),
        likes: undefined,
        _count: undefined,
      })),
      offers,
    },
  });
});

communityRouter.get('/search', async (request: AuthRequest, response) => {
  if (request.user?.status !== 'ACTIF') { response.status(403).json({ error: 'Un compte actif est requis pour consulter le forum.' }); return; }
  const parsed = z.object({
    q: z.string().trim().min(2).max(100),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  }).safeParse(request.query);
  if (!parsed.success) { response.status(400).json({ error: 'Saisissez au moins deux caractères pour rechercher.' }); return; }

  const terms = parsed.data.q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 8);
  const searchWhere: Prisma.PostWhereInput = {
    category: { adminOnly: false },
    OR: [
      { isHidden: false, authorHidden: false },
      { isHidden: false, authorId: request.user.id },
    ],
    AND: terms.map((term): Prisma.PostWhereInput => {
      const officialNameMatch = ['TY', 'SY', 'NDAY'].some((part) => part.includes(term.toLocaleUpperCase('fr')) || term.toLocaleUpperCase('fr').includes(part));
      const matches: Prisma.PostWhereInput[] = [
        { title: { contains: term } },
        { content: { contains: term } },
        { category: { name: { contains: term } } },
        { author: { is: { agentProfile: { is: { firstName: { contains: term } } } } } },
        { author: { is: { agentProfile: { is: { lastName: { contains: term } } } } } },
        { comments: { some: {
          isHidden: false,
          authorHidden: false,
          OR: [
            { content: { contains: term } },
            { author: { is: { agentProfile: { is: { firstName: { contains: term } } } } } },
            { author: { is: { agentProfile: { is: { lastName: { contains: term } } } } } },
          ],
        } } },
      ];
      if (officialNameMatch) matches.push({ author: { is: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } } } });
      return { OR: matches };
    }),
  };
  const posts = await prisma.post.findMany({
    where: searchWhere,
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    skip: parsed.data.offset,
    take: 21,
    include: postInclude(new Date(), request.user.id),
  });
  const hasMore = posts.length > 20;
  response.json({
    data: {
      posts: posts.slice(0, 20).map(({ authorHidden, ...post }) => ({
        ...post,
        isAuthorHidden: authorHidden,
        author: withSubscriberBadge(post.author),
        comments: post.comments.map(({ authorHidden: commentAuthorHidden, ...comment }) => ({
          ...comment,
          isAuthorHidden: commentAuthorHidden,
          author: withSubscriberBadge(comment.author),
        })),
        likesCount: post._count.likes,
        likedByMe: post.likes.some((like) => like.userId === request.user?.id),
        likes: undefined,
        _count: undefined,
      })),
      hasMore,
    },
  });
});

async function publishCommunityPost(request: AuthRequest, response: Response) {
  const result = postSchema.safeParse(request.body);
  if (!result.success) { response.status(400).json({ error: 'Titre, contenu ou catégorie invalide.', details: result.error.flatten() }); return; }
  const file = request.file;
  const extension = file ? communityMediaExtension(file.buffer, file.mimetype) : null;
  const validMimeType = extension ? ({
    jpg: file?.mimetype === 'image/jpeg',
    png: file?.mimetype === 'image/png',
    webp: file?.mimetype === 'image/webp',
    mp4: file?.mimetype === 'video/mp4',
    webm: file?.mimetype === 'video/webm',
  }[extension]) : false;
  if (file && (!extension || !validMimeType)) {
    response.status(400).json({ error: 'Le média doit être une image valide (JPEG, PNG ou WebP) ou une vidéo valide (MP4 ou WebM).' });
    return;
  }
  if (file && extension && ['jpg', 'png', 'webp'].includes(extension) && file.size > COMMUNITY_IMAGE_MAX_SIZE) {
    response.status(413).json({ error: 'Une image ne doit pas dépasser 5 Mo.' });
    return;
  }
  if (file && extension && ['mp4', 'webm'].includes(extension) && file.size > COMMUNITY_VIDEO_MAX_SIZE) {
    response.status(413).json({ error: 'Une vidéo ne doit pas dépasser 50 Mo.' });
    return;
  }

  const category = await prisma.postCategory.upsert({
    where: { name: result.data.category },
    update: {},
    create: { name: result.data.category, adminOnly: false },
  });
  if (category.adminOnly) { response.status(409).json({ error: 'Cette catégorie est réservée à l’administration.' }); return; }
  const filename = file && extension ? `${randomUUID()}.${extension}` : null;
  const imageUrl = filename ? `/api/uploads/community-images/${filename}` : null;
  const uploadDirectory = fileURLToPath(new URL('../../../uploads/community-images/', import.meta.url));
  if (file && filename) {
    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(join(uploadDirectory, filename), file.buffer, { flag: 'wx' });
  }
  let post;
  try {
    post = await prisma.post.create({
      data: {
        authorId: request.user!.id,
        categoryId: category.id,
        title: result.data.title,
        content: result.data.content,
        imageUrl,
      },
      include: postInclude(new Date(), request.user!.id),
    });
  } catch (error) {
    if (filename) {
      await unlink(join(uploadDirectory, filename)).catch((cleanupError: unknown) => {
        console.error('Unable to remove an unreferenced community image:', cleanupError);
      });
    }
    throw error;
  }
  const authorName = [post.author.agentProfile?.firstName, post.author.agentProfile?.lastName].filter(Boolean).join(' ')
    || (post.author.role === 'ADMIN' || post.author.role === 'SUPER_ADMIN' ? 'L’administration' : `Agent #${request.user!.id}`);
  await notifyAgents({
    type: 'COMMUNITY_POST',
    title: 'Nouvelle publication dans le forum',
    body: `${authorName} a publié « ${post.title} ».`,
    link: `/community?postId=${post.id}`,
    actorId: request.user!.id,
  });
  const { authorHidden, ...publicPost } = post;
  response.status(201).json({ data: { ...publicPost, isAuthorHidden: authorHidden, author: withSubscriberBadge(post.author), comments: post.comments.map(({ authorHidden: commentAuthorHidden, ...comment }) => ({ ...comment, isAuthorHidden: commentAuthorHidden, author: withSubscriberBadge(comment.author) })), likesCount: 0, likedByMe: false, likes: undefined, _count: undefined } });
}

communityRouter.post('/posts', (request: AuthRequest, response: Response, next: NextFunction) => {
  if (requireAgent(request, response)) next();
}, parsePostMedia, publishCommunityPost);

communityRouter.patch('/posts/:id', async (request: AuthRequest, response) => {
  if (!requireAgent(request, response)) return;
  const postId = Number(request.params.id);
  const result = postUpdateSchema.safeParse(request.body);
  if (!Number.isInteger(postId) || postId < 1 || !result.success) {
    response.status(400).json({ error: 'Identifiant ou publication invalide.' });
    return;
  }
  const post = await prisma.post.findFirst({
    where: { id: postId, authorId: request.user!.id, isHidden: false },
    select: { id: true },
  });
  if (!post) { response.status(404).json({ error: 'Publication introuvable ou modification non autorisée.' }); return; }
  const category = await prisma.postCategory.upsert({
    where: { name: result.data.category },
    update: {},
    create: { name: result.data.category, adminOnly: false },
  });
  if (category.adminOnly) { response.status(409).json({ error: 'Cette catégorie est réservée à l’administration.' }); return; }
  const updated = await prisma.post.update({
    where: { id: postId },
    data: { title: result.data.title, content: result.data.content, categoryId: category.id },
    select: { id: true, title: true, content: true, category: { select: { name: true } } },
  });
  response.json({ data: updated });
});

communityRouter.patch('/posts/:id/visibility', async (request: AuthRequest, response) => {
  if (!requireAgent(request, response)) return;
  const postId = Number(request.params.id);
  const result = visibilitySchema.safeParse(request.body);
  if (!Number.isInteger(postId) || postId < 1 || !result.success) {
    response.status(400).json({ error: 'Identifiant ou visibilité invalide.' });
    return;
  }
  const updated = await prisma.post.updateMany({
    where: { id: postId, authorId: request.user!.id, isHidden: false },
    data: { authorHidden: result.data.hidden },
  });
  if (!updated.count) { response.status(404).json({ error: 'Publication introuvable ou modification non autorisée.' }); return; }
  response.json({ data: { id: postId, isAuthorHidden: result.data.hidden } });
});

communityRouter.delete('/posts/:id', async (request: AuthRequest, response) => {
  if (!requireAgent(request, response)) return;
  const postId = Number(request.params.id);
  if (!Number.isInteger(postId) || postId < 1) { response.status(400).json({ error: 'Identifiant invalide.' }); return; }
  const post = await prisma.post.findFirst({
    where: { id: postId, authorId: request.user!.id },
    select: { id: true, imageUrl: true },
  });
  if (!post) { response.status(404).json({ error: 'Publication introuvable ou suppression non autorisée.' }); return; }
  await prisma.post.delete({ where: { id: postId } });
  const filename = post.imageUrl?.split('/').pop();
  if (filename && basename(filename) === filename) {
    const uploadDirectory = fileURLToPath(new URL('../../../uploads/community-images/', import.meta.url));
    await unlink(join(uploadDirectory, filename)).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return;
      console.error('Unable to remove a deleted community image:', error);
    });
  }
  response.status(204).end();
});

communityRouter.post('/posts/:id/comments', async (request: AuthRequest, response) => {
  if (!requireAgent(request, response)) return;
  const postId = Number(request.params.id);
  const result = commentSchema.safeParse(request.body);
  if (!Number.isInteger(postId) || postId < 1 || !result.success) { response.status(400).json({ error: 'Identifiant ou commentaire invalide.' }); return; }
  const post = await prisma.post.findFirst({
    where: { id: postId, isHidden: false, authorHidden: false, category: { adminOnly: false } },
    select: { id: true, title: true, authorId: true },
  });
  if (!post) { response.status(404).json({ error: 'Publication introuvable.' }); return; }
  const parentCommentId = result.data.parentCommentId ?? null;
  let parentAuthorId: number | null = null;
  if (parentCommentId !== null) {
    const parent = await prisma.comment.findFirst({
      where: { id: parentCommentId, postId, isHidden: false, authorHidden: false, parentCommentId: null },
      select: { id: true, authorId: true },
    });
    if (!parent) { response.status(404).json({ error: 'Commentaire parent introuvable.' }); return; }
    parentAuthorId = parent.authorId;
  }
  const comment = await prisma.comment.create({
    data: { postId, authorId: request.user!.id, parentCommentId, content: result.data.content },
    include: { author: { select: authorSelect(new Date()) } },
  });
  const actorName = [comment.author.agentProfile?.firstName, comment.author.agentProfile?.lastName].filter(Boolean).join(' ') || `Agent #${request.user!.id}`;
  const recipients = new Set([post.authorId, ...(parentAuthorId === null ? [] : [parentAuthorId])]);
  recipients.delete(request.user!.id);
  await Promise.all([...recipients].map((userId) => {
    const isParentAuthor = userId === parentAuthorId;
    return notifyUser(userId, {
      type: isParentAuthor ? 'COMMUNITY_REPLY' : 'COMMUNITY_COMMENT',
      title: isParentAuthor ? 'Nouvelle réponse à votre commentaire' : 'Nouveau commentaire sur votre publication',
      body: `${actorName} a commenté « ${post.title} ».`,
      pushBody: 'Vous avez une nouvelle activité dans le forum.',
      link: `/community?postId=${post.id}`,
      actorId: request.user!.id,
    });
  }));
  const { authorHidden: commentAuthorHidden, ...publicComment } = comment;
  response.status(201).json({ data: { ...publicComment, isAuthorHidden: commentAuthorHidden, author: withSubscriberBadge(comment.author) } });
});

communityRouter.patch('/comments/:id', async (request: AuthRequest, response) => {
  if (!requireAgent(request, response)) return;
  const commentId = Number(request.params.id);
  const result = commentUpdateSchema.safeParse(request.body);
  if (!Number.isInteger(commentId) || commentId < 1 || !result.success) {
    response.status(400).json({ error: 'Identifiant ou commentaire invalide.' });
    return;
  }
  const comment = await prisma.comment.findFirst({
    where: {
      id: commentId,
      authorId: request.user!.id,
      isHidden: false,
      post: { isHidden: false, authorHidden: false, category: { adminOnly: false } },
    },
    select: { id: true },
  });
  if (!comment) { response.status(404).json({ error: 'Commentaire introuvable ou modification non autorisée.' }); return; }
  const updated = await prisma.comment.update({
    where: { id: commentId },
    data: { content: result.data.content },
    select: { id: true, content: true },
  });
  response.json({ data: updated });
});

communityRouter.patch('/comments/:id/visibility', async (request: AuthRequest, response) => {
  if (!requireAgent(request, response)) return;
  const commentId = Number(request.params.id);
  const result = visibilitySchema.safeParse(request.body);
  if (!Number.isInteger(commentId) || commentId < 1 || !result.success) {
    response.status(400).json({ error: 'Identifiant ou visibilité invalide.' });
    return;
  }
  const updated = await prisma.comment.updateMany({
    where: {
      id: commentId,
      authorId: request.user!.id,
      isHidden: false,
      post: { isHidden: false, authorHidden: false, category: { adminOnly: false } },
    },
    data: { authorHidden: result.data.hidden },
  });
  if (!updated.count) { response.status(404).json({ error: 'Commentaire introuvable ou modification non autorisée.' }); return; }
  response.json({ data: { id: commentId, isAuthorHidden: result.data.hidden } });
});

communityRouter.delete('/comments/:id', async (request: AuthRequest, response) => {
  if (!requireAgent(request, response)) return;
  const commentId = Number(request.params.id);
  if (!Number.isInteger(commentId) || commentId < 1) { response.status(400).json({ error: 'Identifiant invalide.' }); return; }
  const comment = await prisma.comment.findFirst({
    where: { id: commentId, authorId: request.user!.id },
    select: { id: true },
  });
  if (!comment) { response.status(404).json({ error: 'Commentaire introuvable ou suppression non autorisée.' }); return; }
  await prisma.comment.delete({ where: { id: commentId } });
  response.status(204).end();
});

communityRouter.post('/posts/:id/like', async (request: AuthRequest, response) => {
  if (!requireAgent(request, response)) return;
  const postId = Number(request.params.id);
  if (!Number.isInteger(postId) || postId < 1) { response.status(400).json({ error: 'Identifiant invalide.' }); return; }
  const post = await prisma.post.findFirst({
    where: { id: postId, isHidden: false, authorHidden: false, category: { adminOnly: false } },
    select: { id: true, title: true, authorId: true },
  });
  if (!post) { response.status(404).json({ error: 'Publication introuvable.' }); return; }
  const existingLike = await prisma.postLike.findUnique({
    where: { postId_userId: { postId, userId: request.user!.id } },
    select: { postId: true },
  });
  await prisma.postLike.upsert({
    where: { postId_userId: { postId, userId: request.user!.id } },
    update: {},
    create: { postId, userId: request.user!.id },
  });
  if (!existingLike && post.authorId !== request.user!.id) {
    await notifyUser(post.authorId, {
      type: 'COMMUNITY_REACTION',
      title: 'Nouvelle réaction à votre publication',
      body: `Un agent a réagi à « ${post.title} ».`,
      pushBody: 'Vous avez une nouvelle réaction dans le forum.',
      link: `/community?postId=${post.id}`,
      actorId: request.user!.id,
    });
  }
  const likesCount = await prisma.postLike.count({ where: { postId } });
  response.json({ data: { liked: true, likesCount } });
});

communityRouter.delete('/posts/:id/like', async (request: AuthRequest, response) => {
  if (!requireAgent(request, response)) return;
  const postId = Number(request.params.id);
  if (!Number.isInteger(postId) || postId < 1) { response.status(400).json({ error: 'Identifiant invalide.' }); return; }
  await prisma.postLike.deleteMany({ where: { postId, userId: request.user!.id } });
  const likesCount = await prisma.postLike.count({ where: { postId } });
  response.json({ data: { liked: false, likesCount } });
});

communityRouter.post('/reports', async (request: AuthRequest, response) => {
  if (!requireAgent(request, response)) return;
  const result = reportSchema.safeParse(request.body);
  if (!result.success) { response.status(400).json({ error: 'Signalement invalide.', details: result.error.flatten() }); return; }
  const { targetType, targetId, reason } = result.data;
  const target = targetType === 'POST'
    ? await prisma.post.findFirst({ where: { id: targetId, isHidden: false, authorHidden: false, category: { adminOnly: false } }, select: { id: true } })
    : await prisma.comment.findFirst({ where: { id: targetId, isHidden: false, authorHidden: false, post: { isHidden: false, authorHidden: false, category: { adminOnly: false } } }, select: { id: true } });
  if (!target) { response.status(404).json({ error: 'Contenu introuvable.' }); return; }
  const existing = await prisma.contentReport.findFirst({ where: { reporterId: request.user!.id, targetType, targetId, status: 'OUVERT' }, select: { id: true } });
  if (existing) { response.status(409).json({ error: 'Vous avez déjà signalé ce contenu.' }); return; }
  const report = await prisma.contentReport.create({ data: { reporterId: request.user!.id, targetType, targetId, reason } });
  response.status(201).json({ data: report });
});

export const adminCommunityRouter = Router();

adminCommunityRouter.get('/posts', async (_request, response) => {
  const posts = await prisma.post.findMany({
    where: { category: { adminOnly: false } },
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    take: 100,
    include: postInclude(new Date(), 0),
  });
  response.json({ data: posts.map(({ authorHidden, ...post }) => ({
    ...post,
    isAuthorHidden: authorHidden,
    author: withSubscriberBadge(post.author),
    comments: post.comments.map(({ authorHidden: commentAuthorHidden, ...comment }) => ({
      ...comment,
      isAuthorHidden: commentAuthorHidden,
      author: withSubscriberBadge(comment.author),
    })),
    likesCount: post._count.likes,
    likedByMe: false,
    likes: undefined,
    _count: undefined,
  })) });
});

adminCommunityRouter.post('/posts', parsePostMedia, publishCommunityPost);

adminCommunityRouter.get('/reports', async (_request, response) => {
  const reports = await prisma.contentReport.findMany({
    where: { status: 'OUVERT' },
    orderBy: { createdAt: 'asc' },
    include: { reporter: { select: { id: true, email: true } } },
  });
  const postIds = reports.filter((report) => report.targetType === 'POST').map((report) => report.targetId);
  const commentIds = reports.filter((report) => report.targetType === 'COMMENT').map((report) => report.targetId);
  const [posts, comments] = await Promise.all([
    prisma.post.findMany({ where: { id: { in: postIds } }, select: { id: true, title: true, content: true } }),
    prisma.comment.findMany({ where: { id: { in: commentIds } }, select: { id: true, content: true, post: { select: { title: true } } } }),
  ]);
  const postById = new Map(posts.map((post) => [post.id, post]));
  const commentById = new Map(comments.map((comment) => [comment.id, comment]));
  response.json({ data: reports.map((report) => ({
    ...report,
    target: report.targetType === 'POST'
      ? postById.get(report.targetId) ?? null
      : commentById.get(report.targetId) ?? null,
  })) });
});

adminCommunityRouter.patch('/reports/:id', async (request, response) => {
  const id = Number(request.params.id);
  const result = z.object({ action: z.enum(['HIDE', 'DISMISS']) }).safeParse(request.body);
  if (!Number.isInteger(id) || id < 1 || !result.success) { response.status(400).json({ error: 'Identifiant ou action invalide.' }); return; }
  const report = await prisma.contentReport.findUnique({ where: { id } });
  if (!report || report.status !== 'OUVERT') { response.status(404).json({ error: 'Signalement ouvert introuvable.' }); return; }
  await prisma.$transaction(async (transaction) => {
    if (result.data.action === 'HIDE') {
      if (report.targetType === 'POST') await transaction.post.updateMany({ where: { id: report.targetId }, data: { isHidden: true } });
      else await transaction.comment.updateMany({ where: { id: report.targetId }, data: { isHidden: true } });
      await transaction.contentReport.updateMany({
        where: { targetType: report.targetType, targetId: report.targetId, status: 'OUVERT' },
        data: { status: 'TRAITE' },
      });
    } else {
      await transaction.contentReport.update({ where: { id }, data: { status: 'REJETE' } });
    }
  });
  response.json({ data: { id, status: result.data.action === 'HIDE' ? 'TRAITE' : 'REJETE' } });
});
