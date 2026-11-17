import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ExternalLink,
  Inbox as InboxIcon,
  Loader2,
  Mail,
  MailOpen,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import { PageHeader } from '../components/Layout.jsx';
import { Alert, Badge, Card, EmptyState, Modal, StatCard } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';
import { api } from '../lib/api.js';
import { formatDate, REPLY_META } from '../lib/format.js';

const CLASSIFICATIONS = ['positive', 'opportunity', 'resume_requested', 'interview', 'rejection', 'other'];

export default function Inbox() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(null);
  const [classification, setClassification] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [detail, setDetail] = useState(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (classification) params.set('classification', classification);
      if (unreadOnly) params.set('unread', 'true');
      if (appliedSearch) params.set('search', appliedSearch);
      const [replies, statusPayload] = await Promise.all([
        api.get(`/outreach/replies?${params.toString()}`),
        api.get('/outreach/status'),
      ]);
      setData(replies);
      setStatus(statusPayload);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [classification, unreadOnly, appliedSearch, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function syncReplies() {
    setSyncing(true);
    try {
      const result = await api.post('/outreach/sync-replies');
      toast.success(`Scanned ${result.scanned} inbox message(s); ${result.stored} new reply(ies) recorded.`);
      if (result.newReplies?.some((row) => ['interview', 'positive', 'opportunity'].includes(row.classification))) {
        toast.info('A positive reply or interview invitation needs your attention.', { title: 'Good news' });
      }
      load();
    } catch (error) {
      toast.error(error.message);
      if (error.integration) toast.info('Connect Gmail on the Integrations page first.');
    } finally {
      setSyncing(false);
    }
  }

  async function updateReply(reply, patch) {
    try {
      await api.patch(`/outreach/replies/${reply.id}`, patch);
      load();
      if (patch.classification) toast.success('Classification updated.');
    } catch (error) {
      toast.error(error.message);
    }
  }

  const counts = Object.fromEntries((data?.summary || []).map((row) => [row.classification, row.count]));
  const highUnread = (data?.rows || []).filter((row) => row.importance === 'high' && !row.isRead);
  const interviews = counts.interview || 0;
  const positives = (counts.positive || 0) + (counts.opportunity || 0) + (counts.resume_requested || 0);

  return (
    <>
      <PageHeader
        title="Inbox & Replies"
        description="Replies are read from your Gmail inbox, matched to the company we emailed, and classified automatically. You can override any label."
        actions={
          <button type="button" className="btn-primary" onClick={syncReplies} disabled={syncing || !status?.gmail?.connected}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Check for replies
          </button>
        }
      />

      {status && !status.gmail.connected ? (
        <Alert tone="warning" className="mb-5" title="Gmail is not connected">
          Reply tracking needs read access to your inbox.{' '}
          <Link to="/integrations" className="font-semibold underline">
            Connect Gmail
          </Link>
          .
        </Alert>
      ) : null}

      {highUnread.length ? (
        <Alert tone="success" className="mb-5" title={`${highUnread.length} important reply(ies) unread`}>
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {highUnread
                .slice(0, 3)
                .map((row) => `${row.companyName || row.fromEmail} (${REPLY_META[row.classification]?.label || row.classification})`)
                .join(', ')}
              {highUnread.length > 3 ? ` and ${highUnread.length - 3} more` : ''}. Interview invitations and positive responses are
              highlighted below.
            </p>
          </div>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Replies stored" value={data?.total ?? 0} hint={`${data?.unread ?? 0} unread`} icon={InboxIcon} tone="brand" />
        <StatCard label="Interview invitations" value={interviews} hint="Highest priority" icon={Sparkles} tone="violet" />
        <StatCard label="Positive / opportunities" value={positives} hint="Includes resume requests" icon={Mail} tone="emerald" />
        <StatCard
          label="Gmail account"
          value={status?.gmail?.connected ? 'Connected' : 'Not connected'}
          hint={status?.gmail?.account || 'Configure OAuth in Integrations'}
          icon={MailOpen}
          tone={status?.gmail?.connected ? 'emerald' : 'slate'}
        />
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 px-4 py-3">
          <div className="min-w-44 flex-1">
            <label className="label !mb-1 !text-xs">Classification</label>
            <select className="input !py-2" value={classification} onChange={(event) => setClassification(event.target.value)}>
              <option value="">All replies</option>
              {CLASSIFICATIONS.map((value) => (
                <option key={value} value={value}>
                  {REPLY_META[value]?.label || value}
                  {counts[value] ? ` (${counts[value]})` : ''}
                </option>
              ))}
            </select>
          </div>
          <label className="flex h-10 cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) => setUnreadOnly(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Unread only
          </label>
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
                placeholder="Company, sender or subject"
              />
            </div>
            <button type="submit" className="btn-secondary mt-6 !px-3 !py-2" aria-label="Search replies">
              <Search className="h-4 w-4" />
            </button>
          </form>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading replies…</div>
        ) : data?.rows?.length ? (
          <ul className="divide-y divide-slate-100">
            {data.rows.map((reply) => {
              const meta = REPLY_META[reply.classification] || REPLY_META.other;
              return (
                <li key={reply.id} className={`px-4 py-3.5 ${reply.isRead ? '' : 'bg-brand-500/150/15'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={meta.tone} dot={reply.importance === 'high'}>
                          {meta.label}
                        </Badge>
                        {!reply.isRead ? <Badge tone="blue">New</Badge> : null}
                        <Link
                          to={reply.companyId ? `/companies/${reply.companyId}` : '/companies'}
                          className="text-sm font-semibold text-slate-900 hover:text-brand-200"
                        >
                          {reply.companyName || 'Unmatched company'}
                        </Link>
                        <span className="text-xs text-slate-400">{formatDate(reply.receivedAt)}</span>
                      </div>
                      <button type="button" onClick={() => setDetail(reply)} className="mt-1 block max-w-full text-left">
                        <p className="truncate text-sm font-medium text-slate-800">{reply.subject}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{reply.snippet || reply.body?.slice(0, 200)}</p>
                      </button>
                      <p className="mt-1 text-[11px] text-slate-400">From: {reply.fromEmail}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        className="input !w-auto !py-1.5 text-xs"
                        value={reply.classification}
                        onChange={(event) => updateReply(reply, { classification: event.target.value })}
                        aria-label="Change classification"
                      >
                        {CLASSIFICATIONS.map((value) => (
                          <option key={value} value={value}>
                            {REPLY_META[value]?.label || value}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn-ghost !px-2 !py-1.5 text-xs"
                        onClick={() => updateReply(reply, { isRead: !reply.isRead })}
                      >
                        {reply.isRead ? 'Mark unread' : 'Mark read'}
                      </button>
                      <a
                        href={`https://mail.google.com/mail/u/0/#all/${reply.gmailMessageId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-ghost !px-2 !py-1.5 text-xs"
                      >
                        Gmail <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-4">
            <EmptyState
              icon={InboxIcon}
              title="No replies recorded yet"
              description="Once you send requests, press “Check for replies”. Only messages that match a sent email by thread, sender or subject are stored."
              action={
                <button
                  type="button"
                  className="btn-primary"
                  onClick={syncReplies}
                  disabled={syncing || !status?.gmail?.connected}
                >
                  {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Check now
                </button>
              }
            />
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.subject || 'Reply'}
        description={detail ? `${detail.companyName || 'Unmatched'} · ${detail.fromEmail}` : ''}
        wide
        footer={
          detail ? (
            <>
              <a
                href={`https://mail.google.com/mail/u/0/#all/${detail.gmailMessageId}`}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary"
              >
                Open in Gmail <ExternalLink className="h-4 w-4" />
              </a>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  updateReply(detail, { isRead: true });
                  setDetail(null);
                }}
              >
                Mark as read
              </button>
            </>
          ) : null
        }
      >
        {detail ? (
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge tone={REPLY_META[detail.classification]?.tone || 'slate'}>
                {REPLY_META[detail.classification]?.label || detail.classification}
              </Badge>
              <Badge tone="slate">{formatDate(detail.receivedAt)}</Badge>
            </div>
            <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 px-4 py-3 font-sans text-sm leading-relaxed text-slate-700">
              {detail.body || detail.snippet || '(No text body could be decoded.)'}
            </pre>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
