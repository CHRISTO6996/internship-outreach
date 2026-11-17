import { useEffect } from 'react';
import { X } from 'lucide-react';

const TONES = {
  slate: 'bg-white/5 text-slate-600 ring-white/10',
  blue: 'bg-sky-500/10 text-sky-200 ring-sky-400/30',
  emerald: 'bg-emerald-500/10 text-emerald-200 ring-emerald-400/30',
  amber: 'bg-amber-500/10 text-amber-200 ring-amber-400/30',
  rose: 'bg-rose-500/10 text-rose-200 ring-rose-400/30',
  violet: 'bg-violet-500/10 text-violet-200 ring-violet-400/30',
  brand: 'bg-brand-500/150/10 text-brand-200 ring-brand-400/30',
};

const DOT_TONES = {
  slate: 'bg-slate-400',
  blue: 'bg-sky-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  violet: 'bg-violet-500',
  brand: 'bg-brand-500/150',
};

export function Badge({ tone = 'slate', dot = false, children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${TONES[tone] || TONES.slate} ${className}`}
    >
      {dot ? <span className={`h-1.5 w-1.5 rounded-full ${DOT_TONES[tone] || DOT_TONES.slate}`} /> : null}
      {children}
    </span>
  );
}

export function Card({ className = '', children }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function SectionHeading({ title, description, actions, icon: Icon }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          {Icon ? <Icon className="h-4.5 w-4.5 text-slate-400" /> : null}
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'brand', footer = null }) {
  const iconTone = {
    brand: 'bg-brand-500/150/15 text-brand-300 ring-1 ring-brand-400/20',
    emerald: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/20',
    amber: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/20',
    rose: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/20',
    violet: 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-400/20',
    slate: 'bg-white/10 text-slate-600 ring-1 ring-white/10',
    blue: 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-400/20',
  }[tone];
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
        </div>
        {Icon ? (
          <span className={`grid h-9 w-9 place-items-center rounded-xl ${iconTone}`}>
            <Icon className="h-4.5 w-4.5" />
          </span>
        ) : null}
      </div>
      {hint ? <p className="mt-2 text-xs text-slate-500">{hint}</p> : null}
      {footer}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-12 text-center">
      {Icon ? (
        <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-slate-600 ring-1 ring-white/10">
          <Icon className="h-5 w-5" />
        </span>
      ) : null}
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

const ALERT_TONES = {
  info: 'border-sky-400/30 bg-sky-500/10 text-sky-200',
  success: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  warning: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
  error: 'border-rose-400/30 bg-rose-500/10 text-rose-200',
};

export function Alert({ tone = 'info', title, children, className = '' }) {
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${ALERT_TONES[tone]} ${className}`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? 'mt-1 opacity-90' : ''}>{children}</div> : null}
    </div>
  );
}

export function Spinner({ className = 'h-4 w-4' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function Modal({ open, onClose, title, description, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#111936] shadow-2xl shadow-black/60 sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-xl'}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="btn-ghost -mr-1 !px-2 !py-2" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled = false }) {
  return (
    <label className={`flex cursor-pointer items-start justify-between gap-4 ${disabled ? 'opacity-60' : ''}`}>
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-slate-500">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${checked ? 'bg-brand-600' : 'bg-slate-300'}`}
      >
        <span
          className={`inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow transition ${checked ? 'translate-x-5.5' : 'translate-x-1'}`}
        />
      </button>
    </label>
  );
}

export function ProgressBar({ value = 0, tone = 'brand', className = '' }) {
  const tones = {
    brand: 'bg-brand-500/150',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
  };
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-white/10 ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ${tones[tone] || tones.brand}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function Field({ label, hint, required, children, className = '' }) {
  return (
    <div className={className}>
      <label className="label">
        {label}
        {required ? <span className="ml-0.5 text-rose-500">*</span> : null}
      </label>
      {children}
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-lg bg-white/10 ${className}`} />;
}
