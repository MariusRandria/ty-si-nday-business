import { Router, type NextFunction, type Response } from 'express'
import multer from 'multer'
import type { AuthRequest } from '../auth/auth.middleware.js'
import { requireAdminTotp } from '../collaboration/admin-totp.js'
import {
  confirmAdminMarketplacePayment,
  createAdminMarketplaceProduct,
  createMarketplaceOrder,
  getAdminMarketplacePaymentSettings,
  listAdminMarketplaceOrders,
  listAdminMarketplaceProducts,
  listAgentMarketplaceOrders,
  listMarketplacePaymentSettings,
  listMarketplaceProducts,
  quoteAdminMarketplaceOrder,
  submitMarketplacePaymentReference,
  updateAdminMarketplaceOrderStatus,
  updateAdminMarketplacePaymentSettings,
  updateAdminMarketplaceProduct,
} from './marketplace.controller.js'

const parseProductUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      callback(new Error('L’image doit être au format JPEG, PNG ou WebP.'))
      return
    }
    callback(null, true)
  },
}).single('image')

function handleProductUpload(request: AuthRequest, response: Response, next: NextFunction) {
  parseProductUpload(request, response, (error: unknown) => {
    if (!error) { next(); return }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({ error: 'L’image ne doit pas dépasser 5 Mo.' })
      return
    }
    response.status(400).json({ error: error instanceof Error ? error.message : 'Impossible de lire l’image envoyée.' })
  })
}

export const marketplaceRouter = Router()
marketplaceRouter.get('/products', listMarketplaceProducts)
marketplaceRouter.get('/payment-settings', listMarketplacePaymentSettings)
marketplaceRouter.get('/orders', listAgentMarketplaceOrders)
marketplaceRouter.post('/orders', createMarketplaceOrder)
marketplaceRouter.patch('/orders/:id/payment-reference', submitMarketplacePaymentReference)

export const adminMarketplaceRouter = Router()
adminMarketplaceRouter.get('/payment-settings', getAdminMarketplacePaymentSettings)
adminMarketplaceRouter.put('/payment-settings', requireAdminTotp, updateAdminMarketplacePaymentSettings)
adminMarketplaceRouter.get('/products', listAdminMarketplaceProducts)
adminMarketplaceRouter.post('/products', handleProductUpload, createAdminMarketplaceProduct)
adminMarketplaceRouter.patch('/products/:id', handleProductUpload, updateAdminMarketplaceProduct)
adminMarketplaceRouter.get('/orders', listAdminMarketplaceOrders)
adminMarketplaceRouter.patch('/orders/:id/quote', requireAdminTotp, quoteAdminMarketplaceOrder)
adminMarketplaceRouter.patch('/orders/:id/status', updateAdminMarketplaceOrderStatus)
adminMarketplaceRouter.patch('/orders/:id/payment', requireAdminTotp, confirmAdminMarketplacePayment)
