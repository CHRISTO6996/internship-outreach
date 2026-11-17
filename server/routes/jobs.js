import { Router } from 'express';
import { z } from 'zod';
import { parseBody } from '../lib/validate.js';
import {
  activeJob,
  createJob,
  getJob,
  listJobs,
  pauseJob,
  resumeJob,
  startJob,
  stopJob,
  bus,
} from '../services/jobs.js';
import { NotFoundError } from '../lib/errors.js';

export const jobsRouter = Router();

jobsRouter.get('/', (req, res) => {
  res.json({ jobs: listJobs(req.query.limit || 20), active: activeJob() });
});

jobsRouter.post('/', (req, res) => {
  const body = parseBody(
    z.object({
      companyIds: z.array(z.coerce.number().int().positive()).min(1).max(500),
      autoStart: z.boolean().optional().default(true),
    }),
    req.body,
  );
  const job = createJob({ type: 'discovery', companyIds: body.companyIds });
  res.status(202).json(body.autoStart ? startJob(job.id) : job);
});

jobsRouter.get('/:id', (req, res) => {
  const job = getJob(Number(req.params.id));
  if (!job) throw new NotFoundError('Job not found');
  res.json(job);
});

jobsRouter.post('/:id/start', (req, res) => {
  res.json(startJob(Number(req.params.id)));
});

jobsRouter.post('/:id/pause', (req, res) => {
  res.json(pauseJob(Number(req.params.id)));
});

jobsRouter.post('/:id/resume', (req, res) => {
  res.json(resumeJob(Number(req.params.id)));
});

jobsRouter.post('/:id/stop', (req, res) => {
  res.json(stopJob(Number(req.params.id)));
});

jobsRouter.get('/:id/stream', (req, res) => {
  const jobId = Number(req.params.id);
  const job = getJob(jobId);
  if (!job) throw new NotFoundError('Job not found');

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  send({ type: 'snapshot', job });

  const listener = (updated) => {
    if (!updated || updated.id !== jobId) return;
    send({ type: 'job', job: updated });
    if (['completed', 'stopped', 'failed'].includes(updated.status)) {
      send({ type: 'done', job: updated });
    }
  };
  bus.on('job', listener);

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off('job', listener);
  });
});
