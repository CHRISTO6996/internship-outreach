import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  Play,
  Loader2,
  ShieldCheck,
  Globe2,
  Mail,
  ExternalLink,
  RefreshCw,
  Info,
  BadgeCheck,
  ListChecks,
} from 'lucide-react';
import { PageHeader } from '../components/Layout.jsx';
import { Alert, Badge, Card, EmptyState, SectionHeading, Skeleton } from '../components/ui.jsx';
import JobPanel from '../components/JobPanel.jsx';
import { useJobs } from '../components/JobContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { api } from '../lib/api.js';
import { relativeTime, STATUS_META, titleCase, VERIFICATION_META } from '../lib/format.js';

const NEEDS_DISCOVERY = new Set(['pending', 'error', 'email_not_found']);

export default function EmailFinder() {
  const [companies, setCompanies] = useState([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [emails, setEmails] = useState([]);
  const [verifyingId, setVerifyingId] = useState(null);
  const [log, setLog] = useState([]);
  const { start, job, version, busy } = useJobs();
  const toast = useToast();

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/companies?limit=500');
      setCompanies(data.rows);
      setTotal(data.total);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadEmails = useCallback(async () => {
    try {
      const data = await api.get('/emails?limit=60');
      setEmails(data.rows);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies, version]);

  useEffect(() => {
    loadEmails();
  }, [loadEmails, version]);

  const active = job && ['queued', 'running', 'pausing', 'paused'].includes(job.status);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api.get('/activity?limit=18');
        if (!cancelled) setLog(data.rows);
      } catch {
        /* transient */
      }
    };
    load();
    const timer = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, job?.id]);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return companies.filter((company) => {
      if (onlyMissing && !NEEDS_DISCOVERY.has(company.status)) return false;
      if (!term) return true;
      return (
        company.name.toLowerCase().includes(term) ||
        (company.domain || '').toLowerCase().includes(term) ||
        (company.primaryEmail || '').toLowerCase().includes(term)
      );
    });
  }, [companies, onlyMissing, searchTerm]);

  const allSelected = filtered.length > 0 && filtered.every((company) => selected.has(company.id));

  function toggle(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) => {
      if (allSelected) {
        const next = new Set(current);
        for (const company of filtered) next.delete(company.id);
        return next;
      }
      const next = new Set(current);
      for (const company of filtered) next.add(company.id);
      return next;
    });
  }

  async function runSelected() {
    const ids = selected.size ? [...selected] : filtered.map((company) => company.id);
    if (!ids.length) {
      toast.warning('Nothing to process. Add companies first.');
      return;
    }
    await start(ids);
    setSelected(new Set());
  }

  async function reverify(id) {
    setVerifyingId(id);
    try {
      const result = await api.post(`/emails/${id}/verify`);
      toast.success(`Re-verified: ${result.verification.replace('_', ' ')} (${result.provider}).`);
      await loadEmails();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setVerifyingId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Email finder"
        description="Runs the real discovery pipeline: official website → careers/contact pages → public addresses → DNS + verification API → one primary contact per company."
        actions={
          <>
            <button type="button" onClick={loadCompanies} className="btn-secondary" disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button type="button" onClick={runSelected} className="btn-primary" disabled={busy || !filtered.length}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Find emails {selected.size ? `(${selected.size})` : `for ${filtered.length}`}
            </button>
          </>
        }
      />

      <div className="mb-5">
        <JobPanel />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Discovery queue</h2>
              <p className="text-xs text-slate-500">
                {total} company(ies) total · {filtered.length} shown
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  checked={onlyMissing}
                  onChange={(event) => setOnlyMissing(event.target.checked)}
                />
                Only without a usable email
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  className="input !py-2 !pl-8 !text-xs"
                  placeholder="Filter companies"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
            </div>
          </div>

          {loading && !companies.length ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : filtered.length ? (
            <div className="max-h-[460px] overflow-auto">
              <table className="w-full min-w-[640px]">
                <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
                  <tr>
                    <th className="th w-10">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-brand-600"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all"
                      />
                    </th>
                    <th className="th">Company</th>
                    <th className="th">Website</th>
                    <th className="th">Primary email</th>
                    <th className="th">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((company) => {
                    const status = STATUS_META[company.status] || STATUS_META.pending;
                    return (
                      <tr key={company.id} className={selected.has(company.id) ? 'bg-brand-50/40' : 'hover:bg-slate-50/60'}>
                        <td className="td">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-brand-600"
                            checked={selected.has(company.id)}
                            onChange={() => toggle(company.id)}
                            aria-label={`Select ${company.name}`}
                          />
                        </td>
                        <td className="td">
                          <Link to={`/companies/${company.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                            {company.name}
                          </Link>
                          <p className="text-[11px] text-slate-400">
                            {company.lastDiscoveredAt ? `checked ${relativeTime(company.lastDiscoveredAt)}` : 'never checked'}
                          </p>
                        </td>
                        <td className="td max-w-[180px] truncate text-xs text-slate-500">
                          {company.website ? (
                            <a href={company.website} target="_blank" rel="noreferrer" className="hover:text-brand-700">
                              {company.domain || company.website}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="td text-xs">
                          {company.primaryEmail ? (
                            <span className="text-slate-700">{company.primaryEmail}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="td">
                          <Badge tone={status.tone} dot>
                            {status.label}
                          </Badge>
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
                icon={ListChecks}
                title={companies.length ? 'Nothing matches this filter' : 'No companies yet'}
                description={
                  companies.length
                    ? 'Turn off the filter to see companies that already have an email.'
                    : 'Add companies first, then come back to run discovery.'
                }
                action={
                  <Link to="/add" className="btn-primary">
                    Add companies
                  </Link>
                }
              />
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <SectionHeading title="Live log" description={active ? 'Streaming while the job runs.' : 'Latest pipeline events.'} icon={Info} />
            {log.length ? (
              <ul className="max-h-80 space-y-2 overflow-auto pr-1">
                {log.map((entry) => (
                  <li key={entry.id} className="flex gap-2 text-xs">
                    <span
                      className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                        entry.level === 'error'
                          ? 'bg-rose-500'
                          : entry.level === 'warn'
                            ? 'bg-amber-500'
                            : entry.level === 'success'
                              ? 'bg-emerald-500'
                              : 'bg-slate-300'
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-slate-600">{entry.message}</p>
                      <p className="text-[10px] text-slate-400">{relativeTime(entry.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No events captured yet.</p>
            )}
          </Card>

          <Card className="p-4">
            <SectionHeading title="Safety rules" description="Applied to every run." icon={ShieldCheck} />
            <ul className="space-y-2.5 text-xs text-slate-600">
              {[
                'robots.txt is checked before each page.',
                'Only publicly listed addresses are stored, with their source URL.',
                'Addresses without MX records are marked Invalid.',
                'Invalid addresses are never promoted to primary and can never be emailed.',
                'Random personal/billing mailboxes are never chosen as the internship contact.',
              ].map((rule) => (
                <li key={rule} className="flex gap-2">
                  <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  {rule}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Discovered email addresses</h2>
            <p className="text-xs text-slate-500">Every address keeps its source and verification result.</p>
          </div>
          <Badge tone="slate">{emails.length} shown</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead className="bg-slate-50/70">
              <tr>
                <th className="th">Email</th>
                <th className="th">Company</th>
                <th className="th">Category</th>
                <th className="th">Verification</th>
                <th className="th">Source</th>
                <th className="th">Score</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {emails.map((email) => {
                const verification = VERIFICATION_META[email.verification] || VERIFICATION_META.unverified;
                return (
                  <tr key={email.id} className="hover:bg-slate-50/60">
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-slate-400" />
                        <span className="font-medium text-slate-800">{email.email}</span>
                        {email.isPrimary ? <Badge tone="brand">Primary</Badge> : null}
                      </div>
                    </td>
                    <td className="td">
                      <Link to={`/companies/${email.companyId}`} className="text-xs font-medium text-slate-700 hover:text-brand-700">
                        {email.companyName}
                      </Link>
                    </td>
                    <td className="td text-xs capitalize text-slate-600">{email.category || '—'}</td>
                    <td className="td">
                      <Badge tone={verification.tone}>{verification.label}</Badge>
                      {email.verificationDetail ? (
                        <p className="mt-1 max-w-[220px] truncate text-[10px] text-slate-400" title={email.verificationDetail}>
                          {email.verificationProvider}: {email.verificationDetail}
                        </p>
                      ) : null}
                    </td>
                    <td className="td max-w-[240px]">
                      {email.sourceUrl ? (
                        <a
                          href={email.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-full items-center gap-1 truncate text-xs text-brand-700 hover:underline"
                        >
                          <Globe2 className="h-3 w-3 shrink-0" />
                          <span className="truncate">{email.sourceUrl.replace(/^https?:\/\//, '')}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                      <p className="text-[10px] text-slate-400">{titleCase(email.sourceType || '')}</p>
                    </td>
                    <td className="td text-xs font-semibold text-slate-700">{email.score ?? 0}</td>
                    <td className="td text-right">
                      <button
                        type="button"
                        onClick={() => reverify(email.id)}
                        disabled={verifyingId === email.id}
                        className="btn-ghost !px-2 !py-1 text-xs"
                      >
                        {verifyingId === email.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Verify
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!emails.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    No addresses discovered yet. Run the finder above.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Alert tone="info" className="mt-5">
        Verification requires ZEROBOUNCE_API_KEY (or HUNTER_API_KEY). Without it, addresses are checked against DNS MX records and
        clearly marked <strong>Unverified</strong> — never <strong>Verified</strong>.
      </Alert>
    </>
  );
}
