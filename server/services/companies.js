import { all, get, insert, nowIso, run } from '../db/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { normalizeCompanyName, registrableDomain } from '../lib/domains.js';
import { normalizeWebsite } from './crawl.js';
import { logActivity } from '../lib/activity.js';
import { companyEmails } from './discover.js';
import { verifyEmail } from './verify.js';
import { isValidEmailSyntax, normalizeEmail } from './extract.js';

const COMPANY_SELECT = `
  SELECT c.*,
    e.id AS primary_email_id,
    e.email AS primary_email,
    e.verification AS verification,
    e.source_url AS email_source,
    e.source_type AS email_source_type,
    e.category AS email_category,
    e.score AS email_score,
    e.updated_at AS email_verified_at,
    (SELECT COUNT(*) FROM company_emails ce WHERE ce.company_id = c.id) AS email_count,
    (SELECT s.status FROM sends s WHERE s.company_id = c.id ORDER BY s.id DESC LIMIT 1) AS send_status,
    (SELECT s.sent_at FROM sends s WHERE s.company_id = c.id AND s.status = 'sent' ORDER BY s.id DESC LIMIT 1) AS last_sent_at,
    (SELECT s.gmail_message_id FROM sends s WHERE s.company_id = c.id AND s.status = 'sent' ORDER BY s.id DESC LIMIT 1) AS gmail_message_id,
    (SELECT COUNT(*) FROM replies r WHERE r.company_id = c.id) AS reply_count,
    (SELECT r.classification FROM replies r WHERE r.company_id = c.id ORDER BY r.id DESC LIMIT 1) AS last_reply_classification,
    (SELECT COUNT(*) FROM replies r WHERE r.company_id = c.id AND r.classification IN ('positive','opportunity','resume_requested','interview')) AS positive_replies,
    (SELECT f.status FROM follow_ups f WHERE f.company_id = c.id ORDER BY f.id DESC LIMIT 1) AS follow_up_status,
    (SELECT f.due_at FROM follow_ups f WHERE f.company_id = c.id AND f.status = 'pending' ORDER BY f.id LIMIT 1) AS follow_up_due_at
  FROM companies c
  LEFT JOIN company_emails e ON e.company_id = c.id AND e.is_primary = 1
`;

function emailStatusFromSend(sendStatus) {
  if (sendStatus === 'sent') return 'sent';
  if (sendStatus === 'failed') return 'failed';
  if (sendStatus === 'sending') return 'sending';
  return 'not_sent';
}

export function dto(row) {
  const replyCount = row.reply_count || 0;
  return {
    id: row.id,
    name: row.name,
    website: row.website,
    websiteSource: row.website_source,
    domain: row.domain,
    status: row.status,
    discoveryError: row.discovery_error,
    lastDiscoveredAt: row.last_discovered_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    primaryEmail: row.primary_email || null,
    primaryEmailId: row.primary_email_id || null,
    verification: row.verification || null,
    emailSource: row.email_source || null,
    emailSourceType: row.email_source_type || null,
    emailCategory: row.email_category || null,
    emailScore: row.email_score ?? null,
    verifiedAt: row.email_verified_at || null,
    emailCount: row.email_count || 0,
    emailStatus: emailStatusFromSend(row.send_status),
    dateSent: row.last_sent_at || null,
    gmailMessageId: row.gmail_message_id || null,
    replyStatus: replyCount > 0 ? 'replied' : row.send_status === 'sent' ? 'no_reply' : 'not_sent',
    replyCount,
    lastReplyClassification: row.last_reply_classification || null,
    positiveReplies: row.positive_replies || 0,
    followUpStatus: row.follow_up_status || 'none',
    followUpDueAt: row.follow_up_due_at || null,
  };
}

export function listCompanies(filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.search) {
    clauses.push('(c.name LIKE ? OR c.domain LIKE ? OR e.email LIKE ?)');
    const term = `%${filters.search}%`;
    params.push(term, term, term);
  }
  if (filters.status) {
    clauses.push('c.status = ?');
    params.push(filters.status);
  }
  if (filters.verification) {
    clauses.push('e.verification = ?');
    params.push(filters.verification);
  }
  if (filters.emailStatus) {
    if (filters.emailStatus === 'not_sent') {
      clauses.push(`COALESCE((SELECT s.status FROM sends s WHERE s.company_id = c.id ORDER BY s.id DESC LIMIT 1), 'none') != 'sent'`);
    } else {
      clauses.push(`(SELECT s.status FROM sends s WHERE s.company_id = c.id ORDER BY s.id DESC LIMIT 1) = ?`);
      params.push(filters.emailStatus);
    }
  }
  if (filters.hasEmail === true) clauses.push('e.email IS NOT NULL');
  if (filters.hasEmail === false) clauses.push('e.email IS NULL');
  if (filters.ids?.length) {
    clauses.push(`c.id IN (${filters.ids.map(() => '?').join(',')})`);
    params.push(...filters.ids);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Number(filters.limit) || 100, 1000);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const rows = all(`${COMPANY_SELECT} ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  const total = get(
    `SELECT COUNT(*) AS count FROM companies c LEFT JOIN company_emails e ON e.company_id = c.id AND e.is_primary = 1 ${where}`,
    ...params,
  );
  return { rows: rows.map(dto), total: total?.count || 0 };
}

export function getCompany(id) {
  const row = get(`${COMPANY_SELECT} WHERE c.id = ?`, id);
  if (!row) throw new NotFoundError('Company not found');
  return dto(row);
}

export function companyDetail(id) {
  const company = getCompany(id);
  const emails = companyEmails(id);
  const activity = all(
    `SELECT id, level, action, message, meta, created_at AS createdAt
     FROM activity_log WHERE company_id = ? ORDER BY id DESC LIMIT 50`,
    id,
  ).map((row) => ({ ...row, meta: row.meta ? safeParse(row.meta) : null }));
  const sends = all(
    `SELECT id, to_email AS toEmail, subject, status, kind, gmail_message_id AS gmailMessageId,
            sent_at AS sentAt, error, created_at AS createdAt
     FROM sends WHERE company_id = ? ORDER BY id DESC`,
    id,
  );
  const replies = all(
    `SELECT id, from_email AS fromEmail, subject, snippet, classification, importance,
            received_at AS receivedAt FROM replies WHERE company_id = ? ORDER BY id DESC`,
    id,
  );
  const followUps = all(
    `SELECT id, status, due_at AS dueAt, sent_at AS sentAt, error FROM follow_ups
     WHERE company_id = ? ORDER BY id DESC`,
    id,
  );
  return { ...company, emails, activity, sends, replies, followUps };
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function createCompany({ name, website = null, notes = '' }, { silent = false } = {}) {
  const trimmed = String(name || '').trim().replace(/\s+/g, ' ');
  if (trimmed.length < 2) throw new ValidationError('Company name must be at least 2 characters');
  const normalized = normalizeCompanyName(trimmed);
  if (!normalized) throw new ValidationError('Company name must contain letters or digits');

  const existing = get('SELECT id, name FROM companies WHERE normalized_name = ?', normalized);
  if (existing) {
    throw new ConflictError(`"${trimmed}" is already in the database as "${existing.name}".`, {
      existingId: existing.id,
    });
  }

  const normalizedSite = website ? normalizeWebsite(website) : null;
  if (website && !normalizedSite) throw new ValidationError(`"${website}" is not a valid website`);

  const id = insert(
    `INSERT INTO companies (name, normalized_name, website, website_source, domain, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    trimmed,
    normalized,
    normalizedSite,
    normalizedSite ? 'provided' : null,
    normalizedSite ? registrableDomain(normalizedSite) : null,
    notes || '',
    nowIso(),
    nowIso(),
  );
  if (!silent) {
    logActivity({ companyId: id, action: 'company_added', message: `Added "${trimmed}".`, meta: { name: trimmed } });
  }
  return getCompany(id);
}

export function bulkCreateCompanies(entries) {
  const created = [];
  const skipped = [];
  const seen = new Set();

  for (const entry of entries || []) {
    const name = String(entry.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2) {
      skipped.push({ name, reason: 'Name too short' });
      continue;
    }
    const normalized = normalizeCompanyName(name);
    if (!normalized) {
      skipped.push({ name, reason: 'No usable letters or digits' });
      continue;
    }
    if (seen.has(normalized)) {
      skipped.push({ name, reason: 'Duplicate in upload' });
      continue;
    }
    seen.add(normalized);

    const existing = get('SELECT id FROM companies WHERE normalized_name = ?', normalized);
    if (existing) {
      skipped.push({ name, reason: 'Already in database', existingId: existing.id });
      continue;
    }
    try {
      const company = createCompany({ name, website: entry.website, notes: entry.notes }, { silent: true });
      created.push(company);
    } catch (error) {
      skipped.push({ name, reason: error.message });
    }
  }

  if (created.length) {
    logActivity({
      action: 'companies_imported',
      message: `Imported ${created.length} company(ies); skipped ${skipped.length}.`,
      meta: { created: created.map((company) => company.name), skipped },
    });
  }
  return { created, skipped };
}

export function updateCompany(id, patch) {
  const current = get('SELECT * FROM companies WHERE id = ?', id);
  if (!current) throw new NotFoundError('Company not found');

  const updates = {};
  if (patch.name !== undefined) {
    const trimmed = String(patch.name).trim().replace(/\s+/g, ' ');
    if (trimmed.length < 2) throw new ValidationError('Company name must be at least 2 characters');
    const normalized = normalizeCompanyName(trimmed);
    const clash = get('SELECT id FROM companies WHERE normalized_name = ? AND id != ?', normalized, id);
    if (clash) throw new ConflictError(`Another company already uses the name "${trimmed}".`);
    updates.name = trimmed;
    updates.normalized_name = normalized;
  }
  if (patch.website !== undefined) {
    if (patch.website === null || patch.website === '') {
      updates.website = null;
      updates.domain = null;
      updates.website_source = null;
    } else {
      const normalizedSite = normalizeWebsite(patch.website);
      if (!normalizedSite) throw new ValidationError(`"${patch.website}" is not a valid website`);
      updates.website = normalizedSite;
      updates.domain = registrableDomain(normalizedSite);
      updates.website_source = 'provided';
    }
  }
  if (patch.notes !== undefined) updates.notes = patch.notes;

  if (Object.keys(updates).length) {
    run(
      `UPDATE companies SET ${Object.keys(updates).map((field) => `${field} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      ...Object.values(updates),
      nowIso(),
      id,
    );
    logActivity({
      companyId: id,
      action: 'company_updated',
      message: `Updated company details (${Object.keys(updates).join(', ')}).`,
    });
  }
  return getCompany(id);
}

export function deleteCompany(id) {
  const company = get('SELECT name FROM companies WHERE id = ?', id);
  if (!company) throw new NotFoundError('Company not found');
  run('DELETE FROM companies WHERE id = ?', id);
  logActivity({ action: 'company_deleted', message: `Deleted "${company.name}".` });
  return { deleted: true };
}

export async function addManualEmail(companyId, { email, sourceUrl = null }) {
  const company = get('SELECT id FROM companies WHERE id = ?', companyId);
  if (!company) throw new NotFoundError('Company not found');
  const normalized = normalizeEmail(email);
  if (!isValidEmailSyntax(normalized)) throw new ValidationError('Enter a valid email address');

  const clash = get(
    'SELECT id FROM company_emails WHERE normalized_email = ? AND company_id != ?',
    normalized,
    companyId,
  );
  if (clash) {
    logActivity({
      companyId,
      level: 'warn',
      action: 'duplicate_email',
      message: `${normalized} is already recorded for another company (#${clash.id}).`,
    });
  }

  const verified = await verifyEmail(normalized);
  const existing = get(
    'SELECT id FROM company_emails WHERE company_id = ? AND normalized_email = ?',
    companyId,
    normalized,
  );
  const category = normalized.split('@')[0];
  const categoryGuess = /^(hr|humanresources|people)/.test(category)
    ? 'hr'
    : /^(recruit|talent|hiring)/.test(category)
      ? 'recruitment'
      : /^(intern)/.test(category)
        ? 'internship'
        : /^(career|jobs?)/.test(category)
          ? 'careers'
          : 'general';

  let emailId;
  if (existing) {
    run(
      `UPDATE company_emails SET verification = ?, verification_provider = ?, verification_detail = ?,
        mx_valid = ?, source_url = COALESCE(source_url, ?), updated_at = ? WHERE id = ?`,
      verified.verification,
      verified.provider,
      verified.detail,
      verified.mxValid === null ? null : verified.mxValid ? 1 : 0,
      sourceUrl,
      nowIso(),
      existing.id,
    );
    emailId = existing.id;
  } else {
    emailId = insert(
      `INSERT INTO company_emails
        (company_id, email, normalized_email, source_url, source_type, category, verification,
         verification_provider, verification_detail, mx_valid, score, is_primary)
       VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, 0)`,
      companyId,
      normalized,
      normalized,
      sourceUrl || null,
      categoryGuess,
      verified.verification,
      verified.provider,
      verified.detail,
      verified.mxValid === null ? null : verified.mxValid ? 1 : 0,
      verified.verification === 'invalid' ? 0 : 50,
    );
  }

  const hasPrimary = get('SELECT id FROM company_emails WHERE company_id = ? AND is_primary = 1', companyId);
  if (!hasPrimary && verified.verification !== 'invalid') {
    run('UPDATE company_emails SET is_primary = 1 WHERE id = ?', emailId);
  }
  const primary = get('SELECT id FROM company_emails WHERE company_id = ? AND is_primary = 1', companyId);
  if (!primary && verified.verification !== 'invalid') {
    run('UPDATE company_emails SET is_primary = 1 WHERE id = ?', emailId);
  }
  const status = verified.verification === 'invalid' ? 'pending' : 'ready';
  run(
    `UPDATE companies SET status = CASE WHEN status IN ('ready','email_not_found','error') THEN ? ELSE status END,
     discovery_error = CASE WHEN ? = 'pending' THEN 'Only invalid addresses recorded so far.' ELSE NULL END,
     updated_at = ? WHERE id = ?`,
    status,
    status,
    nowIso(),
    companyId,
  );

  logActivity({
    companyId,
    level: verified.verification === 'invalid' ? 'warn' : 'info',
    action: 'email_added_manually',
    message: `Recorded ${normalized} (${verified.verification}) via ${verified.provider}.`,
    meta: { email: normalized, verification: verified.verification, sourceUrl },
  });

  return { id: emailId, email: normalized, ...verified };
}

export function setPrimaryEmail(companyId, emailId) {
  const email = get('SELECT * FROM company_emails WHERE id = ? AND company_id = ?', emailId, companyId);
  if (!email) throw new NotFoundError('Email not found for this company');
  if (email.verification === 'invalid') {
    throw new ValidationError('An invalid address cannot be the primary contact.');
  }
  run('UPDATE company_emails SET is_primary = 0 WHERE company_id = ?', companyId);
  run('UPDATE company_emails SET is_primary = 1 WHERE id = ?', emailId);
  run(`UPDATE companies SET status = 'ready', discovery_error = NULL, updated_at = ? WHERE id = ?`, nowIso(), companyId);
  logActivity({ companyId, action: 'primary_email_set', message: `Primary contact set to ${email.email}.` });
  return getCompany(companyId);
}

export function deleteEmail(companyId, emailId) {
  const email = get('SELECT * FROM company_emails WHERE id = ? AND company_id = ?', emailId, companyId);
  if (!email) throw new NotFoundError('Email not found');
  const wasPrimary = email.is_primary;
  run('DELETE FROM company_emails WHERE id = ?', emailId);
  if (wasPrimary) {
    const next = get(
      `SELECT id FROM company_emails WHERE company_id = ? AND verification != 'invalid'
       ORDER BY score DESC LIMIT 1`,
      companyId,
    );
    if (next) {
      run('UPDATE company_emails SET is_primary = 1 WHERE id = ?', next.id);
      run(`UPDATE companies SET status = 'ready', updated_at = ? WHERE id = ?`, nowIso(), companyId);
    } else {
      run(`UPDATE companies SET status = 'email_not_found', updated_at = ? WHERE id = ?`, nowIso(), companyId);
    }
  }
  return getCompany(companyId);
}
