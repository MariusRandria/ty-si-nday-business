import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Response } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { notifyAdmins, notifyUser, notifyAgents } from '../notifications/notifications.service.js'
import type { AuthRequest } from '../auth/auth.middleware.js'
import {
  calculateMarketplaceOrderTotal,
  canTransitionMarketplaceOrder,
  marketplaceDeliveryRequiresAddress,
  marketplaceOrderCanPayWithoutDeadline,
  marketplacePaymentExpiry,
  marketplacePaymentMethodAllowed,
} from './marketplace.policy.js'

const productVariantSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  label: z.string().trim().min(1).max(100),
  stock: z.coerce.number().int().min(0).max(100_000),
})

const variantsSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) as unknown } catch { return undefined }
}, z.array(productVariantSchema).min(1).max(100))
  .refine((variants) => new Set(variants.map(({ label }) => label.toLocaleLowerCase())).size === variants.length, {
    message: 'Chaque déclinaison doit avoir un nom différent.',
  })
  .refine((variants) => {
    const ids = variants.flatMap(({ id }) => id === undefined ? [] : [id])
    return new Set(ids).size === ids.length
  }, { message: 'Une déclinaison ne peut être renseignée qu’une seule fois.' })

const productSchema = z.object({
  title: z.string().trim().min(2).max(200),
  category: z.string().trim().min(2).max(100),
  description: z.string().trim().min(10).max(5000),
  price: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(['BROUILLON', 'PUBLIE', 'ARCHIVE']).default('BROUILLON'),
  variants: variantsSchema,
})

const orderSchema = z.object({
  items: z.array(z.object({
    variantId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(99),
  })).min(1).max(30).refine((items) => new Set(items.map(({ variantId }) => variantId)).size === items.length, {
    message: 'Une déclinaison ne peut apparaître qu’une seule fois dans la commande.',
  }),
  deliveryMethod: z.enum(['LIVRAISON', 'COLIS', 'RECUPERATION']),
  paymentMethod: z.enum(['MVOLA', 'ORANGE_MONEY', 'AIRTEL_MONEY', 'ESPECES']),
  deliveryAddress: z.string().trim().max(1000).optional(),
  agentNote: z.string().trim().max(1000).optional(),
}).superRefine((order, context) => {
  if (marketplaceDeliveryRequiresAddress(order.deliveryMethod) && !order.deliveryAddress) {
    context.addIssue({ code: 'custom', path: ['deliveryAddress'], message: 'Indiquez l’adresse ou le point de remise souhaité.' })
  }
  if (!marketplacePaymentMethodAllowed(order.deliveryMethod, order.paymentMethod)) {
    context.addIssue({ code: 'custom', path: ['paymentMethod'], message: 'Le paiement en espèces est uniquement disponible pour une récupération.' })
  }
})

const orderStatusSchema = z.object({
  status: z.enum(['DEMANDEE', 'CONFIRMEE', 'EN_PREPARATION', 'PRETE', 'EXPEDIEE', 'LIVREE', 'ANNULEE']),
})

const paymentSchema = z.object({
  paymentNote: z.string().trim().max(100).optional(),
})

const paymentReferenceSchema = z.object({
  paymentReference: z.string().trim().min(3).max(100),
  paymentMethod: z.enum(['MVOLA', 'ORANGE_MONEY', 'AIRTEL_MONEY']).optional(),
})

const deliveryQuoteSchema = z.object({
  deliveryFee: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
})

const paymentSettingsSchema = z.object({
  mvolaNumber: z.string().trim().max(100).nullable(),
  mvolaAccountName: z.string().trim().max(150).nullable(),
  orangeMoneyNumber: z.string().trim().max(100).nullable(),
  orangeMoneyName: z.string().trim().max(150).nullable(),
  airtelMoneyNumber: z.string().trim().max(100).nullable(),
  airtelMoneyName: z.string().trim().max(150).nullable(),
  instructions: z.string().trim().max(2000),
})

const uploadDirectory = fileURLToPath(new URL('../../../uploads/marketplace-images/', import.meta.url))

class MarketplaceOperationError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function isActiveAgent(request: AuthRequest, response: Response): request is AuthRequest & { user: NonNullable<AuthRequest['user']> } {
  if (request.user?.role !== 'AGENT' || request.user.status !== 'ACTIF') {
    response.status(403).json({ error: 'Cette action est réservée aux agents actifs.' })
    return false
  }
  return true
}

function imageExtension(buffer: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return null
}

async function saveProductImage(file: Express.Multer.File) {
  const extension = imageExtension(file.buffer)
  const matchesMime = extension === 'jpg' && file.mimetype === 'image/jpeg'
    || extension === 'png' && file.mimetype === 'image/png'
    || extension === 'webp' && file.mimetype === 'image/webp'
  if (!extension || !matchesMime) return null
  const filename = `${randomUUID()}.${extension}`
  await mkdir(uploadDirectory, { recursive: true })
  const filePath = join(uploadDirectory, filename)
  await writeFile(filePath, file.buffer, { flag: 'wx' })
  return { filePath, url: `/api/uploads/marketplace-images/${filename}` }
}

async function removeProductImage(imageUrl: string | null) {
  const filename = imageUrl?.startsWith('/api/uploads/marketplace-images/') ? basename(imageUrl) : null
  if (!filename || !/^[0-9a-f-]+\.(?:jpg|png|webp)$/.test(filename)) return
  try {
    await unlink(join(uploadDirectory, filename))
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code !== 'ENOENT') {
      console.error('Unable to remove a marketplace product image:', error)
    }
  }
}

function serializedProduct<T extends { price: bigint }>(product: T) {
  return { ...product, price: product.price.toString() }
}

function serializedOrder<T extends {
  itemsAmount: bigint
  deliveryFee: bigint | null
  totalAmount: bigint | null
  items: Array<{ unitPrice: bigint; lineTotal: bigint }>
}>(order: T) {
  return {
    ...order,
    itemsAmount: order.itemsAmount.toString(),
    deliveryFee: order.deliveryFee?.toString() ?? null,
    totalAmount: order.totalAmount?.toString() ?? null,
    items: order.items.map((item) => ({
      ...item,
      unitPrice: item.unitPrice.toString(),
      lineTotal: item.lineTotal.toString(),
    })),
  }
}

function serializedPaymentSettings(settings: {
  mvolaNumber: string | null
  mvolaAccountName: string | null
  orangeMoneyNumber: string | null
  orangeMoneyName: string | null
  airtelMoneyNumber: string | null
  airtelMoneyName: string | null
  instructions: string
} | null) {
  return {
    providers: [
      { method: 'MVOLA' as const, label: 'MVola', account: settings?.mvolaNumber ?? null, accountName: settings?.mvolaAccountName ?? null },
      { method: 'ORANGE_MONEY' as const, label: 'Orange Money', account: settings?.orangeMoneyNumber ?? null, accountName: settings?.orangeMoneyName ?? null },
      { method: 'AIRTEL_MONEY' as const, label: 'Airtel Money', account: settings?.airtelMoneyNumber ?? null, accountName: settings?.airtelMoneyName ?? null },
    ],
    instructions: settings?.instructions ?? '',
  }
}

function paymentDestination(settings: {
  mvolaNumber: string | null
  mvolaAccountName: string | null
  orangeMoneyNumber: string | null
  orangeMoneyName: string | null
  airtelMoneyNumber: string | null
  airtelMoneyName: string | null
  instructions: string
} | null, method: 'MVOLA' | 'ORANGE_MONEY' | 'AIRTEL_MONEY') {
  const provider = serializedPaymentSettings(settings).providers.find((item) => item.method === method)
  return provider?.account ? { account: provider.account, accountName: provider.accountName, instructions: settings?.instructions ?? null } : null
}

export async function listMarketplaceProducts(request: AuthRequest, response: Response) {
  if (!isActiveAgent(request, response)) return
  const products = await prisma.marketplaceProduct.findMany({
    where: { status: 'PUBLIE' },
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    include: { variants: { where: { isActive: true }, orderBy: { label: 'asc' }, select: { id: true, label: true, stock: true } } },
  })
  response.json({ data: products.map(serializedProduct) })
}

export async function listMarketplacePaymentSettings(request: AuthRequest, response: Response) {
  if (!isActiveAgent(request, response)) return
  const settings = await prisma.marketplacePaymentSettings.findUnique({ where: { id: 1 } })
  response.json({ data: serializedPaymentSettings(settings) })
}

export async function listAgentMarketplaceOrders(request: AuthRequest, response: Response) {
  if (!isActiveAgent(request, response)) return
  const orders = await prisma.marketplaceOrder.findMany({
    where: { agentId: request.user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { items: { orderBy: { id: 'asc' } } },
  })
  response.json({ data: orders.map(serializedOrder) })
}

export async function createMarketplaceOrder(request: AuthRequest, response: Response) {
  if (!isActiveAgent(request, response)) return
  const result = orderSchema.safeParse(request.body)
  if (!result.success) {
    response.status(400).json({ error: 'Informations de commande invalides.', details: result.error.flatten() })
    return
  }

  const paymentSettings = await prisma.marketplacePaymentSettings.findUnique({ where: { id: 1 } })
  const destination = result.data.paymentMethod === 'ESPECES'
    ? null
    : paymentDestination(paymentSettings, result.data.paymentMethod)
  if (result.data.paymentMethod !== 'ESPECES' && !destination) {
    response.status(409).json({ error: 'Ce mode de paiement n’est pas encore configuré. Contactez l’administration.' })
    return
  }

  try {
    const order = await prisma.$transaction(async (transaction) => {
      const variantIds = result.data.items.map(({ variantId }) => variantId)
      const variants = await transaction.marketplaceProductVariant.findMany({
        where: { id: { in: variantIds }, isActive: true },
        include: { product: { select: { id: true, title: true, price: true, status: true } } },
      })
      if (variants.length !== variantIds.length || variants.some(({ product }) => product.status !== 'PUBLIE')) {
        throw new MarketplaceOperationError(409, 'Un ou plusieurs articles ne sont plus disponibles.')
      }

      const variantById = new Map(variants.map((variant) => [variant.id, variant]))
      const orderLines = result.data.items.map((line) => {
        const variant = variantById.get(line.variantId)
        if (!variant) throw new MarketplaceOperationError(409, 'Une déclinaison sélectionnée n’est plus disponible.')
        if (variant.stock < line.quantity) {
          throw new MarketplaceOperationError(409, `Stock insuffisant pour ${variant.product.title} · ${variant.label}.`)
        }
        return { ...line, variant }
      })

      for (const line of orderLines) {
        const reserved = await transaction.marketplaceProductVariant.updateMany({
          where: { id: line.variantId, isActive: true, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        })
        if (reserved.count !== 1) {
          throw new MarketplaceOperationError(409, `Le stock de ${line.variant.product.title} · ${line.variant.label} vient de changer.`)
        }
      }

      const itemsAmount = calculateMarketplaceOrderTotal(orderLines.map(({ variant, quantity }) => ({
        unitPrice: variant.product.price,
        quantity,
      })))
      const isCollection = result.data.deliveryMethod === 'RECUPERATION'
      const now = new Date()
      return transaction.marketplaceOrder.create({
        data: {
          agentId: request.user!.id,
          deliveryMethod: result.data.deliveryMethod,
          deliveryAddress: result.data.deliveryAddress || null,
          agentNote: result.data.agentNote || null,
          itemsAmount,
          deliveryFee: isCollection ? 0n : null,
          totalAmount: isCollection ? itemsAmount : null,
          paymentMethod: result.data.paymentMethod,
          paymentAccount: destination?.account ?? null,
          paymentAccountName: destination?.accountName ?? null,
          paymentInstructions: destination?.instructions ?? null,
          quotedAt: isCollection ? now : null,
          quoteExpiresAt: isCollection ? null : marketplacePaymentExpiry(now),
          paymentExpiresAt: isCollection ? marketplacePaymentExpiry(now) : null,
          items: {
            create: orderLines.map(({ variant, quantity }) => ({
              productId: variant.product.id,
              variantId: variant.id,
              productName: variant.product.title,
              variantLabel: variant.label,
              quantity,
              unitPrice: variant.product.price,
              lineTotal: variant.product.price * BigInt(quantity),
            })),
          },
        },
        include: { items: { orderBy: { id: 'asc' } } },
      })
    })
    await notifyAdmins({
      type: 'MARKETPLACE_ORDER',
      title: 'Nouvelle commande marketplace',
      body: order.totalAmount === null
        ? `La commande #${order.id} attend un devis des frais de remise.`
        : `La commande #${order.id} attend la vérification du paiement (${order.totalAmount.toLocaleString('fr-FR')} Ar).`,
      link: '/admin-marketplace',
      actorId: request.user.id,
    })
    response.status(201).json({ data: serializedOrder(order) })
  } catch (error) {
    if (error instanceof MarketplaceOperationError) {
      response.status(error.status).json({ error: error.message })
      return
    }
    throw error
  }
}

export async function listAdminMarketplaceProducts(_request: AuthRequest, response: Response) {
  const products = await prisma.marketplaceProduct.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { variants: { orderBy: { label: 'asc' } } },
  })
  response.json({ data: products.map(serializedProduct) })
}

function parseProductBody(request: AuthRequest, response: Response) {
  const result = productSchema.safeParse(request.body)
  if (!result.success) {
    response.status(400).json({ error: 'Informations du produit invalides.', details: result.error.flatten() })
    return null
  }
  return result.data
}

export async function createAdminMarketplaceProduct(request: AuthRequest, response: Response) {
  const input = parseProductBody(request, response)
  if (!input) return
  const image = request.file ? await saveProductImage(request.file) : null
  if (request.file && !image) {
    response.status(400).json({ error: 'L’image doit être un fichier JPEG, PNG ou WebP valide.' })
    return
  }

  try {
    const product = await prisma.marketplaceProduct.create({
      data: {
        title: input.title,
        category: input.category,
        description: input.description,
        price: BigInt(input.price),
        status: input.status,
        publishedAt: input.status === 'PUBLIE' ? new Date() : null,
        createdBy: request.user!.id,
        imageUrl: image?.url ?? null,
        variants: { create: input.variants.map(({ label, stock }) => ({ label, stock })) },
      },
      include: { variants: { orderBy: { label: 'asc' } } },
    })
    if (product.status === 'PUBLIE') {
      await notifyAgents({
        type: 'MARKETPLACE_PRODUCT_PUBLISHED',
        title: 'Nouvel article disponible',
        body: `${product.title} est disponible dans la boutique des agents.`,
        link: '/marketplace',
      })
    }
    response.status(201).json({ data: serializedProduct(product) })
  } catch (error) {
    if (image) await removeProductImage(image.url)
    throw error
  }
}

export async function updateAdminMarketplaceProduct(request: AuthRequest, response: Response) {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) {
    response.status(400).json({ error: 'Identifiant de produit invalide.' })
    return
  }
  const input = parseProductBody(request, response)
  if (!input) return
  const existing = await prisma.marketplaceProduct.findUnique({
    where: { id },
    include: { variants: { select: { id: true, label: true } } },
  })
  if (!existing) {
    response.status(404).json({ error: 'Article introuvable.' })
    return
  }
  const existingVariantIds = new Set(existing.variants.map(({ id: variantId }) => variantId))
  if (input.variants.some(({ id: variantId }) => variantId !== undefined && !existingVariantIds.has(variantId))) {
    response.status(400).json({ error: 'Une déclinaison sélectionnée ne correspond pas à cet article.' })
    return
  }
  const submittedVariantIds = new Set(input.variants.flatMap(({ id: variantId }) => variantId === undefined ? [] : [variantId]))
  if (input.variants.some((variant) => variant.id !== undefined && existing.variants.some((current) =>
    current.id !== variant.id && !submittedVariantIds.has(current.id) && current.label.toLocaleLowerCase() === variant.label.toLocaleLowerCase(),
  ))) {
    response.status(400).json({ error: 'Le nom d’une déclinaison est déjà utilisé par une autre déclinaison.' })
    return
  }
  const usedVariantIds = new Set(input.variants.flatMap(({ id: variantId }) => variantId === undefined ? [] : [variantId]))
  const variantsToSave = input.variants.map((variant) => {
    if (variant.id !== undefined) return variant
    const reusable = existing.variants.find(({ id: variantId, label }) =>
      !usedVariantIds.has(variantId) && label.toLocaleLowerCase() === variant.label.toLocaleLowerCase(),
    )
    if (!reusable) return variant
    usedVariantIds.add(reusable.id)
    return { ...variant, id: reusable.id }
  })
  const image = request.file ? await saveProductImage(request.file) : null
  if (request.file && !image) {
    response.status(400).json({ error: 'L’image doit être un fichier JPEG, PNG ou WebP valide.' })
    return
  }
  const keepVariantIds = variantsToSave.flatMap(({ id: variantId }) => variantId === undefined ? [] : [variantId])

  try {
    const product = await prisma.$transaction(async (transaction) => {
      const updatedProduct = await transaction.marketplaceProduct.update({
        where: { id },
        data: {
          title: input.title,
          category: input.category,
          description: input.description,
          price: BigInt(input.price),
          status: input.status,
          publishedAt: input.status === 'PUBLIE' ? existing.publishedAt ?? new Date() : null,
          ...(image ? { imageUrl: image.url } : {}),
        },
      })
      for (const variant of variantsToSave) {
        if (variant.id === undefined) {
          await transaction.marketplaceProductVariant.create({
            data: { productId: id, label: variant.label, stock: variant.stock },
          })
        } else {
          await transaction.marketplaceProductVariant.update({
            where: { id: variant.id },
            data: { label: variant.label, stock: variant.stock, isActive: true },
          })
        }
      }
      const removedVariantIds = existing.variants
        .map(({ id: variantId }) => variantId)
        .filter((variantId) => !keepVariantIds.includes(variantId))
      if (removedVariantIds.length) {
        await transaction.marketplaceProductVariant.updateMany({
          where: { id: { in: removedVariantIds } },
          data: { isActive: false },
        })
      }
      return transaction.marketplaceProduct.findUniqueOrThrow({
        where: { id },
        include: { variants: { orderBy: { label: 'asc' } } },
      })
    })
    if (image) await removeProductImage(existing.imageUrl)
    if (product.status === 'PUBLIE' && existing.status !== 'PUBLIE') {
      await notifyAgents({
        type: 'MARKETPLACE_PRODUCT_PUBLISHED',
        title: 'Nouvel article disponible',
        body: `${product.title} est disponible dans la boutique des agents.`,
        link: '/marketplace',
      })
    }
    response.json({ data: serializedProduct(product) })
  } catch (error) {
    if (image) await removeProductImage(image.url)
    throw error
  }
}

export async function listAdminMarketplaceOrders(_request: AuthRequest, response: Response) {
  const orders = await prisma.marketplaceOrder.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      items: { orderBy: { id: 'asc' } },
      agent: { select: { id: true, email: true, agentProfile: { select: { firstName: true, lastName: true, phone: true, city: true } } } },
      paidBy: { select: { id: true, email: true } },
    },
  })
  response.json({ data: orders.map(serializedOrder) })
}

export async function getAdminMarketplacePaymentSettings(_request: AuthRequest, response: Response) {
  const settings = await prisma.marketplacePaymentSettings.findUnique({ where: { id: 1 } })
  response.json({
    data: settings ?? {
      mvolaNumber: null,
      mvolaAccountName: null,
      orangeMoneyNumber: null,
      orangeMoneyName: null,
      airtelMoneyNumber: null,
      airtelMoneyName: null,
      instructions: '',
    },
  })
}

export async function updateAdminMarketplacePaymentSettings(request: AuthRequest, response: Response) {
  const result = paymentSettingsSchema.safeParse(request.body)
  if (!result.success) {
    response.status(400).json({ error: 'Coordonnées de paiement invalides.', details: result.error.flatten() })
    return
  }
  const normalized = {
    ...result.data,
    mvolaNumber: result.data.mvolaNumber || null,
    mvolaAccountName: result.data.mvolaAccountName || null,
    orangeMoneyNumber: result.data.orangeMoneyNumber || null,
    orangeMoneyName: result.data.orangeMoneyName || null,
    airtelMoneyNumber: result.data.airtelMoneyNumber || null,
    airtelMoneyName: result.data.airtelMoneyName || null,
  }
  const settings = await prisma.marketplacePaymentSettings.upsert({
    where: { id: 1 },
    create: { id: 1, ...normalized },
    update: normalized,
  })
  response.json({ data: settings })
}

export async function quoteAdminMarketplaceOrder(request: AuthRequest, response: Response) {
  const id = Number(request.params.id)
  const result = deliveryQuoteSchema.safeParse(request.body)
  if (!Number.isSafeInteger(id) || id < 1 || !result.success) {
    response.status(400).json({ error: 'Identifiant ou frais de remise invalides.' })
    return
  }

  try {
    const order = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.marketplaceOrder.findUnique({ where: { id } })
      if (!existing) throw new MarketplaceOperationError(404, 'Commande introuvable.')
      if (existing.status === 'ANNULEE' || existing.deliveryMethod === 'RECUPERATION') {
        throw new MarketplaceOperationError(409, 'Cette commande ne peut pas recevoir de devis de livraison ou de colis.')
      }
      if (marketplaceOrderCanPayWithoutDeadline(existing.status)) {
        throw new MarketplaceOperationError(409, 'Cette commande a déjà été expédiée. Aucun devis de remise supplémentaire ne peut être demandé.')
      }
      if (existing.paymentStatus !== 'A_CONFIRMER' || existing.totalAmount !== null) {
        throw new MarketplaceOperationError(409, 'Le devis de cette commande est déjà défini ou le paiement est déjà confirmé.')
      }
      const now = new Date()
      if (!existing.quoteExpiresAt || existing.quoteExpiresAt <= now) {
        throw new MarketplaceOperationError(409, 'Le délai pour transmettre le devis est dépassé. La commande va être annulée et son stock libéré.')
      }
      const currentSettings = existing.paymentMethod && existing.paymentMethod !== 'ESPECES'
        ? await transaction.marketplacePaymentSettings.findUnique({ where: { id: 1 } })
        : null
      const destination = existing.paymentMethod && existing.paymentMethod !== 'ESPECES'
        ? paymentDestination(currentSettings, existing.paymentMethod)
        : null
      if (existing.paymentMethod && existing.paymentMethod !== 'ESPECES' && !destination) {
        throw new MarketplaceOperationError(409, 'Le compte de paiement sélectionné n’est plus configuré. Mettez-le à jour avant d’envoyer le devis.')
      }
      const expiresAt = marketplacePaymentExpiry(now)
      const updated = await transaction.marketplaceOrder.updateMany({
        where: {
          id,
          status: existing.status,
          paymentStatus: 'A_CONFIRMER',
          totalAmount: null,
          quoteExpiresAt: { gt: now },
        },
        data: {
          deliveryFee: BigInt(result.data.deliveryFee),
          totalAmount: existing.itemsAmount + BigInt(result.data.deliveryFee),
          quoteExpiresAt: null,
          ...(destination ? {
            paymentAccount: destination.account,
            paymentAccountName: destination.accountName,
            paymentInstructions: destination.instructions,
          } : {}),
          quotedAt: now,
          paymentExpiresAt: expiresAt,
          updatedById: request.user!.id,
        },
      })
      if (updated.count !== 1) throw new MarketplaceOperationError(409, 'La commande a été modifiée entre-temps. Actualisez la page.')
      return transaction.marketplaceOrder.findUniqueOrThrow({
        where: { id },
        include: { items: { orderBy: { id: 'asc' } } },
      })
    })
    await notifyUser(order.agentId, {
      type: 'MARKETPLACE_ORDER_QUOTED',
      title: 'Frais de remise confirmés',
      body: `Le total de la commande #${order.id} est de ${order.totalAmount!.toLocaleString('fr-FR')} Ar. Vous avez 24 heures pour régler.`,
      link: '/marketplace',
    })
    response.json({ data: serializedOrder(order) })
  } catch (error) {
    if (error instanceof MarketplaceOperationError) {
      response.status(error.status).json({ error: error.message })
      return
    }
    throw error
  }
}

export async function submitMarketplacePaymentReference(request: AuthRequest, response: Response) {
  if (!isActiveAgent(request, response)) return
  const id = Number(request.params.id)
  const result = paymentReferenceSchema.safeParse(request.body)
  if (!Number.isSafeInteger(id) || id < 1 || !result.success) {
    response.status(400).json({ error: 'Identifiant ou référence de transaction invalide.' })
    return
  }
  try {
    const order = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.marketplaceOrder.findFirst({
        where: { id, agentId: request.user!.id },
      })
      if (!existing) throw new MarketplaceOperationError(404, 'Commande introuvable.')
      if (existing.status === 'ANNULEE' || existing.paymentStatus !== 'A_CONFIRMER') {
        throw new MarketplaceOperationError(409, 'Cette commande ne peut plus recevoir de référence de paiement.')
      }
      if (existing.paymentMethod === 'ESPECES') {
        throw new MarketplaceOperationError(409, 'Une référence Mobile Money ne peut pas être ajoutée à un paiement en espèces.')
      }
      const selectedMethod = existing.paymentMethod ?? result.data.paymentMethod
      if (!selectedMethod || (existing.paymentMethod && result.data.paymentMethod && existing.paymentMethod !== result.data.paymentMethod)) {
        throw new MarketplaceOperationError(400, 'Choisissez un mode Mobile Money pour transmettre la référence.')
      }
      const noDeadlineLegacyOrder = marketplaceOrderCanPayWithoutDeadline(existing.status) && !existing.paymentExpiresAt
      if (existing.totalAmount === null || (!existing.paymentExpiresAt && !noDeadlineLegacyOrder)) {
        throw new MarketplaceOperationError(409, 'Attendez que l’administration confirme le montant avant de payer.')
      }
      const now = new Date()
      if (existing.paymentExpiresAt && existing.paymentExpiresAt <= now) {
        throw new MarketplaceOperationError(409, 'Le délai de paiement est dépassé. La commande va être annulée et son stock libéré.')
      }
      const destination = existing.paymentMethod === null
        ? paymentDestination(await transaction.marketplacePaymentSettings.findUnique({ where: { id: 1 } }), selectedMethod)
        : null
      if (existing.paymentMethod === null && !destination) {
        throw new MarketplaceOperationError(409, 'Ce mode de paiement n’est pas configuré. Contactez l’administration.')
      }
      const updated = await transaction.marketplaceOrder.updateMany({
        where: {
          id,
          agentId: request.user!.id,
          status: existing.status,
          paymentStatus: 'A_CONFIRMER',
          paymentMethod: existing.paymentMethod,
          ...(existing.paymentExpiresAt ? { paymentExpiresAt: { gt: now } } : {}),
        },
        data: {
          paymentReference: result.data.paymentReference,
          ...(existing.paymentMethod === null ? {
            paymentMethod: selectedMethod,
            paymentAccount: destination?.account ?? null,
            paymentAccountName: destination?.accountName ?? null,
            paymentInstructions: destination?.instructions ?? null,
          } : {}),
        },
      })
      if (updated.count !== 1) throw new MarketplaceOperationError(409, 'La commande a expiré ou a été modifiée. Actualisez la page.')
      return transaction.marketplaceOrder.findUniqueOrThrow({
        where: { id },
        include: { items: { orderBy: { id: 'asc' } } },
      })
    })
    await notifyAdmins({
      type: 'MARKETPLACE_PAYMENT_REFERENCE',
      title: 'Référence de paiement reçue',
      body: `L’agent a transmis la référence pour la commande #${order.id}.`,
      link: '/admin-marketplace',
      actorId: request.user.id,
    })
    response.json({ data: serializedOrder(order) })
  } catch (error) {
    if (error instanceof MarketplaceOperationError) {
      response.status(error.status).json({ error: error.message })
      return
    }
    throw error
  }
}

export async function updateAdminMarketplaceOrderStatus(request: AuthRequest, response: Response) {
  const id = Number(request.params.id)
  const result = orderStatusSchema.safeParse(request.body)
  if (!Number.isSafeInteger(id) || id < 1 || !result.success) {
    response.status(400).json({ error: 'Identifiant ou statut de commande invalide.' })
    return
  }

  try {
    const order = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.marketplaceOrder.findUnique({ where: { id }, include: { items: true } })
      if (!existing) throw new MarketplaceOperationError(404, 'Commande introuvable.')
      if (!canTransitionMarketplaceOrder(existing.status, result.data.status)) {
        throw new MarketplaceOperationError(409, 'Cette transition de commande n’est pas autorisée.')
      }
      if (result.data.status === 'ANNULEE' && existing.paymentStatus === 'PAYE') {
        throw new MarketplaceOperationError(409, 'Une commande déjà payée ne peut pas être annulée ici. Traitez d’abord le remboursement hors plateforme.')
      }
      if (result.data.status !== 'ANNULEE' && (existing.paymentStatus !== 'PAYE' || existing.totalAmount === null)) {
        throw new MarketplaceOperationError(409, 'Confirmez d’abord le devis et le paiement avant de poursuivre cette commande.')
      }
      const updated = await transaction.marketplaceOrder.updateMany({
        where: { id, status: existing.status, paymentStatus: existing.paymentStatus },
        data: { status: result.data.status, updatedById: request.user!.id },
      })
      if (updated.count !== 1) throw new MarketplaceOperationError(409, 'La commande a été modifiée entre-temps. Actualisez la page.')
      if (result.data.status === 'ANNULEE') {
        for (const item of existing.items) {
          if (item.variantId !== null) {
            await transaction.marketplaceProductVariant.updateMany({
              where: { id: item.variantId },
              data: { stock: { increment: item.quantity } },
            })
          }
        }
      }
      return transaction.marketplaceOrder.findUniqueOrThrow({
        where: { id },
        include: { items: { orderBy: { id: 'asc' } } },
      })
    })
    await notifyUser(order.agentId, {
      type: 'MARKETPLACE_ORDER_UPDATED',
      title: 'Mise à jour de votre commande',
      body: `La commande #${order.id} est maintenant au statut ${order.status.toLocaleLowerCase().replaceAll('_', ' ')}.`,
      link: '/marketplace',
    })
    response.json({ data: serializedOrder(order) })
  } catch (error) {
    if (error instanceof MarketplaceOperationError) {
      response.status(error.status).json({ error: error.message })
      return
    }
    throw error
  }
}

export async function confirmAdminMarketplacePayment(request: AuthRequest, response: Response) {
  const id = Number(request.params.id)
  const result = paymentSchema.safeParse(request.body)
  if (!Number.isSafeInteger(id) || id < 1 || !result.success) {
    response.status(400).json({ error: 'Identifiant ou référence de paiement invalide.' })
    return
  }

  try {
    const order = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.marketplaceOrder.findUnique({ where: { id } })
      if (!existing) throw new MarketplaceOperationError(404, 'Commande introuvable.')
      if (existing.status === 'ANNULEE') throw new MarketplaceOperationError(409, 'Une commande annulée ne peut pas être marquée comme payée.')
      const noDeadlineLegacyOrder = marketplaceOrderCanPayWithoutDeadline(existing.status) && !existing.paymentExpiresAt
      if (existing.totalAmount === null || (!existing.paymentExpiresAt && !noDeadlineLegacyOrder)) {
        throw new MarketplaceOperationError(409, 'Le montant total doit être confirmé avant le paiement.')
      }
      const now = new Date()
      if (existing.paymentExpiresAt && existing.paymentExpiresAt <= now) {
        throw new MarketplaceOperationError(409, 'Le délai de paiement est dépassé. La commande va être annulée et son stock libéré.')
      }
      if (existing.paymentMethod !== 'ESPECES' && !existing.paymentReference) {
        throw new MarketplaceOperationError(409, 'L’agent doit d’abord transmettre sa référence de transaction.')
      }
      const updated = await transaction.marketplaceOrder.updateMany({
        where: {
          id,
          status: existing.status,
          paymentStatus: 'A_CONFIRMER',
          ...(existing.paymentExpiresAt ? { paymentExpiresAt: { gt: now } } : {}),
          paymentReference: existing.paymentReference,
        },
        data: {
          paymentStatus: 'PAYE',
          paymentReference: existing.paymentMethod === 'ESPECES'
            ? result.data.paymentNote || 'Espèces au retrait'
            : existing.paymentReference,
          paidById: request.user!.id,
          paidAt: now,
          updatedById: request.user!.id,
        },
      })
      if (updated.count !== 1) throw new MarketplaceOperationError(409, 'Le paiement de cette commande est déjà confirmé. Actualisez la page.')
      return transaction.marketplaceOrder.findUniqueOrThrow({
        where: { id },
        include: { items: { orderBy: { id: 'asc' } } },
      })
    })
    await notifyUser(order.agentId, {
      type: 'MARKETPLACE_PAYMENT_CONFIRMED',
      title: 'Paiement confirmé',
      body: `Le paiement de la commande #${order.id} a été confirmé par l’administration.`,
      link: '/marketplace',
    })
    response.json({ data: serializedOrder(order) })
  } catch (error) {
    if (error instanceof MarketplaceOperationError) {
      response.status(error.status).json({ error: error.message })
      return
    }
    throw error
  }
}
