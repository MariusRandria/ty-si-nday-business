import { Router } from 'express';
import { getAgentStats } from './stats.controller.js';

export const statsRouter = Router();
statsRouter.get('/agent', getAgentStats);
