import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  Plus,
  Upload,
  Sheet,
  ListPlus,
  CheckCircle2,
  XCircle,
  ArrowRight,
  FileSpreadsheet,
  Loader2,
  Info,
} from 'lucide-react';
import { PageHeader } from '../components/Layout.jsx';
import { Alert, Badge, Card, Field, SectionHeading, Toggle } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';
import { useJobs } from '../components/JobContext.jsx';
import { api } from '../lib/api.js';

const TABS = [
  { id: 'single', label: 'One company', icon: Building2 },
  { id: 'multiple', label: 'Multiple', icon: ListPlus },
  { id: 'file', label: 'Upload file', icon: Upload },
  { id: 'sheet', label: 'Google Sheet', icon: Sheet },
];

export default function AddCompanies() {
  const [tab, setTab] = useState('single');
  const [autoRun, setAutoRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [form, setForm] = useState({ name: '', website: '', notes: '' });
  const [bulkText, setBulkText] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);
  const toast = useToast();
  const { start } = useJobs();

  const parsedNames = useMemo(
    () =>
      bulkText
        .split(/\r?\n|,/)
        .map((line) => line.trim())
        .filter(Boolean),
    [bulkText],
  );

  const createdIds = result?.created?.map((company) => company.id) || [];

  async function runDiscovery(ids) {
    if (!ids?.length) return;
    await start(ids);
  }

  function applyResult(payload, message) {
    setResult(payload);
    const created = payload.created?.length || 0;
    const skipped = payload.skipped?.length || 0;
    if (created) toast.success(`${created} company(ies) added${skipped ? `, ${skipped} skipped` : ''}.`);
    else toast.warning(message || 'Nothing new was added.');
    if (autoRun && created) void runDiscovery(payload.created.map((entry) => entry.id));
  }

  async function submitSingle(event) {
    event.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const company = await api.post('/companies', {
        name: form.name,
        website: form.website || undefined,
        notes: form.notes || undefined,
      });
      applyResult({ created: [company], skipped: [] });
      setForm({ name: '', website: '', notes: '' });
    } catch (error) {
      if (error.status === 409 && error.details?.existingId) {
        setResult({ created: [], skipped: [{ name: form.name, reason: error.message, existingId: error.details.existingId }] });
        toast.warning(error.message);
      } else {
        toast.error(error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitMultiple() {
    if (!parsedNames.length) return;
    setBusy(true);
    setResult(null);
    try {
      const payload = await api.post('/companies/bulk', {
        companies: parsedNames.map((name) => ({ name })),
      });
      applyResult(payload);
      setBulkText('');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitFile(event) {
    event.preventDefault();
    if (!file) {
      toast.warning('Choose a CSV, TXT or XLSX file first.');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const payload = await api.upload('/companies/import', formData);
      applyResult(payload);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitSheet(event) {
    event.preventDefault();
    if (!sheetUrl.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const payload = await api.post('/companies/import-sheet', { url: sheetUrl.trim() });
      applyResult(payload);
      setSheetUrl('');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Add companies"
        description="Add one company, paste a list, upload Excel/CSV, or import a shared Google Sheet. Duplicates are rejected automatically."
        actions={
          <Link to="/companies" className="btn-secondary">
            Company database <ArrowRight className="h-4 w-4" />
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
            {TABS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition sm:text-sm ${
                    tab === item.id ? 'bg-surface text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="whitespace-nowrap">{item.label}</span>
                </button>
              );
            })}
          </div>

          {tab === 'single' ? (
            <form onSubmit={submitSingle} className="space-y-4">
              <Field label="Company name" required hint="Exactly as you would search for it, e.g. Infosys, Zoho, a local startup.">
                <input
                  className="input"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Acme Technologies"
                  autoFocus
                />
              </Field>
              <Field
                label="Website (optional)"
                hint="Recommended when web search is not configured, or when the site blocks crawlers. We still verify the page belongs to the company."
              >
                <input
                  className="input"
                  value={form.website}
                  onChange={(event) => setForm({ ...form, website: event.target.value })}
                  placeholder="acme.com"
                />
              </Field>
              <Field label="Notes (optional)">
                <textarea
                  className="input min-h-20 resize-y"
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  placeholder="Referral contact, deadline, anything useful."
                />
              </Field>
              <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-3.5 py-3">
                <Toggle
                  checked={autoRun}
                  onChange={setAutoRun}
                  label="Find the email immediately"
                  description="Queue this company for website + email discovery as soon as it is added."
                />
              </div>
              <button type="submit" className="btn-primary w-full sm:w-auto" disabled={busy || !form.name.trim()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add company
              </button>
            </form>
          ) : null}

          {tab === 'multiple' ? (
            <div className="space-y-4">
              <Field label="Company names" hint="One per line (or comma separated). Maximum 500 per batch.">
                <textarea
                  className="input min-h-48 resize-y font-mono text-[13px]"
                  value={bulkText}
                  onChange={(event) => setBulkText(event.target.value)}
                  placeholder={'Infosys\nWipro\nTCS\nZoho\nFreshworks'}
                />
              </Field>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500">{parsedNames.length} name(s) detected</p>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-600"
                      checked={autoRun}
                      onChange={(event) => setAutoRun(event.target.checked)}
                    />
                    Find emails immediately
                  </label>
                  <button type="button" onClick={submitMultiple} className="btn-primary" disabled={busy || !parsedNames.length}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />}
                    Add {parsedNames.length || ''} companies
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'file' ? (
            <form onSubmit={submitFile} className="space-y-4">
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
                <FileSpreadsheet className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-3 text-sm font-medium text-slate-700">Upload Excel, CSV or TXT</p>
                <p className="mt-1 text-xs text-slate-500">
                  A column named Company / Company Name / Organisation is detected automatically. Otherwise the first column is used.
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.txt,.tsv,.xlsx,.xlsm"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                  className="mx-auto mt-4 block w-full max-w-sm text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-700 file:shadow-sm file:ring-1 file:ring-slate-200"
                />
                {file ? <p className="mt-2 text-xs text-slate-500">{file.name} · {Math.round(file.size / 1024)} KB</p> : null}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                    checked={autoRun}
                    onChange={(event) => setAutoRun(event.target.checked)}
                  />
                  Find emails immediately
                </label>
                <button type="submit" className="btn-primary" disabled={busy || !file}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Import file
                </button>
              </div>
            </form>
          ) : null}

          {tab === 'sheet' ? (
            <form onSubmit={submitSheet} className="space-y-4">
              <Field
                label="Google Sheets URL"
                hint="The sheet must be shared as “Anyone with the link – Viewer”. We download its CSV export; no Google account is needed for this import."
              >
                <input
                  className="input"
                  value={sheetUrl}
                  onChange={(event) => setSheetUrl(event.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0"
                />
              </Field>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                    checked={autoRun}
                    onChange={(event) => setAutoRun(event.target.checked)}
                  />
                  Find emails immediately
                </label>
                <button type="submit" className="btn-primary" disabled={busy || !sheetUrl.trim()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sheet className="h-4 w-4" />}
                  Import sheet
                </button>
              </div>
            </form>
          ) : null}
        </Card>

        <div className="space-y-4">
          {result ? (
            <Card className="p-4">
              <SectionHeading
                title="Import result"
                description={`${result.created?.length || 0} added · ${result.skipped?.length || 0} skipped`}
              />
              {result.created?.length ? (
                <div className="mb-3 space-y-1.5">
                  {result.created.slice(0, 12).map((company) => (
                    <div key={company.id} className="flex items-center gap-2 text-sm text-slate-700">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                      <Link to={`/companies/${company.id}`} className="truncate hover:text-brand-700">
                        {company.name}
                      </Link>
                    </div>
                  ))}
                  {result.created.length > 12 ? (
                    <p className="text-xs text-slate-500">+ {result.created.length - 12} more</p>
                  ) : null}
                </div>
              ) : null}
              {result.skipped?.length ? (
                <div className="space-y-1.5 border-t border-slate-100 pt-3">
                  {result.skipped.slice(0, 8).map((entry, index) => (
                    <div key={`${entry.name}-${index}`} className="flex items-start gap-2 text-xs text-slate-600">
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <span className="min-w-0">
                        <span className="font-medium text-slate-700">{entry.name}</span>
                        {entry.reason ? ` — ${entry.reason}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {createdIds.length ? (
                <button type="button" onClick={() => runDiscovery(createdIds)} className="btn-primary mt-4 w-full">
                  <SearchIcon /> Find emails for {createdIds.length} company(ies)
                </button>
              ) : null}
            </Card>
          ) : (
            <Card className="p-4">
              <SectionHeading title="How it works" description="Nothing is guessed." icon={Info} />
              <ol className="space-y-3 text-sm text-slate-600">
                {[
                  'Company name is normalised and checked for duplicates.',
                  'The official website is resolved (search API, or a verified domain probe).',
                  'Careers, contact, about and internship pages are crawled with robots.txt respected.',
                  'Public addresses are extracted, scored, and verified before anything is sent.',
                ].map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <Alert tone="info" className="mt-4">
                No email address is ever invented. If the company publishes nothing usable, it is marked{' '}
                <strong>Email Not Found</strong>.
              </Alert>
            </Card>
          )}

          <Card className="p-4">
            <SectionHeading title="Input formats" description="What the importer understands." />
            <div className="space-y-2 text-xs text-slate-600">
              <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono">Company Name, Website, Notes</p>
              <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono">Infosys, infosys.com</p>
              <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono">Zoho</p>
              <p>
                Header names recognised: <Badge tone="slate">Company</Badge> <Badge tone="slate">Company Name</Badge>{' '}
                <Badge tone="slate">Organisation</Badge> <Badge tone="slate">Employer</Badge>
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function SearchIcon() {
  return <ArrowRight className="h-4 w-4" />;
}
