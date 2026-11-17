import { EventEmitter } from 'node:events';
import { all, get, insert, nowIso, run } from '../db/index.js';
import { logActivity } from '../lib/activity.js';
import { discoverCompany } from './discover.js';

export const bus = new EventEmitter();
bus.setMaxListeners(100);

const runners = new Map();
const ACTIVE_STATUSES = ['queued', 'running', 'pausing', 'paused'];

export function serializeJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    total: row.total,
    processed: row.processed,
    failedCount: row.failed_count,
    currentCompanyId: row.current_company_id,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getJob(jobId) {
  const row = get('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!row) return null;
  const items = all(
    `SELECT ji.id, ji.company_id AS companyId, c.name AS companyName, ji.status, ji.message,
            ji.updated_at AS updatedAt
     FROM job_items ji JOIN companies c ON c.id = ji.company_id
     WHERE ji.job_id = ? ORDER BY ji.id`,
    jobId,
  );
  return { ...serializeJob(row), items };
}

export function listJobs(limit = 20) {
  return all('SELECT * FROM jobs ORDER BY id DESC LIMIT ?', Math.min(Number(limit) || 20, 100)).map(serializeJob);
}

export function activeJob() {
  const row = get(`SELECT * FROM jobs WHERE status IN ('queued','running','pausing','paused') ORDER BY id DESC LIMIT 1`);
  return serializeJob(row);
}

export function createJob({ type = 'discovery', companyIds }) {
  const ids = [...new Set((companyIds || []).map(Number).filter(Boolean))];
  if (!ids.length) throw new Error('Select at least one company');

  const existing = activeJob();
  if (existing) {
    const error = new Error(`Job #${existing.id} is still ${existing.status}. Finish, stop, or resume it first.`);
    error.status = 409;
    throw error;
  }

  const known = new Set(
    all(`SELECT id FROM companies WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids).map((row) => row.id),
  );
  const validIds = ids.filter((id) => known.has(id));
  if (!validIds.length) throw new Error('None of the selected companies exist');

  const jobId = insert(
    'INSERT INTO jobs (type, status, total, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    type,
    'queued',
    validIds.length,
    nowIso(),
    nowIso(),
  );
  for (const companyId of validIds) {
    insert(
      'INSERT INTO job_items (job_id, company_id, status, updated_at) VALUES (?, ?, ?, ?)',
      jobId,
      companyId,
      'queued',
      nowIso(),
    );
  }
  logActivity({
    action: 'job_created',
    message: `Queued ${validIds.length} company(ies) for ${type}.`,
    meta: { jobId, companyIds: validIds },
  });
  return getJob(jobId);
}

function emitJob(jobId) {
  const job = getJob(jobId);
  bus.emit('job', job);
  return job;
}

function updateJob(jobId, patch) {
  const fields = Object.keys(patch);
  if (!fields.length) return;
  run(
    `UPDATE jobs SET ${fields.map((field) => `${field} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    ...fields.map((field) => patch[field]),
    nowIso(),
    jobId,
  );
}

export function startJob(jobId) {
  const job = get('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) throw new Error('Job not found');
  if (runners.has(jobId)) return getJob(jobId);
  if (!['queued', 'paused', 'stopped'].includes(job.status)) return getJob(jobId);

  const control = { paused: false, stopped: false, abort: new AbortController() };
  runners.set(jobId, control);
  updateJob(jobId, { status: 'running', started_at: job.started_at || nowIso(), error: null });
  emitJob(jobId);

  void runLoop(jobId, control).catch((error) => {
    updateJob(jobId, { status: 'failed', error: error.message, finished_at: nowIso() });
    logActivity({ action: 'job_failed', message: `Job #${jobId} failed: ${error.message}`, level: 'error', meta: { jobId } });
    emitJob(jobId);
  });

  return getJob(jobId);
}

async function runLoop(jobId, control) {
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (control.stopped) {
        finalize(jobId, 'stopped');
        return;
      }
      if (control.paused) {
        updateJob(jobId, { status: 'paused' });
        emitJob(jobId);
        return;
      }

      const next = get(
        `SELECT * FROM job_items WHERE job_id = ? AND status = 'queued' ORDER BY id LIMIT 1`,
        jobId,
      );
      if (!next) {
        const remaining = get(
          `SELECT COUNT(*) AS count FROM job_items WHERE job_id = ? AND status IN ('queued','running')`,
          jobId,
        );
        finalize(jobId, remaining?.count ? 'stopped' : 'completed');
        return;
      }

      run(`UPDATE job_items SET status = 'running', updated_at = ? WHERE id = ?`, nowIso(), next.id);
      updateJob(jobId, { current_company_id: next.company_id });
      emitJob(jobId);

      try {
        await discoverCompany(next.company_id, { signal: control.abort.signal });
        run(
          `UPDATE job_items SET status = 'done', message = 'Discovery complete', updated_at = ? WHERE id = ?`,
          nowIso(),
          next.id,
        );
      } catch (error) {
        if (error.name === 'CancelledError' || control.stopped) {
          run(
            `UPDATE job_items SET status = 'queued', message = 'Stopped by user', updated_at = ? WHERE id = ?`,
            nowIso(),
            next.id,
          );
          finalize(jobId, 'stopped');
          return;
        }
        run(
          `UPDATE job_items SET status = 'failed', message = ?, updated_at = ? WHERE id = ?`,
          String(error.message).slice(0, 500),
          nowIso(),
          next.id,
        );
        const jobRow = get('SELECT failed_count FROM jobs WHERE id = ?', jobId);
        updateJob(jobId, { failed_count: (jobRow?.failed_count || 0) + 1 });
      }

      run(`UPDATE jobs SET processed = processed + 1, current_company_id = NULL, updated_at = ? WHERE id = ?`, nowIso(), jobId);
      emitJob(jobId);
      if (control.stopped) {
        finalize(jobId, 'stopped');
        return;
      }
    }
  } finally {
    runners.delete(jobId);
  }
}

function finalize(jobId, status) {
  const pending = get(`SELECT COUNT(*) AS count FROM job_items WHERE job_id = ? AND status = 'running'`, jobId);
  if (pending?.count) {
    run(`UPDATE job_items SET status = 'queued', updated_at = ? WHERE job_id = ? AND status = 'running'`, nowIso(), jobId);
  }
  if (status !== 'completed') {
    run(`UPDATE job_items SET status = 'skipped', updated_at = ? WHERE job_id = ? AND status = 'queued'`, nowIso(), jobId);
  }
  updateJob(jobId, {
    status,
    finished_at: status === 'completed' || status === 'stopped' ? nowIso() : null,
    current_company_id: null,
  });
  const job = emitJob(jobId);
  logActivity({
    action: `job_${status}`,
    message:
      status === 'completed'
        ? `Job #${jobId} completed (${job.processed}/${job.total} processed, ${job.failedCount} failed).`
        : `Job #${jobId} ${status}.`,
    level: status === 'completed' ? 'success' : 'warn',
    meta: { jobId },
  });
}

export function pauseJob(jobId) {
  const control = runners.get(jobId);
  const job = get('SELECT status FROM jobs WHERE id = ?', jobId);
  if (!job) throw new Error('Job not found');
  if (!control) {
    if (job.status === 'paused') return getJob(jobId);
    throw new Error('This job is not running');
  }
  control.paused = true;
  updateJob(jobId, { status: 'pausing' });
  logActivity({ action: 'job_pausing', message: `Job #${jobId} will pause after the current company.`, meta: { jobId } });
  return emitJob(jobId);
}

export function resumeJob(jobId) {
  const job = get('SELECT status FROM jobs WHERE id = ?', jobId);
  if (!job) throw new Error('Job not found');
  if (!['paused', 'pausing'].includes(job.status)) throw new Error('This job is not paused');
  const control = runners.get(jobId);
  if (control) {
    control.paused = false;
    updateJob(jobId, { status: 'running' });
    return emitJob(jobId);
  }
  return startJob(jobId);
}

export function stopJob(jobId) {
  const job = get('SELECT status FROM jobs WHERE id = ?', jobId);
  if (!job) throw new Error('Job not found');
  if (!ACTIVE_STATUSES.includes(job.status)) return getJob(jobId);
  const control = runners.get(jobId);
  if (control) {
    control.stopped = true;
    control.abort.abort();
    updateJob(jobId, { status: job.status === 'paused' ? 'paused' : 'running' });
  } else {
    finalize(jobId, 'stopped');
  }
  logActivity({ action: 'job_stopping', message: `Stop requested for job #${jobId}.`, level: 'warn', meta: { jobId } });
  return emitJob(jobId);
}

/** Called on boot: no job can survive a restart, so mark stale rows honestly. */
export function recoverJobs() {
  const stale = all(`SELECT id FROM jobs WHERE status IN ('running','pausing','paused','queued')`);
  for (const row of stale) {
    run(`UPDATE job_items SET status = 'skipped' WHERE job_id = ? AND status IN ('queued','running')`, row.id);
    updateJob(row.id, {
      status: 'stopped',
      error: 'Server restarted while this job was active.',
      finished_at: nowIso(),
      current_company_id: null,
    });
  }
  if (stale.length) {
    logActivity({
      action: 'jobs_recovered',
      message: `Marked ${stale.length} interrupted job(s) as stopped after restart.`,
      level: 'warn',
    });
  }
}
