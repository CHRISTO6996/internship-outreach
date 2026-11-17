import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Globe2,
  Mail,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Star,
  Trash2,
  Loader2,
  Pencil,
  ExternalLink,
  Clock,
  Send,
  Reply,
  Activity,
  AlertTriangle,
} from 'lucide-react';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Card, EmptyState, Field, Modal, SectionHeading, Skeleton } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';
import { useJobs } from '../components/JobContext.jsx';
import { api } from '../lib/api.js';
import { CATEGORY_META, formatDate, relativeTime, STATUS_META, titleCase, VERIFICATION_META } from '../lib/format.js';

export default function CompanyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { start, busy, version } = useJobs();
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [emailModal, setEmailModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [emailForm, setEmailForm] = useState({ email: '', sourceUrl: '' });
  const [editForm, setEditForm] = useState({ name: '', website: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/companies/${id}`);
      setCompany(data);
      setEditForm({ name: data.name, website: data.website || '', notes: data.notes || '' });
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load, version]);

  async function addEmail(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post(`/companies/${id}/emails`, {
        email: emailForm.email,
        sourceUrl: emailForm.sourceUrl || null,
      });
      toast.success('Email recorded and verified.');
      setEmailModal(false);
      setEmailForm({ email: '', sourceUrl: '' });
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/companies/${id}`, {
        name: editForm.name,
        website: editForm.website || null,
        notes: editForm.notes,
      });
      toast.success('Company updated.');
      setEditModal(false);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function verifyEmail(emailId) {
    setVerifying(emailId);
    try {
      const result = await api.post(`/companies/${id}/emails/${emailId}/verify`);
      toast.success(`Verification: ${result.result.verification.replace('_', ' ')}.`);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setVerifying(null);
    }
  }

  async function setPrimary(emailId) {
    try {
      await api.post(`/companies/${id}/emails/${emailId}/primary`);
      toast.success('Primary contact updated.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeEmail(emailId) {
    try {
      await api.del(`/companies/${id}/emails/${emailId}`);
      toast.success('Address removed.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeCompany() {
    try {
      await api.del(`/companies/${id}`);
      toast.success('Company deleted.');
      navigate('/companies');
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (loading && !company) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <p className="text-sm text-rose-700">{error}</p>
        <Link to="/companies" className="btn-secondary mt-4">
          Back to database
        </Link>
      </Card>
    );
  }

  const status = STATUS_META[company.status] || STATUS_META.pending;

  return (
    <>
      <Link to="/companies" className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-3.5 w-3.5" /> Company database
      </Link>

      <PageHeader
        title={company.name}
        description={company.website || 'No website resolved yet.'}
        badge={
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
        }
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEditModal(true)}>
              <Pencil className="h-4 w-4" /> Edit
            </button>
            <button type="button" className="btn-secondary" onClick={() => setEmailModal(true)}>
              <Plus className="h-4 w-4" /> Add email
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => start([company.id])}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run finder
            </button>
          </>
        }
      />

      {company.discoveryError ? (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Discovery note</p>
            <p className="opacity-90">{company.discoveryError}</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Primary contact</p>
          {company.primaryEmail ? (
            <>
              <p className="mt-2 break-all text-sm font-semibold text-slate-900">{company.primaryEmail}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {company.verification ? (
                  <Badge tone={(VERIFICATION_META[company.verification] || VERIFICATION_META.unverified).tone}>
                    {(VERIFICATION_META[company.verification] || VERIFICATION_META.unverified).label}
                  </Badge>
                ) : null}
                <Badge tone="slate">{CATEGORY_META[company.emailCategory] || titleCase(company.emailCategory || 'contact')}</Badge>
                {company.emailScore != null ? <Badge tone="brand">Score {company.emailScore}</Badge> : null}
              </div>
              {company.emailSource ? (
                <a
                  href={company.emailSource}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex max-w-full items-center gap-1 truncate text-xs text-brand-700 hover:underline"
                >
                  <Globe2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{company.emailSource}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              No primary email yet. Run the finder, or add one you found on the official site.
            </p>
          )}
        </Card>

        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Website</p>
          {company.website ? (
            <a
              href={company.website}
              target="_blank"
              rel="noreferrer"
              className="mt-2 flex items-center gap-1.5 break-all text-sm font-medium text-brand-700 hover:underline"
            >
              {company.domain || company.website}
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Not resolved.</p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Source: {company.websiteSource ? titleCase(company.websiteSource.replace('search:', 'search · ')) : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Last checked: {company.lastDiscoveredAt ? relativeTime(company.lastDiscoveredAt) : 'never'}
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Outreach</p>
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Email status</dt>
              <dd className="font-medium text-slate-800">{titleCase(company.emailStatus || 'not sent')}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Date sent</dt>
              <dd className="font-medium text-slate-800">{company.dateSent ? formatDate(company.dateSent) : '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Replies</dt>
              <dd className="font-medium text-slate-800">{company.replyCount || 0}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Follow-up</dt>
              <dd className="font-medium text-slate-800">{titleCase(company.followUpStatus || 'none')}</dd>
            </div>
          </dl>
          <Link to="/outreach" className="mt-3 inline-flex text-xs font-semibold text-brand-700 hover:underline">
            Open outreach →
          </Link>
        </Card>
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Discovered addresses</h2>
            <p className="text-xs text-slate-500">Only non-invalid addresses can be selected as primary.</p>
          </div>
          <Badge tone="slate">{company.emails.length}</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="bg-slate-50/70">
              <tr>
                <th className="th">Email</th>
                <th className="th">Category</th>
                <th className="th">Verification</th>
                <th className="th">Source</th>
                <th className="th">Score</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {company.emails.map((email) => {
                const verification = VERIFICATION_META[email.verification] || VERIFICATION_META.unverified;
                return (
                  <tr key={email.id} className={email.isPrimary ? 'bg-brand-50/30' : ''}>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-slate-400" />
                        <span className="font-medium text-slate-800">{email.email}</span>
                        {email.isPrimary ? <Badge tone="brand">Primary</Badge> : null}
                      </div>
                    </td>
                    <td className="td text-xs capitalize">{email.category || '—'}</td>
                    <td className="td">
                      <Badge tone={verification.tone}>{verification.label}</Badge>
                      {email.verificationDetail ? (
                        <p className="mt-1 max-w-[240px] text-[10px] text-slate-400">{email.verificationDetail}</p>
                      ) : null}
                    </td>
                    <td className="td max-w-[220px]">
                      {email.sourceUrl ? (
                        <a
                          href={email.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-xs text-brand-700 hover:underline"
                          title={email.sourceUrl}
                        >
                          {email.sourceUrl.replace(/^https?:\/\//, '')}
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">manual</span>
                      )}
                    </td>
                    <td className="td text-xs font-semibold">{email.score ?? 0}</td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => verifyEmail(email.id)}
                          disabled={verifying === email.id}
                          className="btn-ghost !px-2 !py-1 text-xs"
                          title="Verify again"
                        >
                          {verifying === email.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        </button>
                        {!email.isPrimary && email.verification !== 'invalid' ? (
                          <button
                            type="button"
                            onClick={() => setPrimary(email.id)}
                            className="btn-ghost !px-2 !py-1 text-xs"
                            title="Make primary"
                          >
                            <Star className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => removeEmail(email.id)}
                          className="btn-ghost !px-2 !py-1 text-xs text-rose-600 hover:bg-rose-50"
                          title="Remove address"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!company.emails.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    No addresses recorded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card className="p-4">
          <SectionHeading title="Sending history" description="Individual Gmail sends for this company." icon={Send} />
          {company.sends.length ? (
            <ul className="space-y-2.5">
              {company.sends.map((send) => (
                <li key={send.id} className="rounded-xl border border-slate-200 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-800">{send.subject}</p>
                    <Badge tone={send.status === 'sent' ? 'emerald' : send.status === 'failed' ? 'rose' : 'slate'}>{titleCase(send.status)}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    To {send.toEmail} · {send.sentAt ? formatDate(send.sentAt) : 'not sent'}
                  </p>
                  {send.error ? <p className="mt-1 text-xs text-rose-600">{send.error}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Send} title="No emails sent" description="Connect Gmail and approve an outreach batch to send." />
          )}
        </Card>

        <Card className="p-4">
          <SectionHeading title="Replies & follow-ups" description="Matched automatically by Gmail thread." icon={Reply} />
          {company.replies.length ? (
            <ul className="space-y-2.5">
              {company.replies.map((reply) => (
                <li key={reply.id} className="rounded-xl border border-slate-200 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-slate-800">{reply.subject}</p>
                    <Badge tone="emerald">{titleCase(reply.classification)}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">{reply.fromEmail} · {formatDate(reply.receivedAt)}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">{reply.snippet}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No replies yet.</p>
          )}
          {company.followUps.length ? (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <Clock className="h-3.5 w-3.5" /> Follow-ups
              </p>
              <ul className="space-y-1.5 text-xs text-slate-600">
                {company.followUps.map((followUp) => (
                  <li key={followUp.id} className="flex justify-between gap-2">
                    <span>{titleCase(followUp.status)}</span>
                    <span>{followUp.sentAt ? formatDate(followUp.sentAt) : followUp.dueAt ? `due ${formatDate(followUp.dueAt, { withTime: false })}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </div>

      <Card className="mt-5 p-4">
        <SectionHeading title="Activity timeline" description="Source-backed audit trail for this company." icon={Activity} />
        <ol className="relative space-y-3 border-l border-slate-200 pl-4">
          {company.activity.map((entry) => (
            <li key={entry.id} className="relative">
              <span
                className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${
                  entry.level === 'error'
                    ? 'bg-rose-500'
                    : entry.level === 'warn'
                      ? 'bg-amber-500'
                      : entry.level === 'success'
                        ? 'bg-emerald-500'
                        : 'bg-slate-300'
                }`}
              />
              <p className="text-sm text-slate-700">{entry.message}</p>
              <p className="text-[11px] text-slate-400">
                {titleCase(entry.action)} · {formatDate(entry.createdAt)}
              </p>
            </li>
          ))}
          {!company.activity.length ? <li className="text-sm text-slate-500">No activity recorded.</li> : null}
        </ol>
      </Card>

      <div className="mt-5 flex justify-end">
        <button type="button" className="btn-danger" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-4 w-4" /> Delete company
        </button>
      </div>

      <Modal
        open={emailModal}
        onClose={() => setEmailModal(false)}
        title="Add a public email manually"
        description="Use this for an address you found yourself on the official website. It will be verified before it can be used."
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEmailModal(false)}>
              Cancel
            </button>
            <button type="submit" form="manual-email-form" className="btn-primary" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Save & verify
            </button>
          </>
        }
      >
        <form id="manual-email-form" onSubmit={addEmail} className="space-y-4">
          <Field label="Email address" required>
            <input
              className="input"
              type="email"
              value={emailForm.email}
              onChange={(event) => setEmailForm({ ...emailForm, email: event.target.value })}
              placeholder="careers@company.com"
              autoFocus
            />
          </Field>
          <Field label="Where you found it" hint="Paste the official page URL. Required for an honest audit trail.">
            <input
              className="input"
              value={emailForm.sourceUrl}
              onChange={(event) => setEmailForm({ ...emailForm, sourceUrl: event.target.value })}
              placeholder="https://company.com/careers"
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={editModal}
        onClose={() => setEditModal(false)}
        title="Edit company"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEditModal(false)}>
              Cancel
            </button>
            <button type="submit" form="edit-company-form" className="btn-primary" disabled={saving}>
              Save changes
            </button>
          </>
        }
      >
        <form id="edit-company-form" onSubmit={saveEdit} className="space-y-4">
          <Field label="Company name" required>
            <input className="input" value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} />
          </Field>
          <Field label="Website" hint="Leave blank to let the search provider resolve it again.">
            <input
              className="input"
              value={editForm.website}
              onChange={(event) => setEditForm({ ...editForm, website: event.target.value })}
              placeholder="company.com"
            />
          </Field>
          <Field label="Notes">
            <textarea
              className="input min-h-24"
              value={editForm.notes}
              onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })}
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete company?"
        description={company.name}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setDeleteOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn-danger" onClick={removeCompany}>
              <Trash2 className="h-4 w-4" /> Delete permanently
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">All emails, sends, replies and logs for this company will be removed.</p>
      </Modal>
    </>
  );
}
