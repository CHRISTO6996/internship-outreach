import { Link } from 'react-router-dom';
import { Pause, Play, Square, Loader2, ChevronRight } from 'lucide-react';
import { Badge, ProgressBar } from './ui.jsx';
import { useJobs, ACTIVE_JOB_STATUSES } from './JobContext.jsx';
import { titleCase } from '../lib/format.js';

const STATUS_TONE = {
  queued: 'slate',
  running: 'blue',
  pausing: 'amber',
  paused: 'amber',
  completed: 'emerald',
  stopped: 'slate',
  failed: 'rose',
};

export default function JobPanel({ compact = false }) {
  const { job, busy, control } = useJobs();
  if (!job) return null;

  const percent = job.total ? Math.round((job.processed / job.total) * 100) : 0;
  const active = ACTIVE_JOB_STATUSES.has(job.status);
  const current = job.items?.find((item) => item.status === 'running');
  const done = job.items?.filter((item) => item.status === 'done').length || 0;
  const failed = job.items?.filter((item) => item.status === 'failed').length || 0;
  const skipped = job.items?.filter((item) => item.status === 'skipped').length || 0;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2.5">
          {active ? (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500/150" />
            </span>
          ) : null}
          <p className="text-sm font-semibold text-slate-900">Discovery job #{job.id}</p>
          <Badge tone={STATUS_TONE[job.status] || 'slate'} dot>
            {titleCase(job.status)}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {active ? (
            <>
              {job.status === 'paused' || job.status === 'pausing' ? (
                <button type="button" disabled={busy} onClick={() => control('resume')} className="btn-secondary !px-3 !py-1.5 text-xs">
                  <Play className="h-3.5 w-3.5" /> Resume
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => control('pause')} className="btn-secondary !px-3 !py-1.5 text-xs">
                  <Pause className="h-3.5 w-3.5" /> Pause
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => control('stop')} className="btn-danger !px-3 !py-1.5 text-xs">
                <Square className="h-3.5 w-3.5" /> Stop
              </button>
            </>
          ) : (
            <Link to="/finder" className="btn-ghost !px-3 !py-1.5 text-xs">
              Run another <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            {job.processed}/{job.total} processed
            {done ? ` · ${done} done` : ''}
            {failed ? ` · ${failed} failed` : ''}
            {skipped ? ` · ${skipped} skipped` : ''}
          </span>
          <span className="font-medium text-slate-700">{percent}%</span>
        </div>
        <ProgressBar value={percent} tone={job.status === 'failed' ? 'rose' : job.status === 'completed' ? 'emerald' : 'brand'} />

        {current ? (
          <p className="mt-2.5 flex items-center gap-2 text-xs text-slate-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-500" />
            Working on <span className="font-semibold">{current.companyName}</span>
          </p>
        ) : job.error ? (
          <p className="mt-2.5 text-xs text-rose-600">{job.error}</p>
        ) : null}

        {!compact && job.items?.length ? (
          <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
            {job.items.slice(0, 8).map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 py-1.5 text-xs">
                <span className="truncate font-medium text-slate-700">{item.companyName}</span>
                <span
                  className={`shrink-0 ${
                    item.status === 'failed'
                      ? 'text-rose-600'
                      : item.status === 'done'
                        ? 'text-emerald-600'
                        : item.status === 'running'
                          ? 'text-brand-600'
                          : 'text-slate-400'
                  }`}
                >
                  {item.message || titleCase(item.status)}
                </span>
              </li>
            ))}
            {job.items.length > 8 ? (
              <li className="py-1.5 text-xs text-slate-400">+ {job.items.length - 8} more companies…</li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
