import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Search,
  Table2,
} from 'lucide-react';
import { PageHeader } from '../components/Layout.jsx';
import { Alert, Badge, Card, EmptyState, SectionHeading } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';
import { api, downloadExport } from '../lib/api.js';
import {
  FOLLOWUP_STATUS_META,
  REPLY_META,
  formatDate,
  VERIFICATION_META,
} from '../lib/format.js';

const EMAIL_STATUS = {
  sent: { label: 'Sent', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
  sending: { label: 'Sending', tone: 'violet' },
  not_sent: { label: 'Not sent', tone: 'slate' },
};

export default function Spreadsheet() {
  const [companies, setCompanies] = useState([]);
  const [status, setStatus] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [companyPayload, statusPayload] = await Promise.all([
        api.get('/companies?limit=1000'),
        api.get('/outreach/status'),
      ]);
      setCompanies(companyPayload.rows);
      setStatus(statusPayload);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return companies;
    return companies.filter((company) =>
      [company.name, company.domain, company.primaryEmail, company.website]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [companies, search]);

  async function syncSheet() {
    setSyncing(true);
    try {
      const result = await api.post('/outreach/sheets/sync');
      toast.success(`Synced ${result.rowCount} company(ies) to Google Sheets.`);
      load();
    } catch (error) {
      toast.error(error.message);
      if (error.env?.length) toast.info(`Required: ${error.env.join(', ')}`);
    } finally {
      setSyncing(false);
    }
  }

  async function copy(value) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copied.');
    } catch {
      toast.warning('Clipboard is not available.');
    }
  }

  const sheet = status?.sheets;
  const sheetUrl = sheet?.spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}/edit`
    : null;

  return (
    <>
      <PageHeader
        title="Spreadsheet"
        description="The complete tracker with the exact columns requested. Export it as CSV/Excel, or mirror it to your own Google Sheet."
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={load}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button type="button" className="btn-secondary" onClick={() => downloadExport('csv')}>
              <Download className="h-4 w-4" /> CSV
            </button>
            <button type="button" className="btn-primary" onClick={() => downloadExport('xlsx')}>
              <Download className="h-4 w-4" /> Excel
            </button>
          </>
        }
      />

      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <SectionHeading
            title="Google Sheets mirror"
            description="The internal SQLite database stays authoritative; a sync copies the tracker into the sheet."
            icon={FileSpreadsheet}
            actions={
              <Badge tone={sheet?.spreadsheetId ? 'emerald' : sheet?.configured ? 'amber' : 'slate'} dot>
                {sheet?.spreadsheetId ? 'Linked' : sheet?.configured ? 'Not synced yet' : 'Not configured'}
              </Badge>
            }
          />
          {sheet?.lastError ? <Alert tone="error" className="mb-3">{sheet.lastError}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Last sync</p>
              <p className="mt-1 text-sm font-medium text-slate-800">
                {sheet?.lastSyncedAt ? formatDate(sheet.lastSyncedAt) : 'Never'}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Spreadsheet</p>
              {sheetUrl ? (
                <a href={sheetUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                  Open Google Sheet <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                <p className="mt-1 text-sm text-slate-500">Created on first sync</p>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary !px-3.5 !py-2 text-sm"
              onClick={syncSheet}
              disabled={syncing || !status?.gmail?.connected}
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              {sheet?.spreadsheetId ? 'Sync now' : 'Create and sync sheet'}
            </button>
            {!status?.gmail?.connected ? (
              <span className="text-xs text-slate-500">
                Connect Google on the{' '}
                <Link to="/integrations" className="font-semibold text-brand-700 hover:underline">
                  Integrations
                </Link>{' '}
                page first.
              </span>
            ) : (
              <span className="text-xs text-slate-500">
                Uses the same Google account as Gmail. The sheet is created in your Drive if no ID is configured.
              </span>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <SectionHeading title="Tracker columns" icon={Table2} />
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            {[
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
            ].map((column, index) => (
              <div key={column} className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1.5 text-slate-600">
                <span className="grid h-4 w-4 place-items-center rounded bg-white text-[9px] font-bold text-slate-500 ring-1 ring-slate-200">
                  {index + 1}
                </span>
                <span className="truncate">{column}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            CSV and Excel exports always contain these columns, even when Google Sheets is not configured.
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Company tracker</h2>
            <p className="text-xs text-slate-500">
              {rows.length} of {companies.length} company(ies)
            </p>
          </div>
          <div className="relative min-w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input !py-2 !pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter companies…"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading tracker…</div>
        ) : rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1400px]">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="th">Company Name</th>
                  <th className="th">Website</th>
                  <th className="th">Company Email</th>
                  <th className="th">Email Source</th>
                  <th className="th">Verification</th>
                  <th className="th">Email Status</th>
                  <th className="th">Date Sent</th>
                  <th className="th">Gmail Message ID</th>
                  <th className="th">Reply Status</th>
                  <th className="th">Reply Details</th>
                  <th className="th">Follow-up Status</th>
                  <th className="th">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((company) => {
                  const verification = VERIFICATION_META[company.verification] || null;
                  const emailStatus = EMAIL_STATUS[company.emailStatus] || EMAIL_STATUS.not_sent;
                  const followUp = FOLLOWUP_STATUS_META[company.followUpStatus];
                  const replyMeta = company.lastReplyClassification
                    ? REPLY_META[company.lastReplyClassification]
                    : null;
                  return (
                    <tr key={company.id} className="hover:bg-slate-50/60">
                      <td className="td">
                        <Link to={`/companies/${company.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                          {company.name}
                        </Link>
                      </td>
                      <td className="td max-w-48">
                        {company.website ? (
                          <a
                            href={company.website}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-full items-center gap-1 truncate text-xs text-brand-700 hover:underline"
                          >
                            <span className="truncate">{company.website.replace(/^https?:\/\//, '')}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="td text-xs">{company.primaryEmail || '—'}</td>
                      <td className="td max-w-56">
                        {company.emailSource ? (
                          <a
                            href={company.emailSource}
                            target="_blank"
                            rel="noreferrer"
                            className="line-clamp-2 text-[11px] text-slate-500 hover:text-brand-700 hover:underline"
                          >
                            {company.emailSource}
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="td">
                        {verification ? <Badge tone={verification.tone}>{verification.label}</Badge> : <span className="text-xs text-slate-400">—</span>}
                      </td>
                      <td className="td">
                        <Badge tone={emailStatus.tone}>{emailStatus.label}</Badge>
                      </td>
                      <td className="td text-xs text-slate-500">{company.dateSent ? formatDate(company.dateSent) : '—'}</td>
                      <td className="td">
                        {company.gmailMessageId ? (
                          <button
                            type="button"
                            onClick={() => copy(company.gmailMessageId)}
                            className="inline-flex max-w-36 items-center gap-1 text-[11px] text-slate-600 hover:text-brand-700"
                            title={company.gmailMessageId}
                          >
                            <Copy className="h-3 w-3 shrink-0" />
                            <span className="truncate font-mono">{company.gmailMessageId}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="td">
                        <Badge tone={company.replyStatus === 'replied' ? 'emerald' : company.replyStatus === 'no_reply' ? 'slate' : 'slate'}>
                          {company.replyStatus === 'replied' ? 'Replied' : company.replyStatus === 'no_reply' ? 'No reply' : 'Not sent'}
                        </Badge>
                      </td>
                      <td className="td">
                        {replyMeta ? (
                          <span className="text-xs text-slate-600">{replyMeta.label}</span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="td">
                        {followUp ? <Badge tone={followUp.tone}>{followUp.label}</Badge> : <span className="text-xs text-slate-400">—</span>}
                      </td>
                      <td className="td max-w-56">
                        <span className="line-clamp-2 text-xs text-slate-500">{company.notes || '—'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState
              icon={Table2}
              title={companies.length ? 'No companies match this filter' : 'The tracker is empty'}
              description={
                companies.length
                  ? 'Clear the filter to see every company.'
                  : 'Add companies and find their public contact addresses to populate the tracker.'
              }
              action={
                !companies.length ? (
                  <Link to="/add" className="btn-primary">
                    Add companies
                  </Link>
                ) : null
              }
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          Auto-updated from the database. Export is available even when Google Sheets is offline.
        </div>
      </Card>
    </>
  );
}
