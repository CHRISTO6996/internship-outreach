import * as cheerio from 'cheerio';
import { crawl } from '../config.js';
import { fetchDocument, fetchDocumentViaReader, sleep } from '../lib/http.js';
import { registrableDomain, sameSite } from '../lib/domains.js';
import { extractEmailsFromHtml } from './extract.js';
import { isCrawlAllowed } from './robots.js';

const PRIORITY = [
  { kind: 'careers', score: 100, pattern: /(career|careers|jobs?|job-openings|openings|recruit|recruitment|hiring|talent|intern|internship|placement|work-with-us|join-us|join-our-team|life-at)/i },
  { kind: 'contact', score: 80, pattern: /(contact|contact-us|contactus|get-in-touch|reach-us|kontakt|impressum|imprint|support-center)/i },
  { kind: 'about', score: 50, pattern: /(about|about-us|who-we-are|our-story|company|team|leadership|management|people)/i },
];

const COMMON_PATHS = [
  '/contact',
  '/contact-us',
  '/contactus',
  '/get-in-touch',
  '/enquiries',
  '/inquiries',
  '/careers',
  '/careers/',
  '/careers/jobs',
  '/careers/internships',
  '/careers/internship',
  '/careers/recruitment',
  '/careers/contact',
  '/careers/contact-us',
  '/jobs',
  '/jobs/careers',
  '/about',
  '/about-us',
  '/about/contact',
  '/internship',
  '/internships',
  '/internships/apply',
  '/campus',
  '/campus-hiring',
  '/early-careers',
  '/graduates',
  '/students',
  '/recruitment',
  '/recruitment/contact',
  '/talent',
  '/talent-acquisition',
  '/hiring',
  '/we-are-hiring',
  '/join-us',
  '/joinus',
  '/work-with-us',
  '/company/careers',
  '/hr',
  '/contact/hr',
  '/contact/careers',
  '/impressum',
  '/kontakt',
];

const SKIP_EXTENSIONS = /\.(?:pdf|jpg|jpeg|png|gif|webp|svg|ico|zip|rar|mp4|mp3|avi|mov|css|js|json|xml|docx?|xlsx?|pptx?|woff2?|ttf|eot)$/i;

export function normalizeWebsite(input) {
  let value = String(input || '').trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value.replace(/^\/+/, '')}`;
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function classifyLink(url, anchorText = '') {
  const haystack = `${url} ${anchorText}`;
  for (const entry of PRIORITY) {
    if (entry.pattern.test(haystack)) return entry;
  }
  return { kind: 'other', score: 0 };
}

function collectLinks($, pageUrl) {
  const links = new Map();
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href || /^(mailto:|tel:|javascript:|#|data:)/i.test(href)) return;
    let absolute;
    try {
      absolute = new URL(href, pageUrl);
    } catch {
      return;
    }
    if (!/^https?:$/.test(absolute.protocol)) return;
    if (SKIP_EXTENSIONS.test(absolute.pathname)) return;
    absolute.hash = '';
    const url = absolute.toString().replace(/\/$/, '');
    const text = $(element).text().replace(/\s+/g, ' ').trim().slice(0, 120);
    const priority = classifyLink(url, text);
    const existing = links.get(url);
    if (!existing || existing.score < priority.score) {
      links.set(url, { url, kind: priority.kind, score: priority.score, text });
    }
  });
  return [...links.values()];
}

/**
 * Fetch a page normally, then fall back to Jina Reader when the site blocks
 * automated access (401/403/429/451) or returns a JavaScript-only shell.
 */
async function fetchPage(url, { timeoutMs = crawl.requestTimeoutMs } = {}) {
  try {
    return await fetchDocument(url, { timeoutMs });
  } catch (error) {
    const blocked = [401, 403, 429, 451].includes(error.status);
    if (!blocked) throw error;
    return fetchDocumentViaReader(url, { timeoutMs: Math.max(timeoutMs, 45000) });
  }
}

async function fetchHomepage(website) {
  const candidates = [];
  const normalized = normalizeWebsite(website);
  if (!normalized) throw new Error('Invalid website URL');
  candidates.push(normalized);

  const url = new URL(normalized);
  if (url.hostname.startsWith('www.')) {
    candidates.push(normalized.replace('www.', ''));
  } else {
    candidates.push(`${url.protocol}//www.${url.hostname}${url.pathname === '/' ? '' : url.pathname}`);
  }
  if (url.protocol === 'https:') {
    candidates.push(normalized.replace(/^https:/, 'http:'));
  }

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const page = await fetchPage(candidate, { timeoutMs: crawl.requestTimeoutMs });
      if (!page.viaReader && !/text\/html|application\/xhtml/i.test(page.contentType || '') && page.text.length < 200) {
        lastError = new Error('Not an HTML page');
        continue;
      }
      return page;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Could not load website');
}

/**
 * Crawl a company website for publicly listed emails, prioritising
 * careers/contact/about pages. Respects robots.txt and request delays.
 */
export async function crawlSite({ website, maxPages = crawl.maxPages, respectRobots = true, onProgress = () => {} }) {
  const homepage = await fetchHomepage(website);
  const homepageUrl = homepage.url;
  const siteDomain = registrableDomain(homepageUrl);
  const $home = cheerio.load(homepage.text);

  const homepageEmails = extractEmailsFromHtml(homepage.text, homepageUrl);
  const pages = [
    {
      url: homepageUrl,
      title: $home('title').first().text().trim(),
      text: $home('body').text().replace(/\s+/g, ' ').trim(),
      emails: homepageEmails,
    },
  ];

  const seen = new Set([homepageUrl.replace(/\/$/, '')]);
  const queue = [];

  const pushPage = (url, score, kind) => {
    const clean = url.replace(/\/$/, '');
    if (seen.has(clean)) return;
    seen.add(clean);
    queue.push({ url: clean, score, kind });
  };

  for (const link of collectLinks($home, homepageUrl)) {
    if (!sameSite(link.url, siteDomain)) continue;
    if (link.score >= 50) pushPage(link.url, link.score, link.kind);
  }

  const origin = new URL(homepageUrl).origin;
  for (const path of COMMON_PATHS) {
    pushPage(`${origin}${path}`, 40, classifyLink(path).kind);
  }

  queue.sort((a, b) => b.score - a.score);
  const cap = Math.max(1, Math.min(Number(maxPages) || crawl.maxPages, 40));
  let fetches = 0;
  let skippedByRobots = 0;

  while (queue.length && fetches < cap - 1) {
    const next = queue.shift();
    fetches += 1;
    try {
      if (respectRobots) {
        const allowed = await isCrawlAllowed(next.url, crawl.userAgent);
        if (!allowed) {
          skippedByRobots += 1;
          onProgress({ url: next.url, status: 'blocked', message: 'Disallowed by robots.txt' });
          continue;
        }
      }
      const page = await fetchPage(next.url, { timeoutMs: crawl.requestTimeoutMs });
      if (!page.viaReader && !/text\/html|application\/xhtml/i.test(page.contentType || '')) continue;
      const $ = cheerio.load(page.text);
      const pageEmails = extractEmailsFromHtml(page.text, page.url);
      const text = $('body').text().replace(/\s+/g, ' ').trim();
      pages.push({ url: page.url, title: $('title').first().text().trim(), text, emails: pageEmails });
      onProgress({
        url: page.url,
        status: 'ok',
        message: `${pageEmails.length ? `${pageEmails.length} email address(es)` : 'no email address'}${
          page.viaReader ? ' (via reader fallback)' : ''
        }`,
      });

      for (const link of collectLinks($, page.url)) {
        if (!sameSite(link.url, siteDomain)) continue;
        if (link.score >= 50) pushPage(link.url, link.score, link.kind);
      }
    } catch (error) {
      onProgress({ url: next.url, status: 'error', message: error.message });
    }
    if (crawl.delayMs > 0) await sleep(crawl.delayMs);
  }

  const emailMap = new Map();
  for (const page of pages) {
    for (const candidate of page.emails) {
      const existing = emailMap.get(candidate.email);
      if (!existing) {
        emailMap.set(candidate.email, candidate);
      } else if (existing.sourceType !== 'careers' && candidate.sourceType === 'careers') {
        emailMap.set(candidate.email, candidate);
      }
    }
  }

  return {
    homepageUrl,
    siteDomain,
    pages,
    emails: [...emailMap.values()],
    homepageText: pages[0].text,
    homepageTitle: pages[0].title,
    skippedByRobots,
    pagesFetched: pages.length,
  };
}
