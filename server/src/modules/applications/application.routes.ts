import { Router } from 'express';
import { createApplication } from './application.controller.js';

export const applicationRouter = Router();
applicationRouter.post('/', createApplication);
