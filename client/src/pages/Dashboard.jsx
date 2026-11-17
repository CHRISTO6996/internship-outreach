import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  MailSearch,
  BadgeCheck,
  Send,
  AlertTriangle,
  Reply,
  CalendarCheck,
  Clock,
  Sparkles,
  ArrowRight,
  Search,
  Plug,
  UserRound,
  FileText,
  RefreshCw,
  Activity,
} from 'lucide-react';
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Card, EmptyState, Skeleton, SectionHeading, StatCard } from '../components/ui.jsx';
import JobPanel from '../components/JobPanel.jsx';
import { useJobs } from '../components/JobContext.jsx';
import { api } from '../lib/api.js';
import { relativeTime, STATUS_META, titleCase, VERIFICATION_META } from '../lib/format.js';

const ICONS = {
  profile: UserRound,
  search: Search,
  zerobounce: BadgeCheck,
  gmail: Send,
};

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const { version } = useJobs();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get('/dashboard/stats')
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const totals = data?.totals;
  const statusData = (data?.breakdowns?.companyStatus || []).map((row) => ({
    status: titleCase(row.status),
    count: row.count,
  }));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Company name in, internship request out. Every step below uses real data from your database and connected APIs."
        actions={
          <>
            <Link to="/integrations" className="btn-secondary">
              <Plug className="h-4 w-4" /> Integrations
            </Link>
            <Link to="/add" className="btn-primary">
              <Building2 className="h-4 w-4" /> Add companies
            </Link>
          </>
        }
      />

      {error ? (
        <Card className="mb-5 border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
          <button type="button" onClick={() => window.location.reload()} className="ml-2 font-semibold underline">
            retry
          </button>
        </Card>
      ) : null}

      {totals?.interviews > 0 || totals?.positiveResponses > 0 ? (
        <Card className="mb-5 border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Sparkles className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="font-semibold">Good news needs your attention:</span>
            <span>
              {totals?.interviews ?? 0} interview invitation(s) and {totals?.positiveResponses ?? 0} positive
              response(s) recorded.
            </span>
            <Link to="/inbox" className="font-semibold underline">
              Review replies
            </Link>
          </div>
        </Card>
      ) : null}

      <div className="mb-5">
        <JobPanel />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {loading && !data
          ? Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-28" />)
          : [
              {
                label: 'Total companies',
                value: totals?.companies ?? 0,
                hint: `${totals?.companiesReady ?? 0} with a usable email`,
                icon: Building2,
                tone: 'brand',
              },
              {
                label: 'Emails found',
                value: totals?.emailsFound ?? 0,
                hint: `${totals?.emailNotFound ?? 0} companies need attention`,
                icon: MailSearch,
                tone: 'blue',
              },
              {
                label: 'Verified emails',
                value: totals?.verifiedEmails ?? 0,
                hint: `${totals?.unverifiedEmails ?? 0} unverified · ${totals?.invalidEmails ?? 0} invalid`,
                icon: BadgeCheck,
                tone: 'emerald',
              },
              {
                label: 'Requests sent',
                value: totals?.sent ?? 0,
                hint: `${totals?.failed ?? 0} failed · ${totals?.queued ?? 0} queued`,
                icon: Send,
                tone: 'violet',
              },
              {
                label: 'Failed emails',
                value: totals?.failed ?? 0,
                hint: 'Sending errors, retry from Sent Emails',
                icon: AlertTriangle,
                tone: 'rose',
              },
              {
                label: 'Companies replied',
                value: totals?.repliedCompanies ?? 0,
                hint: `${totals?.interviews ?? 0} interview invitation(s)`,
                icon: Reply,
                tone: 'amber',
              },
              {
                label: 'Positive responses',
                value: totals?.positiveResponses ?? 0,
                hint: 'Including resume requests and interviews',
                icon: CalendarCheck,
                tone: 'emerald',
              },
              {
                label: 'Pending follow-ups',
                value: totals?.pendingFollowUps ?? 0,
                hint: `${totals?.dueFollowUps ?? 0} due now`,
                icon: Clock,
                tone: 'slate',
              },
            ].map((stat) => <StatCard key={stat.label} {...stat} />)}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <SectionHeading
            title="Pipeline"
            description="Where your companies currently sit in the workflow."
            icon={Activity}
            actions={
              <button
                type="button"
                onClick={async () => {
                  const fresh = await api.get('/dashboard/stats');
                  setData(fresh);
                }}
                className="btn-ghost !px-2.5 !py-1.5 text-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </button>
            }
          />
          {statusData.length ? (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={statusData} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="status" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }}
                    formatter={(value) => [value, 'Companies']}
                  />
                  <Bar dataKey="count" fill="#338ffb" radius={[6, 6, 0, 0]} maxBarSize={56} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              icon={Building2}
              title="No companies yet"
              description="Add a few company names, then run the email finder."
              action={
                <Link to="/add" className="btn-primary">
                  Add your first company
                </Link>
              }
            />
          )}
        </Card>

        <Card className="p-4">
          <SectionHeading title="Before you send" description="Live readiness checks." icon={Plug} />
          <ul className="space-y-2.5">
            {(data?.pendingChecks || []).length === 0 ? (
              <li className="rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
                Everything needed for the next step is configured.
              </li>
            ) : (
              data?.pendingChecks?.map((check) => {
                const Icon = ICONS[check.id] || Plug;
                return (
                  <li key={check.id}>
                    <Link
                      to={check.href}
                      className="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <span
                        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                          check.severity === 'warning' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-800">{check.title}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">{check.detail}</span>
                      </span>
                      <ArrowRight className="ml-auto mt-1 h-4 w-4 shrink-0 text-slate-300" />
                    </Link>
                  </li>
                );
              })
            )}
          </ul>
          <div className="mt-4 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
            <Badge tone={data?.readiness?.search ? 'emerald' : 'amber'} dot>
              Search
            </Badge>
            <Badge tone={data?.readiness?.verification ? 'emerald' : 'amber'} dot>
              Verify
            </Badge>
            <Badge tone={data?.readiness?.gmail ? 'emerald' : 'amber'} dot>
              Gmail
            </Badge>
            <Badge tone={data?.readiness?.profile ? 'emerald' : 'amber'} dot>
              Profile
            </Badge>
            <Badge tone={data?.readiness?.resume ? 'emerald' : 'amber'} dot>
              Resume
            </Badge>
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Recent companies</h2>
              <p className="text-xs text-slate-500">Latest additions and their discovery result.</p>
            </div>
            <Link to="/companies" className="text-xs font-semibold text-brand-700 hover:text-brand-800">
              View all →
            </Link>
          </div>
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full min-w-[560px]">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="th">Company</th>
                  <th className="th">Email</th>
                  <th className="th">Verification</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.recentCompanies || []).map((company) => {
                  const status = STATUS_META[company.status] || STATUS_META.pending;
                  const verification = VERIFICATION_META[company.verification] || VERIFICATION_META.unverified;
                  return (
                    <tr key={company.id} className="hover:bg-slate-50/60">
                      <td className="td">
                        <Link to={`/companies/${company.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                          {company.name}
                        </Link>
                        <p className="text-xs text-slate-400">{company.domain || company.website || 'no website yet'}</p>
                      </td>
                      <td className="td">
                        {company.primaryEmail ? (
                          <span className="text-slate-700">{company.primaryEmail}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="td">
                        {company.verification ? (
                          <Badge tone={verification.tone}>{verification.label}</Badge>
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
                {!data?.recentCompanies?.length ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">
                      Nothing here yet. Add a company to get started.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4">
          <SectionHeading title="Activity" description="Every action is logged." icon={Activity} />
          <ul className="space-y-3">
            {(data?.recentActivity || []).slice(0, 7).map((entry) => (
              <li key={entry.id} className="flex gap-3">
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
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
                  <p className="text-xs font-medium text-slate-700">{entry.message}</p>
                  <p className="text-[11px] text-slate-400">
                    {titleCase(entry.action)} · {relativeTime(entry.createdAt)}
                  </p>
                </div>
              </li>
            ))}
            {!data?.recentActivity?.length ? <li className="text-sm text-slate-500">No activity yet.</li> : null}
          </ul>
          <Link to="/activity" className="mt-4 inline-flex text-xs font-semibold text-brand-700 hover:text-brand-800">
            Open full log →
          </Link>
        </Card>
      </div>
    </>
  );
}
