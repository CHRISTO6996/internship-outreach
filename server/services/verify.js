import { hunter, pingutil, zeroBounce } from '../config.js';
import { fetchJson } from '../lib/http.js';
import { displayDomain } from '../lib/domains.js';
import { isValidEmailSyntax } from './extract.js';
import { checkMx } from './mx.js';
import { pingutilVerify } from './pingutil.js';

const ZEROBOUNCE_MAP = {
  valid: 'verified',
  invalid: 'invalid',
  'catch-all': 'catch_all',
  unknown: 'unverified',
  spamtrap: 'invalid',
  abuse: 'invalid',
  do_not_mail: 'invalid',
};

const HUNTER_RESULT_MAP = {
  deliverable: 'verified',
  undeliverable: 'invalid',
  risky: 'catch_all',
  unknown: 'unverified',
};

function mapHunterStatus(status) {
  if (!status) return null;
  if (status === 'valid') return 'verified';
  if (status === 'invalid') return 'invalid';
  if (status === 'accept_all') return 'catch_all';
  if (status === 'disposable' || status === 'webmail') return 'unverified';
  return null;
}

async function viaZeroBounce(email) {
  const url = new URL('https://api.zerobounce.net/v2/validate');
  url.searchParams.set('api_key', zeroBounce.apiKey);
  url.searchParams.set('email', email);
  const json = await fetchJson(url.toString(), { timeoutMs: 20000 });
  if (json.error) throw new Error(json.error);
  const status = String(json.status || '').toLowerCase();
  const verification = ZEROBOUNCE_MAP[status] || 'unverified';
  return {
    verification,
    provider: 'zerobounce',
    detail: [status, json.sub_status, json.did_you_mean].filter(Boolean).join(' / ') || status,
  };
}

async function viaHunter(email) {
  const url = new URL('https://api.hunter.io/v2/email-verifier');
  url.searchParams.set('email', email);
  url.searchParams.set('api_key', hunter.apiKey);
  const json = await fetchJson(url.toString(), { timeoutMs: 20000 });
  const data = json.data || {};
  const verification =
    HUNTER_RESULT_MAP[String(data.result || '').toLowerCase()] ||
    mapHunterStatus(String(data.status || '').toLowerCase()) ||
    'unverified';
  return {
    verification,
    provider: 'hunter',
    detail: [data.result, data.status, data.score != null ? `score ${data.score}` : null]
      .filter(Boolean)
      .join(' / ') || 'hunter',
  };
}

/**
 * Verify a discovered email using real checks only:
 * syntax -> DNS MX -> Pingutil -> ZeroBounce -> Hunter verifier -> unverified.
 */
export async function verifyEmail(email) {
  const address = String(email || '').trim().toLowerCase();
  if (!isValidEmailSyntax(address)) {
    return { verification: 'invalid', provider: 'syntax', detail: 'Invalid email syntax', mxValid: false };
  }

  const domain = displayDomain(address.split('@')[1]);
  const mx = await checkMx(domain);
  if (mx.valid === false) {
    return {
      verification: 'invalid',
      provider: 'dns',
      detail: mx.reason || 'Domain has no mail exchanger (MX) records',
      mxValid: false,
    };
  }

  const providers = [];
  if (pingutil.apiKey) providers.push({ name: 'Pingutil', run: () => pingutilVerify(address) });
  if (zeroBounce.apiKey) providers.push({ name: 'ZeroBounce', run: () => viaZeroBounce(address) });
  if (hunter.apiKey) providers.push({ name: 'Hunter', run: () => viaHunter(address) });

  const failures = [];
  let inconclusive = null;
  for (const provider of providers) {
    try {
      const result = await provider.run();
      if (!result) continue;
      // "unknown"/"unverified" means this provider could not prove anything, so
      // give the next provider a chance before settling on the weak answer.
      if (result.verification === 'unverified' || result.verification === 'unknown') {
        inconclusive = inconclusive || result;
        continue;
      }
      return { ...result, mxValid: mx.valid };
    } catch (error) {
      // Fall through to the next provider rather than silently claiming "verified".
      failures.push(`${provider.name}: ${error.message}`);
    }
  }

  if (inconclusive) {
    return {
      ...inconclusive,
      detail: `${inconclusive.detail}${
        failures.length ? `; other providers failed (${failures.join('; ')})` : ''
      }`,
      mxValid: mx.valid,
    };
  }

  return {
    verification: 'unverified',
    provider: 'dns',
    detail: mx.valid
      ? `Domain accepts mail (MX records found)${
          failures.length
            ? `; verification APIs failed (${failures.join('; ')})`
            : '; no email verification API configured'
        }`
      : `MX lookup inconclusive: ${mx.reason || 'unknown'}`,
    mxValid: mx.valid,
  };
}

export function verificationRank(verification) {
  switch (verification) {
    case 'verified':
      return 4;
    case 'catch_all':
      return 3;
    case 'unverified':
      return 2;
    case 'unknown':
      return 1;
    case 'invalid':
      return 0;
    default:
      return 1;
  }
}
