import { hunter } from '../config.js';
import { fetchJson } from '../lib/http.js';
import { isBlockedEmailDomain, registrableDomain, categorizeEmail } from '../lib/domains.js';
import { isUsefulEmail, normalizeEmail } from './extract.js';

/**
 * Optional enrichment: query Hunter.io for publicly indexed professional
 * addresses on the company domain. Returns candidates with source URLs.
 */
export async function hunterDomainSearch(domain, { limit = 10 } = {}) {
  if (!hunter.apiKey) return [];
  const root = registrableDomain(domain);
  if (!root) return [];

  const url = new URL('https://api.hunter.io/v2/domain-search');
  url.searchParams.set('domain', root);
  url.searchParams.set('limit', String(Math.min(limit, 10)));
  url.searchParams.set('api_key', hunter.apiKey);

  const json = await fetchJson(url.toString(), { timeoutMs: 20000 });
  const emails = json.data?.emails || [];
  const results = [];
  for (const item of emails) {
    const email = normalizeEmail(item.value);
    if (!isUsefulEmail(email)) continue;
    if (isBlockedEmailDomain(email.split('@')[1])) continue;
    results.push({
      email,
      domain: email.split('@')[1],
      localPart: email.split('@')[0],
      category: categorizeEmail(email.split('@')[0]),
      sourceUrl: item.sources?.[0]?.uri || `https://hunter.io/search/${root}`,
      sourceType: 'hunter',
      context: [item.position, item.department, item.confidence != null ? `confidence ${item.confidence}%` : null]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 200),
      occurrences: 1,
      providerConfidence: item.confidence ?? null,
    });
  }
  return results;
}
