import { getSettings } from '../lib/settings.js';
import { logActivity } from '../lib/activity.js';
import { all, get, insert, nowIso, run, transaction } from '../db/index.js';
import { crawlSite } from './crawl.js';
import { hunterDomainSearch } from './hunter.js';
import { scoreCandidate, pickBest } from './scoring.js';
import { resolveWebsite } from './website.js';
import { verifyEmail } from './verify.js';
import { hunter } from '../config.js';
import { normalizeEmail } from './extract.js';
import { isBlockedHost } from '../lib/domains.js';
import { checkMx } from './mx.js';

class CancelledError extends Error {
  constructor() {
    super('Discovery cancelled');
    this.name = 'CancelledError';
  }
}

function ensureActive(signal) {
  if (signal?.aborted) throw new CancelledError();
}

function touchCompany(companyId, patch) {
  const fields = Object.keys(patch);
  const assignments = fields.map((field) => `${field} = ?`).join(', ');
  run(
    `UPDATE companies SET ${assignments}, updated_at = ? WHERE id = ?`,
    ...fields.map((field) => patch[field]),
    nowIso(),
    companyId,
  );
}

function setCompanyStatus(companyId, status, patch = {}) {
  touchCompany(companyId, { status, ...patch });
  return status;
}

function saveEmail(companyId, candidate) {
  const normalized = normalizeEmail(candidate.email);
  const existing = get(
    'SELECT id FROM company_emails WHERE company_id = ? AND normalized_email = ?',
    companyId,
    normalized,
  );
  if (existing) {
    run(
      `UPDATE company_emails
       SET score = ?, category = ?, source_url = COALESCE(source_url, ?), source_type = COALESCE(source_type, ?),
           verification = ?, verification_provider = ?, verification_detail = ?, mx_valid = ?, updated_at = ?
       WHERE id = ?`,
      candidate.score ?? 0,
      candidate.category ?? 'other',
      candidate.sourceUrl ?? null,
      candidate.sourceType ?? null,
      candidate.verification ?? 'unverified',
      candidate.verificationProvider ?? null,
      candidate.verificationDetail ?? null,
      candidate.mxValid === null || candidate.mxValid === undefined ? null : candidate.mxValid ? 1 : 0,
      nowIso(),
      existing.id,
    );
    return existing.id;
  }
  return insert(
    `INSERT INTO company_emails
      (company_id, email, normalized_email, source_url, source_type, category,
       verification, verification_provider, verification_detail, mx_valid, score, is_primary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    companyId,
    candidate.email,
    normalized,
    candidate.sourceUrl ?? null,
    candidate.sourceType ?? null,
    candidate.category ?? 'other',
    candidate.verification ?? 'unverified',
    candidate.verificationProvider ?? null,
    candidate.verificationDetail ?? null,
    candidate.mxValid === null || candidate.mxValid === undefined ? null : candidate.mxValid ? 1 : 0,
    candidate.score ?? 0,
  );
}

/**
 * Full discovery pipeline for one company:
 * website -> crawl official pages -> collect public emails -> verify -> pick primary.
 */
export async function discoverCompany(companyId, { signal } = {}) {
  const company = get('SELECT * FROM companies WHERE id = ?', companyId);
  if (!company) throw new Error(`Company ${companyId} not found`);

  const settings = getSettings();
  const log = (action, message, meta = {}) => {
    const { level = 'info', ...rest } = meta;
    logActivity({ companyId, level, action, message, meta: rest });
  };

  setCompanyStatus(companyId, 'discovering', { discovery_error: null });
  log('discovery_started', `Starting email discovery for "${company.name}"`);

  try {
    ensureActive(signal);

    const resolved = await resolveWebsite({
      name: company.name,
      website: company.website,
      log,
    });
    ensureActive(signal);

    touchCompany(companyId, {
      website: resolved.website,
      website_source: resolved.source,
      domain: resolved.domain,
    });

    log('crawl_started', `Crawling ${resolved.website}`, { domain: resolved.domain });
    const crawlResult = await crawlSite({
      website: resolved.website,
      maxPages: settings.discovery.maxPages,
      onProgress: (progress) => {
        if (progress.status === 'ok') {
          log('page_scanned', `${progress.url} — ${progress.message}`, { url: progress.url });
        } else if (progress.status === 'blocked') {
          log('page_blocked', `${progress.url} skipped (robots.txt)`, { url: progress.url, level: 'warn' });
        } else if (progress.status === 'error') {
          const notFound = /HTTP 404/.test(progress.message);
          log(
            notFound ? 'page_missing' : 'page_error',
            `${progress.url} could not be read: ${progress.message}`,
            { url: progress.url, level: notFound ? 'debug' : 'warn' },
          );
        }
      },
    });
    ensureActive(signal);

    log(
      'crawl_completed',
      `Scanned ${crawlResult.pagesFetched} page(s); found ${crawlResult.emails.length} public address(es).`,
      { pages: crawlResult.pages.map((page) => page.url), skippedByRobots: crawlResult.skippedByRobots },
    );

    let candidates = crawlResult.emails.map((candidate) => ({ ...candidate, verification: 'unverified' }));

    if (settings.discovery.useHunter && hunter.apiKey) {
      try {
        const hunterCandidates = await hunterDomainSearch(resolved.domain);
        if (hunterCandidates.length) {
          log('hunter_results', `Hunter.io returned ${hunterCandidates.length} public address(es).`);
          candidates.push(...hunterCandidates);
        }
      } catch (error) {
        log('hunter_error', `Hunter.io lookup failed: ${error.message}`, { level: 'warn' });
      }
    }
    ensureActive(signal);

    // Deduplicate across crawl pages and providers, keeping the best source.
    const unique = new Map();
    for (const candidate of candidates) {
      const key = normalizeEmail(candidate.email);
      if (!key) continue;
      const previous = unique.get(key);
      if (!previous) {
        unique.set(key, { ...candidate, email: key });
      } else if (
        (previous.sourceType === 'hunter' && candidate.sourceType !== 'hunter') ||
        (candidate.occurrences || 0) > (previous.occurrences || 0)
      ) {
        unique.set(key, { ...candidate, email: key, occurrences: (previous.occurrences || 0) + 1 });
      }
    }

    // DNS pre-screen: an address on a domain with no MX records cannot receive
    // mail, so it is marked invalid before any verification credits are spent.
    const emailDomains = [...new Set([...unique.values()].map((candidate) => candidate.email.split('@')[1]))].slice(0, 15);
    const mxByDomain = new Map();
    await Promise.all(
      emailDomains.map(async (domain) => {
        mxByDomain.set(domain, await checkMx(domain));
      }),
    );
    for (const candidate of unique.values()) {
      const mx = mxByDomain.get(candidate.email.split('@')[1]);
      if (mx && mx.valid === false) {
        candidate.verification = 'invalid';
        candidate.verificationProvider = 'dns';
        candidate.verificationDetail = mx.reason || 'Domain has no MX records';
        candidate.mxValid = false;
      }
    }
    ensureActive(signal);

    let scored = [...unique.values()]
      .map((candidate) => {
        const { score, reasons } = scoreCandidate(candidate, {
          siteDomain: resolved.domain,
          companyName: company.name,
        });
        return { ...candidate, score, reasons };
      })
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      touchCompany(companyId, {
        status: 'email_not_found',
        last_discovered_at: nowIso(),
        discovery_error: 'No public email address was listed on the official website.',
      });
      log('email_not_found', 'No public email address was found on the official website.', { level: 'warn' });
      return { status: 'email_not_found', emails: [], website: resolved.website };
    }

    const toVerify = scored
      .filter((candidate) => candidate.verification !== 'invalid')
      .slice(0, Math.max(1, settings.discovery.verifyTopCandidates));
    const verified = [];
    for (const candidate of toVerify) {
      ensureActive(signal);
      const result = await verifyEmail(candidate.email);
      const recalculated = scoreCandidate(
        { ...candidate, verification: result.verification },
        { siteDomain: resolved.domain, companyName: company.name },
      );
      verified.push({
        ...candidate,
        verification: result.verification,
        verificationProvider: result.provider,
        verificationDetail: result.detail,
        mxValid: result.mxValid,
        score: recalculated.score,
        reasons: recalculated.reasons,
      });
      log(
        'email_verified',
        `${candidate.email} → ${result.verification} (${result.provider}: ${result.detail})`,
        {
          email: candidate.email,
          verification: result.verification,
          provider: result.provider,
          level: result.verification === 'invalid' ? 'warn' : 'info',
        },
      );
      if (result.verification === 'verified') break; // good enough, save API credits
    }

    const verifiedEmails = new Set(verified.map((candidate) => candidate.email));
    const remaining = scored
      .filter((candidate) => !verifiedEmails.has(candidate.email))
      .map((candidate) =>
        candidate.verification === 'invalid'
          ? candidate
          : {
              ...candidate,
              verification: 'unverified',
              verificationProvider: 'not_checked',
              verificationDetail: 'Not checked to conserve verification credits',
              mxValid: candidate.mxValid ?? null,
            },
      );

    const combined = [...verified, ...remaining];
    const best = pickBest(combined);
    const primaryEmailId = best ? saveEmail(companyId, best) : null;

    transaction(() => {
      for (const candidate of combined) {
        if (best && normalizeEmail(candidate.email) === normalizeEmail(best.email)) continue;
        saveEmail(companyId, candidate);
      }
      run('UPDATE company_emails SET is_primary = 0 WHERE company_id = ?', companyId);
      if (primaryEmailId) {
        run('UPDATE company_emails SET is_primary = 1, score = ? WHERE id = ?', best.score, primaryEmailId);
      }
    });

    if (!best) {
      const message = combined.length
        ? 'Addresses were found, but none were an HR/recruitment/careers/general mailbox. Add one manually if you know it.'
        : 'All discovered addresses failed verification.';
      touchCompany(companyId, {
        status: 'email_not_found',
        last_discovered_at: nowIso(),
        discovery_error: message,
      });
      log('email_not_found', message, { level: 'warn' });
      return { status: 'email_not_found', emails: combined, website: resolved.website };
    }

    touchCompany(companyId, {
      status: 'ready',
      last_discovered_at: nowIso(),
      discovery_error: null,
    });
    log(
      'discovery_completed',
      `Primary contact: ${best.email} (${best.verification}, score ${best.score})`,
      { email: best.email, verification: best.verification, score: best.score, sourceUrl: best.sourceUrl },
    );

    return { status: 'ready', primary: best, emails: combined, website: resolved.website };
  } catch (error) {
    if (error instanceof CancelledError || signal?.aborted) {
      touchCompany(companyId, { status: 'pending', discovery_error: 'Discovery stopped by user.' });
      log('discovery_cancelled', 'Discovery stopped by user.', { level: 'warn' });
      throw error;
    }
    touchCompany(companyId, {
      status: 'error',
      discovery_error: error.message,
      last_discovered_at: nowIso(),
    });
    log('discovery_error', `Discovery failed: ${error.message}`, { level: 'error' });
    throw error;
  }
}

export function companyEmails(companyId) {
  return all(
    `SELECT id, email, source_url AS sourceUrl, source_type AS sourceType, category,
            verification, verification_provider AS verificationProvider,
            verification_detail AS verificationDetail, mx_valid AS mxValid,
            score, is_primary AS isPrimary, created_at AS createdAt
     FROM company_emails WHERE company_id = ? ORDER BY is_primary DESC, score DESC`,
    companyId,
  );
}

export function isBlockedDomain(host) {
  return isBlockedHost(host);
}
