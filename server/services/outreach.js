import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, insert, nowIso, run } from '../db/index.js';
import { getSettings } from '../lib/settings.js';
import { renderTemplate } from '../lib/template.js';
import { logActivity } from '../lib/activity.js';
import { IntegrationError, NotFoundError, ValidationError } from '../lib/errors.js';
import { sending as sendingConfig, resumeDir } from '../config.js';
import {
  defaultAccount,
  fetchInboxMessages,
  getMessageMeta,
  googleOAuthReady,
  mailboxAddress,
  sendGmail,
} from './google.js';
import { maybeSyncSheet, sheetStatus } from './sheets.js';

export const sendBus = new EventEmitter();
sendBus.setMaxListeners(50);

const ACTIVE_SEND_STATUSES = ['awaiting_approval', 'queued', 'sending'];

const queue = {
  running: false,
  paused: false,
  stopRequested: false,
  startedAt: null,
  currentSendId: null,
  reason: null,
  sentThisRun: 0,
  failedThisRun: 0,
  wake: null,
};

function emitStatus() {
  try {
    sendBus.emit('status', statusSnapshot());
  } catch {
    /* listeners must not break the queue */
  }
}

function googleAccount() {
  return defaultAccount();
}

function connected() {
  return googleOAuthReady() && Boolean(googleAccount());
}

function effectiveLimit(settings) {
  return Math.min(Number(settings.sending.dailyLimit) || 0, sendingConfig.absoluteDailyLimit);
}

function sentToday() {
  const row = get(
    `SELECT COUNT(*) AS count FROM sends WHERE status = 'sent' AND sent_at IS NOT NULL AND date(sent_at) = date('now')`,
  );
  return row?.count || 0;
}

function minutesFromTime(value, fallback) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function windowState(settings = getSettings()) {
  const now = new Date();
  const day = now.getDay();
  if (settings.sending.weekdaysOnly && (day === 0 || day === 6)) {
    return { open: false, reason: 'Weekend: sending is limited to Monday–Friday.' };
  }
  const start = minutesFromTime(settings.sending.sendWindowStart, 9 * 60);
  const end = minutesFromTime(settings.sending.sendWindowEnd, 18 * 60);
  const current = now.getHours() * 60 + now.getMinutes();
  const open = start <= end ? current >= start && current < end : current >= start || current < end;
  return {
    open,
    reason: open
      ? null
      : `Outside the sending window (${settings.sending.sendWindowStart}–${settings.sending.sendWindowEnd}).`,
  };
}

export function firstBatchRequiresApproval(settings = getSettings()) {
  if (!settings.sending.requireApproval) return false;
  const row = get(`SELECT COUNT(*) AS count FROM sends WHERE approved_at IS NOT NULL`);
  return (row?.count || 0) === 0;
}

function valuesForCompany(company) {
  const settings = getSettings();
  const profile = settings.profile;
  return {
    companyName: company.name || '',
    website: company.website || '',
    domain: company.domain || '',
    fullName: profile.fullName || '',
    college: profile.college || '',
    branch: profile.branch || '',
    phone: profile.phone || '',
    // Fall back to the connected Gmail address so every signature has a real
    // reply-to address even before the profile form is filled in.
    contactEmail: profile.contactEmail || googleAccount()?.email || '',
    portfolioUrl: profile.portfolioUrl || '',
    linkedinUrl: profile.linkedinUrl || '',
  };
}

const CANDIDATE_SQL = `
  SELECT c.id, c.name, c.website, c.domain, c.status,
         e.id AS emailId, e.email, e.verification, e.verification_provider AS verificationProvider,
         e.source_url AS sourceUrl, e.category,
         (SELECT s.status FROM sends s WHERE s.company_id = c.id AND s.kind = 'initial' ORDER BY s.id DESC LIMIT 1) AS lastSendStatus,
         (SELECT s.sent_at FROM sends s WHERE s.company_id = c.id AND s.kind = 'initial' AND s.status = 'sent' ORDER BY s.id DESC LIMIT 1) AS lastSentAt,
         (SELECT COUNT(*) FROM replies r WHERE r.company_id = c.id) AS replyCount,
         (SELECT COUNT(*) FROM sends s WHERE s.company_id = c.id AND s.status = 'sent') AS sentCount
  FROM companies c
  LEFT JOIN company_emails e ON e.company_id = c.id AND e.is_primary = 1
`;

function candidateReason(row) {
  if (!row.email) return 'No primary email address';
  if (row.verification === 'invalid') return 'Primary address is invalid';
  if (row.replyCount > 0) return 'Already replied — no new request needed';
  if (row.sentCount > 0 && row.lastSendStatus !== 'failed') return 'Initial request already sent';
  if (ACTIVE_SEND_STATUSES.includes(row.lastSendStatus)) return 'Already queued for sending';
  return null;
}

export function listCandidates() {
  const rows = all(`${CANDIDATE_SQL} ORDER BY c.id DESC`);
  const candidates = rows.map((row) => ({
    id: row.id,
    name: row.name,
    website: row.website,
    domain: row.domain,
    emailId: row.emailId,
    email: row.email,
    verification: row.verification,
    verificationProvider: row.verificationProvider,
    sourceUrl: row.sourceUrl,
    category: row.category,
    lastSendStatus: row.lastSendStatus,
    lastSentAt: row.lastSentAt,
    replyCount: row.replyCount || 0,
    ineligibleReason: candidateReason(row),
  }));
  return {
    rows: candidates.filter((row) => !row.ineligibleReason),
    excluded: candidates.filter((row) => row.ineligibleReason),
    total: candidates.length,
  };
}

export function previewForCompany(companyId, kind = 'initial') {
  const company = get(`${CANDIDATE_SQL} WHERE c.id = ?`, companyId);
  if (!company) throw new NotFoundError('Company not found');
  const settings = getSettings();
  const values = valuesForCompany(company);
  const subject = renderTemplate(
    kind === 'follow_up' ? settings.template.followUpSubject : settings.template.subject,
    values,
  );
  const body = renderTemplate(
    kind === 'follow_up' ? settings.template.followUpBody : settings.template.body,
    values,
  );
  return {
    companyId,
    companyName: company.name,
    toEmail: company.email,
    subject,
    body,
    attachment: settings.profile.resumeOriginalName || settings.profile.resumeFileName || null,
  };
}

function readinessForSending() {
  if (!googleOAuthReady()) {
    throw new IntegrationError('Google OAuth is not configured.', {
      integration: 'gmail',
      env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    });
  }
  if (!googleAccount()) {
    throw new IntegrationError('Connect your Gmail account on the Integrations page before preparing emails.', {
      integration: 'gmail',
    });
  }
  const settings = getSettings();
  const missing = [];
  if (!settings.profile.fullName) missing.push('full name');
  if (!settings.profile.college) missing.push('college');
  if (!settings.profile.branch) missing.push('branch');
  if (missing.length) {
    throw new ValidationError(`Complete your profile first: ${missing.join(', ')}. Open Settings → Profile.`);
  }
  if (!settings.profile.resumeFileName) {
    throw new ValidationError('Upload your PDF resume in Settings before preparing emails.');
  }
  const resumePath = path.join(resumeDir, settings.profile.resumeFileName);
  if (!fs.existsSync(resumePath)) {
    throw new ValidationError('The resume file is missing on disk. Upload it again in Settings.');
  }
  return settings;
}

function resumeAttachment(settings) {
  const resumePath = path.join(resumeDir, settings.profile.resumeFileName);
  if (!fs.existsSync(resumePath)) {
    throw new ValidationError('The resume file is missing on disk. Upload it again in Settings.');
  }
  return {
    filename: 'resume.pdf',
    contentType: 'application/pdf',
    content: fs.readFileSync(resumePath),
  };
}

function logSend(companyId, level, action, message, meta = null) {
  logActivity({ companyId, level, action, message, meta });
}

export function prepareSends({ companyIds, kind = 'initial' }) {
  if (!['initial', 'follow_up'].includes(kind)) throw new ValidationError('Unknown email kind');
  const ids = [...new Set((companyIds || []).map(Number).filter(Boolean))];
  if (!ids.length) throw new ValidationError('Select at least one company');

  const settings = readinessForSending();
  const needsApproval =
    kind === 'follow_up' ? settings.followUp.requireApproval : firstBatchRequiresApproval(settings);
  const created = [];
  const skipped = [];

  for (const companyId of ids) {
    const company = get(`${CANDIDATE_SQL} WHERE c.id = ?`, companyId);
    if (!company) {
      skipped.push({ companyId, name: `#${companyId}`, reason: 'Company not found' });
      continue;
    }
    const reason = candidateReason(company);
    if (kind === 'initial' && reason) {
      skipped.push({ companyId, name: company.name, reason });
      continue;
    }
    if (kind === 'follow_up') {
      if (!company.email) {
        skipped.push({ companyId, name: company.name, reason: 'No primary email address' });
        continue;
      }
      if (company.verification === 'invalid') {
        skipped.push({ companyId, name: company.name, reason: 'Primary address is invalid' });
        continue;
      }
      if (company.replyCount > 0) {
        skipped.push({ companyId, name: company.name, reason: 'Already replied — no follow-up needed' });
        continue;
      }
      const parent = get(
        `SELECT * FROM sends WHERE company_id = ? AND kind = 'initial' AND status = 'sent' ORDER BY id DESC LIMIT 1`,
        companyId,
      );
      if (!parent) {
        skipped.push({ companyId, name: company.name, reason: 'No sent initial email to follow up on' });
        continue;
      }
      const existingFollowUp = get(
        `SELECT * FROM follow_ups WHERE company_id = ? AND status IN ('pending','queued') ORDER BY id LIMIT 1`,
        companyId,
      );
      if (!existingFollowUp) {
        skipped.push({ companyId, name: company.name, reason: 'No follow-up is scheduled' });
        continue;
      }
      const pendingSend = get(
        `SELECT id FROM sends WHERE company_id = ? AND kind = 'follow_up' AND status IN ('awaiting_approval','queued','sending')`,
        companyId,
      );
      if (pendingSend) {
        skipped.push({ companyId, name: company.name, reason: 'Follow-up already queued' });
        continue;
      }
    }

    const preview = previewForCompany(companyId, kind);
    const approvalRequired = needsApproval;
    const sendId = insert(
      `INSERT INTO sends
        (company_id, email_id, to_email, subject, body, status, kind, approved_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      companyId,
      company.emailId,
      company.email,
      preview.subject,
      preview.body,
      approvalRequired ? 'awaiting_approval' : 'queued',
      kind,
      approvalRequired ? null : nowIso(),
      nowIso(),
    );
    if (kind === 'follow_up') {
      const followUp = get(
        `SELECT id FROM follow_ups WHERE company_id = ? AND status IN ('pending','queued') ORDER BY id LIMIT 1`,
        companyId,
      );
      if (followUp) run(`UPDATE follow_ups SET status = 'queued' WHERE id = ?`, followUp.id);
    }
    created.push({
      id: sendId,
      companyId,
      companyName: company.name,
      toEmail: company.email,
      subject: preview.subject,
      status: approvalRequired ? 'awaiting_approval' : 'queued',
      kind,
    });
    logSend(
      companyId,
      'info',
      'email_prepared',
      `Prepared ${kind === 'follow_up' ? 'follow-up' : 'internship request'} to ${company.email}${approvalRequired ? ' (awaiting approval)' : ''}.`,
      { sendId },
    );
  }

  emitStatus();
  return { created, skipped, awaitingApproval: created.filter((row) => row.status === 'awaiting_approval').length };
}

export function approveSends({ sendIds = null, all: approveAll = false }) {
  const params = [];
  let where = `status = 'awaiting_approval'`;
  if (!approveAll) {
    const ids = [...new Set((sendIds || []).map(Number).filter(Boolean))];
    if (!ids.length) throw new ValidationError('Select at least one email to approve');
    where += ` AND id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  const rows = all(`SELECT id, company_id FROM sends WHERE ${where}`, ...params);
  for (const row of rows) {
    run(`UPDATE sends SET status = 'queued', approved_at = ? WHERE id = ?`, nowIso(), row.id);
    logSend(row.company_id, 'info', 'email_approved', `Approved email #${row.id} for sending.`, { sendId: row.id });
  }
  emitStatus();
  return { approved: rows.length };
}

export function cancelSend(sendId) {
  const send = get('SELECT * FROM sends WHERE id = ?', sendId);
  if (!send) throw new NotFoundError('Email not found');
  if (!['awaiting_approval', 'queued'].includes(send.status)) {
    throw new ValidationError('Only emails that have not been sent can be cancelled');
  }
  run(`UPDATE sends SET status = 'cancelled', error = 'Cancelled before sending' WHERE id = ?`, sendId);
  if (send.kind === 'follow_up') {
    run(`UPDATE follow_ups SET status = 'pending' WHERE company_id = ? AND status = 'queued'`, send.company_id);
  }
  logSend(send.company_id, 'warn', 'email_cancelled', `Cancelled queued email #${sendId}.`, { sendId });
  emitStatus();
  return getSend(sendId);
}

export function retrySend(sendId) {
  const send = get('SELECT * FROM sends WHERE id = ?', sendId);
  if (!send) throw new NotFoundError('Email not found');
  if (!['failed', 'skipped', 'cancelled'].includes(send.status)) {
    throw new ValidationError('Only failed, skipped or cancelled emails can be retried');
  }
  const candidate = get(`${CANDIDATE_SQL} WHERE c.id = ?`, send.company_id);
  const reason = candidateReason(candidate);
  if (reason && !(send.kind === 'initial' && candidate.lastSendStatus === 'failed')) {
    throw new ValidationError(`Cannot retry: ${reason}`);
  }
  const settings = getSettings();
  const approvalRequired =
    send.kind === 'follow_up' ? settings.followUp.requireApproval : firstBatchRequiresApproval(settings);
  run(
    `UPDATE sends SET status = ?, error = NULL, approved_at = ? WHERE id = ?`,
    approvalRequired ? 'awaiting_approval' : 'queued',
    approvalRequired ? null : nowIso(),
    sendId,
  );
  if (send.kind === 'follow_up') {
    run(`UPDATE follow_ups SET status = 'queued', error = NULL WHERE company_id = ? AND status IN ('failed','pending')`, send.company_id);
  }
  logSend(send.company_id, 'info', 'email_retry_queued', `Re-queued failed email #${sendId}.`, { sendId });
  emitStatus();
  return getSend(sendId);
}

export function getSend(sendId) {
  const row = get(
    `SELECT s.id, s.company_id AS companyId, c.name AS companyName, s.email_id AS emailId,
            s.to_email AS toEmail, s.subject, s.body, s.status, s.kind,
            s.gmail_message_id AS gmailMessageId, s.gmail_thread_id AS gmailThreadId,
            s.error, s.approved_at AS approvedAt, s.sent_at AS sentAt, s.created_at AS createdAt
     FROM sends s JOIN companies c ON c.id = s.company_id WHERE s.id = ?`,
    sendId,
  );
  if (!row) throw new NotFoundError('Email not found');
  return row;
}

export function listSends({ status, kind, search, limit = 100, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push('s.status = ?');
    params.push(status);
  }
  if (kind) {
    clauses.push('s.kind = ?');
    params.push(kind);
  }
  if (search) {
    clauses.push('(c.name LIKE ? OR s.to_email LIKE ? OR s.subject LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = all(
    `SELECT s.id, s.company_id AS companyId, c.name AS companyName, s.to_email AS toEmail,
            s.subject, s.status, s.kind, s.gmail_message_id AS gmailMessageId,
            s.gmail_thread_id AS gmailThreadId, s.error, s.approved_at AS approvedAt,
            s.sent_at AS sentAt, s.created_at AS createdAt
     FROM sends s JOIN companies c ON c.id = s.company_id
     ${where} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
    ...params,
    Math.min(Number(limit) || 100, 500),
    Math.max(Number(offset) || 0, 0),
  );
  const total = get(
    `SELECT COUNT(*) AS count FROM sends s JOIN companies c ON c.id = s.company_id ${where}`,
    ...params,
  );
  return { rows, total: total?.count || 0 };
}

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      queue.wake = null;
      resolve();
    }
    queue.wake = done;
  });
}

function randomDelayMs(settings) {
  const min = Math.max(5, Number(settings.sending.minDelaySeconds) || 0);
  const max = Math.max(min, Number(settings.sending.maxDelaySeconds) || min);
  return (min + Math.random() * (max - min)) * 1000;
}

async function processSend(send, settings) {
  const company = get('SELECT * FROM companies WHERE id = ?', send.company_id);
  if (!company) {
    run(`UPDATE sends SET status = 'failed', error = 'Company no longer exists' WHERE id = ?`, send.id);
    return;
  }
  const primary = get(
    `SELECT * FROM company_emails WHERE company_id = ? AND is_primary = 1`,
    send.company_id,
  );
  const reply = get(`SELECT id FROM replies WHERE company_id = ? LIMIT 1`, send.company_id);
  if (reply) {
    run(`UPDATE sends SET status = 'cancelled', error = 'A reply already exists for this company' WHERE id = ?`, send.id);
    if (send.kind === 'follow_up') {
      run(`UPDATE follow_ups SET status = 'skipped' WHERE company_id = ? AND status = 'queued'`, send.company_id);
    }
    logSend(send.company_id, 'warn', 'email_skipped', `Skipped email to ${send.to_email}: a reply already exists.`);
    return;
  }
  if (!primary || primary.verification === 'invalid') {
    run(
      `UPDATE sends SET status = 'failed', error = 'Primary email is missing or invalid' WHERE id = ?`,
      send.id,
    );
    logSend(send.company_id, 'error', 'email_failed', `Not sent to ${send.to_email}: address is missing or invalid.`);
    queue.failedThisRun += 1;
    return;
  }
  if (send.kind === 'initial') {
    const other = get(
      `SELECT id FROM sends WHERE company_id = ? AND kind = 'initial' AND status = 'sent' AND id != ?`,
      send.company_id,
      send.id,
    );
    if (other) {
      run(`UPDATE sends SET status = 'skipped', error = 'An initial email was already sent' WHERE id = ?`, send.id);
      logSend(send.company_id, 'warn', 'email_skipped', `Skipped duplicate initial email to ${send.to_email}.`);
      return;
    }
  }

  run(`UPDATE sends SET status = 'sending', error = NULL WHERE id = ?`, send.id);
  queue.currentSendId = send.id;
  emitStatus();

  try {
    const attachment = resumeAttachment(settings);
    let threadId = null;
    let inReplyTo = null;
    let references = null;
    const subject = send.subject;
    if (send.kind === 'follow_up') {
      const parent = get(
        `SELECT * FROM sends WHERE company_id = ? AND kind = 'initial' AND status = 'sent' ORDER BY id DESC LIMIT 1`,
        send.company_id,
      );
      if (!parent) throw new Error('The original email could not be found');
      threadId = parent.gmail_thread_id || null;
      if (parent.gmail_message_id) {
        const meta = await getMessageMeta(parent.gmail_message_id);
        if (meta?.headers?.['message-id']) {
          inReplyTo = meta.headers['message-id'];
          references = meta.headers.references
            ? `${meta.headers.references} ${inReplyTo}`
            : inReplyTo;
        }
      }
    }

    if (sendingConfig.dryRun) {
      throw new IntegrationError(
        'SEND_DRY_RUN=true. Emails are not transmitted while dry-run mode is enabled.',
        { integration: 'gmail' },
      );
    }

    const result = await sendGmail({
      toEmail: send.to_email,
      subject,
      body: send.body,
      attachment,
      threadId,
      inReplyTo,
      references,
    });
    run(
      `UPDATE sends SET status = 'sent', gmail_message_id = ?, gmail_thread_id = ?, sent_at = ?, error = NULL WHERE id = ?`,
      result.id,
      result.threadId,
      nowIso(),
      send.id,
    );
    queue.sentThisRun += 1;
    logSend(send.company_id, 'success', 'email_sent', `Sent "${subject}" to ${send.to_email}.`, {
      sendId: send.id,
      gmailMessageId: result.id,
    });

    if (send.kind === 'initial') {
      scheduleFollowUp(send.company_id, send.id, settings);
    } else {
      run(
        `UPDATE follow_ups SET status = 'sent', sent_at = ?, gmail_message_id = ?, error = NULL
         WHERE company_id = ? AND status = 'queued'`,
        nowIso(),
        result.id,
        send.company_id,
      );
      scheduleNextFollowUp(send.company_id, send.id, settings);
    }
  } catch (error) {
    const message = String(error.message || error).slice(0, 1000);
    run(`UPDATE sends SET status = 'failed', error = ? WHERE id = ?`, message, send.id);
    if (send.kind === 'follow_up') {
      run(
        `UPDATE follow_ups SET status = 'failed', error = ? WHERE company_id = ? AND status = 'queued'`,
        message,
        send.company_id,
      );
    }
    queue.failedThisRun += 1;
    logSend(send.company_id, 'error', 'email_failed', `Failed to send to ${send.to_email}: ${message}`, {
      sendId: send.id,
    });
  } finally {
    queue.currentSendId = null;
    emitStatus();
  }
}

function scheduleFollowUp(companyId, parentSendId, settings) {
  if (!settings.followUp.enabled) return;
  const active = get(
    `SELECT id FROM follow_ups WHERE company_id = ? AND status IN ('pending','queued','sent')`,
    companyId,
  );
  if (active) return;
  const dueAt = new Date(Date.now() + settings.followUp.days * 86400000).toISOString();
  insert(
    `INSERT INTO follow_ups (company_id, send_id, status, due_at, created_at) VALUES (?, ?, 'pending', ?, ?)`,
    companyId,
    parentSendId,
    dueAt,
    nowIso(),
  );
  logSend(companyId, 'info', 'follow_up_scheduled', `Follow-up scheduled for ${dueAt.slice(0, 10)}.`);
}

function scheduleNextFollowUp(companyId, parentSendId, settings) {
  if (!settings.followUp.enabled) return;
  const sent = get(`SELECT COUNT(*) AS count FROM follow_ups WHERE company_id = ? AND status = 'sent'`, companyId);
  if ((sent?.count || 0) >= Number(settings.followUp.maxFollowUps || 1)) return;
  if (get(`SELECT id FROM replies WHERE company_id = ? LIMIT 1`, companyId)) return;
  if (get(`SELECT id FROM follow_ups WHERE company_id = ? AND status IN ('pending','queued')`, companyId)) return;
  const dueAt = new Date(Date.now() + settings.followUp.days * 86400000).toISOString();
  insert(
    `INSERT INTO follow_ups (company_id, send_id, status, due_at, created_at) VALUES (?, ?, 'pending', ?, ?)`,
    companyId,
    parentSendId,
    dueAt,
    nowIso(),
  );
}

export async function startSendQueue() {
  if (queue.running) return statusSnapshot();
  if (!connected()) {
    throw new IntegrationError('Connect your Gmail account before starting to send.', { integration: 'gmail' });
  }
  const settings = getSettings();
  const window = windowState(settings);
  if (!window.open) throw new ValidationError(window.reason);
  const limit = effectiveLimit(settings);
  if (sentToday() >= limit) {
    throw new ValidationError(`Today's sending limit (${limit}) has already been reached. Try again tomorrow.`);
  }
  const next = get(`SELECT id FROM sends WHERE status = 'queued' LIMIT 1`);
  if (!next) {
    const pendingApproval = get(`SELECT COUNT(*) AS count FROM sends WHERE status = 'awaiting_approval'`);
    if (pendingApproval?.count) {
      throw new ValidationError('Emails are waiting for your approval. Approve them first.');
    }
    throw new ValidationError('There are no queued emails to send.');
  }

  queue.running = true;
  queue.paused = false;
  queue.stopRequested = false;
  queue.reason = null;
  queue.startedAt = nowIso();
  queue.sentThisRun = 0;
  queue.failedThisRun = 0;
  emitStatus();
  void runSendLoop().catch((error) => {
    queue.running = false;
    queue.paused = true;
    queue.reason = error.message;
    queue.currentSendId = null;
    logActivity({ level: 'error', action: 'send_queue_failed', message: `Sending queue stopped: ${error.message}` });
    emitStatus();
  });
  return statusSnapshot();
}

async function runSendLoop() {
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (queue.stopRequested) break;
      if (queue.paused) break;
      const settings = getSettings();
      const window = windowState(settings);
      if (!window.open) {
        queue.paused = true;
        queue.reason = window.reason;
        break;
      }
      const limit = effectiveLimit(settings);
      if (sentToday() >= limit) {
        queue.paused = true;
        queue.reason = `Daily sending limit reached (${limit}).`;
        break;
      }
      const next = get(
        `SELECT * FROM sends WHERE status = 'queued' ORDER BY id LIMIT 1`,
      );
      if (!next) break;
      await processSend(next, settings);
      if (queue.stopRequested || queue.paused) break;
      const more = get(`SELECT id FROM sends WHERE status = 'queued' LIMIT 1`);
      if (!more) break;
      queue.reason = `Waiting ${settings.sending.minDelaySeconds}–${settings.sending.maxDelaySeconds}s before the next email.`;
      emitStatus();
      await delay(randomDelayMs(settings));
    }
  } finally {
    queue.running = false;
    queue.currentSendId = null;
    if (!queue.paused && !queue.stopRequested) {
      queue.reason = 'Queue finished.';
    }
    if (queue.stopRequested) {
      queue.reason = 'Stopped by user.';
      queue.stopRequested = false;
    }
    logActivity({
      level: queue.failedThisRun ? 'warn' : 'success',
      action: 'send_queue_finished',
      message: `Sending queue finished: ${queue.sentThisRun} sent, ${queue.failedThisRun} failed.`,
    });
    emitStatus();
    maybeSyncSheet();
  }
}

export function pauseSendQueue() {
  if (!queue.running) return statusSnapshot();
  queue.paused = true;
  queue.reason = 'Pausing after the current email finishes.';
  queue.wake?.();
  emitStatus();
  return statusSnapshot();
}

export function resumeSendQueue() {
  if (queue.running) {
    queue.paused = false;
    queue.reason = null;
    emitStatus();
    return statusSnapshot();
  }
  return startSendQueue();
}

export function stopSendQueue() {
  if (!queue.running) return statusSnapshot();
  queue.stopRequested = true;
  queue.paused = true;
  queue.wake?.();
  queue.reason = 'Stopping after the current email.';
  emitStatus();
  return statusSnapshot();
}

export function classifyReply(subject, body) {
  const text = `${subject || ''}\n${body || ''}`.toLowerCase();
  if (
    /unfortunately|regret to inform|not (been )?(selected|shortlisted)|not moving forward|no (current )?(openings?|vacanc|positions?)|position (has been|is) filled|unable to (offer|consider)|we (will|can) not (be able to )?(offer|proceed)/.test(
      text,
    )
  ) {
    return 'rejection';
  }
  if (/interview|shortlisted|schedule (a|an) (call|meeting|interview)|availability for|calendly|zoom|google meet|teams meeting|discuss your application/.test(text)) {
    return 'interview';
  }
  if (/resume|cv|curriculum vitae|send (us )?(your )?(portfolio|transcript|documents)|attach(ed|ment)?|share your (portfolio|work)/.test(text)) {
    return 'resume_requested';
  }
  if (/internship|opening|opportunit|vacanc|position|role|hiring|apply|application (form|portal)/.test(text)) {
    return 'opportunity';
  }
  if (/interested|impressed|would like to|happy to|glad to|thank you for reaching out|looks good|sounds good|consider/.test(text)) {
    return 'positive';
  }
  return 'other';
}

export function normalizeSubject(subject) {
  return String(subject || '')
    .replace(/^((re|fwd|fw)\s*:\s*)+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function pollReplies() {
  if (!connected()) {
    throw new IntegrationError('Connect your Gmail account before checking for replies.', { integration: 'gmail' });
  }
  return fetchInboxMessages({ maxResults: 50 }).then((messages) => {
    const account = googleAccount();
    const sends = all(
      `SELECT s.id, s.company_id AS companyId, s.to_email AS toEmail, s.subject, s.gmail_thread_id AS threadId,
              s.sent_at AS sentAt, c.name AS companyName
       FROM sends s JOIN companies c ON c.id = s.company_id
       WHERE s.status = 'sent' ORDER BY s.id DESC`,
    );
    const byThread = new Map();
    const byEmail = new Map();
    const bySubject = new Map();
    for (const send of sends) {
      if (send.threadId) byThread.set(send.threadId, send);
      const email = mailboxAddress(send.toEmail);
      if (email) {
        if (!byEmail.has(email)) byEmail.set(email, []);
        byEmail.get(email).push(send);
      }
      const subject = normalizeSubject(send.subject);
      if (subject) {
        if (!bySubject.has(subject)) bySubject.set(subject, []);
        bySubject.get(subject).push(send);
      }
    }

    let stored = 0;
    let skipped = 0;
    const newReplies = [];
    for (const message of messages) {
      if ((message.labelIds || []).includes('SENT')) {
        skipped += 1;
        continue;
      }
      const from = mailboxAddress(message.from);
      if (account && from === account.email.toLowerCase()) {
        skipped += 1;
        continue;
      }
      const exists = get(`SELECT id FROM replies WHERE gmail_message_id = ?`, message.id);
      if (exists) {
        skipped += 1;
        continue;
      }

      let match = message.threadId ? byThread.get(message.threadId) : null;
      if (!match && from && byEmail.has(from)) match = byEmail.get(from)[0];
      if (!match) {
        const candidateSubject = normalizeSubject(message.subject);
        const matches = bySubject.get(candidateSubject) || [];
        match = matches.find((send) => send.companyId) || null;
      }
      if (!match) {
        skipped += 1;
        continue;
      }

      const classification = classifyReply(message.subject, message.body || message.snippet);
      const importance = ['interview', 'positive', 'opportunity', 'resume_requested'].includes(classification)
        ? 'high'
        : 'normal';
      const receivedAt = message.internalDate || nowIso();
      insert(
        `INSERT INTO replies
          (company_id, send_id, gmail_message_id, gmail_thread_id, from_email, subject, snippet, body,
           classification, importance, received_at, is_read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        match.companyId,
        match.id,
        message.id,
        message.threadId || null,
        from || message.from,
        message.subject || '(no subject)',
        message.snippet || '',
        message.body || '',
        classification,
        importance,
        receivedAt,
        nowIso(),
      );
      run(
        `UPDATE follow_ups SET status = 'skipped'
         WHERE company_id = ? AND status IN ('pending','queued')`,
        match.companyId,
      );
      run(
        `UPDATE sends SET status = 'cancelled', error = 'Skipped: the company replied before this email was sent'
         WHERE company_id = ? AND kind = 'follow_up' AND status IN ('awaiting_approval','queued')`,
        match.companyId,
      );
      stored += 1;
      newReplies.push({ companyId: match.companyId, companyName: match.companyName, classification });
      logSend(
        match.companyId,
        importance === 'high' ? 'success' : 'info',
        'reply_received',
        `Reply from ${from || message.from}: ${message.subject || '(no subject)'} → ${classification}.`,
        { gmailMessageId: message.id, classification },
      );
    }

    if (stored) maybeSyncSheet();
    emitStatus();
    return { scanned: messages.length, stored, skipped, newReplies };
  });
}

export function listReplies({ classification, unread, search, limit = 100, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (classification) {
    clauses.push('r.classification = ?');
    params.push(classification);
  }
  if (unread) clauses.push('r.is_read = 0');
  if (search) {
    clauses.push('(c.name LIKE ? OR r.from_email LIKE ? OR r.subject LIKE ? OR r.snippet LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = all(
    `SELECT r.id, r.company_id AS companyId, c.name AS companyName, r.send_id AS sendId,
            r.gmail_message_id AS gmailMessageId, r.gmail_thread_id AS gmailThreadId,
            r.from_email AS fromEmail, r.subject, r.snippet, r.body, r.classification, r.importance,
            r.received_at AS receivedAt, r.is_read AS isRead, r.created_at AS createdAt
     FROM replies r LEFT JOIN companies c ON c.id = r.company_id
     ${where} ORDER BY COALESCE(r.received_at, r.created_at) DESC, r.id DESC LIMIT ? OFFSET ?`,
    ...params,
    Math.min(Number(limit) || 100, 500),
    Math.max(Number(offset) || 0, 0),
  );
  const summary = all(
    `SELECT classification, COUNT(*) AS count, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread
     FROM replies GROUP BY classification`,
  );
  const total = get(`SELECT COUNT(*) AS count FROM replies`);
  return {
    rows: rows.map((row) => ({ ...row, isRead: Boolean(row.isRead) })),
    total: total?.count || 0,
    summary,
    unread: get(`SELECT COUNT(*) AS count FROM replies WHERE is_read = 0`)?.count || 0,
  };
}

export function updateReply(replyId, { isRead, classification }) {
  const reply = get('SELECT * FROM replies WHERE id = ?', replyId);
  if (!reply) throw new NotFoundError('Reply not found');
  const updates = [];
  const params = [];
  if (isRead !== undefined) {
    updates.push('is_read = ?');
    params.push(isRead ? 1 : 0);
  }
  if (classification !== undefined) {
    if (!['positive', 'opportunity', 'resume_requested', 'interview', 'rejection', 'other'].includes(classification)) {
      throw new ValidationError('Unknown classification');
    }
    updates.push('classification = ?');
    params.push(classification);
    updates.push('importance = ?');
    params.push(['interview', 'positive', 'opportunity', 'resume_requested'].includes(classification) ? 'high' : 'normal');
  }
  if (!updates.length) return reply;
  params.push(replyId);
  run(`UPDATE replies SET ${updates.join(', ')} WHERE id = ?`, ...params);
  if (reply.company_id) maybeSyncSheet();
  return get('SELECT * FROM replies WHERE id = ?', replyId);
}

export function syncFollowUps() {
  const settings = getSettings();
  if (!settings.followUp.enabled) return { created: 0 };
  // Backfill schedules for sends that predate the setting being enabled.
  const sent = all(
    `SELECT s.id, s.company_id AS companyId, s.sent_at AS sentAt FROM sends s
     WHERE s.status = 'sent' AND s.kind = 'initial'
       AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.company_id = s.company_id)`,
  );
  let created = 0;
  for (const send of sent) {
    if (get(`SELECT id FROM replies WHERE company_id = ? LIMIT 1`, send.companyId)) continue;
    const dueAt = new Date(new Date(send.sentAt || Date.now()).getTime() + settings.followUp.days * 86400000).toISOString();
    insert(
      `INSERT INTO follow_ups (company_id, send_id, status, due_at, created_at) VALUES (?, ?, 'pending', ?, ?)`,
      send.companyId,
      send.id,
      dueAt,
      nowIso(),
    );
    created += 1;
  }
  run(
    `UPDATE follow_ups SET status = 'skipped'
     WHERE status IN ('pending','queued')
       AND company_id IN (SELECT company_id FROM replies)`,
  );
  return { created };
}

export function listFollowUps() {
  syncFollowUps();
  const rows = all(
    `SELECT f.id, f.company_id AS companyId, c.name AS companyName, f.send_id AS sendId,
            f.status, f.due_at AS dueAt, f.sent_at AS sentAt, f.gmail_message_id AS gmailMessageId,
            f.error, f.created_at AS createdAt,
            e.email AS toEmail,
            (SELECT COUNT(*) FROM replies r WHERE r.company_id = f.company_id) AS replyCount,
            (SELECT COUNT(*) FROM follow_ups x WHERE x.company_id = f.company_id) AS totalFollowUps
     FROM follow_ups f
     JOIN companies c ON c.id = f.company_id
     LEFT JOIN company_emails e ON e.company_id = f.company_id AND e.is_primary = 1
     ORDER BY CASE f.status WHEN 'pending' THEN 0 WHEN 'queued' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END,
              f.due_at, f.id DESC`,
  );
  const now = Date.now();
  return {
    rows: rows.map((row) => ({
      ...row,
      replyCount: row.replyCount || 0,
      due: row.status === 'pending' && row.dueAt ? new Date(row.dueAt).getTime() <= now : false,
    })),
    summary: {
      pending: rows.filter((row) => row.status === 'pending').length,
      due: rows.filter((row) => row.status === 'pending' && row.dueAt && new Date(row.dueAt).getTime() <= now).length,
      sent: rows.filter((row) => row.status === 'sent').length,
      skipped: rows.filter((row) => row.status === 'skipped').length,
      failed: rows.filter((row) => row.status === 'failed').length,
    },
    enabled: getSettings().followUp.enabled,
  };
}

export function prepareFollowUps(ids = null) {
  const rows = all(
    `SELECT f.* FROM follow_ups f
     WHERE f.status = 'pending'
       AND (f.due_at IS NULL OR f.due_at <= ?)
       ${ids?.length ? `AND f.id IN (${ids.map(() => '?').join(',')})` : ''}
     ORDER BY f.id`,
    nowIso(),
    ...(ids || []),
  );
  if (!rows.length) throw new ValidationError('No due follow-ups are ready to queue');
  const companyIds = [...new Set(rows.map((row) => row.company_id))];
  return prepareSends({ companyIds, kind: 'follow_up' });
}

export function updateFollowUp(followUpId, status) {
  if (!['pending', 'skipped', 'cancelled'].includes(status)) {
    throw new ValidationError('Follow-ups can be set to pending, skipped or cancelled');
  }
  const row = get('SELECT * FROM follow_ups WHERE id = ?', followUpId);
  if (!row) throw new NotFoundError('Follow-up not found');
  if (row.status === 'sent') throw new ValidationError('A sent follow-up cannot be changed');
  run(`UPDATE follow_ups SET status = ? WHERE id = ?`, status, followUpId);
  if (row.status === 'queued') {
    run(
      `UPDATE sends SET status = 'cancelled', error = 'Follow-up cancelled'
       WHERE company_id = ? AND kind = 'follow_up' AND status IN ('awaiting_approval','queued')`,
      row.company_id,
    );
  }
  logSend(row.company_id, 'warn', 'follow_up_updated', `Follow-up #${followUpId} marked ${status}.`);
  emitStatus();
  return { id: followUpId, status };
}

export function statusSnapshot() {
  const settings = getSettings();
  const limit = effectiveLimit(settings);
  const counts = all('SELECT status, COUNT(*) AS count FROM sends GROUP BY status');
  const byStatus = Object.fromEntries(counts.map((row) => [row.status, row.count]));
  const candidates = listCandidates();
  const followUps = all(
    `SELECT COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END),0) AS pending,
            COALESCE(SUM(CASE WHEN status = 'pending' AND (due_at IS NULL OR due_at <= datetime('now')) THEN 1 ELSE 0 END),0) AS due
     FROM follow_ups`,
  )[0] || { pending: 0, due: 0 };
  const account = googleAccount();
  return {
    queue: {
      running: queue.running,
      paused: queue.paused,
      startedAt: queue.startedAt,
      currentSendId: queue.currentSendId,
      reason: queue.reason,
      sentThisRun: queue.sentThisRun,
      failedThisRun: queue.failedThisRun,
    },
    gmail: { configured: googleOAuthReady(), connected: Boolean(account), account: account?.email || null },
    sending: {
      dailyLimit: limit,
      sentToday: sentToday(),
      remainingToday: Math.max(0, limit - sentToday()),
      minDelaySeconds: settings.sending.minDelaySeconds,
      maxDelaySeconds: settings.sending.maxDelaySeconds,
      windowStart: settings.sending.sendWindowStart,
      windowEnd: settings.sending.sendWindowEnd,
      weekdaysOnly: settings.sending.weekdaysOnly,
      requireApproval: settings.sending.requireApproval,
      approvalRequiredNow: firstBatchRequiresApproval(settings),
      window: windowState(settings),
    },
    counts: {
      awaitingApproval: byStatus.awaiting_approval || 0,
      queued: byStatus.queued || 0,
      sending: byStatus.sending || 0,
      sent: byStatus.sent || 0,
      failed: byStatus.failed || 0,
      cancelled: byStatus.cancelled || 0,
      skipped: byStatus.skipped || 0,
    },
    candidates: { eligible: candidates.rows.length, excluded: candidates.excluded.length },
    followUps: { ...followUps, enabled: settings.followUp.enabled },
    sheets: sheetStatus(),
    profileReady: Boolean(settings.profile.fullName && settings.profile.college && settings.profile.branch),
    resumeReady: Boolean(settings.profile.resumeFileName),
  };
}
