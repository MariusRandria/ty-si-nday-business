import { Router } from 'express';
import { createReport, listReports } from './report.controller.js';

export const reportRouter = Router();
reportRouter.get('/', listReports);
reportRouter.post('/', createReport);
