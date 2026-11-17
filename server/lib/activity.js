import { insert, all, get } from '../db/index.js';

const LEVEL_ORDER = ['debug', 'info', 'success', 'warn', 'error'];
const consoleLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();

export function logActivity({ companyId = null, level = 'info', action, message, meta = null }) {
  const safeLevel = LEVEL_ORDER.includes(level) ? level : 'info';
  let metaJson = null;
  if (meta !== null && meta !== undefined) {
    try {
      metaJson = JSON.stringify(meta);
    } catch {
      metaJson = JSON.stringify({ note: 'unserializable metadata' });
    }
  }

  const id = insert(
    'INSERT INTO activity_log (company_id, level, action, message, meta) VALUES (?, ?, ?, ?, ?)',
    companyId,
    safeLevel,
    action,
    String(message).slice(0, 2000),
    metaJson,
  );

  const order = LEVEL_ORDER.indexOf(safeLevel);
  if (order >= LEVEL_ORDER.indexOf(consoleLevel)) {
    const prefix = companyId ? `[company:${companyId}]` : '[app]';
    const line = `${prefix} [${safeLevel}] ${action}: ${message}`;
    if (safeLevel === 'error') console.error(line);
    else if (safeLevel === 'warn') console.warn(line);
    else console.log(line);
  }
  return id;
}

export function listActivity({ companyId = null, limit = 100, beforeId = null, level = null, search = null } = {}) {
  const params = [];
  const clauses = [];
  if (companyId) {
    clauses.push('company_id = ?');
    params.push(companyId);
  }
  if (beforeId) {
    clauses.push('id < ?');
    params.push(beforeId);
  }
  if (level) {
    clauses.push('level = ?');
    params.push(level);
  }
  if (search) {
    clauses.push('(message LIKE ? OR action LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(Math.min(Number(limit) || 100, 500));
  const rows = all(
    `SELECT id, company_id AS companyId, level, action, message, meta, created_at AS createdAt
     FROM activity_log ${where} ORDER BY id DESC LIMIT ?`,
    ...params,
  );
  return rows.map((row) => ({
    ...row,
    meta: row.meta ? safeParse(row.meta) : null,
  }));
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function recentForCompany(companyId, limit = 30) {
  return listActivity({ companyId, limit });
}

export function logCounts() {
  return get(
    `SELECT
      SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN level = 'warn' THEN 1 ELSE 0 END) AS warnings,
      COUNT(*) AS total
     FROM activity_log`,
  );
}
