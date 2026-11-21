import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
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
  ChevronRight,
  LogOut,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';

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
      { to: '/follow-ups', label: 'Follow-ups', icon: Clock },
    ],
  },
  {
    title: 'Data',
    items: [
      { to: '/spreadsheet', label: 'Spreadsheet', icon: Table2 },
      { to: '/activity', label: 'Activity Log', icon: ScrollText },
    ],
  },
];

const FOOTER_ITEMS = [
  { to: '/integrations', label: 'Integrations', icon: Plug },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function NavItem({ item, onNavigate }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition ${
          isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? <span className="absolute inset-y-1.5 -left-3 w-0.5 rounded-full bg-brand-500" /> : null}
          <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-brand-500' : 'text-slate-500 group-hover:text-slate-700'}`} />
          <span className="truncate">{item.label}</span>
          {isActive ? <ChevronRight className="ml-auto h-3.5 w-3.5 text-brand-500" /> : null}
        </>
      )}
    </NavLink>
  );
}

function SidebarSearch({ onNavigate }) {
  const [term, setTerm] = useState('');
  const navigate = useNavigate();
  return (
    <form
      className="px-4"
      onSubmit={(event) => {
        event.preventDefault();
        const value = term.trim();
        navigate(value ? `/companies?search=${encodeURIComponent(value)}` : '/companies');
        setTerm('');
        onNavigate?.();
      }}
    >
      <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-surface-2 px-3 py-2 text-xs text-slate-500 focus-within:border-brand-400">
        <Search className="h-3.5 w-3.5 shrink-0" />
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search companies…"
          className="w-full bg-transparent text-slate-800 outline-none placeholder:text-slate-500"
          aria-label="Search companies"
        />
      </label>
    </form>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-linear-to-br from-[#c23cff] to-[#21b4ff] shadow-[0_4px_14px_-4px_rgb(194_60_255/0.7)]">
        <Send className="h-4 w-4 text-white" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[15px] font-bold tracking-tight text-slate-950">Internship Outreach</p>
        <p className="text-[11px] text-slate-500">Internship pipeline</p>
      </div>
    </div>
  );
}

function AccountCard({ account, gmailConfigured, onNavigate }) {
  const label = account ? account.email : gmailConfigured ? 'Gmail not connected' : 'Gmail not configured';
  const initial = account?.email?.[0]?.toUpperCase() || '?';
  return (
    <NavLink
      to="/integrations"
      onClick={onNavigate}
      className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-slate-100"
    >
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white ${
          account ? 'bg-linear-to-br from-[#c23cff] to-[#6c3cff]' : 'bg-slate-300'
        }`}
      >
        {initial}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-slate-900">{label}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className={`h-1.5 w-1.5 rounded-full ${account ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          {account ? 'Connected' : 'Connect account'}
        </span>
      </span>
    </NavLink>
  );
}

function SidebarContent({ readiness, onNavigate }) {
  const { user, logout } = useAuth();
  const gmailConfigured = readiness?.integrations?.find((item) => item.key === 'gmail')?.configured;
  const account = readiness?.google?.account;
  return (
    <>
      <SidebarSearch onNavigate={onNavigate} />
      <nav className="mt-4 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{group.title}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavItem item={item} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="space-y-0.5 border-t border-slate-200 px-4 py-3">
        {FOOTER_ITEMS.map((item) => (
          <NavItem key={item.to} item={item} onNavigate={onNavigate} />
        ))}
      </div>
      <div className="space-y-2 border-t border-slate-200 px-3 py-3">
        <AccountCard account={account} gmailConfigured={gmailConfigured} onNavigate={onNavigate} />
        {user ? (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-800">{user.username}</p>
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Signed in</p>
            </div>
            <button
              type="button"
              onClick={() => {
                onNavigate?.();
                logout();
              }}
              className="btn-ghost !px-2 !py-1.5 text-xs text-slate-500 hover:text-rose-400"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        ) : null}
      </div>
    </>
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

  return (
    <div className="min-h-full bg-canvas">
      {/* Soft glow in the top-left corner, like the template's background. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0bg-[radial-gradient(60rem_40rem_at_20%_-10%,rgb(140_60_255/0.10),transparent_60%),radial-gradient(50rem_30rem_at_100%_0%,rgb(33_180_255/0.06),transparent_60%)]"
      />

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-slate-200 bg-sidebar lg:flex">
        <Brand />
        <SidebarContent readiness={readiness} />
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-slate-200 bg-sidebar shadow-2xl">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarContent readiness={readiness} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="relative lg:pl-64">
        {/* Mobile top bar only; on desktop the page header carries the actions. */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-sidebar/90 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <p className="text-sm font-bold text-slate-950">Internship Outreach</p>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions, badge }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{title}</h1>
          {badge}
        </div>
        {description ? <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
