import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(here, '..');

function resolvePath(value, fallback) {
  const target = value?.trim() || fallback;
  return path.isAbsolute(target) ? target : path.resolve(rootDir, target);
}

export const dataDir = resolvePath(process.env.DATA_DIR, 'data');
export const databasePath = resolvePath(process.env.DATABASE_PATH, path.join(dataDir, 'app.db'));
export const uploadDir = path.join(dataDir, 'uploads');
export const resumeDir = path.join(dataDir, 'resumes');

for (const dir of [dataDir, uploadDir, resumeDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const env = (key) => (process.env[key] || '').trim();

export const server = {
  port: Number(env('PORT') || 4000),
  host: env('HOST') || '127.0.0.1',
  nodeEnv: env('NODE_ENV') || 'development',
  appBaseUrl: env('APP_BASE_URL') || `http://localhost:${Number(env('PORT') || 4000)}`,
  logLevel: env('LOG_LEVEL') || 'info',
};

export const client = {
  // Where the browser app lives. OAuth callbacks land on the API and then redirect here.
  baseUrl:
    env('CLIENT_BASE_URL') ||
    (server.nodeEnv === 'production' ? server.appBaseUrl : 'http://localhost:5173'),
};

/**
 * Redirect target for OAuth callbacks. An explicit CLIENT_BASE_URL always wins.
 * Otherwise, when a production build exists, return to the same origin that
 * served the callback so `npm start` works without extra configuration.
 */
export function clientBaseUrlForRequest(req) {
  const explicit = env('CLIENT_BASE_URL');
  if (explicit) return explicit;
  if (fs.existsSync(path.join(rootDir, 'dist', 'index.html'))) {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.get('host') || `localhost:${server.port}`)
      .split(',')[0]
      .trim();
    return `${proto}://${host}`;
  }
  return client.baseUrl;
}

/** Backend origin, used to build OAuth callback URLs behind a reverse proxy. */
export function apiBaseUrlForRequest(req) {
  const explicit = env('APP_BASE_URL');
  if (explicit) return explicit.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || `localhost:${server.port}`)
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

export const crawl = {
  userAgent:
    env('CRAWL_USER_AGENT') ||
    'InternshipOutreachBot/0.1 (+contact: local operator; respects robots.txt)',
  maxPages: Number(env('CRAWL_MAX_PAGES') || 12),
  requestTimeoutMs: Number(env('CRAWL_TIMEOUT_MS') || 12000),
  maxPageBytes: Number(env('CRAWL_MAX_PAGE_BYTES') || 2_000_000),
  delayMs: Number(env('CRAWL_DELAY_MS') || 250),
};

export const search = {
  provider: env('SEARCH_PROVIDER') || 'auto', // auto | serpapi | google_cse | none
  serpApiKey: env('SERPAPI_KEY'),
  googleApiKey: env('GOOGLE_CSE_KEY') || env('GOOGLE_API_KEY'),
  googleCx: env('GOOGLE_CSE_CX'),
};

export const hunter = { apiKey: env('HUNTER_API_KEY') };
export const zeroBounce = { apiKey: env('ZEROBOUNCE_API_KEY') };
export const apollo = { apiKey: env('APOLLO_API_KEY') };
export const snov = { clientId: env('SNOV_CLIENT_ID'), clientSecret: env('SNOV_CLIENT_SECRET') };

const configuredRedirectUri = env('GOOGLE_REDIRECT_URI');

export const google = {
  clientId: env('GOOGLE_CLIENT_ID'),
  clientSecret: env('GOOGLE_CLIENT_SECRET'),
  redirectUri:
    configuredRedirectUri || `http://localhost:${Number(env('PORT') || 4000)}/api/integrations/google/callback`,
  redirectUriConfigured: Boolean(configuredRedirectUri),
  sheetsSpreadsheetId: env('GOOGLE_SHEETS_SPREADSHEET_ID'),
};

/** Explicit env value wins; otherwise derive from the request so Vercel rewrites work. */
export function redirectUriForRequest(req) {
  if (google.redirectUriConfigured) return google.redirectUri;
  return `${apiBaseUrlForRequest(req)}/api/integrations/google/callback`;
}

export const security = {
  tokenEncryptionKey: env('TOKEN_ENCRYPTION_KEY'),
  // Comma separated list of Google account emails allowed to authorize. Empty = any.
  allowedSenderEmails: env('ALLOWED_SENDER_EMAILS')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean),
};

export const access = {
  username: env('AUTH_USERNAME') || 'admin',
  password: env('AUTH_PASSWORD'),
  enabled: Boolean(env('AUTH_PASSWORD')),
  // Escape hatch for a trusted private network only. Never enable on the public internet.
  allowPublicNoAuth: env('ALLOW_PUBLIC_NO_AUTH') === 'true',
};

export const sending = {
  // Hard safety ceiling regardless of dashboard settings.
  absoluteDailyLimit: Number(env('ABSOLUTE_DAILY_LIMIT') || 40),
  dryRun: env('SEND_DRY_RUN') === 'true',
};

export const searchConfigured =
  (search.provider === 'serpapi' && Boolean(search.serpApiKey)) ||
  (search.provider === 'google_cse' && Boolean(search.googleApiKey && search.googleCx)) ||
  (search.provider === 'auto' && Boolean((search.serpApiKey) || (search.googleApiKey && search.googleCx)));

export function activeSearchProvider() {
  if (search.provider === 'serpapi') return search.serpApiKey ? 'serpapi' : null;
  if (search.provider === 'google_cse') return search.googleApiKey && search.googleCx ? 'google_cse' : null;
  if (search.provider === 'none') return null;
  if (search.serpApiKey) return 'serpapi';
  if (search.googleApiKey && search.googleCx) return 'google_cse';
  return null;
}

export const googleOAuthConfigured = Boolean(google.clientId && google.clientSecret);

export const integrations = [
  {
    key: 'search',
    name: 'Web Search',
    category: 'Discovery',
    configured: searchConfigured,
    requiredEnv: ['SERPAPI_KEY', 'or GOOGLE_CSE_KEY + GOOGLE_CSE_CX'],
    description:
      'Resolves a company name to its official website. Without it you can still add companies with an explicit website/domain.',
    docsUrl: 'https://serpapi.com/',
    alternatives: 'SerpAPI or Google Programmable Search (Custom Search JSON API)',
  },
  {
    key: 'hunter',
    name: 'Hunter.io',
    category: 'Discovery',
    configured: Boolean(hunter.apiKey),
    requiredEnv: ['HUNTER_API_KEY'],
    description: 'Finds publicly listed professional email addresses for a company domain.',
    docsUrl: 'https://hunter.io/api-documentation',
    alternatives: null,
  },
  {
    key: 'zerobounce',
    name: 'ZeroBounce',
    category: 'Verification',
    configured: Boolean(zeroBounce.apiKey),
    requiredEnv: ['ZEROBOUNCE_API_KEY'],
    description: 'Verifies deliverability before any email is sent. Invalid addresses are never emailed.',
    docsUrl: 'https://www.zerobounce.net/docs/',
    alternatives: 'Hunter email verifier is used as a fallback when configured',
  },
  {
    key: 'apollo',
    name: 'Apollo.io',
    category: 'Discovery',
    configured: Boolean(apollo.apiKey),
    requiredEnv: ['APOLLO_API_KEY'],
    description: 'Optional enrichment for public professional contacts.',
    docsUrl: 'https://apolloio.github.io/apollo-api-docs/',
    alternatives: null,
  },
  {
    key: 'gmail',
    name: 'Gmail (sending + replies)',
    category: 'Google',
    configured: googleOAuthConfigured,
    requiredEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    description:
      'OAuth 2.0 access to send individual internship requests and to read replies in your inbox.',
    docsUrl: 'https://developers.google.com/gmail/api/quickstart/nodejs',
    alternatives: null,
  },
  {
    key: 'sheets',
    name: 'Google Sheets',
    category: 'Google',
    configured: googleOAuthConfigured,
    requiredEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    description:
      'Mirrors the company tracker into a Google Sheet (the internal database always stays authoritative). Set GOOGLE_SHEETS_SPREADSHEET_ID to target an existing sheet, or one will be created on first sync.',
    docsUrl: 'https://developers.google.com/sheets/api',
    alternatives: 'Excel/CSV export is always available',
  },
];

export function integrationStatus() {
  return integrations.map((integration) => ({ ...integration }));
}
