import { Router } from 'express';
import { z } from 'zod';
import { parseQuery } from '../lib/validate.js';
import { all, get } from '../db/index.js';
import { verifyEmail } from '../services/verify.js';
import { NotFoundError } from '../lib/errors.js';
import { nowIso, run } from '../db/index.js';
import { logActivity } from '../lib/activity.js';

export const emailsRouter = Router();

const querySchema = z.object({
  verification: z.enum(['verified', 'unverified', 'invalid', 'catch_all', 'unknown']).optional(),
  category: z.enum(['hr', 'recruitment', 'careers', 'internship', 'general', 'other']).optional(),
  search: z.string().trim().max(200).optional(),
  companyId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

emailsRouter.get('/', (req, res) => {
  const query = parseQuery(querySchema, req.query);
  const clauses = [];
  const params = [];
  if (query.verification) {
    clauses.push('e.verification = ?');
    params.push(query.verification);
  }
  if (query.category) {
    clauses.push('e.category = ?');
    params.push(query.category);
  }
  if (query.companyId) {
    clauses.push('e.company_id = ?');
    params.push(query.companyId);
  }
  if (query.search) {
    clauses.push('(e.email LIKE ? OR c.name LIKE ? OR c.domain LIKE ?)');
    const term = `%${query.search}%`;
    params.push(term, term, term);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(query.limit || 100, 500);
  const offset = query.offset || 0;
  const rows = all(
    `SELECT e.id, e.company_id AS companyId, c.name AS companyName, c.website,
            e.email, e.source_url AS sourceUrl, e.source_type AS sourceType, e.category,
            e.verification, e.verification_provider AS verificationProvider,
            e.verification_detail AS verificationDetail, e.mx_valid AS mxValid,
            e.score, e.is_primary AS isPrimary, e.updated_at AS updatedAt
     FROM company_emails e JOIN companies c ON c.id = e.company_id
     ${where} ORDER BY e.is_primary DESC, e.score DESC, e.id DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  const total = get(
    `SELECT COUNT(*) AS count FROM company_emails e JOIN companies c ON c.id = e.company_id ${where}`,
    ...params,
  );
  res.json({
    rows: rows.map((row) => ({ ...row, mxValid: row.mxValid === null ? null : Boolean(row.mxValid), isPrimary: Boolean(row.isPrimary) })),
    total: total?.count || 0,
  });
});

emailsRouter.post('/:id/verify', async (req, res, next) => {
  try {
    const email = get('SELECT * FROM company_emails WHERE id = ?', Number(req.params.id));
    if (!email) throw new NotFoundError('Email not found');
    const result = await verifyEmail(email.email);
    run(
      `UPDATE company_emails SET verification = ?, verification_provider = ?, verification_detail = ?,
        mx_valid = ?, updated_at = ? WHERE id = ?`,
      result.verification,
      result.provider,
      result.detail,
      result.mxValid === null ? null : result.mxValid ? 1 : 0,
      nowIso(),
      email.id,
    );
    logActivity({
      companyId: email.company_id,
      level: result.verification === 'invalid' ? 'warn' : 'info',
      action: 'email_reverified',
      message: `${email.email} → ${result.verification} (${result.provider}).`,
      meta: result,
    });
    res.json({ id: email.id, verification: result.verification, ...result });
  } catch (error) {
    next(error);
  }
});
