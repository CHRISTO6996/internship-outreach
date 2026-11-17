import { Router } from 'express';
import { all, get } from '../db/index.js';
import { integrationStatus, googleOAuthConfigured, google, searchConfigured } from '../config.js';
import { listCompanies } from '../services/companies.js';
import { listActivity } from '../lib/activity.js';
import { getSettings } from '../lib/settings.js';
import { activeJob } from '../services/jobs.js';
import { searchAvailability } from '../services/search.js';

export const dashboardRouter = Router();

function counts() {
  const companies = get(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END), 0) AS ready,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN status = 'discovering' THEN 1 ELSE 0 END), 0) AS discovering,
      COALESCE(SUM(CASE WHEN status = 'email_not_found' THEN 1 ELSE 0 END), 0) AS emailNotFound,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS errored
    FROM companies
  `);
  const emails = get(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN verification = 'verified' THEN 1 ELSE 0 END), 0) AS verified,
      COALESCE(SUM(CASE WHEN verification = 'unverified' THEN 1 ELSE 0 END), 0) AS unverified,
      COALESCE(SUM(CASE WHEN verification = 'invalid' THEN 1 ELSE 0 END), 0) AS invalid,
      COALESCE(SUM(CASE WHEN verification = 'catch_all' THEN 1 ELSE 0 END), 0) AS catchAll
    FROM company_emails
  `);
  const sends = get(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) AS sent,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
      COALESCE(SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END), 0) AS queued
    FROM sends
  `);
  const replies = get(`
    SELECT
      COUNT(*) AS total,
      COUNT(DISTINCT company_id) AS companies,
      COALESCE(SUM(CASE WHEN classification IN ('positive','opportunity','resume_requested','interview') THEN 1 ELSE 0 END), 0) AS positive,
      COALESCE(SUM(CASE WHEN classification = 'interview' THEN 1 ELSE 0 END), 0) AS interviews
    FROM replies
  `);
  const followUps = get(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN status = 'pending' AND due_at IS NOT NULL AND due_at <= datetime('now') THEN 1 ELSE 0 END), 0) AS due
    FROM follow_ups
  `);

  return { companies, emails, sends, replies, followUps };
}

dashboardRouter.get('/stats', (req, res) => {
  const c = counts();
  const settings = getSettings();
  const activity = listActivity({ limit: 8 });
  const recent = listCompanies({ limit: 6 }).rows;
  const integrations = integrationStatus();
  const job = activeJob();

  const configured = Object.fromEntries(integrations.map((item) => [item.key, item.configured]));

  const pendingChecks = [];
  if (!settings.profile.fullName || !settings.profile.college || !settings.profile.branch) {
    pendingChecks.push({
      id: 'profile',
      severity: 'info',
      title: 'Complete your profile',
      detail: 'Your name, college and branch are used in every internship email.',
      href: '/settings',
    });
  }
  if (!searchConfigured) {
    pendingChecks.push({
      id: 'search',
      severity: 'warning',
      title: 'Web search is not configured',
      detail:
        'Company names can only be resolved when a website is supplied. Add SERPAPI_KEY or Google CSE credentials.',
      href: '/integrations',
    });
  }
  if (!configured.zerobounce) {
    pendingChecks.push({
      id: 'zerobounce',
      severity: 'info',
      title: 'No email verification API',
      detail: 'Addresses are checked with DNS MX only and will be marked Unverified. Add ZEROBOUNCE_API_KEY.',
      href: '/integrations',
    });
  }
  if (!configured.gmail) {
    pendingChecks.push({
      id: 'gmail',
      severity: 'warning',
      title: 'Gmail is not connected',
      detail: 'Sending is disabled until Google OAuth credentials are configured and your account is linked.',
      href: '/integrations',
    });
  }

  res.json({
    totals: {
      companies: c.companies.total,
      companiesReady: c.companies.ready,
      emailsFound: c.companies.ready,
      verifiedEmails: c.emails.verified,
      unverifiedEmails: c.emails.unverified,
      invalidEmails: c.emails.invalid,
      catchAllEmails: c.emails.catchAll,
      sent: c.sends.sent,
      failed: c.sends.failed,
      queued: c.sends.queued,
      repliedCompanies: c.replies.companies,
      positiveResponses: c.replies.positive,
      interviews: c.replies.interviews,
      pendingFollowUps: c.followUps.pending,
      dueFollowUps: c.followUps.due,
      emailNotFound: c.companies.emailNotFound,
      errors: c.companies.errored,
      pendingCompanies: c.companies.pending,
    },
    breakdowns: {
      companyStatus: all('SELECT status, COUNT(*) AS count FROM companies GROUP BY status ORDER BY count DESC'),
      verification: all(
        'SELECT verification, COUNT(*) AS count FROM company_emails GROUP BY verification ORDER BY count DESC',
      ),
    },
    recentCompanies: recent,
    recentActivity: activity,
    activeJob: job,
    readiness: {
      search: searchConfigured,
      searchProvider: searchAvailability().provider,
      verification: Boolean(configured.zerobounce),
      hunter: Boolean(configured.hunter),
      gmail: Boolean(configured.gmail),
      sheets: Boolean(configured.sheets),
      profile: Boolean(settings.profile.fullName && settings.profile.college && settings.profile.branch),
      resume: Boolean(settings.profile.resumeFileName),
      approvalRequired: settings.sending.requireApproval,
      followUpsEnabled: settings.followUp.enabled,
    },
    pendingChecks,
  });
});

dashboardRouter.get('/readiness', (req, res) => {
  const integrations = integrationStatus();
  const settings = getSettings();
  const googleAccount = get(
    `SELECT email, token_expiry AS tokenExpiry, updated_at AS updatedAt FROM oauth_accounts
     WHERE provider = 'google' AND is_default = 1`,
  );
  res.json({
    integrations,
    google: {
      configured: googleOAuthConfigured,
      clientIdSet: Boolean(google.clientId),
      redirectUri: google.redirectUri,
      account: googleAccount || null,
      sheetsSpreadsheetId: google.sheetsSpreadsheetId || null,
    },
    settings: {
      approvalRequired: settings.sending.requireApproval,
      dailyLimit: settings.sending.dailyLimit,
      followUpsEnabled: settings.followUp.enabled,
    },
  });
});
