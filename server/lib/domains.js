const LEGAL_SUFFIXES = [
  'private limited',
  'pvt ltd',
  'pvt. ltd.',
  'pvt limited',
  'limited',
  'ltd',
  'llc',
  'l.l.c.',
  'inc',
  'inc.',
  'incorporated',
  'corp',
  'corp.',
  'corporation',
  'company',
  'co.',
  'gmbh',
  'ag',
  'plc',
  'pvt',
  'private',
];

export function normalizeCompanyName(name) {
  let value = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const suffix of LEGAL_SUFFIXES) {
    const pattern = new RegExp(`(^|\\s)${suffix.replace(/\./g, '\\.')}$`);
    if (pattern.test(value)) {
      value = value.replace(pattern, '').trim();
    }
  }
  return value.replace(/\s+/g, ' ').trim();
}

export function nameTokens(name) {
  return normalizeCompanyName(name)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !['the', 'and', 'of', 'for', 'co'].includes(token));
}

export function displayDomain(hostname) {
  return String(hostname || '').replace(/^www\./i, '').toLowerCase();
}

const MULTI_PART_SUFFIXES = new Set([
  'co.in', 'co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za', 'co.il', 'co.id', 'co.th',
  'com.au', 'com.br', 'com.cn', 'com.mx', 'com.sg', 'com.tr', 'com.tw', 'com.hk',
  'com.ar', 'com.co', 'com.my', 'com.ph', 'com.pk', 'com.ng', 'com.eg',
  'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in',
  'ac.in', 'ac.uk', 'edu.in', 'edu.au', 'gov.in', 'gov.uk',
  'org.uk', 'net.uk', 'nhs.uk',
]);

/** Best-effort registrable domain ("careers.acme.co.uk" -> "acme.co.uk"). Accepts URLs too. */
export function registrableDomain(hostname) {
  let host = String(hostname || '').trim();
  if (!host) return '';
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname;
    } catch {
      /* fall through */
    }
  }
  host = displayDomain(host).split('/')[0].split(':')[0];
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.has(lastTwo)) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

export function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function sameSite(candidateUrl, siteDomain) {
  const host = hostnameOf(candidateUrl);
  if (!host) return false;
  const root = registrableDomain(host);
  return root === registrableDomain(siteDomain);
}

export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk', 'ymail.com',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com', 'aol.com',
  'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'proton.me', 'pm.me',
  'mail.com', 'gmx.com', 'gmx.net', 'zoho.com', 'zohomail.com', 'yandex.com',
  'yandex.ru', 'rediffmail.com', 'qq.com', '163.com', '126.com', 'sina.com',
]);

/** Domains that are never a company's HR contact address. */
export const BLOCKED_EMAIL_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'test.com', 'domain.com', 'email.com',
  'yourdomain.com', 'yourcompany.com', 'company.com', 'mysite.com', 'site.com',
  'sentry.io', 'sentry-next.wixpress.com', 'wixpress.com', 'wix.com', 'squarespace.com',
  'wordpress.com', 'wordpress.org', 'shopify.com', 'godaddy.com', 'cloudflare.com',
  'gstatic.com', 'google.com', 'googleapis.com', 'schema.org', 'w3.org', 'w3schools.com',
  'jquery.com', 'microsoft.com', 'apple.com', 'adobe.com', 'facebook.com', 'instagram.com',
  'twitter.com', 'x.com', 'linkedin.com', 'youtube.com', 'tiktok.com', 'pinterest.com',
  'github.com', 'gitlab.com', 'npmjs.com', 'mozilla.org', 'gravatar.com',
  'u003', 'localhost', 'invalid', 'mydomain.com', 'abc.com', 'xyz.com',
]);

export const BLOCKED_LOCAL_PARTS = [
  'no-reply', 'noreply', 'no.reply', 'donotreply', 'do-not-reply', 'mailer-daemon',
  'postmaster', 'abuse', 'webmaster', 'hostmaster', 'privacy', 'legal', 'dpo',
  'unsubscribe', 'bounce', 'bounces', 'notifications', 'notification', 'alerts',
  'support', 'help', 'helpdesk', 'sales', 'marketing', 'press', 'media', 'billing',
  'accounts', 'admin', 'administrator', 'root', 'security', 'compliance',
];

export const BLOCKED_HOSTS = new Set([
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'youtube.com',
  'tiktok.com', 'pinterest.com', 'reddit.com', 'wikipedia.org', 'wikidata.org',
  'glassdoor.com', 'indeed.com', 'naukri.com', 'monster.com', 'ambitionbox.com',
  'crunchbase.com', 'bloomberg.com', 'zaubacorp.com', 'tofler.in', 'justdial.com',
  'quora.com', 'medium.com', 'github.com', 'g2.com', 'capterra.com', 'trustpilot.com',
  'yellowpages.com', 'yell.com', 'manta.com', 'dnb.com', 'zoominfo.com', 'apollo.io',
  'hunter.io', 'rocketreach.co', 'signalhire.com', 'lusha.com', 'contactout.com',
]);

export function isBlockedHost(hostname) {
  const host = displayDomain(hostname);
  for (const blocked of BLOCKED_HOSTS) {
    if (host === blocked || host.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

export function isBlockedEmailDomain(domain) {
  const host = displayDomain(domain);
  if (!host) return true;
  if (BLOCKED_EMAIL_DOMAINS.has(host)) return true;
  for (const blocked of BLOCKED_EMAIL_DOMAINS) {
    if (blocked.length > 3 && host.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

const EMAIL_CATEGORY_RULES = [
  { category: 'internship', patterns: [/^(intern|internship|interns|trainee)/, /internship/] },
  { category: 'recruitment', patterns: [/^(recruit|recruitment|recruiting|talent|talentacquisition|ta|staffing|hiring|placement|placements)/] },
  { category: 'hr', patterns: [/^(hr|humanresources|human-resources|human_resources|hrd|people|personnel|careers?hr)/] },
  { category: 'careers', patterns: [/^(career|careers|jobs?|job|apply|employment|opportunities)/] },
  { category: 'general', patterns: [/^(info|contact|hello|hi|office|enquiry|enquiries|inquiry|general|mail|email|reach|connect|team|business|corporate)/] },
];

export function categorizeEmail(localPart) {
  const local = String(localPart || '').toLowerCase();
  for (const rule of EMAIL_CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(local))) return rule.category;
  }
  return 'other';
}

export function isPlausibleCompanyDomain(domain) {
  const host = displayDomain(domain);
  if (!host.includes('.')) return false;
  if (isBlockedHost(host)) return false;
  if (FREE_EMAIL_DOMAINS.has(host)) return false;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host);
}
