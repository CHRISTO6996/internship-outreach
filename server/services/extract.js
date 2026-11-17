import * as cheerio from 'cheerio';
import {
  BLOCKED_LOCAL_PARTS,
  FREE_EMAIL_DOMAINS,
  categorizeEmail,
  displayDomain,
  isBlockedEmailDomain,
} from '../lib/domains.js';

const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi;
const FILE_TLDS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff', 'avif',
  'css', 'js', 'mjs', 'json', 'xml', 'txt', 'pdf', 'zip', 'rar', 'gz', 'tar',
  'mp3', 'mp4', 'webm', 'mov', 'avi', 'woff', 'woff2', 'ttf', 'eot', 'otf',
  'html', 'htm', 'php', 'aspx', 'jsp',
]);

const NOISE_LOCAL_PARTS = new Set([
  'example', 'test', 'your', 'yourname', 'name', 'email', 'username', 'user',
  'firstname', 'lastname', 'someone', 'john', 'jane', 'info@example',
]);

function cleanContext(value, limit = 240) {
  return String(value || '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

/** Keep only the mailbox being scored so adjacent addresses cannot skew its category. */
function withoutOtherEmails(value, targetEmail) {
  const target = normalizeEmail(targetEmail);
  return cleanContext(
    String(value || '').replace(EMAIL_RE, (match) => (normalizeEmail(match) === target ? match : ' ')),
  );
}

function contextAround(text, index, length, email) {
  const raw = String(text || '');
  const position = Number(index || 0);
  const endPosition = position + Number(length || 0);
  const previousBoundary = Math.max(raw.lastIndexOf('|', position), raw.lastIndexOf('\n', position));
  const followingBoundaries = [raw.indexOf('|', endPosition), raw.indexOf('\n', endPosition)].filter(
    (value) => value !== -1,
  );
  const nextBoundary = followingBoundaries.length ? Math.min(...followingBoundaries) : raw.length;
  const start = Math.max(previousBoundary + 1, position - 100);
  const end = Math.min(nextBoundary, endPosition + 100);
  return withoutOtherEmails(raw.slice(start, end), email);
}

function contextForMailto($, element, href, email) {
  const parts = [];
  const container = $(element).closest('p, li, tr, td, dd, figcaption').first();
  const containerText = container.length ? String(container.text()).replace(/\s+/g, ' ').trim() : '';
  if (containerText && containerText.length <= 160) parts.push(containerText);

  const parent = $(element).parent();
  const siblings = parent.contents();
  const position = siblings.index(element);
  if (position >= 0) {
    const from = Math.max(0, position - 2);
    const to = Math.min(siblings.length - 1, position + 2);
    for (let index = from; index <= to; index += 1) {
      const text =
        index === position
          ? $(element).text()
          : $(siblings[index]).text();
      if (text) parts.push(text);
    }
  } else {
    parts.push(parent.text());
  }
  parts.push($(element).text(), href);
  return withoutOtherEmails(parts.filter(Boolean).join(' | '), email);
}

export function deobfuscate(text) {
  return String(text || '')
    .replace(/\s*(?:\[|\(|\{)\s*at\s*(?:\]|\)|\})\s*/gi, '@')
    .replace(/\s+(?:at)\s+/gi, '@')
    .replace(/\s*(?:\[|\(|\{)\s*dot\s*(?:\]|\)|\})\s*/gi, '.')
    .replace(/\s+(?:dot)\s+/gi, '.')
    .replace(/&#0*64;|&commat;/gi, '@')
    .replace(/&#0*46;|&period;/gi, '.')
    .replace(/%40/gi, '@')
    .replace(/\s+@\s+/g, '@')
    .replace(/\s*\.\s*(?=[a-z]{2,24}\b)/gi, '.');
}

export function normalizeEmail(raw) {
  let value = String(raw || '').trim().toLowerCase();
  value = value.replace(/^mailto:/, '').split('?')[0];
  value = value.replace(/^[<("'\s]+/, '').replace(/[>)"'.,;:\s]+$/, '');
  value = value.replace(/^(?:e-?mail|contact|write to)\s*:?\s*/i, '');
  return value;
}

export function isValidEmailSyntax(email) {
  if (typeof email !== 'string') return false;
  if (email.length < 6 || email.length > 254) return false;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i.test(domain)) return false;
  const tld = domain.split('.').pop().toLowerCase();
  if (FILE_TLDS.has(tld)) return false;
  if (domain.endsWith('.local') || domain.endsWith('.internal') || domain.endsWith('.invalid')) return false;
  return true;
}

export function isUsefulEmail(email) {
  if (!isValidEmailSyntax(email)) return false;
  const [local, domain] = email.split('@');
  if (!local || !domain) return false;
  if (isBlockedEmailDomain(domain)) return false;
  if (NOISE_LOCAL_PARTS.has(local)) return false;
  if (BLOCKED_LOCAL_PARTS.includes(local)) return false;
  if (/^(no-?reply|do-?not-?reply|mailer)/i.test(local)) return false;
  if (local.length > 40 && !/[aeiou]/i.test(local)) return false;
  if (/^[0-9a-f]{16,}$/i.test(local)) return false; // hash-like
  // Ignore long random strings often used in tracking pixels.
  if (local.length > 45) return false;
  return true;
}

/** Page-affinity classification used for scoring, stored alongside the email. */
function pageTypeOf(url) {
  const value = String(url || '').toLowerCase();
  if (/(career|jobs?|recruit|hiring|intern|talent|placement)/.test(value)) return 'careers';
  if (/(contact|kontakt|reach|impressum|imprint|get-in-touch)/.test(value)) return 'contact';
  if (/(about|company|team|who-we-are|leadership|our-story)/.test(value)) return 'about';
  return 'homepage';
}

export function extractEmailsFromHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  $('script, style, noscript, template').remove();

  const found = new Map();
  const add = (rawEmail, context) => {
    const email = normalizeEmail(rawEmail);
    if (!isUsefulEmail(email)) return;
    const pageContext = cleanContext(context);
    const existing = found.get(email);
    const category = categorizeEmail(email.split('@')[0], pageContext);
    if (existing) {
      existing.occurrences += 1;
      if (existing.category === 'other' && category !== 'other') {
        existing.category = category;
        existing.context = pageContext || existing.context;
      }
      return;
    }
    found.set(email, {
      email,
      domain: email.split('@')[1],
      localPart: email.split('@')[0],
      category,
      sourceUrl: pageUrl,
      sourceType: pageTypeOf(pageUrl),
      context: pageContext || pageTypeOf(pageUrl),
      occurrences: 1,
    });
  };

  $('a[href^="mailto:"]').each((_, element) => {
    const href = $(element).attr('href') || '';
    const decoded = (() => {
      try {
        return decodeURIComponent(href);
      } catch {
        return href;
      }
    })();
    for (const match of decoded.matchAll(EMAIL_RE)) {
      add(match[0], contextForMailto($, element, decoded, match[0]));
    }
  });

  // Visible text only. Replace element boundaries with spaces so that adjacent
  // elements ("reporting" + "abuse@…") never fuse into a fake address.
  const bodyHtml = $('body').html() || '';
  const separated = bodyHtml
    .replace(/<br[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, ' | ');
  const visible = deobfuscate(cheerio.load(`<div>${separated}</div>`).text());
  for (const match of visible.matchAll(EMAIL_RE)) {
    add(match[0], contextAround(visible, match.index, match[0].length, match[0]));
  }

  return [...found.values()];
}

/** Whether a company domain and an email domain are the same organisation. */
export function emailMatchesDomain(emailDomain, siteDomain) {
  const emailRoot = displayDomain(emailDomain);
  const siteRoot = displayDomain(siteDomain);
  if (!emailRoot || !siteRoot) return false;
  if (emailRoot === siteRoot) return true;
  return emailRoot.endsWith(`.${siteRoot}`) || siteRoot.endsWith(`.${emailRoot}`);
}

export function isFreeEmail(email) {
  return FREE_EMAIL_DOMAINS.has(displayDomain(email.split('@')[1] || ''));
}
