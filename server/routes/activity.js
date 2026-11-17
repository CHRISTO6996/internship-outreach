import { Router } from 'express';
import { listActivity } from '../lib/activity.js';

export const activityRouter = Router();

activityRouter.get('/', (req, res) => {
  res.json({
    rows: listActivity({
      companyId: req.query.companyId ? Number(req.query.companyId) : null,
      limit: req.query.limit || 100,
      beforeId: req.query.beforeId ? Number(req.query.beforeId) : null,
      level: ['debug', 'info', 'success', 'warn', 'error'].includes(String(req.query.level))
        ? String(req.query.level)
        : null,
      search: typeof req.query.search === 'string' && req.query.search.trim() ? req.query.search.trim().slice(0, 200) : null,
    }),
  });
});
