import { hunter, zeroBounce } from '../config.js';
import { fetchJson } from '../lib/http.js';
import { displayDomain } from '../lib/domains.js';
import { isValidEmailSyntax } from './extract.js';
import { checkMx } from './mx.js';

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
 * syntax -> DNS MX -> ZeroBounce -> Hunter verifier -> unverified.
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

  if (zeroBounce.apiKey) {
    try {
      const result = await viaZeroBounce(address);
      return { ...result, mxValid: mx.valid };
    } catch (error) {
      // Fall through to other verification rather than silently claiming "verified".
      if (hunter.apiKey) {
        try {
          const result = await viaHunter(address);
          return { ...result, detail: `${result.detail} (ZeroBounce error: ${error.message})`, mxValid: mx.valid };
        } catch (hunterError) {
          return {
            verification: 'unverified',
            provider: 'dns',
            detail: `MX present, verification APIs failed (${error.message}; ${hunterError.message})`,
            mxValid: mx.valid,
          };
        }
      }
      return {
        verification: 'unverified',
        provider: 'dns',
        detail: `MX present, ZeroBounce error: ${error.message}`,
        mxValid: mx.valid,
      };
    }
  }

  if (hunter.apiKey) {
    try {
      const result = await viaHunter(address);
      return { ...result, mxValid: mx.valid };
    } catch (error) {
      return {
        verification: 'unverified',
        provider: 'dns',
        detail: `MX present, Hunter error: ${error.message}`,
        mxValid: mx.valid,
      };
    }
  }

  return {
    verification: mx.valid ? 'unverified' : 'unverified',
    provider: 'dns',
    detail: mx.valid
      ? 'Domain accepts mail (MX records found); no email verification API configured'
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
