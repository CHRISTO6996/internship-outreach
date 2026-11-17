import { google as googleapis } from 'googleapis';
import { google as googleConfig } from '../config.js';
import { getSettings, saveSettings } from '../lib/settings.js';
import { listCompanies } from './companies.js';
import { authorizedClient } from './google.js';
import { IntegrationError } from '../lib/errors.js';
import { logActivity } from '../lib/activity.js';

export const TRACKER_COLUMNS = [
  'Company Name',
  'Website',
  'Company Email',
  'Email Source',
  'Verification',
  'Email Status',
  'Date Sent',
  'Gmail Message ID',
  'Reply Status',
  'Reply Details',
  'Follow-up Status',
  'Notes',
];

function capitalize(value) {
  return String(value || '').replace(/_/g, ' ').replace(/^\w/, (char) => char.toUpperCase());
}

export function trackerRows() {
  const { rows } = listCompanies({ limit: 1000 });
  return rows.map((company) => [
    company.name || '',
    company.website || '',
    company.primaryEmail || '',
    company.emailSource || '',
    company.verification ? capitalize(company.verification) : '',
    company.emailStatus === 'sent' ? 'Sent' : company.emailStatus === 'failed' ? 'Failed' : 'Not Sent',
    company.dateSent ? String(company.dateSent).replace('T', ' ').slice(0, 19) : '',
    company.gmailMessageId || '',
    company.replyStatus === 'replied' ? 'Replied' : company.replyStatus === 'no_reply' ? 'No Reply' : '',
    company.lastReplyClassification ? capitalize(company.lastReplyClassification) : '',
    company.followUpStatus === 'none' ? '' : capitalize(company.followUpStatus),
    company.notes || '',
  ]);
}

export function sheetStatus() {
  const settings = getSettings();
  return {
    configured: Boolean(googleConfig.clientId && googleConfig.clientSecret),
    spreadsheetId: settings.sheets.spreadsheetId || googleConfig.sheetsSpreadsheetId || null,
    source: settings.sheets.spreadsheetId ? 'app' : googleConfig.sheetsSpreadsheetId ? 'env' : null,
    lastSyncedAt: settings.sheets.lastSyncedAt,
    lastError: settings.sheets.lastError,
  };
}

async function sheetsClient() {
  const { auth } = await authorizedClient();
  return googleapis.sheets({ version: 'v4', auth });
}

/**
 * Mirror the tracker into Google Sheets. Creates a spreadsheet on first run when
 * no GOOGLE_SHEETS_SPREADSHEET_ID is configured, then stores its id in settings.
 */
export async function syncSheet() {
  if (!googleConfig.clientId || !googleConfig.clientSecret) {
    throw new IntegrationError('Google OAuth is not configured.', {
      integration: 'sheets',
      env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    });
  }
  const sheets = await sheetsClient();
  const settings = getSettings();
  let spreadsheetId = settings.sheets.spreadsheetId || googleConfig.sheetsSpreadsheetId || null;
  let sheetName = 'Tracker';

  try {
    if (!spreadsheetId) {
      const created = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: 'Internship Outreach Tracker' },
          sheets: [{ properties: { title: sheetName } }],
        },
      });
      spreadsheetId = created.data.spreadsheetId;
      saveSettings({ sheets: { spreadsheetId } });
      logActivity({
        level: 'success',
        action: 'sheet_created',
        message: 'Created Google Sheet "Internship Outreach Tracker".',
        meta: { spreadsheetId },
      });
    } else {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties.title',
      });
      const first = meta.data.sheets?.[0]?.properties?.title;
      if (!first) throw new Error('The spreadsheet has no worksheets');
      sheetName = first;
    }

    const rows = trackerRows();
    const values = [TRACKER_COLUMNS, ...rows];
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${sheetName}!A1:L5000` });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values },
    });

    saveSettings({ sheets: { lastSyncedAt: new Date().toISOString(), lastError: null } });
    logActivity({
      level: 'success',
      action: 'sheet_synced',
      message: `Synced ${rows.length} company(ies) to Google Sheets.`,
      meta: { spreadsheetId },
    });
    return { spreadsheetId, sheetName, rowCount: rows.length, syncedAt: new Date().toISOString() };
  } catch (error) {
    const message = error?.response?.data?.error?.message || error.message;
    saveSettings({ sheets: { lastError: String(message).slice(0, 1000) } });
    throw new IntegrationError(`Google Sheets sync failed: ${message}`, { integration: 'sheets' });
  }
}

export function maybeSyncSheet() {
  const status = sheetStatus();
  if (!status.configured) return;
  // Fire-and-forget: a Sheets outage must never block sending.
  void syncSheet().catch(() => {});
}
