import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCheck,
  Eye,
  Loader2,
  MailCheck,
  MailQuestion,
  Pause,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
  Square,
  Users,
} from 'lucide-react';
import { PageHeader } from '../components/Layout.jsx';
import { Alert, Badge, Card, EmptyState, Modal, ProgressBar, SectionHeading, Spinner, StatCard } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';
import { api } from '../lib/api.js';
import { formatDate, SEND_STATUS_META } from '../lib/format.js';

function StatusBadge({ status }) {
  const meta = SEND_STATUS_META[status] || { label: status, tone: 'slate' };
  return <Badge tone={meta.tone} dot={status === 'sending'}>{meta.label}</Badge>;
}

export default function Outreach() {
  const [status, setStatus] = useState(null);
  const [candidates, setCandidates] = useState(null);
  const [sends, setSends] = useState([]);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(null);
  const [preview, setPreview] = useState(null);
  const [lastSkipped, setLastSkipped] = useState([]);
  const [error, setError] = useState(null);
  const toast = useToast();
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    try {
      const [statusPayload, candidatesPayload, sendsPayload] = await Promise.all([
        api.get('/outreach/status'),
        api.get('/outreach/candidates'),
        api.get('/outreach/sends?limit=12'),
      ]);
      setStatus(statusPayload);
      setCandidates(candidatesPayload);
      setSends(sendsPayload.rows);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(async () => {
      try {
        const fresh = await api.get('/outreach/status');
        setStatus(fresh);
        if (wasRunning.current && !fresh.queue.running) {
          load();
        }
        wasRunning.current = fresh.queue.running;
      } catch {
        /* transient */
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [load]);

  const eligible = candidates?.rows || [];
  const allSelected = eligible.length > 0 && selected.length === eligible.length;

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(id) {
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  function toggleAll() {
    setSelected(allSelected ? [] : eligible.map((row) => row.id));
  }

  async function run(label, path, body) {
    setBusy(label);
    try {
      const result = await api.post(path, body);
      return result;
    } catch (err) {
      toast.error(err.message);
      if (err.env?.length) toast.info(`Required: ${err.env.join(', ')}`);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function prepare() {
    const result = await run('prepare', '/outreach/prepare', { companyIds: selected, kind: 'initial' });
    if (!result) return;
    setLastSkipped(result.skipped || []);
    setSelected([]);
    toast.success(
      `${result.created.length} email(s) prepared${result.awaitingApproval ? `, ${result.awaitingApproval} awaiting your approval` : ''}.`,
    );
    load();
  }

  async function approveAll() {
    const result = await run('approve', '/outreach/approve', { all: true });
    if (!result) return;
    toast.success(`${result.approved} email(s) approved.`);
    load();
  }

  async function control(action) {
    const result = await run(action, `/outreach/${action}`);
    if (!result) return;
    setStatus(result);
    if (action === 'start') toast.info('Sending queue started. Emails go out one at a time.');
    if (action === 'pause') toast.info('Pausing after the current email.');
    if (action === 'resume') toast.info('Sending resumed.');
    if (action === 'stop') toast.warning('Stopping after the current email.');
    load();
  }

  async function openPreview(companyId) {
    try {
      const data = await api.get(`/outreach/preview/${companyId}`);
      setPreview(data);
    } catch (err) {
      toast.error(err.message);
    }
  }

  const queue = status?.queue;
  const sending = status?.sending;
  const counts = status?.counts;

  return (
    <>
      <PageHeader
        title="Email Outreach"
        description="Prepare individual internship requests, review the first batch, then let the queue send them slowly within your limits."
        actions={
          <button type="button" className="btn-secondary" onClick={load}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        }
      />

      {error ? <Alert tone="error" className="mb-5">{error}</Alert> : null}

      {status && !status.gmail.connected ? (
        <Alert tone="warning" className="mb-5" title="Gmail is not connected">
          Sending requires a connected Google account.{' '}
          <Link to="/integrations" className="font-semibold underline">
            Open Integrations
          </Link>{' '}
          to configure OAuth and connect your inbox.
        </Alert>
      ) : null}

      {status && status.gmail.connected && !status.resumeReady ? (
        <Alert tone="warning" className="mb-5" title="No resume attached">
          Upload a PDF resume in{' '}
          <Link to="/settings" className="font-semibold underline">
            Settings
          </Link>{' '}
          before preparing emails. Every outreach email attaches it.
        </Alert>
      ) : null}

      {lastSkipped.length ? (
        <Alert tone="info" className="mb-5" title={`${lastSkipped.length} company(ies) were skipped`}>
          <ul className="mt-1 space-y-0.5">
            {lastSkipped.slice(0, 6).map((row) => (
              <li key={`${row.companyId}-${row.reason}`}>
                <strong>{row.name}</strong>: {row.reason}
              </li>
            ))}
            {lastSkipped.length > 6 ? <li>…and {lastSkipped.length - 6} more.</li> : null}
          </ul>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Awaiting approval"
          value={counts?.awaitingApproval ?? 0}
          hint={sending?.approvalRequiredNow ? 'First batch held for review' : 'Approval is not required now'}
          icon={ShieldAlert}
          tone="amber"
        />
        <StatCard label="Queued" value={counts?.queued ?? 0} hint={`${counts?.sending ?? 0} sending now`} icon={MailQuestion} tone="blue" />
        <StatCard
          label="Sent today"
          value={sending?.sentToday ?? 0}
          hint={`${sending?.remainingToday ?? 0} remaining of ${sending?.dailyLimit ?? 0}`}
          icon={MailCheck}
          tone="emerald"
        />
        <StatCard
          label="Ready companies"
          value={candidates?.rows?.length ?? 0}
          hint={`${candidates?.excluded?.length ?? 0} excluded for a reason`}
          icon={Users}
          tone="slate"
        />
      </div>

      <Card className="mt-5 p-4">
        <SectionHeading
          title="Sending queue"
          description="One email at a time, with your configured delay and daily cap."
          icon={Send}
          actions={
            <Badge tone={queue?.running ? 'emerald' : queue?.paused ? 'amber' : 'slate'} dot={queue?.running}>
              {queue?.running ? 'Running' : queue?.paused ? 'Paused' : 'Idle'}
            </Badge>
          }
        />
        {status ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Gmail</p>
                <p className="mt-1 truncate text-sm font-medium text-slate-800">{status.gmail.account || 'Not connected'}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Delay</p>
                <p className="mt-1 text-sm font-medium text-slate-800">
                  {sending.minDelaySeconds}–{sending.maxDelaySeconds}s between sends
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Window</p>
                <p className="mt-1 text-sm font-medium text-slate-800">
                  {sending.windowStart}–{sending.windowEnd}
                  {sending.weekdaysOnly ? ' · Mon–Fri' : ''}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">This run</p>
                <p className="mt-1 text-sm font-medium text-slate-800">
                  {queue.sentThisRun} sent · {queue.failedThisRun} failed
                </p>
              </div>
            </div>

            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                <span>Daily progress</span>
                <span>
                  {sending.sentToday}/{sending.dailyLimit}
                </span>
              </div>
              <ProgressBar
                value={sending.dailyLimit ? (sending.sentToday / sending.dailyLimit) * 100 : 0}
                tone={sending.sentToday >= sending.dailyLimit ? 'amber' : 'brand'}
              />
            </div>

            {queue.reason ? <p className="mt-3 text-xs text-slate-500">{queue.reason}</p> : null}
            {!sending.window.open ? (
              <p className="mt-1 text-xs text-amber-700">{sending.window.reason}</p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {counts.awaitingApproval > 0 ? (
                <button type="button" className="btn-primary" onClick={approveAll} disabled={busy !== null}>
                  {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                  Approve all ({counts.awaitingApproval})
                </button>
              ) : null}
              {!queue.running ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => control('start')}
                  disabled={busy !== null || !counts.queued || !status.gmail.connected}
                >
                  {busy === 'start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Start sending
                </button>
              ) : (
                <>
                  <button type="button" className="btn-secondary" onClick={() => control('pause')} disabled={busy !== null}>
                    <Pause className="h-4 w-4" /> Pause
                  </button>
                  <button type="button" className="btn-danger" onClick={() => control('stop')} disabled={busy !== null}>
                    <Square className="h-4 w-4" /> Stop
                  </button>
                </>
              )}
              {queue.paused && counts.queued > 0 ? (
                <button type="button" className="btn-secondary" onClick={() => control('resume')} disabled={busy !== null}>
                  {busy === 'resume' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Resume
                </button>
              ) : null}
              <Link to="/sent" className="btn-ghost">
                View sent emails →
              </Link>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner /> Loading queue status…
          </div>
        )}
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Companies ready for outreach</h2>
              <p className="text-xs text-slate-500">Primary email found, not invalid, no initial request sent yet.</p>
            </div>
            <button
              type="button"
              className="btn-primary !px-3 !py-2 text-xs"
              onClick={prepare}
              disabled={!selected.length || busy !== null}
            >
              {busy === 'prepare' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Prepare {selected.length || ''} email{selected.length === 1 ? '' : 's'}
            </button>
          </div>

          {!candidates ? (
            <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
              <Spinner /> Loading companies…
            </div>
          ) : eligible.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead className="bg-slate-50/70">
                  <tr>
                    <th className="th w-10">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all eligible companies"
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </th>
                    <th className="th">Company</th>
                    <th className="th">Email</th>
                    <th className="th">Verification</th>
                    <th className="th">Source</th>
                    <th className="th w-16">Preview</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {eligible.map((row) => (
                    <tr key={row.id} className={selectedSet.has(row.id) ? 'bg-brand-500/15' : 'hover:bg-slate-50/60'}>
                      <td className="td">
                        <input
                          type="checkbox"
                          checked={selectedSet.has(row.id)}
                          onChange={() => toggle(row.id)}
                          aria-label={`Select ${row.name}`}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </td>
                      <td className="td">
                        <Link to={`/companies/${row.id}`} className="font-medium text-slate-900 hover:text-brand-200">
                          {row.name}
                        </Link>
                        <p className="text-xs text-slate-400">{row.domain || '—'}</p>
                      </td>
                      <td className="td">{row.email}</td>
                      <td className="td">
                        <Badge tone={row.verification === 'verified' ? 'emerald' : row.verification === 'catch_all' ? 'violet' : 'amber'}>
                          {row.verification === 'catch_all' ? 'Catch-all' : row.verification === 'verified' ? 'Verified' : 'Unverified'}
                        </Badge>
                      </td>
                      <td className="td">
                        {row.sourceUrl ? (
                          <a
                            href={row.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-medium text-brand-300 hover:underline"
                          >
                            Public page
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="td">
                        <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => openPreview(row.id)} aria-label="Preview email">
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4">
              <EmptyState
                icon={MailQuestion}
                title="No companies are ready"
                description="Discover a public HR or careers address first, or add one manually to a company. Companies that already received a request or replied are excluded automatically."
                action={
                  <Link to="/finder" className="btn-primary">
                    Open Email Finder
                  </Link>
                }
              />
            </div>
          )}

          {candidates?.excluded?.length ? (
            <details className="border-t border-slate-100 px-4 py-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                {candidates.excluded.length} excluded company(ies) — why?
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-slate-500">
                {candidates.excluded.slice(0, 20).map((row) => (
                  <li key={row.id} className="flex flex-wrap justify-between gap-2">
                    <Link to={`/companies/${row.id}`} className="font-medium text-slate-700 hover:text-brand-200">
                      {row.name}
                    </Link>
                    <span>{row.ineligibleReason}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Recent emails</h2>
              <p className="text-xs text-slate-500">Prepared and sent records.</p>
            </div>
            <Link to="/sent" className="text-xs font-semibold text-brand-300 hover:text-brand-200">
              All →
            </Link>
          </div>
          <ul className="divide-y divide-slate-100">
            {sends.map((send) => (
              <li key={send.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{send.companyName}</p>
                    <p className="truncate text-xs text-slate-500">{send.toEmail}</p>
                  </div>
                  <StatusBadge status={send.status} />
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  {send.kind === 'follow_up' ? 'Follow-up' : 'Initial request'} · {formatDate(send.sentAt || send.createdAt)}
                </p>
                {send.error ? <p className="mt-1 line-clamp-2 text-[11px] text-rose-600">{send.error}</p> : null}
              </li>
            ))}
            {!sends.length ? <li className="px-4 py-8 text-center text-sm text-slate-500">Nothing prepared yet.</li> : null}
          </ul>
        </Card>
      </div>

      <Alert tone="info" className="mt-5" title="Sending rules">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Every message is sent individually from your own Gmail account, never CC/BCC. The backend enforces the daily cap,
            random delays and the send window. Only verified, unverified or catch-all public role addresses are used — invalid
            addresses are never emailed.
          </p>
        </div>
      </Alert>

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview ? `Preview — ${preview.companyName}` : 'Preview'}
        description="This is the exact text that will be rendered for this company."
        wide
      >
        {preview ? (
          <div className="rounded-xl border border-slate-200">
            <div className="space-y-1 border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500">
              <p>
                <span className="font-semibold text-slate-700">To:</span> {preview.toEmail}
              </p>
              <p>
                <span className="font-semibold text-slate-700">Subject:</span> {preview.subject}
              </p>
              <p>
                <span className="font-semibold text-slate-700">Attachment:</span> {preview.attachment || 'none'}
              </p>
            </div>
            <pre className="whitespace-pre-wrap px-4 py-4 font-sans text-sm leading-relaxed text-slate-700">{preview.body}</pre>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
