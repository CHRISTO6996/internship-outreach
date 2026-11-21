import crypto from 'node:crypto';
import { access, security } from '../config.js';

export const SESSION_COOKIE = 'internship_outreach_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function secret() {
  return security.tokenEncryptionKey || access.password || 'local-development-session';
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createSessionToken(username) {
  const now = Date.now();
  const payload = base64url(JSON.stringify({ u: username, iat: now, exp: now + SESSION_TTL_MS }));
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  if (!safeEqual(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.u || !data?.exp || Number(data.exp) < Date.now()) return null;
    return String(data.u);
  } catch {
    return null;
  }
}

export function readCookie(req, name = SESSION_COOKIE) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

export function requestIsSecure(req) {
  if (req.secure) return true;
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

export function setSessionCookie(req, res, username) {
  const token = createSessionToken(username);
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (requestIsSecure(req)) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

export function clearSessionCookie(req, res) {
  const attributes = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (requestIsSecure(req)) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

export function basicAuthUser(req) {
  if (!access.enabled) return null;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  const username = separator === -1 ? decoded : decoded.slice(0, separator);
  const password = separator === -1 ? '' : decoded.slice(separator + 1);
  if (safeEqual(username, access.username) && safeEqual(password, access.password)) return username;
  return null;
}

/** Returns the signed-in username, or null when the request is unauthenticated. */
export function sessionUser(req) {
  if (!access.enabled) return access.username || 'local';
  const basic = basicAuthUser(req);
  if (basic) return basic;
  return verifySessionToken(readCookie(req));
}

export function credentialsMatch(username, password) {
  if (!access.enabled) return false;
  return safeEqual(username, access.username) && safeEqual(password, access.password);
}
