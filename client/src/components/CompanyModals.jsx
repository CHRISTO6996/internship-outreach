import { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { Field, Modal } from './ui.jsx';
import { useToast } from './Toast.jsx';
import { api } from '../lib/api.js';

export function EditCompanyModal({ company, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', website: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (company) {
      setForm({
        name: company.name || '',
        website: company.website || '',
        notes: company.notes || '',
      });
    }
  }, [company]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!company) return;
    setSaving(true);
    try {
      const updated = await api.patch(`/companies/${company.id}`, {
        name: form.name,
        website: form.website.trim() || null,
        notes: form.notes,
      });
      toast.success(`"${updated.name}" updated.`);
      onClose();
      onSaved?.(updated);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={Boolean(company)}
      onClose={onClose}
      title="Edit company"
      description={company ? `Update details for ${company.name}.` : ''}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="shared-edit-company-form" className="btn-primary" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save changes
          </button>
        </>
      }
    >
      <form id="shared-edit-company-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Company name" required>
          <input
            className="input"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
        </Field>
        <Field label="Website" hint="Leave blank to let the search provider resolve it again.">
          <input
            className="input"
            value={form.website}
            onChange={(event) => setForm({ ...form, website: event.target.value })}
            placeholder="company.com"
          />
        </Field>
        <Field label="Notes">
          <textarea
            className="input min-h-24"
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </Field>
      </form>
    </Modal>
  );
}

export function DeleteCompanyModal({ company, count = 0, busy = false, onClose, onConfirm }) {
  const isBulk = !company && count > 0;
  return (
    <Modal
      open={Boolean(company) || isBulk}
      onClose={onClose}
      title={isBulk ? `Delete ${count} selected company(ies)?` : 'Delete company?'}
      description={
        isBulk
          ? `All ${count} selected companies and their discovered emails, sends, and replies will be removed.`
          : company
            ? `"${company.name}" and its discovered emails, sends, and replies will be removed.`
            : ''
      }
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete permanently
          </button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        This cannot be undone. Export the spreadsheet first if you want a copy of the history.
      </p>
    </Modal>
  );
}
