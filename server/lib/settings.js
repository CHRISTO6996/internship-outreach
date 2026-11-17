import { all, get, run, nowIso } from '../db/index.js';

export const DEFAULT_SETTINGS = {
  profile: {
    fullName: '',
    college: '',
    branch: '',
    phone: '',
    contactEmail: '',
    portfolioUrl: '',
    linkedinUrl: '',
    resumeFileName: null,
    resumeOriginalName: null,
    resumeUploadedAt: null,
  },
  sending: {
    requireApproval: true,
    dailyLimit: 20,
    minDelaySeconds: 60,
    maxDelaySeconds: 180,
    sendWindowStart: '09:00',
    sendWindowEnd: '18:00',
    weekdaysOnly: true,
  },
  followUp: {
    enabled: false,
    days: 7,
    maxFollowUps: 1,
    requireApproval: false,
  },
  discovery: {
    maxPages: 12,
    useHunter: true,
    verifyTopCandidates: 3,
    preferApiProviders: true,
  },
  sheets: {
    spreadsheetId: null,
    lastSyncedAt: null,
    lastError: null,
  },
  template: {
    subject: 'Application for Internship Opportunity',
    body: [
      'Dear Hiring Team,',
      '',
      'I hope you are doing well.',
      '',
      'I am interested in applying for an internship opportunity at {{companyName}}. I am eager to learn, improve my technical skills, and gain practical industry experience.',
      '',
      'I would be grateful if you could consider my application for any available internship opportunities.',
      '',
      'I have attached my resume for your reference.',
      '',
      'Thank you for your time and consideration.',
      '',
      'Best regards,',
      '{{fullName}}',
      '{{college}}',
      '{{branch}}',
      '{{phone}}',
      '{{contactEmail}}',
    ].join('\n'),
    followUpSubject: 'Following up: Application for Internship Opportunity',
    followUpBody: [
      'Dear Hiring Team,',
      '',
      'I hope this message finds you well.',
      '',
      'I recently wrote to you regarding internship opportunities at {{companyName}}. I wanted to gently follow up in case my earlier email was missed.',
      '',
      'I remain very interested in contributing to your team and would be grateful for any update you can share.',
      '',
      'Thank you for your time.',
      '',
      'Best regards,',
      '{{fullName}}',
      '{{college}}',
      '{{branch}}',
      '{{phone}}',
      '{{contactEmail}}',
    ].join('\n'),
  },
};

function mergeDeep(base, override) {
  if (Array.isArray(base)) return override ?? base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    for (const [key, value] of Object.entries(override || {})) {
      out[key] = key in base ? mergeDeep(base[key], value) : value;
    }
    return out;
  }
  return override === undefined ? base : override;
}

export function getSettings() {
  const stored = all('SELECT key, value FROM settings');
  const result = structuredClone(DEFAULT_SETTINGS);
  for (const row of stored) {
    if (!(row.key in result)) continue;
    try {
      result[row.key] = mergeDeep(result[row.key], JSON.parse(row.value));
    } catch {
      // ignore corrupt values
    }
  }
  return result;
}

export function getSetting(section) {
  return getSettings()[section];
}

export function saveSettings(patch) {
  const current = getSettings();
  const next = mergeDeep(current, patch || {});
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      JSON.stringify(next[key]),
      nowIso(),
    );
  }
  return next;
}

export function hasProfile() {
  const profile = getSettings().profile;
  return Boolean(profile.fullName && profile.college && profile.branch);
}
