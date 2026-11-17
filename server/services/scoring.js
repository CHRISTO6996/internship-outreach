import { FREE_EMAIL_DOMAINS, nameTokens, registrableDomain } from '../lib/domains.js';
import { emailMatchesDomain } from './extract.js';
import { verificationRank } from './verify.js';

const CATEGORY_WEIGHT = {
  recruitment: 42,
  hr: 40,
  careers: 32,
  internship: 28,
  general: 12,
  other: 4,
};

const SOURCE_WEIGHT = {
  careers: 16,
  contact: 12,
  about: 6,
  homepage: 2,
  hunter: 8,
};

/**
 * Score how likely an address is the right internship contact.
 * Explanations are stored so the dashboard can justify every choice.
 */
export function scoreCandidate(candidate, { siteDomain, companyName = '' }) {
  const reasons = [];
  let score = CATEGORY_WEIGHT[candidate.category] ?? 4;
  reasons.push(`${candidate.category} address (+${CATEGORY_WEIGHT[candidate.category] ?? 4})`);

  const emailDomain = candidate.domain || candidate.email.split('@')[1];
  const root = registrableDomain(emailDomain);
  const tokens = companyName ? nameTokens(companyName) : [];
  const squashed = tokens.join('');

  if (siteDomain && emailMatchesDomain(emailDomain, siteDomain)) {
    score += 24;
    reasons.push(`matches company domain ${siteDomain} (+24)`);
  } else if (squashed.length >= 4 && root.replace(/[^a-z0-9]/g, '').includes(squashed)) {
    score += 18;
    reasons.push(`related company domain ${root} (+18)`);
  } else if (FREE_EMAIL_DOMAINS.has(root)) {
    score -= 6;
    reasons.push('free mailbox provider (-6)');
  } else {
    score -= 2;
    reasons.push('external domain (-2)');
  }

  const sourceWeight = SOURCE_WEIGHT[candidate.sourceType] ?? 0;
  if (sourceWeight) {
    score += sourceWeight;
    reasons.push(`found on ${candidate.sourceType} page (+${sourceWeight})`);
  }

  if (candidate.occurrences > 1) {
    score += Math.min(candidate.occurrences, 5);
    reasons.push(`listed ${candidate.occurrences}x (+${Math.min(candidate.occurrences, 5)})`);
  }

  if (candidate.providerConfidence != null) {
    const bonus = Math.round((candidate.providerConfidence / 100) * 10);
    score += bonus;
    reasons.push(`provider confidence ${candidate.providerConfidence}% (+${bonus})`);
  }

  const vRank = verificationRank(candidate.verification);
  score += vRank * 4;
  reasons.push(`verification ${candidate.verification || 'unverified'} (+${vRank * 4})`);

  return { score: Math.max(0, Math.min(score, 100)), reasons };
}

const PRIMARY_CATEGORIES = new Set(['hr', 'recruitment', 'careers', 'internship', 'general']);

export function pickBest(candidates) {
  // Never promote a random personal/billing/support address to the primary
  // internship contact. Only role mailboxes (or a general company mailbox) qualify.
  const eligible = candidates.filter(
    (candidate) => candidate.verification !== 'invalid' && PRIMARY_CATEGORIES.has(candidate.category),
  );
  if (!eligible.length) return null;
  return [...eligible].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return verificationRank(b.verification) - verificationRank(a.verification);
  })[0];
}
