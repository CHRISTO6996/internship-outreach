import { Router } from 'express';
import multer from 'multer';
import {
  addManualEmail,
  bulkCreateCompanies,
  companyDetail,
  createCompany,
  deleteEmail,
  deleteCompany,
  getCompany,
  listCompanies,
  setPrimaryEmail,
  updateCompany,
} from '../services/companies.js';
import { createJob, startJob } from '../services/jobs.js';
import { parseCompanyFile, parseGoogleSheet } from '../lib/imports.js';
import {
  bulkCompanySchema,
  createCompanySchema,
  manualEmailSchema,
  parseBody,
  parseQuery,
  updateCompanySchema,
} from '../lib/validate.js';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { all, get, run } from '../db/index.js';
import { nowIso } from '../db/index.js';
import { logActivity } from '../lib/activity.js';
import { verifyEmail } from '../services/verify.js';
import { companyEmails } from '../services/discover.js';

export const companiesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const listQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.string().trim().max(40).optional(),
  verification: z.enum(['verified', 'unverified', 'invalid', 'catch_all', 'unknown']).optional(),
  emailStatus: z.enum(['sent', 'failed', 'not_sent']).optional(),
  hasEmail: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

companiesRouter.get('/', (req, res) => {
  const query = parseQuery(listQuerySchema, req.query);
  const result = listCompanies({
    ...query,
    hasEmail: query.hasEmail === undefined ? undefined : query.hasEmail === 'true',
  });
  res.json(result);
});

companiesRouter.post('/', (req, res) => {
  const body = parseBody(createCompanySchema, req.body);
  const company = createCompany(body);
  res.status(201).json(company);
});

companiesRouter.post('/bulk', (req, res) => {
  const body = parseBody(bulkCompanySchema, req.body);
  res.status(201).json(bulkCreateCompanies(body.companies));
});

companiesRouter.post('/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new ValidationError('Attach a .csv, .txt or .xlsx file');
    let entries;
    try {
      entries = await parseCompanyFile(req.file.buffer, req.file.originalname);
    } catch (error) {
      throw new ValidationError(error.message);
    }
    if (!entries.length) throw new ValidationError('No company names were found in that file');
    if (entries.length > 2000) throw new ValidationError('Files are limited to 2000 company names per import');
    const result = bulkCreateCompanies(entries);
    res.status(201).json({ ...result, parsed: entries.length, filename: req.file.originalname });
  } catch (error) {
    next(error);
  }
});

companiesRouter.post('/import-sheet', async (req, res, next) => {
  try {
    const body = parseBody(z.object({ url: z.string().trim().min(10).max(1000) }), req.body);
    let entries;
    try {
      entries = await parseGoogleSheet(body.url);
    } catch (error) {
      throw new ValidationError(error.message);
    }
    if (!entries.length) throw new ValidationError('No company names were found in that sheet');
    const result = bulkCreateCompanies(entries);
    res.status(201).json({ ...result, parsed: entries.length });
  } catch (error) {
    next(error);
  }
});

companiesRouter.get('/:id', (req, res) => {
  res.json(companyDetail(Number(req.params.id)));
});

companiesRouter.patch('/:id', (req, res) => {
  const body = parseBody(updateCompanySchema, req.body);
  res.json(updateCompany(Number(req.params.id), body));
});

companiesRouter.delete('/:id', (req, res) => {
  res.json(deleteCompany(Number(req.params.id)));
});

companiesRouter.post('/:id/discover', (req, res) => {
  const id = Number(req.params.id);
  getCompany(id);
  const job = createJob({ type: 'discovery', companyIds: [id] });
  res.status(202).json(startJob(job.id));
});

companiesRouter.post('/:id/emails', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = parseBody(manualEmailSchema, req.body);
    const result = await addManualEmail(id, body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

companiesRouter.post('/:id/emails/:emailId/primary', (req, res) => {
  res.json(setPrimaryEmail(Number(req.params.id), Number(req.params.emailId)));
});

companiesRouter.delete('/:id/emails/:emailId', (req, res) => {
  res.json(deleteEmail(Number(req.params.id), Number(req.params.emailId)));
});

companiesRouter.post('/:id/emails/:emailId/verify', async (req, res, next) => {
  try {
    const companyId = Number(req.params.id);
    const email = get('SELECT * FROM company_emails WHERE id = ? AND company_id = ?', Number(req.params.emailId), companyId);
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
    if (result.verification === 'invalid' && email.is_primary) {
      run('UPDATE company_emails SET is_primary = 0 WHERE id = ?', email.id);
      const next = get(
        `SELECT id FROM company_emails WHERE company_id = ? AND verification != 'invalid' AND id != ?
         ORDER BY score DESC LIMIT 1`,
        companyId,
        email.id,
      );
      if (next) {
        run('UPDATE company_emails SET is_primary = 1 WHERE id = ?', next.id);
      } else {
        run(`UPDATE companies SET status = 'email_not_found', updated_at = ? WHERE id = ?`, nowIso(), companyId);
      }
    }
    logActivity({
      companyId,
      level: result.verification === 'invalid' ? 'warn' : 'info',
      action: 'email_reverified',
      message: `${email.email} → ${result.verification} (${result.provider}).`,
      meta: result,
    });
    res.json({ emails: companyEmails(companyId), result });
  } catch (error) {
    next(error);
  }
});
