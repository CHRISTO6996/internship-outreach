import * as cheerio from 'cheerio';
import { activeSearchProvider, search } from '../config.js';
import { fetchDocument, fetchJson } from '../lib/http.js';
import { IntegrationError } from '../lib/errors.js';

const SEARCH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export function searchAvailability() {
  return {
    provider: activeSearchProvider(),
    configured: Boolean(activeSearchProvider()),
    keylessFallback: search.keylessFallback,
    jinaFallback: search.jinaFallback,
    requestQuotaHint: 'Each company usually costs 1-3 search requests.',
  };
}

function normalizeResults(items) {
  return items
    .map((item) => ({
      title: item.title || '',
      url: item.url || '',
      snippet: item.snippet || '',
    }))
    .filter((item) => /^https?:\/\//i.test(item.url));
}

async function viaSerpApi(query, num) {
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(Math.min(num, 10)));
  url.searchParams.set('api_key', search.serpApiKey);
  const json = await fetchJson(url.toString(), { timeoutMs: 20000 });
  return normalizeResults(
    (json.organic_results || []).map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
    })),
  );
}

async function viaGoogleCse(query, num) {
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', search.googleApiKey);
  url.searchParams.set('cx', search.googleCx);
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(Math.min(num, 10)));
  const json = await fetchJson(url.toString(), { timeoutMs: 20000 });
  return normalizeResults(
    (json.items || []).map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
    })),
  );
}

/**
 * Keyless fallback. DuckDuckGo's HTML endpoint returns ordinary web results and
 * needs no account, which keeps the app usable when Google CSE is not enabled.
 */
async function viaDuckDuckGo(query, num) {
  const url = new URL('https://html.duckduckgo.com/html/');
  url.searchParams.set('q', query);
  const page = await fetchDocument(url.toString(), {
    timeoutMs: 20000,
    maxBytes: 1_500_000,
    headers: {
      'user-agent': SEARCH_UA,
      accept: 'text/html,application/xhtml+xml',
    },
  });

  const $ = cheerio.load(page.text);
  const results = [];
  $('.result').each((_, element) => {
    const anchor = $(element).find('.result__a').first();
    const rawHref = anchor.attr('href');
    if (!rawHref) return;
    let href = rawHref;
    try {
      if (href.startsWith('//')) href = `https:${href}`;
      const link = new URL(href, 'https://duckduckgo.com');
      const redirect = link.searchParams.get('uddg');
      if (redirect) href = redirect;
      else if (/(^|\.)duckduckgo\.com$/i.test(link.hostname)) return;
    } catch {
      return;
    }
    if (!/^https?:\/\//i.test(href)) return;
    const snippet = $(element).find('.result__snippet').text().replace(/\s+/g, ' ').trim();
    results.push({
      title: anchor.text().replace(/\s+/g, ' ').trim(),
      url: href,
      snippet,
    });
    if (results.length >= num) return false;
    return undefined;
  });
  return normalizeResults(results);
}

function decodeBingLink(href) {
  try {
    const url = new URL(href, 'https://www.bing.com');
    if (!/(^|\.)bing\.com$/i.test(url.hostname)) return href;
    const encoded = url.searchParams.get('u');
    if (!encoded) return null;
    // Bing encodes the destination as "a1" + base64url(URL).
    const base64 = encoded.startsWith('a1') ? encoded.slice(2) : encoded;
    const padded = base64.replace(/-/g, '+').replace(/_/g, '/');
    const target = Buffer.from(padded, 'base64').toString('utf8');
    return /^https?:\/\//i.test(target) ? target : null;
  } catch {
    return null;
  }
}

const SEARCH_NOISE =
  /(^|\.)(bing|microsoft|msn|live|office|go\.microsoft|duckduckgo|google|w3\.org)\.[a-z.]{2,}$/i;

/**
 * Keyless fallback: Jina Reader proxies a Bing result page as markdown.
 * Useful when the site blocks direct search scraping and no API key is set.
 * Bing's marked-down links are redirect wrappers, so they are decoded to the
 * real destination before being returned.
 */
async function viaJinaBing(query, num) {
  const target = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(
    Math.max(num, 10),
    20,
  )}`;
  const page = await fetchDocument(`https://r.jina.ai/${target}`, {
    timeoutMs: 45000,
    maxBytes: 2_500_000,
    headers: {
      accept: 'text/plain,text/markdown,*/*',
      'x-return-format': 'markdown',
    },
  });

  const results = [];
  const byUrl = new Map();
  const linkPattern = /\[([^\]\n]{2,200})\]\((https?:\/\/[^)\s]+)\)/g;
  let match;
  while ((match = linkPattern.exec(page.text)) !== null) {
    const rawTitle = match[1].replace(/\s+/g, ' ').trim();
    const href = decodeBingLink(match[2]);
    if (!href) continue;
    let hostname;
    try {
      hostname = new URL(href).hostname;
    } catch {
      continue;
    }
    if (SEARCH_NOISE.test(hostname)) continue;

    // Bing prints a breadcrumb link first and the real headline second, so
    // keep the most human-readable title for each destination.
    const score = /https?:\/\//i.test(rawTitle) ? 0 : Math.min(rawTitle.length, 120);
    const existing = byUrl.get(href);
    if (!existing) {
      byUrl.set(href, { title: rawTitle, url: href, snippet: '', score });
    } else if (score > existing.score) {
      existing.title = rawTitle;
      existing.score = score;
    }
    if (byUrl.size >= num * 2) break;
  }

  for (const item of byUrl.values()) {
    results.push({ title: item.title, url: item.url, snippet: item.snippet });
    if (results.length >= num) break;
  }
  return normalizeResults(results);
}

async function runProvider(provider, query, num) {
  if (provider === 'serpapi') return viaSerpApi(query, num);
  if (provider === 'google_cse') return viaGoogleCse(query, num);
  if (provider === 'duckduckgo') return viaDuckDuckGo(query, num);
  return [];
}

/**
 * Search the public web. Returns normalized results: [{ title, url, snippet }].
 * If the configured keyed provider fails (quota, API not enabled, bad key), the
 * keyless fallback is tried before giving up.
 */
export async function webSearch(query, { num = 8 } = {}) {
  const provider = activeSearchProvider();
  if (!provider) {
    throw new IntegrationError(
      'Web search is not configured. Add SERPAPI_KEY or GOOGLE_CSE_KEY + GOOGLE_CSE_CX to .env, or add companies with an explicit website.',
      { integration: 'search', env: ['SERPAPI_KEY', 'GOOGLE_CSE_KEY', 'GOOGLE_CSE_CX'] },
    );
  }

  let primaryError = null;
  try {
    const results = await runProvider(provider, query, num);
    if (results.length || provider === 'duckduckgo') return results;
  } catch (error) {
    primaryError = error;
  }

  const failures = [];
  if (search.keylessFallback && provider !== 'duckduckgo') {
    try {
      const results = await viaDuckDuckGo(query, num);
      if (results.length) return results;
    } catch (fallbackError) {
      failures.push(`duckduckgo: ${fallbackError.message}`);
    }
  }

  if (search.jinaFallback && provider !== 'jina') {
    try {
      const results = await viaJinaBing(query, num);
      if (results.length) return results;
    } catch (fallbackError) {
      failures.push(`jina: ${fallbackError.message}`);
    }
  }

  if (primaryError || failures.length) {
    throw new IntegrationError(
      `Web search failed (${provider}: ${primaryError?.message || 'no results'}${
        failures.length ? `; fallbacks: ${failures.join('; ')}` : ''
      }).`,
      { integration: 'search', env: ['SERPAPI_KEY', 'GOOGLE_CSE_KEY', 'GOOGLE_CSE_CX'] },
    );
  }
  return [];
}
