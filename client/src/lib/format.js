export function formatDate(value, { withTime = true } = {}) {
  if (!value) return '—';
  let date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    // SQLite datetime('now') is UTC without a timezone marker.
    date = new Date(`${value}Z`);
  }
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function relativeTime(value) {
  if (!value) return '—';
  let date = new Date(value);
  if (Number.isNaN(date.getTime())) date = new Date(`${value}Z`);
  if (Number.isNaN(date.getTime())) return '—';
  const diff = Date.now() - date.getTime();
  const abs = Math.abs(diff);
  const units = [
    ['year', 31536000000],
    ['month', 2592000000],
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) {
      const rounded = Math.round(diff / ms);
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-rounded, unit);
    }
  }
  return 'just now';
}

export function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export const STATUS_META = {
  pending: { label: 'Not Started', tone: 'slate' },
  discovering: { label: 'Finding Email', tone: 'blue' },
  ready: { label: 'Email Found', tone: 'emerald' },
  email_not_found: { label: 'Email Not Found', tone: 'amber' },
  error: { label: 'Error', tone: 'rose' },
};

export const VERIFICATION_META = {
  verified: { label: 'Verified', tone: 'emerald' },
  unverified: { label: 'Unverified', tone: 'amber' },
  invalid: { label: 'Invalid', tone: 'rose' },
  catch_all: { label: 'Catch-all', tone: 'violet' },
  unknown: { label: 'Unknown', tone: 'slate' },
};

export const CATEGORY_META = {
  hr: 'HR',
  recruitment: 'Recruitment',
  careers: 'Careers',
  internship: 'Internship',
  general: 'General',
  other: 'Other',
};

export const REPLY_META = {
  positive: { label: 'Positive response', tone: 'emerald' },
  opportunity: { label: 'Internship available', tone: 'emerald' },
  resume_requested: { label: 'Resume requested', tone: 'blue' },
  interview: { label: 'Interview invitation', tone: 'violet' },
  rejection: { label: 'Rejection', tone: 'rose' },
  no_response: { label: 'No response', tone: 'slate' },
  other: { label: 'Other', tone: 'slate' },
};

export const SEND_STATUS_META = {
  awaiting_approval: { label: 'Awaiting approval', tone: 'amber' },
  queued: { label: 'Queued', tone: 'blue' },
  sending: { label: 'Sending', tone: 'violet' },
  sent: { label: 'Sent', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
  skipped: { label: 'Skipped', tone: 'slate' },
};

export const FOLLOWUP_STATUS_META = {
  pending: { label: 'Scheduled', tone: 'blue' },
  queued: { label: 'Queued to send', tone: 'amber' },
  sent: { label: 'Sent', tone: 'emerald' },
  skipped: { label: 'Skipped', tone: 'slate' },
  failed: { label: 'Failed', tone: 'rose' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
};

export function renderTemplate(template, values) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    const value = values[key];
    return value === undefined || value === null || value === '' ? '' : String(value);
  });
}
