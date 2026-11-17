import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  RefreshCw,
  Download,
  FileSpreadsheet,
  Trash2,
  ExternalLink,
  Play,
  ChevronLeft,
  ChevronRight,
  Database,
  Filter,
} from 'lucide-react';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Card, EmptyState, Modal, SectionHeading, Skeleton } from '../components/ui.jsx';
import { useJobs } from '../components/JobContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { api, downloadExport } from '../lib/api.js';
import { formatDate, STATUS_META, VERIFICATION_META } from '../lib/format.js';

const PAGE_SIZE = 50;

const EMAIL_STATUS = {
  sent: { label: 'Sent', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
  sending: { label: 'Sending', tone: 'blue' },
  not_sent: { label: 'Not Sent', tone: 'slate' },
};

export default function CompanyDatabase() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', status: '', verification: '', emailStatus: '' });
  const [applied, setApplied] = useState({ search: '', status: '', verification: '', emailStatus: '' });
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const toast = useToast();
  const { start, busy, version } = useJobs();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      for (const [key, value] of Object.entries(applied)) if (value) params.set(key, value);
      const data = await api.get(`/companies?${params.toString()}`);
      setRows(data.rows);
      setTotal(data.total);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [applied, page, toast]);

  useEffect(() => {
    load();
  }, [load, version]);

  function applyFilters(event) {
    event?.preventDefault();
    setPage(0);
    setApplied(filters);
  }

  async function discover(id) {
    try {
      await start([id]);
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function deleteCompany() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.del(`/companies/${deleting.id}`);
      toast.success(`"${deleting.name}" deleted.`);
      setDeleting(null);
      setSelected((current) => {
        const next = new Set(current);
        next.delete(deleting.id);
        return next;
      });
      load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function runSelected() {
    if (!selected.size) return;
    await start([...selected]);
    setSelected(new Set());
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Company database"
        description="The live tracker. Every row shows the discovered email, its source, verification state, sending state, replies and follow-ups."
        actions={
          <>
            <button type="button" onClick={() => downloadExport('csv')} className="btn-secondary">
              <Download className="h-4 w-4" /> CSV
            </button>
            <button type="button" onClick={() => downloadExport('xlsx')} className="btn-secondary">
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </button>
            <Link to="/add" className="btn-primary">
              Add companies
            </Link>
          </>
        }
      />

      <Card className="mb-4 p-3.5">
        <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              className="input !pl-9"
              placeholder="Search company, domain or email"
              value={filters.search}
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            />
          </div>
          <select
            className="input !w-auto !py-2.5 text-sm"
            value={filters.status}
            onChange={(event) => setFilters({ ...filters, status: event.target.value })}
          >
            <option value="">All statuses</option>
            <option value="pending">Not started</option>
            <option value="ready">Email found</option>
            <option value="email_not_found">Email not found</option>
            <option value="error">Error</option>
          </select>
          <select
            className="input !w-auto !py-2.5 text-sm"
            value={filters.verification}
            onChange={(event) => setFilters({ ...filters, verification: event.target.value })}
          >
            <option value="">Any verification</option>
            <option value="verified">Verified</option>
            <option value="unverified">Unverified</option>
            <option value="catch_all">Catch-all</option>
            <option value="invalid">Invalid</option>
          </select>
          <select
            className="input !w-auto !py-2.5 text-sm"
            value={filters.emailStatus}
            onChange={(event) => setFilters({ ...filters, emailStatus: event.target.value })}
          >
            <option value="">Any email status</option>
            <option value="not_sent">Not sent</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
          <button type="submit" className="btn-secondary">
            <Filter className="h-4 w-4" /> Apply
          </button>
          <button type="button" onClick={load} className="btn-ghost" aria-label="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </form>

        {selected.size ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-500/15 px-3 py-2">
            <p className="text-xs font-medium text-brand-200">{selected.size} selected</p>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => setSelected(new Set())}>
                Clear
              </button>
              <button type="button" className="btn-primary !py-1.5 text-xs" onClick={runSelected} disabled={busy}>
                <Play className="h-3.5 w-3.5" /> Find emails
              </button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px]">
            <thead className="bg-slate-50/80">
              <tr>
                <th className="th w-10">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                    checked={rows.length > 0 && rows.every((row) => selected.has(row.id))}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        for (const row of rows) {
                          if (event.target.checked) next.add(row.id);
                          else next.delete(row.id);
                        }
                        return next;
                      })
                    }
                    aria-label="Select page"
                  />
                </th>
                <th className="th">Company name</th>
                <th className="th">Website</th>
                <th className="th">Company email</th>
                <th className="th">Email source</th>
                <th className="th">Verification</th>
                <th className="th">Email status</th>
                <th className="th">Date sent</th>
                <th className="th">Reply</th>
                <th className="th">Follow-up</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && !rows.length
                ? Array.from({ length: 6 }).map((_, index) => (
                    <tr key={index}>
                      <td colSpan={11} className="px-4 py-3">
                        <Skeleton className="h-8" />
                      </td>
                    </tr>
                  ))
                : rows.map((company) => {
                    const status = STATUS_META[company.status] || STATUS_META.pending;
                    const verification = VERIFICATION_META[company.verification] || VERIFICATION_META.unverified;
                    const emailStatus = EMAIL_STATUS[company.emailStatus] || EMAIL_STATUS.not_sent;
                    return (
                      <tr key={company.id} className={selected.has(company.id) ? 'bg-brand-500/150/15' : 'hover:bg-slate-50/60'}>
                        <td className="td">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-brand-600"
                            checked={selected.has(company.id)}
                            onChange={() =>
                              setSelected((current) => {
                                const next = new Set(current);
                                if (next.has(company.id)) next.delete(company.id);
                                else next.add(company.id);
                                return next;
                              })
                            }
                            aria-label={`Select ${company.name}`}
                          />
                        </td>
                        <td className="td">
                          <Link to={`/companies/${company.id}`} className="font-medium text-slate-900 hover:text-brand-200">
                            {company.name}
                          </Link>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <Badge tone={status.tone} dot>
                              {status.label}
                            </Badge>
                            {company.notes ? <span className="text-[10px] text-slate-400">notes</span> : null}
                          </div>
                        </td>
                        <td className="td max-w-[170px]">
                          {company.website ? (
                            <a
                              href={company.website}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex max-w-full items-center gap-1 truncate text-xs text-brand-300 hover:underline"
                            >
                              <span className="truncate">{company.domain || company.website}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="td max-w-[220px]">
                          {company.primaryEmail ? (
                            <>
                              <p className="truncate text-sm text-slate-800">{company.primaryEmail}</p>
                              <p className="text-[10px] capitalize text-slate-400">{company.emailCategory || 'contact'}</p>
                            </>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="td max-w-[200px]">
                          {company.emailSource ? (
                            <a
                              href={company.emailSource}
                              target="_blank"
                              rel="noreferrer"
                              className="block truncate text-xs text-slate-500 hover:text-brand-200"
                              title={company.emailSource}
                            >
                              {company.emailSource.replace(/^https?:\/\//, '')}
                            </a>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="td">
                          {company.verification ? (
                            <Badge tone={verification.tone}>{verification.label}</Badge>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="td">
                          <Badge tone={emailStatus.tone}>{emailStatus.label}</Badge>
                        </td>
                        <td className="td whitespace-nowrap text-xs text-slate-500">{company.dateSent ? formatDate(company.dateSent) : '—'}</td>
                        <td className="td">
                          {company.replyStatus === 'replied' ? (
                            <Badge tone="emerald">Replied</Badge>
                          ) : company.replyStatus === 'no_reply' ? (
                            <Badge tone="amber">No reply</Badge>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="td text-xs text-slate-500">
                          {company.followUpStatus === 'none' ? '—' : company.followUpStatus}
                          {company.followUpDueAt ? (
                            <p className="text-[10px] text-slate-400">due {formatDate(company.followUpDueAt, { withTime: false })}</p>
                          ) : null}
                        </td>
                        <td className="td">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => discover(company.id)}
                              className="btn-ghost !px-2 !py-1 text-xs"
                              title="Run email discovery"
                            >
                              <Play className="h-3.5 w-3.5" />
                            </button>
                            <Link to={`/companies/${company.id}`} className="btn-ghost !px-2 !py-1 text-xs" title="Open details">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                            <button
                              type="button"
                              onClick={() => setDeleting(company)}
                              className="btn-ghost !px-2 !py-1 text-xs text-rose-600 hover:bg-rose-50"
                              title="Delete company"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>

        {!loading && !rows.length ? (
          <div className="p-6">
            <EmptyState
              icon={Database}
              title="No companies match"
              description="Adjust the filters, or add companies to the database."
              action={
                <Link to="/add" className="btn-primary">
                  Add companies
                </Link>
              }
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
          <p className="text-xs text-slate-500">
            Showing {total ? page * PAGE_SIZE + 1 : 0}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
          </p>
          <div className="flex items-center gap-1">
            <button type="button" className="btn-ghost !px-2 !py-1.5" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 text-xs text-slate-600">
              Page {page + 1} of {pages}
            </span>
            <button
              type="button"
              className="btn-ghost !px-2 !py-1.5"
              disabled={page + 1 >= pages}
              onClick={() => setPage((value) => value + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </Card>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete company?"
        description={deleting ? `"${deleting.name}" and its discovered emails, sends and replies will be removed.` : ''}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button type="button" className="btn-danger" onClick={deleteCompany} disabled={deleteBusy}>
              <Trash2 className="h-4 w-4" /> Delete permanently
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          This cannot be undone. Export the spreadsheet first if you want a copy of the history.
        </p>
      </Modal>
    </>
  );
}
