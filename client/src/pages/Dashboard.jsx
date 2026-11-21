import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  MailSearch,
  BadgeCheck,
  Send,
  Reply,
  Sparkles,
  ArrowRight,
  Search,
  Plug,
  UserRound,
  FileText,
  RefreshCw,
  Activity,
  Download,
  BarChart3,
} from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Card, EmptyState, Skeleton, SectionHeading, StatCard } from '../components/ui.jsx';
import JobPanel from '../components/JobPanel.jsx';
import { useJobs } from '../components/JobContext.jsx';
import { api, downloadExport } from '../lib/api.js';
import { relativeTime, STATUS_META, titleCase, VERIFICATION_META } from '../lib/format.js';

const ICONS = {
  profile: UserRound,
  resume: FileText,
  search: Search,
  zerobounce: BadgeCheck,
  gmail: Send,
};

// Chart colours match the theme tokens in index.css.
const C = {
  purple: '#c23cff',
  cyan: '#21b4ff',
  grid: '#1e2554',
  axis: '#8a91bd',
  tooltipBg: '#0f1437',
  tooltipBorder: '#2c3468',
};

const tooltipStyle = {
  contentStyle: {
    background: C.tooltipBg,
    border: `1px solid ${C.tooltipBorder}`,
    borderRadius: 12,
    fontSize: 12,
    color: '#dde0f4',
    boxShadow: '0 12px 32px -12px rgb(0 0 0 / 0.7)',
  },
  labelStyle: { color: '#8a91bd', marginBottom: 4 },
  itemStyle: { color: '#f4f5fe' },
  cursor: { stroke: '#5f6798', strokeDasharray: '3 3' },
};

function shortDay(day) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const { version } = useJobs();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get('/dashboard/stats'));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  const totals = data?.totals;
  const timeline = useMemo(
    () => (data?.timeline || []).map((row) => ({ ...row, label: shortDay(row.day) })),
    [data?.timeline],
  );
  const sent30 = timeline.reduce((sum, row) => sum + row.sent, 0);
  const replies30 = timeline.reduce((sum, row) => sum + row.replies, 0);
  const statusData = (data?.breakdowns?.companyStatus || []).map((row) => ({
    status: STATUS_META[row.status]?.label || titleCase(row.status),
    count: row.count,
  }));

  const stats = [
    {
      label: 'Companies',
      value: totals?.companies ?? 0,
      pill: totals ? `${totals.companiesReady} ready` : null,
      pillTone: 'brand',
      hint: `${totals?.pendingCompanies ?? 0} not started · ${totals?.emailNotFound ?? 0} need attention`,
      icon: Building2,
      tone: 'brand',
    },
    {
      label: 'Emails found',
      // Total addresses discovered (the old card showed "ready companies" here, which
      // read as 0 even when addresses had been found but none was usable yet).
      value:
        (totals?.verifiedEmails ?? 0) +
        (totals?.unverifiedEmails ?? 0) +
        (totals?.invalidEmails ?? 0) +
        (totals?.catchAllEmails ?? 0),
      pill: totals ? `${totals.verifiedEmails} verified` : null,
      pillTone: 'emerald',
      hint: `${totals?.unverifiedEmails ?? 0} unverified · ${totals?.invalidEmails ?? 0} invalid`,
      icon: MailSearch,
      tone: 'blue',
    },
    {
      label: 'Requests sent',
      value: totals?.sent ?? 0,
      pill: totals?.failed ? `${totals.failed} failed` : totals?.queued ? `${totals.queued} queued` : null,
      pillTone: totals?.failed ? 'rose' : 'blue',
      hint: totals?.failed ? 'Retry failures from Sent Emails' : `${totals?.dueFollowUps ?? 0} follow-up(s) due`,
      icon: Send,
      tone: 'violet',
    },
    {
      label: 'Replies',
      value: totals?.repliedCompanies ?? 0,
      pill: totals?.positiveResponses ? `${totals.positiveResponses} positive` : null,
      pillTone: 'emerald',
      hint: `${totals?.interviews ?? 0} interview invitation(s)`,
      icon: Reply,
      tone: 'amber',
    },
  ];

  return (
    <>
      <PageHeader
        title="Welcome back"
        description="Track discovery, outreach and replies across every company in one place."
        actions={
          <>
            <button type="button" onClick={() => downloadExport('xlsx')} className="btn-ghost">
              <Download className="h-4 w-4" /> Export data
            </button>
            <Link to="/add" className="btn-primary">
              <Building2 className="h-4 w-4" /> Add companies
            </Link>
          </>
        }
      />

      {error ? (
        <Card className="mb-5 border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
          <button type="button" onClick={load} className="ml-2 font-semibold underline">
            retry
          </button>
        </Card>
      ) : null}

      {totals?.interviews > 0 || totals?.positiveResponses > 0 ? (
        <Card className="mb-5 border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Sparkles className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="font-semibold">Good news needs your attention:</span>
            <span>
              {totals?.interviews ?? 0} interview invitation(s) and {totals?.positiveResponses ?? 0} positive
              response(s).
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        {loading && !data
          ? Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[118px]" />)
          : stats.map((stat) => <StatCard key={stat.label} {...stat} />)}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-600">Emails sent · last 30 days</p>
              <div className="mt-2 flex items-center gap-2">
                <p className="text-2xl font-bold tracking-tight text-slate-950">{sent30}</p>
                <Badge tone="emerald" className="!rounded-md !px-1.5 !py-0.5 !text-[10px]">
                  {replies30} repl{replies30 === 1 ? 'y' : 'ies'}
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: C.purple }} /> Sent
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: C.cyan }} /> Replies
              </span>
              <button type="button" onClick={load} className="btn-ghost !px-2 !py-1.5 text-xs" aria-label="Refresh">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="mt-4 h-64 w-full">
            {timeline.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeline} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
                  <defs>
                    <linearGradient id="fillSent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.purple} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={C.purple} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="fillReplies" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.cyan} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={C.cyan} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: C.axis }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={24}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} />
                  <Area
                    type="monotone"
                    dataKey="sent"
                    name="Sent"
                    stroke={C.purple}
                    strokeWidth={2.5}
                    fill="url(#fillSent)"
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="replies"
                    name="Replies"
                    stroke={C.cyan}
                    strokeWidth={2}
                    fill="url(#fillReplies)"
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton className="h-full" />
            )}
          </div>
        </Card>

        <div className="grid gap-5">
          <Card className="p-5">
            <p className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <BarChart3 className="h-3.5 w-3.5 text-brand-700" /> Pipeline
            </p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-slate-950">{totals?.companies ?? 0}</p>
            {statusData.length ? (
              <div className="mt-3 h-28 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="fillBar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.purple} />
                        <stop offset="100%" stopColor="#6c3cff" />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="status" hide />
                    <Tooltip {...tooltipStyle} cursor={{ fill: 'rgb(255 255 255 / 0.04)' }} formatter={(value) => [value, 'Companies']} />
                    <Bar dataKey="count" fill="url(#fillBar)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">No companies yet.</p>
            )}
            <Link to="/companies" className="mt-3 inline-flex text-xs font-semibold text-brand-700 hover:text-brand-800">
              View database →
            </Link>
          </Card>

          <Card className="p-5">
            <SectionHeading title="Before you send" icon={Plug} />
            <ul className="-mt-2 space-y-2">
              {(data?.pendingChecks || []).length === 0 ? (
                <li className="rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
                  Everything needed to send is set up.
                </li>
              ) : (
                data?.pendingChecks?.map((check) => {
                  const Icon = ICONS[check.id] || Plug;
                  return (
                    <li key={check.id}>
                      <Link
                        to={check.href}
                        className="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-brand-300 hover:bg-brand-50/50"
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
                        <ArrowRight className="ml-auto mt-1 h-4 w-4 shrink-0 text-slate-400" />
                      </Link>
                    </li>
                  );
                })
              )}
            </ul>
          </Card>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Recent companies</h2>
              <p className="text-xs text-slate-500">Latest additions and their discovery result.</p>
            </div>
            <Link to="/companies" className="text-xs font-semibold text-brand-700 hover:text-brand-800">
              View all →
            </Link>
          </div>
          <div className="overflow-x-auto border-t border-slate-200">
            <table className="w-full min-w-[560px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Company</th>
                  <th className="th">Email</th>
                  <th className="th">Verification</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(data?.recentCompanies || []).map((company) => {
                  const status = STATUS_META[company.status] || STATUS_META.pending;
                  const verification = VERIFICATION_META[company.verification] || VERIFICATION_META.unverified;
                  return (
                    <tr key={company.id} className="hover:bg-slate-100/60">
                      <td className="td">
                        <Link to={`/companies/${company.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                          {company.name}
                        </Link>
                        <p className="text-xs text-slate-500">{company.domain || company.website || 'no website yet'}</p>
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
                    <td colSpan={4} className="px-4 py-10">
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
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeading title="Activity" icon={Activity} />
          <ul className="-mt-2 space-y-3">
            {(data?.recentActivity || []).slice(0, 7).map((entry) => (
              <li key={entry.id} className="flex gap-3">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    entry.level === 'error'
                      ? 'bg-rose-500'
                      : entry.level === 'warn'
                        ? 'bg-amber-500'
                        : entry.level === 'success'
                          ? 'bg-emerald-500'
                          : 'bg-slate-400'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-700">{entry.message}</p>
                  <p className="text-[11px] text-slate-500">
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
