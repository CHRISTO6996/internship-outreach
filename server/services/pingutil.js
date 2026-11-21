import { pingutil } from '../config.js';
import { fetchJson } from '../lib/http.js';

/**
 * Pingutil mailbox verification.
 * API: POST https://pingutil.com/v1/verify  { email }  (Bearer key)
 * Returns valid | invalid | risky | unknown plus a reason and score.
 */
export async function pingutilVerify(email) {
  if (!pingutil.apiKey) return null;

  const json = await fetchJson('https://pingutil.com/v1/verify', {
    method: 'POST',
    timeoutMs: 30000,
    headers: {
      authorization: `Bearer ${pingutil.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });

  const status = String(json?.status || 'unknown').toLowerCase();
  const reason = String(json?.reason || '').toLowerCase();
  const checks = json?.checks || {};

  let verification = 'unverified';
  if (status === 'valid') verification = 'verified';
  else if (status === 'invalid') verification = 'invalid';
  else if (status === 'risky') {
    if (reason === 'disposable_domain') verification = 'invalid';
    else if (reason === 'accept_all') verification = 'catch_all';
    else verification = 'unverified';
  }

  const detail = [
    status,
    reason,
    json?.score != null ? `score ${json.score}` : null,
    json?.did_you_mean ? `did you mean ${json.did_you_mean}` : null,
  ]
    .filter(Boolean)
    .join(' / ');

  return {
    verification,
    provider: 'pingutil',
    detail: detail || 'pingutil',
    mxValid: checks.has_mx === true ? true : checks.has_mx === false ? false : null,
  };
}
