import { useEffect, useRef, useState } from 'react';
import {
  UserRound,
  Send,
  Clock,
  Search,
  Mail,
  Upload,
  Trash2,
  Download,
  Loader2,
  Save,
  Eye,
  FileText,
  ShieldCheck,
} from 'lucide-react';
import { PageHeader } from '../components/Layout.jsx';
import { Alert, Badge, Card, Field, Modal, SectionHeading, Toggle } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';
import { api } from '../lib/api.js';
import { renderTemplate } from '../lib/format.js';

const PLACEHOLDERS = [
  ['companyName', 'Company'],
  ['fullName', 'Your name'],
  ['college', 'College'],
  ['branch', 'Branch'],
  ['phone', 'Phone'],
  ['contactEmail', 'Contact email'],
  ['portfolioUrl', 'Portfolio'],
  ['linkedinUrl', 'LinkedIn'],
];

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [savingSection, setSavingSection] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const toast = useToast();

  useEffect(() => {
    api
      .get('/settings')
      .then(setSettings)
      .catch((error) => toast.error(error.message));
  }, [toast]);

  function update(section, patch) {
    setSettings((current) => ({ ...current, [section]: { ...current[section], ...patch } }));
  }

  async function save(section) {
    setSavingSection(section);
    try {
      const payload = await api.put('/settings', { [section]: settings[section] });
      setSettings(payload);
      toast.success('Settings saved.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingSection(null);
    }
  }

  async function uploadResume(event) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.warning('Choose a PDF file first.');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('resume', file);
      const payload = await api.upload('/settings/resume', formData);
      update('profile', payload.profile);
      toast.success('Resume uploaded. It will be attached to every outreach email.');
      if (fileRef.current) fileRef.current.value = '';
    } catch (error) {
      toast.error(error.message);
    } finally {
      setUploading(false);
    }
  }

  async function removeResume() {
    try {
      const payload = await api.del('/settings/resume');
      update('profile', payload.profile);
      toast.success('Resume removed.');
    } catch (error) {
      toast.error(error.message);
    }
  }

  if (!settings) {
    return (
      <>
        <PageHeader title="Settings" description="Profile, sending limits, follow-up rules and the email template." />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} className="h-40 animate-pulse" />
          ))}
        </div>
      </>
    );
  }

  const { profile, sending, followUp, discovery, template } = settings;

  function insertPlaceholder(token) {
    setSettings((current) => ({
      ...current,
      template: { ...current.template, body: `${current.template.body}{{${token}}}` },
    }));
  }

  const previewMissingProfile = !profile.fullName || !profile.college || !profile.branch;
  const previewValues = {
    companyName: 'Acme Technologies',
    fullName: profile.fullName || '[Your name]',
    college: profile.college || '[Your college]',
    branch: profile.branch || '[Your branch]',
    phone: profile.phone || '[Your phone]',
    contactEmail: profile.contactEmail || '[you@example.com]',
    portfolioUrl: profile.portfolioUrl || '',
    linkedinUrl: profile.linkedinUrl || '',
  };

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your profile, safety limits, automation rules and the email template. Everything is stored locally in your database."
        actions={<Badge tone="slate">Stored in SQLite</Badge>}
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card className="p-4">
            <SectionHeading title="Profile" description="Used in every generated email and signature." icon={UserRound} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" required>
                <input
                  className="input"
                  value={profile.fullName}
                  onChange={(event) => update('profile', { fullName: event.target.value })}
                  placeholder="Ada Sharma"
                />
              </Field>
              <Field label="College / university" required>
                <input
                  className="input"
                  value={profile.college}
                  onChange={(event) => update('profile', { college: event.target.value })}
                  placeholder="National Institute of Technology"
                />
              </Field>
              <Field label="Branch / degree" required>
                <input
                  className="input"
                  value={profile.branch}
                  onChange={(event) => update('profile', { branch: event.target.value })}
                  placeholder="B.Tech Computer Science"
                />
              </Field>
              <Field label="Phone">
                <input
                  className="input"
                  value={profile.phone}
                  onChange={(event) => update('profile', { phone: event.target.value })}
                  placeholder="+91 98765 43210"
                />
              </Field>
              <Field label="Contact email">
                <input
                  className="input"
                  type="email"
                  value={profile.contactEmail}
                  onChange={(event) => update('profile', { contactEmail: event.target.value })}
                  placeholder="you@gmail.com"
                />
              </Field>
              <Field label="Portfolio URL">
                <input
                  className="input"
                  value={profile.portfolioUrl}
                  onChange={(event) => update('profile', { portfolioUrl: event.target.value })}
                  placeholder="https://yourportfolio.dev"
                />
              </Field>
              <Field label="LinkedIn URL" className="sm:col-span-2">
                <input
                  className="input"
                  value={profile.linkedinUrl}
                  onChange={(event) => update('profile', { linkedinUrl: event.target.value })}
                  placeholder="https://linkedin.com/in/you"
                />
              </Field>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-rose-50 text-rose-500">
                    <FileText className="h-4.5 w-4.5" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {profile.resumeFileName ? profile.resumeOriginalName || 'resume.pdf' : 'No resume attached'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {profile.resumeUploadedAt ? `Uploaded ${new Date(profile.resumeUploadedAt).toLocaleDateString()}` : 'PDF only'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {profile.resumeFileName ? (
                    <a href="/api/settings/resume" target="_blank" rel="noreferrer" className="btn-secondary !px-2.5 !py-1.5 text-xs">
                      <Download className="h-3.5 w-3.5" /> View
                    </a>
                  ) : null}
                  {profile.resumeFileName ? (
                    <button type="button" onClick={removeResume} className="btn-ghost !px-2.5 !py-1.5 text-xs text-rose-600">
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </button>
                  ) : null}
                </div>
              </div>
              <form onSubmit={uploadResume} className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  className="text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700"
                />
                <button type="submit" className="btn-secondary !px-3 !py-1.5 text-xs" disabled={uploading}>
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Upload resume
                </button>
              </form>
            </div>

            <div className="mt-4 flex justify-end">
              <button type="button" className="btn-primary" onClick={() => save('profile')} disabled={savingSection === 'profile'}>
                {savingSection === 'profile' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save profile
              </button>
            </div>
          </Card>

          <Card className="p-4">
            <SectionHeading title="Email template" description="Placeholders are replaced per company. Keep it honest and concise." icon={Mail} />
            <div className="space-y-4">
              <Field label="Subject">
                <input
                  className="input"
                  value={template.subject}
                  onChange={(event) => update('template', { subject: event.target.value })}
                />
              </Field>
              <Field label="Body">
                <textarea
                  className="input min-h-72 resize-y font-mono text-[12.5px] leading-relaxed"
                  value={template.body}
                  onChange={(event) => update('template', { body: event.target.value })}
                />
              </Field>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Insert placeholder</p>
                <div className="flex flex-wrap gap-1.5">
                  {PLACEHOLDERS.map(([token, label]) => (
                    <button
                      key={token}
                      type="button"
                      onClick={() => insertPlaceholder(token)}
                      className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-600 hover:bg-brand-500/150/15 hover:text-brand-200"
                    >
                      {`{{${token}}}`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <button type="button" className="btn-secondary" onClick={() => setPreview('initial')}>
                  <Eye className="h-4 w-4" /> Preview email
                </button>
                <button type="button" className="btn-primary" onClick={() => save('template')} disabled={savingSection === 'template'}>
                  {savingSection === 'template' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save template
                </button>
              </div>
            </div>

            <div className="mt-5 border-t border-slate-100 pt-4">
              <p className="mb-3 text-sm font-semibold text-slate-800">Follow-up email</p>
              <div className="space-y-4">
                <Field label="Follow-up subject">
                  <input
                    className="input"
                    value={template.followUpSubject}
                    onChange={(event) => update('template', { followUpSubject: event.target.value })}
                  />
                </Field>
                <Field label="Follow-up body">
                  <textarea
                    className="input min-h-52 resize-y font-mono text-[12.5px] leading-relaxed"
                    value={template.followUpBody}
                    onChange={(event) => update('template', { followUpBody: event.target.value })}
                  />
                </Field>
                <div className="flex justify-end">
                  <button type="button" className="btn-secondary" onClick={() => setPreview('followUp')}>
                    <Eye className="h-4 w-4" /> Preview follow-up
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-4">
            <SectionHeading title="Sending safety" description="Hard limits applied by the backend." icon={Send} />
            <div className="space-y-4">
              <Toggle
                checked={sending.requireApproval}
                onChange={(value) => update('sending', { requireApproval: value })}
                label="Require my approval before sending"
                description="Recommended. The first batch is always held until you approve it."
              />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Daily limit" hint="Never above the server ceiling.">
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="200"
                    value={sending.dailyLimit}
                    onChange={(event) => update('sending', { dailyLimit: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Weekdays only">
                  <div className="pt-2.5">
                    <Toggle
                      checked={sending.weekdaysOnly}
                      onChange={(value) => update('sending', { weekdaysOnly: value })}
                      label="Mon–Fri"
                    />
                  </div>
                </Field>
                <Field label="Min delay (seconds)">
                  <input
                    className="input"
                    type="number"
                    min="5"
                    value={sending.minDelaySeconds}
                    onChange={(event) => update('sending', { minDelaySeconds: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Max delay (seconds)">
                  <input
                    className="input"
                    type="number"
                    min="5"
                    value={sending.maxDelaySeconds}
                    onChange={(event) => update('sending', { maxDelaySeconds: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Send window start">
                  <input
                    className="input"
                    type="time"
                    value={sending.sendWindowStart}
                    onChange={(event) => update('sending', { sendWindowStart: event.target.value })}
                  />
                </Field>
                <Field label="Send window end">
                  <input
                    className="input"
                    type="time"
                    value={sending.sendWindowEnd}
                    onChange={(event) => update('sending', { sendWindowEnd: event.target.value })}
                  />
                </Field>
              </div>
              <button type="button" className="btn-primary w-full" onClick={() => save('sending')} disabled={savingSection === 'sending'}>
                {savingSection === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save sending rules
              </button>
            </div>
          </Card>

          <Card className="p-4">
            <SectionHeading title="Follow-ups" description="Only one polite reminder per company by default." icon={Clock} />
            <div className="space-y-4">
              <Toggle
                checked={followUp.enabled}
                onChange={(value) => update('followUp', { enabled: value })}
                label="Enable automatic follow-ups"
                description="Never sends if the company already replied, or if a follow-up was already sent."
              />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Wait days">
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="60"
                    value={followUp.days}
                    onChange={(event) => update('followUp', { days: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Max follow-ups">
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="3"
                    value={followUp.maxFollowUps}
                    onChange={(event) => update('followUp', { maxFollowUps: Number(event.target.value) })}
                  />
                </Field>
              </div>
              <Toggle
                checked={followUp.requireApproval}
                onChange={(value) => update('followUp', { requireApproval: value })}
                label="Approve each follow-up"
              />
              <button type="button" className="btn-primary w-full" onClick={() => save('followUp')} disabled={savingSection === 'followUp'}>
                {savingSection === 'followUp' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save follow-up rules
              </button>
            </div>
          </Card>

          <Card className="p-4">
            <SectionHeading title="Discovery" description="Crawler behaviour and API usage." icon={Search} />
            <div className="space-y-4">
              <Field label="Maximum pages per website" hint="Higher values find more addresses but take longer.">
                <input
                  className="input"
                  type="number"
                  min="1"
                  max="40"
                  value={discovery.maxPages}
                  onChange={(event) => update('discovery', { maxPages: Number(event.target.value) })}
                />
              </Field>
              <Field label="Candidates to verify" hint="Each verification may consume API credit.">
                <input
                  className="input"
                  type="number"
                  min="1"
                  max="10"
                  value={discovery.verifyTopCandidates}
                  onChange={(event) => update('discovery', { verifyTopCandidates: Number(event.target.value) })}
                />
              </Field>
              <Toggle
                checked={discovery.useHunter}
                onChange={(value) => update('discovery', { useHunter: value })}
                label="Use Hunter.io enrichment"
                description="Queries indexed professional emails for the company domain when configured."
              />
              <button type="button" className="btn-primary w-full" onClick={() => save('discovery')} disabled={savingSection === 'discovery'}>
                {savingSection === 'discovery' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save discovery settings
              </button>
            </div>
          </Card>

          <Alert tone="info" title="Privacy">
            <span className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              All data stays in <code className="rounded bg-white/10 px-1 text-brand-200">data/app.db</code> on this machine. OAuth refresh tokens are
              encrypted at rest with TOKEN_ENCRYPTION_KEY.
            </span>
          </Alert>
        </div>
      </div>

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview === 'followUp' ? 'Follow-up preview' : 'Email preview'}
        description={
          previewMissingProfile
            ? 'Sample preview. Your profile is incomplete, so bracketed placeholders are shown.'
            : 'Rendered with your profile and a sample company name.'
        }
        wide
      >
        <div className="rounded-xl border border-slate-200">
          <div className="border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500">
            <p>
              <span className="font-semibold text-slate-700">To:</span> careers@acmetechnologies.com
            </p>
            <p className="mt-1">
              <span className="font-semibold text-slate-700">Subject:</span>{' '}
              {renderTemplate(
                preview === 'followUp' ? template.followUpSubject : template.subject,
                previewValues,
              )}
            </p>
            <p className="mt-1">
              <span className="font-semibold text-slate-700">Attachment:</span>{' '}
              {profile.resumeFileName ? profile.resumeOriginalName || 'resume.pdf' : 'none (upload a resume)'}
            </p>
          </div>
          <pre className="whitespace-pre-wrap px-4 py-4 font-sans text-sm leading-relaxed text-slate-700">
            {renderTemplate(preview === 'followUp' ? template.followUpBody : template.body, previewValues)}
          </pre>
        </div>
      </Modal>
    </>
  );
}
