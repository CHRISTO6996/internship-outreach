import { crawl, activeSearchProvider } from '../config.js';
import { isBlockedHost, nameTokens, normalizeCompanyName, registrableDomain } from '../lib/domains.js';
import { fetchDocument } from '../lib/http.js';
import { webSearch } from './search.js';
import { normalizeWebsite } from './crawl.js';

function tokenPresence(text, tokens) {
  const haystack = String(text || '').toLowerCase();
  if (!tokens.length) return 0;
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  return hits / tokens.length;
}

export function websiteMatchScore({ url, title, text, name }) {
  const tokens = nameTokens(name);
  const normalizedName = normalizeCompanyName(name);
  const host = registrableDomain(url);
  const hostBase = host.split('.')[0].replace(/[^a-z0-9]/g, '');
  const squashed = tokens.join('');
  let score = 0;

  if (hostBase && (hostBase === squashed || squashed.includes(hostBase) || hostBase.includes(squashed))) {
    score += 45;
  } else if (tokens.some((token) => token.length > 3 && hostBase.includes(token))) {
    score += 25;
  }

  const titleHay = `${title} ${text.slice(0, 4000)}`.toLowerCase();
  if (normalizedName && normalizedName.length > 3 && titleHay.includes(normalizedName)) score += 35;
  const presence = tokenPresence(titleHay, tokens);
  score += Math.round(presence * 30);
  if (titleHay.includes('official website') || titleHay.includes('official site')) score += 5;

  return Math.min(score, 100);
}

function candidateDomains(name) {
  const tokens = nameTokens(name);
  if (!tokens.length) return [];
  const squashed = tokens.join('');
  const candidates = [];
  const push = (host) => {
    if (host && !candidates.includes(host)) candidates.push(host);
  };
  push(`${squashed}.com`);
  if (tokens.length > 1) {
    push(`${tokens[0]}.com`);
    push(`${tokens.join('-')}.com`);
  }
  if (squashed.length <= 10) push(`${squashed}.in`);
  return candidates.slice(0, 4);
}

async function inspect(url) {
  const page = await fetchDocument(url, { timeoutMs: crawl.requestTimeoutMs, maxBytes: 600_000 });
  if (!/text\/html|application\/xhtml/i.test(page.contentType || '') && page.text.length < 300) {
    throw new Error('Not an HTML page');
  }
  const titleMatch = page.text.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
  const bodyMatch = page.text.match(/<body[\s\S]*$/i);
  const text = (bodyMatch ? bodyMatch[0] : page.text)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 6000);
  return { url: page.url, title, text };
}

/**
 * Turn a company name into a verified official website.
 * Order: explicit website -> paid web search -> derived candidate + identity check.
 */
export async function resolveWebsite({ name, website = null, log = () => {} }) {
  if (website && String(website).trim()) {
    const normalized = normalizeWebsite(website);
    if (!normalized) throw new Error(`"${website}" is not a valid website address`);
    const page = await inspect(normalized);
    const score = websiteMatchScore({ ...page, name });
    log('website_resolved', `Using provided website ${page.url}`, { url: page.url, source: 'provided', score });
    return {
      website: page.url,
      domain: registrableDomain(page.url),
      title: page.title,
      source: 'provided',
      score,
      homepageText: page.text,
    };
  }

  const tokens = nameTokens(name);
  if (!tokens.length) {
    throw new Error('Company name must contain at least two letters or digits');
  }

  const provider = activeSearchProvider();
  if (provider) {
    const queries = [
      `"${name}" official website`,
      `${name} company contact careers`,
      `${name} official site`,
    ];
    const tried = new Set();
    let best = null;

    for (const query of queries) {
      let results = [];
      try {
        results = await webSearch(query, { num: 8 });
      } catch (error) {
        log('search_error', `Search provider error: ${error.message}`, { query, level: 'warn' });
        continue;
      }
      for (const result of results.slice(0, 6)) {
        const host = registrableDomain(result.url);
        if (!host || isBlockedHost(host) || tried.has(host)) continue;
        tried.add(host);
        try {
          const page = await inspect(result.url);
          const score = websiteMatchScore({ ...page, name });
          log('candidate_website', `Evaluated ${page.url} (match ${score}/100)`, {
            url: page.url,
            score,
            query,
          });
          if (score >= 45 && (!best || score > best.score)) {
            best = { ...page, score, source: `search:${provider}` };
          }
          if (best && best.score >= 75) break;
        } catch (error) {
          log('candidate_rejected', `Could not inspect ${result.url}: ${error.message}`, { level: 'warn' });
        }
      }
      if (best && best.score >= 75) break;
    }

    if (best) {
      log('website_resolved', `Official website: ${best.website ?? best.url}`, {
        url: best.url,
        score: best.score,
        source: best.source,
      });
      return {
        website: best.url,
        domain: registrableDomain(best.url),
        title: best.title,
        source: best.source,
        score: best.score,
        homepageText: best.text,
      };
    }
    throw new Error(
      'No official website could be confirmed from search results. Add the website manually to continue.',
    );
  }

  // No search API: probe likely domains, but only accept a strong identity match.
  log(
    'search_not_configured',
    'Web search is not configured; trying likely company domains and verifying page identity.',
    { level: 'warn' },
  );
  let best = null;
  for (const host of candidateDomains(name)) {
    try {
      const page = await inspect(`https://${host}`);
      const score = websiteMatchScore({ ...page, name });
      log('candidate_website', `Probed ${page.url} (match ${score}/100)`, { url: page.url, score });
      if (score >= 60 && (!best || score > best.score)) {
        best = { ...page, score, source: 'derived_verified' };
      }
    } catch {
      // Candidate does not resolve or is not an HTML site.
    }
  }

  if (best) {
    log('website_resolved', `Official website: ${best.url}`, {
      url: best.url,
      score: best.score,
      source: 'derived_verified',
    });
    return {
      website: best.url,
      domain: registrableDomain(best.url),
      title: best.title,
      source: 'derived_verified',
      score: best.score,
      homepageText: best.text,
    };
  }

  throw new Error(
    'No official website could be confirmed. Add the company website manually, or configure a search API (SerpAPI / Google CSE) in Integrations.',
  );
}
