import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Send,
  SkipForward,
  XCircle,
} from 'lucide-react';
import { PageHeader } from '../components/Layout.jsx';
import { Alert, Badge, Card, EmptyState, StatCard } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';
import { api } from '../lib/api.js';
import { formatDate, FOLLOWUP_STATUS_META, relativeTime } from '../lib/format.js';

export default function FollowUps() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [followUps, statusPayload] = await Promise.all([
        api.get('/outreach/follow-ups'),
        api.get('/outreach/status'),
      ]);
      setData(followUps);
      setStatus(statusPayload);
    } catch (error) {
      toast.error(error.message);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function queue(ids = null) {
    setBusy(ids ? `one-${ids[0]}` : 'all');
    try {
      const result = await api.post('/outreach/follow-ups/prepare', ids ? { ids } : {});
      setLastResult(result);
      toast.success(`${result.created.length} follow-up(s) queued${result.awaitingApproval ? ' for approval' : ''}.`);
      load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(null);
    }
  }

  async function setStatusFor(row, next) {
    setBusy(`status-${row.id}`);
    try {
      await api.patch(`/outreach/follow-ups/${row.id}`, { status: next });
      toast.success(next === 'skipped' ? 'Follow-up skipped.' : 'Follow-up updated.');
      load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(null);
    }
  }

  const summary = data?.summary;

  return (
    <>
      <PageHeader
        title="Follow-up Tracker"
        description="A polite reminder is scheduled after your configured wait, only when the company has not replied."
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={load}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => queue()}
              disabled={!summary?.due || busy !== null || !status?.gmail?.connected}
            >
              {busy === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
              Queue due ({summary?.due ?? 0})
            </button>
          </>
        }
      />

      {data && !data.enabled ? (
        <Alert tone="warning" className="mb-5" title="Automatic follow-ups are disabled">
          Enable them in{' '}
          <Link to="/settings" className="font-semibold underline">
            Settings → Follow-ups
          </Link>{' '}
          to schedule reminders automatically after each sent request. You can still queue any existing scheduled follow-up below.
        </Alert>
      ) : null}

      {lastResult ? (
        <Alert tone="info" className="mb-5" title={`${lastResult.created.length} follow-up(s) queued`}>
          {lastResult.skipped.length ? (
            <p>{lastResult.skipped.length} skipped: {lastResult.skipped.slice(0, 3).map((row) => row.reason).join('; ')}</p>
          ) : (
            <p>Open Email Outreach to approve them (if required) and start the sending queue.</p>
          )}
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Scheduled" value={summary?.pending ?? 0} hint={`${summary?.due ?? 0} due now`} icon={Clock} tone="blue" />
        <StatCard label="Sent" value={summary?.sent ?? 0} hint="Reminders delivered" icon={CheckCircle2} tone="emerald" />
        <StatCard label="Skipped" value={summary?.skipped ?? 0} hint="Reply received or cancelled" icon={SkipForward} tone="slate" />
        <StatCard label="Failed" value={summary?.failed ?? 0} hint="Retry from Sent Emails" icon={XCircle} tone="rose" />
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Scheduled follow-ups</h2>
            <p className="text-xs text-slate-500">
              {status?.followUps?.enabled ? 'Auto-scheduling is on.' : 'Auto-scheduling is off.'} No company receives a follow-up after
              it replies.
            </p>
          </div>
          <Link to="/outreach" className="btn-secondary !px-3 !py-2 text-xs">
            <Send className="h-3.5 w-3.5" /> Sending queue
          </Link>
        </div>

        {!data ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading follow-ups…</div>
        ) : data.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="th">Company</th>
                  <th className="th">Recipient</th>
                  <th className="th">Due</th>
                  <th className="th">Status</th>
                  <th className="th">Sent</th>
                  <th className="th">Notes</th>
                  <th className="th">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((row) => {
                  const meta = FOLLOWUP_STATUS_META[row.status] || { label: row.status, tone: 'slate' };
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/60">
                      <td className="td">
                        <Link to={`/companies/${row.companyId}`} className="font-medium text-slate-900 hover:text-brand-700">
                          {row.companyName}
                        </Link>
                        <p className="text-[11px] text-slate-400">Follow-up #{row.id}</p>
                      </td>
                      <td className="td text-xs">{row.toEmail || '—'}</td>
                      <td className="td">
                        <p className="text-xs text-slate-700">{formatDate(row.dueAt, { withTime: false })}</p>
                        <p className={`text-[11px] ${row.due ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>
                          {row.due ? 'Due now' : row.dueAt ? relativeTime(row.dueAt) : '—'}
                        </p>
                      </td>
                      <td className="td">
                        <Badge tone={meta.tone} dot={row.status === 'queued'}>
                          {meta.label}
                        </Badge>
                      </td>
                      <td className="td text-xs text-slate-500">{row.sentAt ? formatDate(row.sentAt) : '—'}</td>
                      <td className="td max-w-64">
                        {row.replyCount ? (
                          <span className="text-xs text-slate-500">Company replied — follow-up skipped automatically.</span>
                        ) : row.error ? (
                          <span className="text-xs text-rose-600">{row.error}</span>
                        ) : (
                          <span className="text-xs text-slate-500">
                            {row.totalFollowUps} follow-up(s) recorded for this company.
                          </span>
                        )}
                      </td>
                      <td className="td">
                        <div className="flex flex-wrap items-center gap-1">
                          {row.status === 'pending' ? (
                            <>
                              <button
                                type="button"
                                className="btn-ghost !px-2 !py-1 text-xs text-brand-700"
                                onClick={() => queue([row.id])}
                                disabled={busy !== null || !status?.gmail?.connected}
                              >
                                {busy === `one-${row.id}` ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Send className="h-3.5 w-3.5" />
                                )}
                                Queue
                              </button>
                              <button
                                type="button"
                                className="btn-ghost !px-2 !py-1 text-xs text-slate-600"
                                onClick={() => setStatusFor(row, 'skipped')}
                                disabled={busy !== null}
                              >
                                Skip
                              </button>
                            </>
                          ) : row.status === 'queued' ? (
                            <button
                              type="button"
                              className="btn-ghost !px-2 !py-1 text-xs text-rose-600"
                              onClick={() => setStatusFor(row, 'cancelled')}
                              disabled={busy !== null}
                            >
                              Cancel
                            </button>
                          ) : row.status === 'skipped' || row.status === 'cancelled' ? (
                            <button
                              type="button"
                              className="btn-ghost !px-2 !py-1 text-xs"
                              onClick={() => setStatusFor(row, 'pending')}
                              disabled={busy !== null}
                            >
                              Re-enable
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
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
              icon={Clock}
              title="No follow-ups scheduled"
              description="Follow-ups are created automatically after an initial request is sent, when the feature is enabled. Enable it in Settings first, then send a request."
              action={
                <Link to="/settings" className="btn-primary">
                  Open follow-up settings
                </Link>
              }
            />
          </div>
        )}
      </Card>
    </>
  );
}
