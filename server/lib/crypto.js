import crypto from 'node:crypto';
import { security } from '../config.js';
import { ValidationError } from './errors.js';

const PREFIX = 'enc:v1:';

function key() {
  if (!security.tokenEncryptionKey) return null;
  return crypto.createHash('sha256').update(security.tokenEncryptionKey).digest();
}

function requireKey() {
  const value = key();
  if (!value) {
    throw new ValidationError(
      'TOKEN_ENCRYPTION_KEY is not set. Add a long random string to .env and restart the server before connecting Google.',
    );
  }
  return value;
}

/**
 * Encrypt a secret for storage in SQLite. Format: enc:v1:<iv>:<tag>:<ciphertext> (base64 parts).
 * Tokens are never written to disk in plain text when a key is configured.
 */
export function encryptSecret(value) {
  if (!value) return null;
  const keyBytes = requireKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/** Decrypt a stored secret. Plain values from older rows are returned unchanged. */
export function decryptSecret(payload) {
  if (!payload) return null;
  if (!String(payload).startsWith(PREFIX)) return payload;
  const keyBytes = requireKey();
  const [ivPart, tagPart, dataPart] = String(payload).slice(PREFIX.length).split(':');
  if (!ivPart || !tagPart || !dataPart) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes, Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function hasEncryptionKey() {
  return Boolean(key());
}
