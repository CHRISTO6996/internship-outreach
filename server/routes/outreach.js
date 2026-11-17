import { Router } from 'express';
import { z } from 'zod';
import { parseBody, parseQuery } from '../lib/validate.js';
import {
  approveSends,
  cancelSend,
  getSend,
  listCandidates,
  listFollowUps,
  listReplies,
  listSends,
  pauseSendQueue,
  pollReplies,
  prepareFollowUps,
  prepareSends,
  previewForCompany,
  resumeSendQueue,
  retrySend,
  sendBus,
  startSendQueue,
  statusSnapshot,
  stopSendQueue,
  updateFollowUp,
  updateReply,
} from '../services/outreach.js';
import { syncSheet } from '../services/sheets.js';

export const outreachRouter = Router();

outreachRouter.get('/status', (req, res) => {
  res.json(statusSnapshot());
});

outreachRouter.get('/candidates', (req, res) => {
  res.json(listCandidates());
});

outreachRouter.get('/preview/:companyId', (req, res) => {
  const kind = req.query.kind === 'follow_up' ? 'follow_up' : 'initial';
  res.json(previewForCompany(Number(req.params.companyId), kind));
});

const sendsQuery = z.object({
  status: z.enum(['awaiting_approval', 'queued', 'sending', 'sent', 'failed', 'cancelled', 'skipped']).optional(),
  kind: z.enum(['initial', 'follow_up']).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

outreachRouter.get('/sends', (req, res) => {
  res.json(listSends(parseQuery(sendsQuery, req.query)));
});

outreachRouter.get('/sends/:id', (req, res) => {
  res.json(getSend(Number(req.params.id)));
});

outreachRouter.post('/prepare', (req, res) => {
  const body = parseBody(
    z.object({
      companyIds: z.array(z.coerce.number().int().positive()).min(1).max(500),
      kind: z.enum(['initial', 'follow_up']).optional().default('initial'),
    }),
    req.body,
  );
  res.status(201).json(prepareSends(body));
});

outreachRouter.post('/approve', (req, res) => {
  const body = parseBody(
    z.object({
      sendIds: z.array(z.coerce.number().int().positive()).max(500).optional(),
      all: z.boolean().optional().default(false),
    }),
    req.body,
  );
  res.json(approveSends(body));
});

outreachRouter.post('/sends/:id/cancel', (req, res) => {
  res.json(cancelSend(Number(req.params.id)));
});

outreachRouter.post('/sends/:id/retry', (req, res) => {
  res.json(retrySend(Number(req.params.id)));
});

outreachRouter.post('/start', (req, res, next) => {
  startSendQueue().then((status) => res.json(status)).catch(next);
});

outreachRouter.post('/pause', (req, res) => {
  res.json(pauseSendQueue());
});

outreachRouter.post('/resume', (req, res, next) => {
  Promise.resolve(resumeSendQueue()).then((status) => res.json(status)).catch(next);
});

outreachRouter.post('/stop', (req, res) => {
  res.json(stopSendQueue());
});

outreachRouter.get('/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ type: 'snapshot', status: statusSnapshot() });
  const listener = (status) => send({ type: 'status', status });
  sendBus.on('status', listener);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    sendBus.off('status', listener);
  });
});

outreachRouter.post('/sync-replies', (req, res, next) => {
  pollReplies().then((result) => res.json(result)).catch(next);
});

const repliesQuery = z.object({
  classification: z.enum(['positive', 'opportunity', 'resume_requested', 'interview', 'rejection', 'other']).optional(),
  unread: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

outreachRouter.get('/replies', (req, res) => {
  const query = parseQuery(repliesQuery, req.query);
  res.json(listReplies({ ...query, unread: query.unread === 'true' }));
});

outreachRouter.patch('/replies/:id', (req, res) => {
  const body = parseBody(
    z.object({
      isRead: z.boolean().optional(),
      classification: z
        .enum(['positive', 'opportunity', 'resume_requested', 'interview', 'rejection', 'other'])
        .optional(),
    }),
    req.body,
  );
  res.json(updateReply(Number(req.params.id), body));
});

outreachRouter.get('/follow-ups', (req, res) => {
  res.json(listFollowUps());
});

outreachRouter.post('/follow-ups/prepare', (req, res) => {
  const body = parseBody(
    z.object({ ids: z.array(z.coerce.number().int().positive()).max(500).optional() }),
    req.body,
  );
  res.status(201).json(prepareFollowUps(body.ids || null));
});

outreachRouter.patch('/follow-ups/:id', (req, res) => {
  const body = parseBody(z.object({ status: z.enum(['pending', 'skipped', 'cancelled']) }), req.body);
  res.json(updateFollowUp(Number(req.params.id), body.status));
});

outreachRouter.post('/sheets/sync', (req, res, next) => {
  syncSheet().then((result) => res.json(result)).catch(next);
});
