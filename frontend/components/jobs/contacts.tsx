'use client';

import { useState } from 'react';
import { Mail, Phone, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  useCreateContactMutation,
  useUpdateContactMutation,
  useRemoveContactMutation,
  type ContactPayload,
} from '../../features/jobs/contacts.hooks';
import type { Contact } from '../../types';

interface ContactsProps {
  jobId: string;
  contacts: Contact[];
}

const EMPTY_FORM = {
  name: '',
  role: '',
  email: '',
  phone: '',
  linkedinUrl: '',
  notes: '',
};

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function Contacts({ jobId, contacts }: ContactsProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [linkedinError, setLinkedinError] = useState<string | undefined>();

  function resetForm() {
    setForm(EMPTY_FORM);
    setFormOpen(false);
    setEditingId(null);
    setNameError(undefined);
    setLinkedinError(undefined);
  }

  function startAdd() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setNameError(undefined);
    setLinkedinError(undefined);
    setFormOpen(true);
  }

  function startEdit(contact: Contact) {
    setForm({
      name: contact.name,
      role: contact.role ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      linkedinUrl: contact.linkedinUrl ?? '',
      notes: contact.notes ?? '',
    });
    setEditingId(contact.id);
    setNameError(undefined);
    setLinkedinError(undefined);
    setFormOpen(true);
  }

  // `null` (not `undefined`) for a blank optional field: JSON.stringify
  // drops `undefined` keys entirely, so an omitted field means "leave the
  // existing value alone" on the backend (see create-contact.dto.ts) —
  // `null` is required to actually clear a field the user has emptied out.
  function buildPayload(): ContactPayload {
    return {
      name: form.name.trim(),
      role: form.role || null,
      email: form.email || null,
      phone: form.phone || null,
      linkedinUrl: form.linkedinUrl || null,
      notes: form.notes || null,
    };
  }

  const createMutation = useCreateContactMutation(jobId, resetForm);
  const updateMutation = useUpdateContactMutation(jobId, resetForm);
  const removeMutation = useRemoveContactMutation(jobId, () =>
    setConfirmingId(null),
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setNameError('Name is required');
      return;
    }
    setNameError(undefined);
    if (form.linkedinUrl.trim() && !isValidHttpUrl(form.linkedinUrl.trim())) {
      setLinkedinError('Enter a valid http:// or https:// URL');
      return;
    }
    setLinkedinError(undefined);
    if (editingId) {
      updateMutation.mutate({ contactId: editingId, payload: buildPayload() });
    } else {
      createMutation.mutate(buildPayload());
    }
  }

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="rounded-md border border-line bg-paper p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">Contacts</h2>
        {!formOpen && (
          <Button type="button" variant="outline" size="sm" onClick={startAdd}>
            <Plus className="h-4 w-4" />
            Add Contact
          </Button>
        )}
      </div>

      {formOpen && (
        <form
          onSubmit={handleSubmit}
          className="mb-4 flex flex-col gap-3 rounded-md border border-line p-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Name"
              placeholder="Jane Doe"
              value={form.name}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value });
                if (nameError) setNameError(undefined);
              }}
              error={nameError}
              required
            />
            <Input
              label="Role (optional)"
              placeholder="Recruiter"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            />
            <Input
              label="Email (optional)"
              type="email"
              placeholder="jane.doe@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Input
              label="Phone (optional)"
              type="tel"
              placeholder="+1 555 123 4567"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <Input
              label="LinkedIn (optional)"
              placeholder="https://www.linkedin.com/in/janedoe"
              value={form.linkedinUrl}
              onChange={(e) => {
                setForm({ ...form, linkedinUrl: e.target.value });
                if (linkedinError) setLinkedinError(undefined);
              }}
              error={linkedinError}
              className="sm:col-span-2"
            />
          </div>
          <Input
            id="contact-notes"
            label="Notes (optional)"
            placeholder="Met at the referral call"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={saving}>
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {contacts.length === 0 ? (
        <p className="text-sm text-muted-2">No contacts added yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex flex-wrap items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">
                  {contact.name}
                  {contact.role && (
                    <span className="ml-2 rounded-sm border border-line/70 px-2 py-0.5 font-mono text-[11px] font-normal uppercase tracking-wide text-muted">
                      {contact.role}
                    </span>
                  )}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="inline-flex items-center gap-1 hover:text-accent"
                    >
                      <Mail className="h-3 w-3" /> {contact.email}
                    </a>
                  )}
                  {contact.phone && (
                    <a
                      href={`tel:${contact.phone}`}
                      className="inline-flex items-center gap-1 hover:text-accent"
                    >
                      <Phone className="h-3 w-3" /> {contact.phone}
                    </a>
                  )}
                  {contact.linkedinUrl && (
                    <a
                      href={contact.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:text-accent"
                    >
                      <ExternalLink className="h-3 w-3" /> LinkedIn
                    </a>
                  )}
                </div>
                {contact.notes && (
                  <p className="mt-1 text-xs text-muted">{contact.notes}</p>
                )}
              </div>

              {confirmingId === contact.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted">
                    Remove?
                  </span>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    loading={removeMutation.isPending}
                    aria-label={`Confirm remove ${contact.name}`}
                    onClick={() => removeMutation.mutate(contact.id)}
                  >
                    Yes
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Cancel remove"
                    onClick={() => setConfirmingId(null)}
                  >
                    No
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Edit ${contact.name}`}
                    onClick={() => startEdit(contact)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-danger-soft hover:text-danger"
                    aria-label={`Remove ${contact.name}`}
                    onClick={() => setConfirmingId(contact.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
