import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { parseBody } from '../lib/validate.js';
import { getSettings, saveSettings } from '../lib/settings.js';
import { resumeDir } from '../config.js';
import { ValidationError } from '../lib/errors.js';
import { logActivity } from '../lib/activity.js';

export const settingsRouter = Router();

const profileSchema = z
  .object({
    fullName: z.string().trim().max(120),
    college: z.string().trim().max(200),
    branch: z.string().trim().max(120),
    phone: z.string().trim().max(60),
    contactEmail: z.string().trim().max(200),
    portfolioUrl: z.string().trim().max(300),
    linkedinUrl: z.string().trim().max(300),
  })
  .partial();

const sendingSchema = z
  .object({
    requireApproval: z.boolean(),
    dailyLimit: z.coerce.number().int().min(1).max(200),
    minDelaySeconds: z.coerce.number().int().min(5).max(3600),
    maxDelaySeconds: z.coerce.number().int().min(5).max(7200),
    sendWindowStart: z.string().regex(/^\d{2}:\d{2}$/),
    sendWindowEnd: z.string().regex(/^\d{2}:\d{2}$/),
    weekdaysOnly: z.boolean(),
  })
  .partial();

const followUpSchema = z
  .object({
    enabled: z.boolean(),
    days: z.coerce.number().int().min(1).max(60),
    maxFollowUps: z.coerce.number().int().min(1).max(3),
    requireApproval: z.boolean(),
  })
  .partial();

const discoverySchema = z
  .object({
    maxPages: z.coerce.number().int().min(1).max(40),
    useHunter: z.boolean(),
    verifyTopCandidates: z.coerce.number().int().min(1).max(10),
  })
  .partial();

const templateSchema = z
  .object({
    subject: z.string().trim().min(3).max(300),
    body: z.string().trim().min(20).max(20000),
    followUpSubject: z.string().trim().min(3).max(300),
    followUpBody: z.string().trim().min(20).max(20000),
  })
  .partial();

const sheetsSchema = z
  .object({
    spreadsheetId: z.string().trim().max(200).nullable(),
    lastSyncedAt: z.string().max(60).nullable(),
    lastError: z.string().max(2000).nullable(),
  })
  .partial();

const patchSchema = z
  .object({
    profile: profileSchema.optional(),
    sending: sendingSchema.optional(),
    followUp: followUpSchema.optional(),
    discovery: discoverySchema.optional(),
    template: templateSchema.optional(),
    sheets: sheetsSchema.optional(),
  })
  .partial();

settingsRouter.get('/', (req, res) => {
  res.json(getSettings());
});

settingsRouter.put('/', (req, res) => {
  const patch = parseBody(patchSchema, req.body);
  if (patch.sending && patch.sending.minDelaySeconds != null && patch.sending.maxDelaySeconds != null) {
    if (patch.sending.minDelaySeconds > patch.sending.maxDelaySeconds) {
      throw new ValidationError('Minimum delay cannot be greater than maximum delay');
    }
  }
  const settings = saveSettings(patch);
  logActivity({ action: 'settings_updated', message: `Updated settings: ${Object.keys(patch).join(', ')}.` });
  res.json(settings);
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

settingsRouter.post('/resume', upload.single('resume'), (req, res) => {
  if (!req.file) throw new ValidationError('Attach a PDF resume');
  const isPdf = req.file.buffer.subarray(0, 4).toString('ascii') === '%PDF';
  if (!isPdf) throw new ValidationError('Resume must be a PDF file');
  const target = path.join(resumeDir, 'resume.pdf');
  fs.writeFileSync(target, req.file.buffer);
  const settings = saveSettings({
    profile: {
      resumeFileName: 'resume.pdf',
      resumeOriginalName: req.file.originalname,
      resumeUploadedAt: new Date().toISOString(),
    },
  });
  logActivity({
    action: 'resume_uploaded',
    message: `Resume uploaded (${req.file.originalname}, ${Math.round(req.file.size / 1024)} KB).`,
  });
  res.json({ profile: settings.profile, size: req.file.size });
});

settingsRouter.get('/resume', (req, res) => {
  const settings = getSettings();
  if (!settings.profile.resumeFileName) throw new ValidationError('No resume uploaded yet');
  const file = path.join(resumeDir, settings.profile.resumeFileName);
  if (!fs.existsSync(file)) throw new ValidationError('Resume file is missing on disk. Upload it again.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${settings.profile.resumeOriginalName || 'resume.pdf'}"`,
  );
  fs.createReadStream(file).pipe(res);
});

settingsRouter.delete('/resume', (req, res) => {
  const settings = getSettings();
  if (settings.profile.resumeFileName) {
    const file = path.join(resumeDir, settings.profile.resumeFileName);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  const next = saveSettings({
    profile: { resumeFileName: null, resumeOriginalName: null, resumeUploadedAt: null },
  });
  logActivity({ action: 'resume_removed', message: 'Resume removed.', level: 'warn' });
  res.json({ profile: next.profile });
});
