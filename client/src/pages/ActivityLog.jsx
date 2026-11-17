import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, RefreshCw, ScrollText, Search } from 'lucide-react';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Card, EmptyState } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';
import { api } from '../lib/api.js';
import { formatDate, relativeTime, titleCase } from '../lib/format.js';

const LEVELS = [
  { value: '', label: 'All levels' },
  { value: 'info', label: 'Info', tone: 'slate' },
  { value: 'success', label: 'Success', tone: 'emerald' },
  { value: 'warn', label: 'Warning', tone: 'amber' },
  { value: 'error', label: 'Error', tone: 'rose' },
  { value: 'debug', label: 'Debug', tone: 'slate' },
];

const TONES = Object.fromEntries(LEVELS.filter((level) => level.value).map((level) => [level.value, level.tone]));

export default function ActivityLog() {
  const [rows, setRows] = useState([]);
  const [level, setLevel] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '150' });
      if (level) params.set('level', level);
      if (appliedSearch) params.set('search', appliedSearch);
      const payload = await api.get(`/activity?${params.toString()}`);
      setRows(payload.rows);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [level, appliedSearch, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadOlder() {
    if (!rows.length) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: '150', beforeId: String(rows[rows.length - 1].id) });
      if (level) params.set('level', level);
      if (appliedSearch) params.set('search', appliedSearch);
      const payload = await api.get(`/activity?${params.toString()}`);
      setRows((current) => [...current, ...payload.rows]);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Activity Log"
        description="An append-only audit trail of every discovery, verification, send, reply and setting change."
        actions={
          <button type="button" className="btn-secondary" onClick={load}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 px-4 py-3">
          <div className="min-w-40">
            <label className="label !mb-1 !text-xs">Level</label>
            <select className="input !py-2" value={level} onChange={(event) => setLevel(event.target.value)}>
              {LEVELS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <form
            className="flex min-w-64 flex-1 gap-2"
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
                placeholder="Message or action"
              />
            </div>
            <button type="submit" className="btn-secondary mt-6 !px-3 !py-2" aria-label="Search activity">
              <Search className="h-4 w-4" />
            </button>
          </form>
          <span className="ml-auto pb-2 text-xs text-slate-400">{rows.length} entries loaded</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading activity…</div>
        ) : rows.length ? (
          <>
            <ul className="divide-y divide-slate-100">
              {rows.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 px-4 py-3">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      entry.level === 'error'
                        ? 'bg-rose-500'
                        : entry.level === 'warn'
                          ? 'bg-amber-500'
                          : entry.level === 'success'
                            ? 'bg-emerald-500'
                            : entry.level === 'debug'
                              ? 'bg-slate-300'
                              : 'bg-sky-400'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={TONES[entry.level] || 'slate'}>{titleCase(entry.level)}</Badge>
                      <span className="font-mono text-[11px] text-slate-400">{entry.action}</span>
                      {entry.companyId ? (
                        <Link
                          to={`/companies/${entry.companyId}`}
                          className="text-[11px] font-medium text-brand-300 hover:underline"
                        >
                          Company #{entry.companyId}
                        </Link>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{entry.message}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400" title={formatDate(entry.createdAt)}>
                      {relativeTime(entry.createdAt)} · {formatDate(entry.createdAt)}
                    </p>
                    {entry.meta ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-600">Details</summary>
                        <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-50 px-2.5 py-2 text-[10.5px] text-slate-600">
                          {JSON.stringify(entry.meta, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-slate-100 px-4 py-3 text-center">
              <button type="button" className="btn-secondary" onClick={loadOlder} disabled={loadingMore}>
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScrollText className="h-4 w-4" />}
                Load older entries
              </button>
            </div>
          </>
        ) : (
          <div className="p-4">
            <EmptyState
              icon={ScrollText}
              title="No activity matches"
              description="Actions such as adding companies, finding emails, sending and receiving replies appear here automatically."
            />
          </div>
        )}
      </Card>
    </>
  );
}
