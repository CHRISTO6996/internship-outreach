import { Router } from 'express';
import { z } from 'zod';
import {
  google,
  googleOAuthConfigured,
  integrationStatus,
  search,
  zeroBounce,
  hunter,
  clientBaseUrlForRequest,
} from '../config.js';
import { parseBody } from '../lib/validate.js';
import { webSearch, searchAvailability } from '../services/search.js';
import { verifyEmail } from '../services/verify.js';
import { get, all } from '../db/index.js';
import { IntegrationError, ValidationError } from '../lib/errors.js';
import { logActivity } from '../lib/activity.js';
import {
  GOOGLE_SCOPES,
  completeAuthorization,
  createAuthorizationUrl,
  disconnectGoogle,
} from '../services/google.js';

export const integrationsRouter = Router();

function envChecklist() {
  return [
    { key: 'SERPAPI_KEY', label: 'SerpAPI key', set: Boolean(search.serpApiKey), group: 'Search' },
    { key: 'GOOGLE_CSE_KEY', label: 'Google CSE key', set: Boolean(search.googleApiKey), group: 'Search' },
    { key: 'GOOGLE_CSE_CX', label: 'Google CSE engine ID', set: Boolean(search.googleCx), group: 'Search' },
    { key: 'HUNTER_API_KEY', label: 'Hunter.io key', set: Boolean(hunter.apiKey), group: 'Discovery' },
    { key: 'ZEROBOUNCE_API_KEY', label: 'ZeroBounce key', set: Boolean(zeroBounce.apiKey), group: 'Verification' },
    { key: 'GOOGLE_CLIENT_ID', label: 'Google OAuth client ID', set: Boolean(google.clientId), group: 'Google' },
    { key: 'GOOGLE_CLIENT_SECRET', label: 'Google OAuth client secret', set: Boolean(google.clientSecret), group: 'Google' },
    {
      key: 'GOOGLE_SHEETS_SPREADSHEET_ID',
      label: 'Google Sheet ID',
      set: Boolean(google.sheetsSpreadsheetId),
      group: 'Google',
    },
  ];
}

integrationsRouter.get('/', (req, res) => {
  const accounts = all(
    `SELECT id, email, is_default AS isDefault, token_expiry AS tokenExpiry, updated_at AS updatedAt
     FROM oauth_accounts WHERE provider = 'google'`,
  );
  res.json({
    integrations: integrationStatus(),
    env: envChecklist(),
    search: searchAvailability(),
    google: {
      configured: googleOAuthConfigured,
      redirectUri: google.redirectUri,
      accounts,
      sheetsSpreadsheetId: google.sheetsSpreadsheetId || null,
      scopes: GOOGLE_SCOPES,
    },
  });
});

integrationsRouter.get('/google/start', (req, res, next) => {
  try {
    res.redirect(createAuthorizationUrl());
  } catch (error) {
    const target = new URL('/integrations', clientBaseUrlForRequest(req));
    target.searchParams.set('google', 'error');
    target.searchParams.set('message', error.message);
    res.redirect(target.toString());
  }
});

integrationsRouter.get('/google/callback', async (req, res) => {
  const target = new URL('/integrations', clientBaseUrlForRequest(req));
  try {
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    if (!req.query.code) throw new Error('Google did not return an authorisation code');
    const result = await completeAuthorization(String(req.query.code), String(req.query.state || ''));
    target.searchParams.set('google', 'connected');
    target.searchParams.set('email', result.email);
  } catch (error) {
    target.searchParams.set('google', 'error');
    target.searchParams.set('message', error.message);
  }
  res.redirect(target.toString());
});

integrationsRouter.post('/google/disconnect', (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email : null;
  res.json(disconnectGoogle(email));
});

integrationsRouter.post('/test/search', async (req, res, next) => {
  try {
    const body = parseBody(
      z.object({ query: z.string().trim().min(2).max(200).default('internship contact page') }),
      req.body,
    );
    const results = await webSearch(body.query, { num: 3 });
    res.json({ ok: true, query: body.query, resultCount: results.length, results });
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post('/test/verification', async (req, res, next) => {
  try {
    const body = parseBody(z.object({ email: z.string().trim().email('Enter a valid email address') }), req.body);
    const result = await verifyEmail(body.email);
    res.json({ ok: result.verification !== 'invalid', email: body.email, ...result });
  } catch (error) {
    next(error);
  }
});

integrationsRouter.get('/:key/guide', (req, res) => {
  const entry = integrationStatus().find((item) => item.key === req.params.key);
  if (!entry) throw new ValidationError('Unknown integration');
  res.json({
    ...entry,
    steps: guideFor(entry.key),
    envExample: '.env.example in the project root documents every variable.',
  });
});

function guideFor(key) {
  const shared = [
    'Copy .env.example to .env.',
    'Paste the credentials into .env (never into the browser or source files).',
    'Restart the server so the new environment variables are loaded.',
    'Return here: the integration will show as Configured.',
  ];
  switch (key) {
    case 'gmail':
    case 'sheets':
      return [
        'Create a Google Cloud project and enable the Gmail API (and Google Sheets API for sheets).',
        'Configure the OAuth consent screen. Add your Gmail address as a test user while the app is unverified.',
        'Create an OAuth 2.0 Client ID of type "Web application".',
        `Add the authorised redirect URI exactly as: ${google.redirectUri}`,
        'Copy the client ID and secret into GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.',
        'Set TOKEN_ENCRYPTION_KEY to a long random string so refresh tokens are encrypted at rest.',
        'Restart the server, then use "Connect Gmail" on this page.',
      ];
    case 'search':
      return [
        'SerpAPI: create an account at serpapi.com and copy the API key into SERPAPI_KEY.',
        'Or Google: enable Custom Search API, create a Programmable Search Engine, then set GOOGLE_CSE_KEY and GOOGLE_CSE_CX.',
        'Set SEARCH_PROVIDER=serpapi or google_cse to force a provider (auto is the default).',
        ...shared.slice(2),
      ];
    case 'hunter':
      return [
        'Create a Hunter.io account and open Dashboard → API.',
        'Copy the API key into HUNTER_API_KEY.',
        ...shared.slice(2),
      ];
    case 'zerobounce':
      return [
        'Create a ZeroBounce account and copy your API key from the dashboard.',
        'Paste it into ZEROBOUNCE_API_KEY. Verification credits are consumed per address checked.',
        ...shared.slice(2),
      ];
    default:
      return shared;
  }
}

export function requireIntegration(key) {
  const entry = integrationStatus().find((item) => item.key === key);
  if (!entry?.configured) {
    throw new IntegrationError(`${entry?.name || key} is not configured.`, {
      integration: key,
      env: entry?.requiredEnv || [],
    });
  }
  return entry;
}

export function googleAccount() {
  return get(
    `SELECT * FROM oauth_accounts WHERE provider = 'google' AND is_default = 1 ORDER BY id DESC LIMIT 1`,
  );
}

export function audit(action, message, level = 'info') {
  logActivity({ action, message, level });
}
