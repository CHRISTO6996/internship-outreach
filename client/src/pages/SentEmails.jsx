import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCheck,
  Copy,
  Eye,
  Loader2,
  MailCheck,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { PageHeader } from '../components/Layout.jsx';
import { Alert, Badge, Card, EmptyState, Modal } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';
import { api } from '../lib/api.js';
import { formatDate, SEND_STATUS_META, titleCase } from '../lib/format.js';

const FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'awaiting_approval', label: 'Awaiting approval' },
  { value: 'queued', label: 'Queued' },
  { value: 'sent', label: 'Sent' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function SentEmails() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState(null);
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [detail, setDetail] = useState(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (filter) params.set('status', filter);
      if (kind) params.set('kind', kind);
      if (appliedSearch) params.set('search', appliedSearch);
      const [sends, statusPayload] = await Promise.all([
        api.get(`/outreach/sends?${params.toString()}`),
        api.get('/outreach/status'),
      ]);
      setRows(sends.rows);
      setTotal(sends.total);
      setStatus(statusPayload);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [filter, kind, appliedSearch, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function approveAll() {
    setBusy('approve');
    try {
      const result = await api.post('/outreach/approve', { all: true });
      toast.success(`${result.approved} email(s) approved.`);
      load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(null);
    }
  }

  async function action(send, what) {
    setBusy(`${what}-${send.id}`);
    try {
      await api.post(`/outreach/sends/${send.id}/${what}`);
      toast.success(what === 'retry' ? 'Email re-queued.' : 'Email cancelled.');
      load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(null);
    }
  }

  async function openDetail(send) {
    try {
      const payload = await api.get(`/outreach/sends/${send.id}`);
      setDetail(payload);
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function copyMessageId(value) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Gmail message ID copied.');
    } catch {
      toast.warning('Clipboard is not available in this browser.');
    }
  }

  return (
    <>
      <PageHeader
        title="Sent Emails"
        description="Every prepared or transmitted email, with its real Gmail message ID, timestamps and errors."
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={load}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            {status?.counts?.awaitingApproval ? (
              <button type="button" className="btn-primary" onClick={approveAll} disabled={busy !== null}>
                {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                Approve all ({status.counts.awaitingApproval})
              </button>
            ) : null}
          </>
        }
      />

      {status && !status.gmail.connected ? (
        <Alert tone="warning" className="mb-5">
          Gmail is not connected, so nothing can be transmitted yet.{' '}
          <Link to="/integrations" className="font-semibold underline">
            Connect Gmail
          </Link>
          .
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 px-4 py-3">
          <div className="min-w-40 flex-1">
            <label className="label !mb-1 !text-xs">Status</label>
            <select className="input !py-2" value={filter} onChange={(event) => setFilter(event.target.value)}>
              {FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-36">
            <label className="label !mb-1 !text-xs">Type</label>
            <select className="input !py-2" value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="">All emails</option>
              <option value="initial">Initial request</option>
              <option value="follow_up">Follow-up</option>
            </select>
          </div>
          <form
            className="flex min-w-56 flex-[2] gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setAppliedSearch(search.trim());
            }}
          >
            <div className="flex-1">
              <label className="label !mb-1 !text-xs">Search</label>
              <input
                className="input !py-2"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Company, recipient or subject"
              />
            </div>
            <button type="submit" className="btn-secondary mt-6 !px-3 !py-2" aria-label="Search">
              <Search className="h-4 w-4" />
            </button>
          </form>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading emails…</div>
        ) : rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="th">Company</th>
                  <th className="th">Recipient</th>
                  <th className="th">Subject</th>
                  <th className="th">Type</th>
                  <th className="th">Status</th>
                  <th className="th">Sent</th>
                  <th className="th">Gmail message</th>
                  <th className="th">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((send) => {
                  const meta = SEND_STATUS_META[send.status] || { label: send.status, tone: 'slate' };
                  return (
                    <tr key={send.id} className="hover:bg-slate-50/60">
                      <td className="td">
                        <Link to={`/companies/${send.companyId}`} className="font-medium text-slate-900 hover:text-brand-700">
                          {send.companyName}
                        </Link>
                        <p className="text-[11px] text-slate-400">#{send.id}</p>
                      </td>
                      <td className="td text-xs">{send.toEmail}</td>
                      <td className="td max-w-64">
                        <p className="truncate">{send.subject}</p>
                        {send.error ? <p className="mt-0.5 line-clamp-2 text-[11px] text-rose-600">{send.error}</p> : null}
                      </td>
                      <td className="td text-xs text-slate-500">{send.kind === 'follow_up' ? 'Follow-up' : 'Initial'}</td>
                      <td className="td">
                        <Badge tone={meta.tone} dot={send.status === 'sending'}>
                          {meta.label}
                        </Badge>
                      </td>
                      <td className="td text-xs text-slate-500">{send.sentAt ? formatDate(send.sentAt) : '—'}</td>
                      <td className="td">
                        {send.gmailMessageId ? (
                          <button
                            type="button"
                            onClick={() => copyMessageId(send.gmailMessageId)}
                            className="inline-flex max-w-40 items-center gap-1 truncate font-mono text-[11px] text-slate-600 hover:text-brand-700"
                            title={send.gmailMessageId}
                          >
                            <Copy className="h-3 w-3 shrink-0" />
                            <span className="truncate">{send.gmailMessageId}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="td">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="btn-ghost !px-2 !py-1"
                            onClick={() => openDetail(send)}
                            aria-label="View email"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {send.status === 'failed' || send.status === 'skipped' || send.status === 'cancelled' ? (
                            <button
                              type="button"
                              className="btn-ghost !px-2 !py-1 text-brand-700"
                              onClick={() => action(send, 'retry')}
                              disabled={busy !== null}
                              aria-label="Retry email"
                            >
                              <RotateCcw className={`h-4 w-4 ${busy === `retry-${send.id}` ? 'animate-spin' : ''}`} />
                            </button>
                          ) : null}
                          {send.status === 'queued' || send.status === 'awaiting_approval' ? (
                            <button
                              type="button"
                              className="btn-ghost !px-2 !py-1 text-rose-600"
                              onClick={() => action(send, 'cancel')}
                              disabled={busy !== null}
                              aria-label="Cancel email"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          ) : null}
                        </div>
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
              icon={MailCheck}
              title="No emails match this view"
              description="Prepare emails from the Outreach page. Nothing is ever sent without a real recipient address from your database."
              action={
                <Link to="/outreach" className="btn-primary">
                  Open Email Outreach
                </Link>
              }
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          <span>
            Showing {rows.length} of {total} email(s)
          </span>
          <span>
            Sent: {status?.counts?.sent ?? 0} · Failed: {status?.counts?.failed ?? 0} · Queued: {status?.counts?.queued ?? 0}
          </span>
        </div>
      </Card>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.companyName} — email #${detail.id}` : 'Email'}
        description="Exact content stored when the email was prepared."
        wide
        footer={
          detail?.status === 'failed' ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                action(detail, 'retry');
                setDetail(null);
              }}
            >
              <RotateCcw className="h-4 w-4" /> Retry
            </button>
          ) : null
        }
      >
        {detail ? (
          <div>
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">To</dt>
                <dd className="font-medium text-slate-800">{detail.toEmail}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Status</dt>
                <dd className="font-medium text-slate-800">{titleCase(detail.status)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Prepared</dt>
                <dd className="font-medium text-slate-800">{formatDate(detail.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Sent</dt>
                <dd className="font-medium text-slate-800">{detail.sentAt ? formatDate(detail.sentAt) : 'Not sent'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Gmail message ID</dt>
                <dd className="break-all font-mono text-[11px] text-slate-700">{detail.gmailMessageId || '—'}</dd>
              </div>
              {detail.error ? (
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">Error</dt>
                  <dd className="rounded-lg bg-rose-50 px-2 py-1 text-rose-700">{detail.error}</dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-4 rounded-xl border border-slate-200">
              <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-medium text-slate-800">{detail.subject}</div>
              <pre className="whitespace-pre-wrap px-4 py-4 font-sans text-sm leading-relaxed text-slate-700">{detail.body}</pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
