import { crawl, activeSearchProvider } from '../config.js';
import { isBlockedHost, nameTokens, normalizeCompanyName, registrableDomain } from '../lib/domains.js';
import { fetchDocument, fetchDocumentViaReader, fetchJson } from '../lib/http.js';
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

  // The root domain (or its www host) is the corporate site; arbitrary
  // subdomains such as "iremote.company.com" are usually portals, not the
  // official homepage, so they should never beat the root.
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === host || hostname === `www.${host}`) score += 25;
    else if (hostname !== host && hostname.endsWith(`.${host}`)) score -= 15;
  } catch {
    /* ignore malformed URL */
  }

  const titleHay = `${title} ${text.slice(0, 4000)}`.toLowerCase();
  if (normalizedName && normalizedName.length > 3 && titleHay.includes(normalizedName)) score += 35;
  const presence = tokenPresence(titleHay, tokens);
  score += Math.round(presence * 30);
  if (titleHay.includes('official website') || titleHay.includes('official site')) score += 5;

  return Math.max(0, Math.min(score, 100));
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
  push(`${squashed}.in`);
  if (tokens.length > 1) {
    push(`${tokens[0]}.com`);
    push(`${tokens.join('-')}.com`);
  }
  if (squashed.length <= 14) {
    push(`${squashed}.io`);
    push(`${squashed}.co`);
    push(`${squashed}.org`);
  }
  return candidates.slice(0, 7);
}

const COMPANY_HINT =
  /(company|corporation|corporat|organisation|organization|business|enterprise|firm|startup|bank|software|technology|manufacturer|retailer|airline|telecom|consulting|multinational|payment|platform|services|conglomerate|employer)/i;
const NON_COMPANY_HINT =
  /(fictional|category|award|theater|theatre|choir|genetic|subfield|music duo|film|character|species|municipality|village|album|song|novel|disorder|syndrome)/i;

function labelMatches(name, entry) {
  const target = normalizeCompanyName(name);
  const labels = [entry.label, ...(entry.aliases || [])]
    .filter(Boolean)
    .map((label) => normalizeCompanyName(label));
  return labels.some((label) => label && (label === target || label.includes(target) || target.includes(label)));
}

async function wikidataEntityWebsite(id) {
  const entityUrl = new URL('https://www.wikidata.org/w/api.php');
  entityUrl.searchParams.set('action', 'wbgetentities');
  entityUrl.searchParams.set('ids', id);
  entityUrl.searchParams.set('props', 'claims');
  entityUrl.searchParams.set('format', 'json');
  const entity = await fetchJson(entityUrl.toString(), { timeoutMs: 15000 });
  return entity?.entities?.[id]?.claims?.P856?.[0]?.mainsnak?.datavalue?.value || null;
}

/**
 * Keyless official-website lookup through Wikidata (P856) and Wikipedia.
 * This is real, cited data - no website or address is guessed.
 */
async function wikidataWebsite(name, log) {
  try {
    const searchUrl = new URL('https://www.wikidata.org/w/api.php');
    searchUrl.searchParams.set('action', 'wbsearchentities');
    searchUrl.searchParams.set('search', name);
    searchUrl.searchParams.set('language', 'en');
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('limit', '10');
    searchUrl.searchParams.set('type', 'item');
    const json = await fetchJson(searchUrl.toString(), { timeoutMs: 15000 });

    const candidates = (json.search || []).filter((entry) => {
      const description = String(entry.description || '');
      return labelMatches(name, entry) && COMPANY_HINT.test(description) && !NON_COMPANY_HINT.test(description);
    });

    for (const entry of candidates.slice(0, 3)) {
      const website = await wikidataEntityWebsite(entry.id);
      if (website) {
        log('wikidata_website', `Wikidata lists ${website} for "${entry.label}"`, {
          url: website,
          entity: entry.id,
        });
        return website;
      }
    }

    // Wikipedia fallback for names whose Wikidata description is sparse.
    const wikiUrl = new URL('https://en.wikipedia.org/w/api.php');
    wikiUrl.searchParams.set('action', 'query');
    wikiUrl.searchParams.set('list', 'search');
    wikiUrl.searchParams.set('srsearch', name);
    wikiUrl.searchParams.set('format', 'json');
    wikiUrl.searchParams.set('srlimit', '3');
    const wiki = await fetchJson(wikiUrl.toString(), { timeoutMs: 15000 });
    for (const hit of wiki?.query?.search || []) {
      const propsUrl = new URL('https://en.wikipedia.org/w/api.php');
      propsUrl.searchParams.set('action', 'query');
      propsUrl.searchParams.set('prop', 'pageprops');
      propsUrl.searchParams.set('ppprop', 'wikibase_item');
      propsUrl.searchParams.set('titles', hit.title);
      propsUrl.searchParams.set('redirects', '1');
      propsUrl.searchParams.set('format', 'json');
      const page = await fetchJson(propsUrl.toString(), { timeoutMs: 15000 });
      const pages = Object.values(page?.query?.pages || {});
      const qid = pages[0]?.pageprops?.wikibase_item;
      if (!qid) continue;
      const website = await wikidataEntityWebsite(qid);
      if (website) {
        log('wikidata_website', `Wikipedia/Wikidata lists ${website} for "${hit.title}"`, {
          url: website,
          entity: qid,
        });
        return website;
      }
    }
  } catch (error) {
    log('wikidata_error', `Wikipedia/Wikidata lookup failed: ${error.message}`, { level: 'warn' });
  }
  return null;
}

async function inspect(url) {
  let page;
  try {
    page = await fetchDocument(url, { timeoutMs: crawl.requestTimeoutMs, maxBytes: 600_000 });
  } catch (error) {
    if (![401, 403, 429, 451].includes(error.status)) throw error;
    page = await fetchDocumentViaReader(url, { timeoutMs: 45000 });
  }
  const viaReader = Boolean(page.viaReader);
  if (!viaReader && !/text\/html|application\/xhtml/i.test(page.contentType || '') && page.text.length < 300) {
    throw new Error('Not an HTML page');
  }
  const titleMatch = page.text.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  const titleFromReader = page.text.match(/^Title:\s*(.+)$/im);
  const title = (titleMatch ? titleMatch[1] : titleFromReader ? titleFromReader[1] : '')
    .replace(/\s+/g, ' ')
    .trim();
  const bodyMatch = page.text.match(/<body[\s\S]*$/i);
  const text = (bodyMatch ? bodyMatch[0] : page.text)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 6000);
  return { url: page.url, title, text };
}

async function confirmListedWebsite(url, name, log) {
  const normalized = normalizeWebsite(url);
  if (!normalized) return null;
  try {
    const page = await inspect(normalized);
    const score = websiteMatchScore({ ...page, name });
    log('candidate_website', `Evaluated ${page.url} (match ${score}/100)`, {
      url: page.url,
      score,
      source: 'wikidata',
    });
    // P856 is an authoritative company property, so a modest text score is
    // acceptable here where search snippets alone would not be.
    if (score < 30) return null;
    log('website_resolved', `Official website: ${page.url}`, { url: page.url, score, source: 'wikidata' });
    return {
      website: page.url,
      domain: registrableDomain(page.url),
      title: page.title,
      source: 'wikidata',
      score,
      homepageText: page.text,
    };
  } catch (error) {
    log('candidate_rejected', `Could not inspect ${normalized}: ${error.message}`, { level: 'warn' });
    return null;
  }
}

/**
 * Turn a company name into a verified official website.
 * Order: explicit website -> Wikidata/Wikipedia -> web search -> derived domains.
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

  // Keyless, authoritative lookup first. This works without any search API and
  // gives the correct root domain for well-known companies.
  const listedWebsite = await wikidataWebsite(name, log);
  if (listedWebsite) {
    const confirmed = await confirmListedWebsite(listedWebsite, name, log);
    if (confirmed) return confirmed;
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
      for (const result of results.slice(0, 8)) {
        let hostname = '';
        try {
          hostname = new URL(result.url).hostname.toLowerCase();
        } catch {
          continue;
        }
        const host = registrableDomain(hostname);
        if (!host || isBlockedHost(host) || tried.has(hostname)) continue;
        tried.add(hostname);
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
          if (best && best.score >= 92) break;
        } catch (error) {
          log('candidate_rejected', `Could not inspect ${result.url}: ${error.message}`, { level: 'warn' });
        }
      }
      if (best && best.score >= 92) break;
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
    log(
      'search_no_match',
      'Search results did not confirm an official website; trying Wikipedia/Wikidata and likely domains.',
      { level: 'warn' },
    );
  }

  // Last resort: probe likely domains, but only accept a strong identity match.
  log('domain_probe', 'Probing likely company domains and verifying page identity.', { level: 'warn' });
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
    'No official website could be confirmed from Wikidata or likely domains. Add the company website manually to continue.',
  );
}
