import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  Search,
  Database,
  Send,
  MailCheck,
  Inbox,
  Clock,
  Table2,
  Plug,
  Settings,
  ScrollText,
  Menu,
  X,
  GraduationCap,
  Plus,
  CircleDot,
} from 'lucide-react';
import { api } from '../lib/api.js';

const NAV_GROUPS = [
  {
    title: 'Workspace',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/add', label: 'Add Companies', icon: Building2 },
      { to: '/finder', label: 'Email Finder', icon: Search },
      { to: '/companies', label: 'Company Database', icon: Database },
    ],
  },
  {
    title: 'Outreach',
    items: [
      { to: '/outreach', label: 'Email Outreach', icon: Send },
      { to: '/sent', label: 'Sent Emails', icon: MailCheck },
      { to: '/inbox', label: 'Inbox & Replies', icon: Inbox },
      { to: '/follow-ups', label: 'Follow-up Tracker', icon: Clock },
    ],
  },
  {
    title: 'Data',
    items: [
      { to: '/spreadsheet', label: 'Spreadsheet', icon: Table2 },
      { to: '/activity', label: 'Activity Log', icon: ScrollText },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/integrations', label: 'Integrations', icon: Plug },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

function NavItems({ onNavigate }) {
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.title}>
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            {group.title}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                        isActive
                          ? 'bg-white/10 text-white shadow-inner'
                          : 'text-slate-400 hover:bg-white/5 hover:text-slate-600'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={`h-4 w-4 ${isActive ? 'text-brand-300' : 'text-slate-500 group-hover:text-slate-600'}`} />
                        <span className="truncate">{item.label}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-5 py-5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500/150/15 text-brand-300 ring-1 ring-brand-400/30">
        <GraduationCap className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">Internship Outreach</p>
        <p className="text-[11px] text-slate-400">Find · Verify · Send · Track</p>
      </div>
    </div>
  );
}

export default function Layout({ children }) {
  const [open, setOpen] = useState(false);
  const [readiness, setReadiness] = useState(null);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/dashboard/readiness')
      .then((data) => {
        if (!cancelled) setReadiness(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  const gmailConfigured = readiness?.integrations?.find((item) => item.key === 'gmail')?.configured;
  const account = readiness?.google?.account;

  return (
    <div className="min-h-full bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-gradient-to-b from-violet-700 via-purple-700 to-indigo-800 shadow-2xl shadow-black/40 lg:flex">
        <Brand />
        <NavItems />
        <div className="border-t border-white/10 p-4">
          <div className="rounded-xl bg-white/5 p-3">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <CircleDot className={`h-3 w-3 ${account ? 'text-emerald-400' : 'text-amber-400'}`} />
              Gmail
            </p>
            <p className="mt-1 truncate text-xs text-slate-600">
              {account ? account.email : gmailConfigured ? 'Not connected' : 'Not configured'}
            </p>
            <NavLink
              to="/integrations"
              className="mt-2 inline-block text-[11px] font-medium text-brand-300 hover:text-brand-200"
            >
              Manage integrations →
            </NavLink>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-gradient-to-b from-violet-700 via-purple-700 to-indigo-800 shadow-2xl">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/10">
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavItems onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-white/10 bg-[#0d1330]/85 px-4 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Local backend
            </span>
            {readiness ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 font-medium">
                <Plug className="h-3 w-3" />
                {readiness.integrations.filter((item) => item.configured).length}/{readiness.integrations.length} integrations ready
              </span>
            ) : null}
          </div>
          <div className="flex-1" />
          <NavLink to="/add" className="btn-primary !px-3.5 !py-2 text-xs sm:text-sm">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add company</span>
            <span className="sm:hidden">Add</span>
          </NavLink>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions, badge }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
          {badge}
        </div>
        {description ? <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
