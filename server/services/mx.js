import dns from 'node:dns/promises';

const cache = new Map();
const TTL_MS = 60 * 60 * 1000;

/** Returns { valid: true|false|null, records: string[] } — null means "could not check". */
export async function checkMx(domain) {
  const host = String(domain || '').toLowerCase();
  if (!host) return { valid: false, records: [] };
  const cached = cache.get(host);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.result;

  let result;
  try {
    const records = await dns.resolveMx(host);
    result = {
      valid: Array.isArray(records) && records.length > 0,
      records: (records || []).sort((a, b) => a.priority - b.priority).map((r) => r.exchange),
    };
  } catch (error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
      result = { valid: false, records: [], reason: 'No MX records' };
    } else {
      result = { valid: null, records: [], reason: error.code || error.message };
    }
  }
  cache.set(host, { result, at: Date.now() });
  return result;
}
