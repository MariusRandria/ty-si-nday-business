import { Router } from 'express';
import { listProducts } from './product.controller.js';

export const productRouter = Router();
productRouter.get('/', listProducts);
