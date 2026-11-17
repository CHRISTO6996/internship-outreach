import crypto from 'node:crypto';
import { google as googleapis } from 'googleapis';
import { google as googleConfig, security, client as clientConfig } from '../config.js';
import { all, get, insert, nowIso, run } from '../db/index.js';
import { IntegrationError, NotFoundError, ValidationError } from '../lib/errors.js';
import { decryptSecret, encryptSecret, hasEncryptionKey } from '../lib/crypto.js';
import { logActivity } from '../lib/activity.js';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
];

const pendingStates = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

export function googleOAuthReady() {
  return Boolean(googleConfig.clientId && googleConfig.clientSecret);
}

export function oauthClient() {
  return new googleapis.auth.OAuth2(
    googleConfig.clientId || 'missing-client-id',
    googleConfig.clientSecret || 'missing-client-secret',
    googleConfig.redirectUri,
  );
}

function cleanStates() {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [state, createdAt] of pendingStates) {
    if (createdAt < cutoff) pendingStates.delete(state);
  }
}

export function createAuthorizationUrl() {
  if (!googleOAuthReady()) {
    throw new IntegrationError('Google OAuth is not configured.', {
      integration: 'gmail',
      env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    });
  }
  if (!hasEncryptionKey()) {
    throw new IntegrationError('TOKEN_ENCRYPTION_KEY is required before connecting Google.', {
      integration: 'gmail',
      env: ['TOKEN_ENCRYPTION_KEY'],
    });
  }
  cleanStates();
  const state = crypto.randomBytes(24).toString('hex');
  pendingStates.set(state, Date.now());
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state,
  });
}

function assertAllowed(email) {
  const allowed = security.allowedSenderEmails;
  if (allowed.length && !allowed.includes(String(email).toLowerCase())) {
    throw new ValidationError(
      `The Google account ${email} is not in ALLOWED_SENDER_EMAILS. Update .env or connect an allowed account.`,
    );
  }
}

export async function completeAuthorization(code, state) {
  if (!pendingStates.has(state)) {
    throw new ValidationError('This Google authorisation link expired or was already used. Start again.');
  }
  pendingStates.delete(state);

  const auth = oauthClient();
  let tokens;
  try {
    const result = await auth.getToken(code);
    tokens = result.tokens;
  } catch (error) {
    throw new IntegrationError(`Google rejected the authorisation: ${error.message}`, { integration: 'gmail' });
  }
  if (!tokens?.access_token) {
    throw new IntegrationError('Google did not return an access token.', { integration: 'gmail' });
  }
  auth.setCredentials(tokens);

  let email = '';
  try {
    const info = await googleapis.oauth2({ version: 'v2', auth }).userinfo.get();
    email = String(info.data.email || '').toLowerCase();
  } catch (error) {
    throw new IntegrationError(`Could not read the Google account profile: ${error.message}`, { integration: 'gmail' });
  }
  if (!email) throw new IntegrationError('The connected Google account has no email address.', { integration: 'gmail' });
  assertAllowed(email);

  const expiry = tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null;
  const scopes = tokens.scope || GOOGLE_SCOPES.join(' ');
  const existing = get(`SELECT * FROM oauth_accounts WHERE provider = 'google' AND email = ?`, email);
  const refreshToken = tokens.refresh_token
    ? encryptSecret(tokens.refresh_token)
    : existing?.refresh_token || null;

  run(`UPDATE oauth_accounts SET is_default = 0 WHERE provider = 'google'`);
  if (existing) {
    run(
      `UPDATE oauth_accounts SET access_token = ?, refresh_token = ?, token_expiry = ?, scopes = ?,
        is_default = 1, updated_at = ? WHERE id = ?`,
      encryptSecret(tokens.access_token),
      refreshToken,
      expiry,
      scopes,
      nowIso(),
      existing.id,
    );
  } else {
    insert(
      `INSERT INTO oauth_accounts
        (provider, email, access_token, refresh_token, token_expiry, scopes, is_default, created_at, updated_at)
       VALUES ('google', ?, ?, ?, ?, ?, 1, ?, ?)`,
      email,
      encryptSecret(tokens.access_token),
      refreshToken,
      expiry,
      scopes,
      nowIso(),
      nowIso(),
    );
  }
  logActivity({
    level: 'success',
    action: 'google_connected',
    message: `Connected Google account ${email} for Gmail sending and reply tracking.`,
  });
  return { email, scopes: String(scopes).split(/\s+/).filter(Boolean) };
}

export function defaultAccount() {
  return get(
    `SELECT * FROM oauth_accounts WHERE provider = 'google' AND is_default = 1 ORDER BY id DESC LIMIT 1`,
  );
}

export function listAccounts() {
  return all(
    `SELECT id, email, is_default AS isDefault, token_expiry AS tokenExpiry, scopes, created_at AS createdAt,
            updated_at AS updatedAt
     FROM oauth_accounts WHERE provider = 'google' ORDER BY is_default DESC, id DESC`,
  );
}

function saveRefreshedTokens(accountId) {
  return (tokens) => {
    const updates = [];
    const params = [];
    if (tokens.access_token) {
      updates.push('access_token = ?');
      params.push(encryptSecret(tokens.access_token));
    }
    if (tokens.refresh_token) {
      updates.push('refresh_token = ?');
      params.push(encryptSecret(tokens.refresh_token));
    }
    if (tokens.expiry_date) {
      updates.push('token_expiry = ?');
      params.push(new Date(tokens.expiry_date).toISOString());
    }
    if (!updates.length) return;
    updates.push('updated_at = ?');
    params.push(nowIso(), accountId);
    run(`UPDATE oauth_accounts SET ${updates.join(', ')} WHERE id = ?`, ...params);
  };
}

/**
 * Returns an authorised OAuth2 client for the default Google account.
 * Refreshed access tokens are re-encrypted and persisted.
 */
export async function authorizedClient() {
  if (!googleOAuthReady()) {
    throw new IntegrationError('Google OAuth is not configured.', {
      integration: 'gmail',
      env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    });
  }
  const account = defaultAccount();
  if (!account) {
    throw new IntegrationError('No Google account is connected. Connect Gmail on the Integrations page.', {
      integration: 'gmail',
    });
  }
  const auth = oauthClient();
  auth.setCredentials({
    access_token: decryptSecret(account.access_token) || undefined,
    refresh_token: decryptSecret(account.refresh_token) || undefined,
    expiry_date: account.token_expiry ? new Date(account.token_expiry).getTime() : undefined,
  });
  auth.on('tokens', saveRefreshedTokens(account.id));
  try {
    await auth.getAccessToken();
  } catch (error) {
    throw new IntegrationError(
      `Google authorisation for ${account.email} is no longer valid (${error.message}). Reconnect Gmail on the Integrations page.`,
      { integration: 'gmail' },
    );
  }
  return { auth, account };
}

export function disconnectGoogle(email = null) {
  const account = email
    ? get(`SELECT * FROM oauth_accounts WHERE provider = 'google' AND email = ?`, email)
    : defaultAccount();
  if (!account) throw new NotFoundError('No connected Google account found');
  run('DELETE FROM oauth_accounts WHERE id = ?', account.id);
  const next = get(`SELECT id FROM oauth_accounts WHERE provider = 'google' ORDER BY id DESC LIMIT 1`);
  if (next) run('UPDATE oauth_accounts SET is_default = 1 WHERE id = ?', next.id);
  logActivity({ level: 'warn', action: 'google_disconnected', message: `Disconnected Google account ${account.email}.` });
  return { disconnected: true, email: account.email };
}

function encodeHeader(value) {
  const text = String(value || '');
  if (!/[^\x20-\x7E]/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function foldBase64(value, width = 76) {
  return String(value).replace(new RegExp(`(.{${width}})`, 'g'), '$1\r\n');
}

function buildMime({ from, to, subject, body, attachment, inReplyTo, references, messageId }) {
  const boundaryMixed = `mixed_${crypto.randomBytes(12).toString('hex')}`;
  const boundaryAlt = `alt_${crypto.randomBytes(12).toString('hex')}`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);

  if (attachment) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundaryMixed}"`);
  } else {
    lines.push(`Content-Type: multipart/alternative; boundary="${boundaryAlt}"`);
  }
  lines.push('');

  const altPart = [
    `--${boundaryAlt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    foldBase64(Buffer.from(String(body || ''), 'utf8').toString('base64')),
    `--${boundaryAlt}--`,
  ].join('\r\n');

  if (!attachment) return lines.join('\r\n') + '\r\n' + altPart;

  const parts = [
    lines.join('\r\n'),
    `--${boundaryMixed}`,
    `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
    '',
    altPart,
    `--${boundaryMixed}`,
    `Content-Type: ${attachment.contentType || 'application/pdf'}; name="${attachment.filename || 'resume.pdf'}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${attachment.filename || 'resume.pdf'}"`,
    '',
    foldBase64(attachment.content.toString('base64')),
    `--${boundaryMixed}--`,
    '',
  ];
  return parts.join('\r\n');
}

/**
 * Send one message through the connected Gmail account.
 * `attachment` = { filename, content: Buffer, contentType }.
 */
export async function sendGmail({ toEmail, subject, body, attachment = null, threadId = null, inReplyTo = null, references = null }) {
  const { auth, account } = await authorizedClient();
  const gmail = googleapis.gmail({ version: 'v1', auth });
  const domain = account.email.split('@')[1] || 'localhost';
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  const raw = buildMime({
    from: account.email,
    to: toEmail,
    subject,
    body,
    attachment,
    inReplyTo,
    references,
    messageId,
  });
  try {
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: Buffer.from(raw, 'utf8').toString('base64url'),
        ...(threadId ? { threadId } : {}),
      },
    });
    return {
      id: response.data.id,
      threadId: response.data.threadId,
      rfcMessageId: messageId,
      labelIds: response.data.labelIds || [],
    };
  } catch (error) {
    const message = error?.response?.data?.error?.message || error.message || 'Gmail rejected the message';
    throw new IntegrationError(`Gmail could not send the message: ${message}`, { integration: 'gmail' });
  }
}

function headerMap(payload) {
  const headers = payload?.headers || [];
  const map = {};
  for (const header of headers) map[String(header.name).toLowerCase()] = header.value;
  return map;
}

function decodePart(data) {
  if (!data) return '';
  try {
    return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function extractText(payload) {
  if (!payload) return '';
  if (payload.body?.data && (!payload.parts || !payload.parts.length)) return decodePart(payload.body.data);
  if (payload.parts?.length) {
    const plain = payload.parts.find((part) => part.mimeType === 'text/plain');
    if (plain) {
      const text = extractText(plain);
      if (text) return text;
    }
    for (const part of payload.parts) {
      const text = extractText(part);
      if (text) return text;
    }
  }
  return payload.body?.data ? decodePart(payload.body.data) : '';
}

export async function getMessageMeta(messageId) {
  const { auth } = await authorizedClient();
  const gmail = googleapis.gmail({ version: 'v1', auth });
  try {
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['Message-ID', 'References', 'Subject', 'From', 'Date'],
    });
    return { id: response.data.id, threadId: response.data.threadId, headers: headerMap(response.data.payload) };
  } catch {
    return null;
  }
}

/** Fetch recent inbox messages and return normalised records. */
export async function fetchInboxMessages({ maxResults = 40, query = 'in:inbox newer_than:45d' } = {}) {
  const { auth } = await authorizedClient();
  const gmail = googleapis.gmail({ version: 'v1', auth });
  let list;
  try {
    list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults });
  } catch (error) {
    const message = error?.response?.data?.error?.message || error.message;
    throw new IntegrationError(`Gmail inbox could not be read: ${message}`, { integration: 'gmail' });
  }
  const messages = [];
  for (const item of list.data.messages || []) {
    try {
      const response = await gmail.users.messages.get({
        userId: 'me',
        id: item.id,
        format: 'full',
      });
      const data = response.data;
      const headers = headerMap(data.payload);
      messages.push({
        id: data.id,
        threadId: data.threadId,
        from: headers.from || '',
        to: headers.to || '',
        subject: headers.subject || '',
        date: headers.date || null,
        rfcMessageId: headers['message-id'] || null,
        references: headers.references || null,
        inReplyTo: headers['in-reply-to'] || null,
        snippet: data.snippet || '',
        body: extractText(data.payload).slice(0, 20000),
        labelIds: data.labelIds || [],
        internalDate: data.internalDate ? new Date(Number(data.internalDate)).toISOString() : null,
      });
    } catch {
      // Skip messages that cannot be decoded rather than failing the whole sync.
    }
  }
  return messages;
}

export function mailboxAddress(value) {
  const text = String(value || '');
  const match = text.match(/<([^>]+)>/);
  return String(match ? match[1] : text).trim().toLowerCase();
}

export function clientBaseUrl() {
  return clientConfig.baseUrl;
}
