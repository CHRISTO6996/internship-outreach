import { useEffect, useState } from 'react';
import {
  Plug,
  CheckCircle2,
  XCircle,
  Search,
  ShieldCheck,
  Send,
  Table2,
  ExternalLink,
  Loader2,
  KeyRound,
  Mail,
  Info,
  Copy,
  LogIn,
  LogOut,
} from 'lucide-react';
import { PageHeader } from '../components/Layout.jsx';
import { Alert, Badge, Card, EmptyState, Field, Modal, SectionHeading, Spinner } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';
import { api } from '../lib/api.js';

const ICONS = {
  search: Search,
  hunter: Search,
  zerobounce: ShieldCheck,
  apollo: Search,
  gmail: Mail,
  sheets: Table2,
};

export default function Integrations() {
  const [data, setData] = useState(null);
  const [guide, setGuide] = useState(null);
  const [guideLoading, setGuideLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('example company careers');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationResult, setVerificationResult] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [gmailTesting, setGmailTesting] = useState(false);
  const [gmailResult, setGmailResult] = useState(null);
  const toast = useToast();

  async function load() {
    try {
      const payload = await api.get('/integrations');
      setData(payload);
    } catch (error) {
      toast.error(error.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('google');
    if (!outcome) return;
    if (outcome === 'connected') {
      toast.success(`Gmail connected as ${params.get('email') || 'your Google account'}.`, { title: 'Google connected' });
    } else {
      toast.error(params.get('message') || 'Google authorisation failed.', { title: 'Google connection failed' });
    }
    window.history.replaceState({}, '', window.location.pathname);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function connectGoogle() {
    window.location.href = '/api/integrations/google/start';
  }

  async function disconnectGoogle() {
    if (!window.confirm('Disconnect this Google account? Sending and reply tracking stop until you reconnect.')) return;
    try {
      await api.post('/integrations/google/disconnect', {});
      toast.success('Google account disconnected.');
      load();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function openGuide(key) {
    setGuideLoading(true);
    try {
      const payload = await api.get(`/integrations/${key}/guide`);
      setGuide(payload);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setGuideLoading(false);
    }
  }

  async function testSearch(e) {
    e.preventDefault();
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.post('/integrations/test/search', { query: searchQuery });
      setTestResult({ ok: true, ...result });
      toast.success(`Live search returned ${result.resultCount} result(s).`);
    } catch (error) {
      setTestResult({ ok: false, message: error.message, env: error.env });
      toast.error(error.message);
    } finally {
      setTesting(false);
    }
  }

  async function testVerification(e) {
    e.preventDefault();
    setVerifying(true);
    setVerificationResult(null);
    try {
      const result = await api.post('/integrations/test/verification', { email: verificationEmail });
      setVerificationResult(result);
      toast.success(`Verification result: ${result.verification.replace('_', ' ')}.`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setVerifying(false);
    }
  }

  async function testGmail() {
    setGmailTesting(true);
    setGmailResult(null);
    try {
      const result = await api.post('/integrations/test/gmail', {});
      setGmailResult({ ok: true, ...result });
      toast.success(`Gmail connection verified for ${result.email}.`);
    } catch (error) {
      setGmailResult({ ok: false, message: error.message });
      toast.error(error.message);
    } finally {
      setGmailTesting(false);
    }
  }

  const googleAccount = data?.google?.accounts?.[0];
  const gmail = data?.google?.connection;
  const canConnectGoogle = Boolean(data?.google?.configured && gmail?.encryptionKeySet);

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Every external service is optional until you reach the step that needs it. Keys live only in the backend .env file."
        actions={
          <button type="button" className="btn-secondary" onClick={load}>
            Recheck configuration
          </button>
        }
      />

      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} className="h-40 animate-pulse p-4" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.integrations.map((integration) => {
              const Icon = ICONS[integration.key] || Plug;
              return (
                <Card key={integration.key} className="flex flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`grid h-9 w-9 place-items-center rounded-xl ${
                          integration.configured ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        <Icon className="h-4.5 w-4.5" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{integration.name}</p>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{integration.category}</p>
                      </div>
                    </div>
                    <Badge tone={integration.configured ? 'emerald' : 'amber'} dot>
                      {integration.configured ? 'Configured' : 'Not configured'}
                    </Badge>
                  </div>

                  <p className="mt-3 flex-1 text-xs leading-relaxed text-slate-600">{integration.description}</p>

                  <div className="mt-3 flex flex-wrap gap-1">
                    {integration.requiredEnv.map((env) => (
                      <span key={env} className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                        {env}
                      </span>
                    ))}
                  </div>

                  <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                    <button type="button" onClick={() => openGuide(integration.key)} className="btn-ghost !px-2 !py-1 text-xs">
                      <Info className="h-3.5 w-3.5" /> Setup guide
                    </button>
                    {integration.docsUrl ? (
                      <a
                        href={integration.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-ghost !px-2 !py-1 text-xs"
                      >
                        Docs <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>
                </Card>
              );
            })}
          </div>

          {gmail?.connected ? (
            <Alert tone="success" className="mb-5">
              Gmail connected as <strong>{gmail.email}</strong>. Sending, connection tests and reply tracking can use this
              account.
            </Alert>
          ) : (
            <Alert tone="warning" className="mb-5">
              Gmail is not connected. Complete the OAuth setup below before sending.{' '}
              {gmail?.missing?.length ? `Missing: ${gmail.missing.join(', ')}.` : null}
            </Alert>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="p-4">
              <SectionHeading title="Test live search" description="Runs a real request against your configured provider." icon={Search} />
              <form onSubmit={testSearch} className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="input"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="e.g. Acme careers contact"
                />
                <button type="submit" className="btn-primary shrink-0" disabled={testing}>
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Run test
                </button>
              </form>
              {testResult ? (
                <div className="mt-3">
                  {testResult.ok ? (
                    <div className="space-y-1.5 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">
                      <p className="font-semibold">{testResult.resultCount} result(s)</p>
                      {testResult.results?.map((result) => (
                        <p key={result.url} className="truncate">
                          {result.title} — {result.url}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <Alert tone="warning" title="Search unavailable">
                      {testResult.message}
                    </Alert>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">
                  Provider: <strong>{data.search.provider || 'none'}</strong>
                </p>
              )}
            </Card>

            <Card className="p-4">
              <SectionHeading
                title="Test email verification"
                description="Runs the same verification the pipeline uses (DNS MX + API)."
                icon={ShieldCheck}
              />
              <form onSubmit={testVerification} className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="input"
                  type="email"
                  value={verificationEmail}
                  onChange={(event) => setVerificationEmail(event.target.value)}
                  placeholder="someone@company.com"
                />
                <button type="submit" className="btn-primary shrink-0" disabled={verifying || !verificationEmail}>
                  {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Verify
                </button>
              </form>
              {verificationResult ? (
                <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                  <p>
                    Result: <strong className="capitalize">{verificationResult.verification.replace('_', ' ')}</strong> via{' '}
                    {verificationResult.provider}
                  </p>
                  <p className="mt-1 text-slate-500">{verificationResult.detail}</p>
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">
                  Use an address you own to confirm credits and mapping before running a batch.
                </p>
              )}
            </Card>
          </div>

          <Card className="mt-5 overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <KeyRound className="h-4 w-4 text-slate-400" /> Environment variables
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Values are never sent to the browser. Only whether each key is present is shown.
              </p>
            </div>
            <div className="divide-y divide-slate-100">
              {data.env.map((entry) => (
                <div key={entry.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-slate-700">{entry.key}</p>
                    <p className="text-[11px] text-slate-400">{entry.group}</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    {entry.set ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <span className="text-emerald-700">Set</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 text-slate-600" />
                        <span className="text-slate-400">Missing</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="mt-5 p-4">
            <SectionHeading title="Google OAuth setup" description="Needed for Gmail sending, reply tracking and Sheets mirroring." icon={Send} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Authorised redirect URI</p>
                  <span className="text-[10px] text-slate-400">
                    {data.google.redirectUriSource === 'env' ? 'Set in .env' : 'Derived from request'}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate text-xs text-slate-700">{data.google.redirectUri}</code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(data.google.redirectUri);
                      toast.success('Copied redirect URI.');
                    }}
                    className="btn-ghost !px-1.5 !py-1"
                    aria-label="Copy redirect URI"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Scopes requested</p>
                <ul className="mt-1 space-y-0.5">
                  {data.google.scopes.map((scope) => (
                    <li key={scope} className="truncate font-mono text-[10px] text-slate-600">
                      {scope}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone={data.google.configured ? 'emerald' : 'amber'} dot>
                {data.google.configured ? 'OAuth client configured' : 'OAuth client missing'}
              </Badge>
              <Badge tone={gmail?.encryptionKeySet ? 'emerald' : 'amber'} dot>
                {gmail?.encryptionKeySet ? 'Token encryption key set' : 'TOKEN_ENCRYPTION_KEY missing'}
              </Badge>
              <Badge tone={gmail?.connected ? 'emerald' : 'slate'} dot>
                {gmail?.connected ? `Connected: ${gmail.email}` : 'No Google account connected'}
              </Badge>
              {gmail?.ready ? (
                <Badge tone="brand" dot>
                  Ready to send
                </Badge>
              ) : null}
            </div>

            {gmail?.missing?.length && !gmail.connected ? (
              <p className="mt-3 text-xs text-amber-200">
                Before connecting: {gmail.missing.join(', ')}. Keys belong in the backend .env file, never in this browser.
              </p>
            ) : null}

            {gmailResult ? (
              <div
                className={`mt-3 rounded-xl p-3 text-xs ring-1 ${
                  gmailResult.ok
                    ? 'bg-emerald-500/10 text-emerald-200 ring-emerald-400/30'
                    : 'bg-amber-500/10 text-amber-200 ring-amber-400/30'
                }`}
              >
                {gmailResult.ok ? (
                  <>
                    <p className="font-semibold">Gmail API responded for {gmailResult.email}.</p>
                    <p className="mt-0.5 opacity-90">
                      Messages: {gmailResult.messagesTotal ?? 'unknown'} · Threads: {gmailResult.threadsTotal ?? 'unknown'}
                    </p>
                  </>
                ) : (
                  <p>{gmailResult.message}</p>
                )}
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
              <button
                type="button"
                className="btn-secondary !px-3 !py-2 text-xs"
                onClick={testGmail}
                disabled={!gmail?.connected || gmailTesting}
                title={gmail?.connected ? 'Call the Gmail API with the connected account' : 'Connect Gmail first'}
              >
                {gmailTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                Test Gmail connection
              </button>
              <div className="flex-1" />
              {gmail?.connected ? (
                <button type="button" className="btn-danger !px-3 !py-2 text-xs" onClick={disconnectGoogle}>
                  <LogOut className="h-3.5 w-3.5" /> Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary !px-3.5 !py-2 text-xs"
                  onClick={connectGoogle}
                  disabled={!canConnectGoogle}
                  title={
                    canConnectGoogle
                      ? 'Start Google OAuth'
                      : 'Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY to the backend .env first'
                  }
                >
                  <LogIn className="h-3.5 w-3.5" /> Connect Gmail
                </button>
              )}
            </div>
          </Card>
        </>
      )}

      <Modal
        open={Boolean(guide) || guideLoading}
        onClose={() => setGuide(null)}
        title={guide ? `${guide.name} setup` : 'Loading guide'}
        description={guide?.description}
        wide
      >
        {guideLoading && !guide ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner /> Loading…
          </div>
        ) : guide ? (
          <div className="space-y-4">
            <ol className="space-y-2.5">
              {guide.steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm text-slate-700">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-500/15 text-[11px] font-bold text-brand-300">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <Alert tone="info">
              Credentials belong in <code className="rounded bg-white/10 px-1 text-brand-200">.env</code>, never in the browser. Restart the API
              after editing the file.
            </Alert>
            {guide.docsUrl ? (
              <a href={guide.docsUrl} target="_blank" rel="noreferrer" className="btn-secondary">
                Open provider documentation <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
