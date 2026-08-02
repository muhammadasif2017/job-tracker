'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { Mail, Phone, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import api from '../../lib/api';
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

export function Contacts({ jobId, contacts }: ContactsProps) {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function invalidate() {
    // Contacts never touch Job.status/nextInterviewAt, so the job detail
    // query is the only cache that needs refreshing — unlike interview
    // rounds, there's no Kanban/stats/funnel invalidation to do here.
    qc.invalidateQueries({ queryKey: ['job', jobId] });
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setFormOpen(false);
    setEditingId(null);
  }

  function startAdd() {
    setForm(EMPTY_FORM);
    setEditingId(null);
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
    setFormOpen(true);
  }

  function buildPayload() {
    return {
      name: form.name,
      role: form.role || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      linkedinUrl: form.linkedinUrl || undefined,
      notes: form.notes || undefined,
    };
  }

  const createMutation = useMutation({
    mutationFn: () =>
      api.post(`/jobs/${jobId}/contacts`, buildPayload()).then((r) => r.data),
    onSuccess: () => {
      invalidate();
      resetForm();
      toast.success('Contact added');
    },
    onError: (err: unknown) =>
      toast.error(
        isAxiosError(err)
          ? (err.response?.data?.message ?? 'Failed to add contact')
          : 'Failed to add contact',
      ),
  });

  const updateMutation = useMutation({
    mutationFn: (contactId: string) =>
      api
        .patch(`/jobs/${jobId}/contacts/${contactId}`, buildPayload())
        .then((r) => r.data),
    onSuccess: () => {
      invalidate();
      resetForm();
      toast.success('Contact updated');
    },
    onError: (err: unknown) =>
      toast.error(
        isAxiosError(err)
          ? (err.response?.data?.message ?? 'Failed to update contact')
          : 'Failed to update contact',
      ),
  });

  const removeMutation = useMutation({
    mutationFn: (contactId: string) =>
      api.delete(`/jobs/${jobId}/contacts/${contactId}`).then((r) => r.data),
    onSuccess: () => {
      invalidate();
      setConfirmingId(null);
      toast.success('Contact removed');
    },
    onError: (err: unknown) => {
      setConfirmingId(null);
      toast.error(
        isAxiosError(err)
          ? (err.response?.data?.message ?? 'Failed to remove contact')
          : 'Failed to remove contact',
      );
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (editingId) {
      updateMutation.mutate(editingId);
    } else {
      createMutation.mutate();
    }
  }

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="rounded-xl border bg-white p-6 dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Contacts</h2>
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
          className="mb-4 flex flex-col gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Name"
              placeholder="Jane Doe"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
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
              onChange={(e) =>
                setForm({ ...form, linkedinUrl: e.target.value })
              }
              className="sm:col-span-2"
            />
          </div>
          <Input
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
        <p className="text-sm text-slate-400">No contacts added yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex flex-wrap items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {contact.name}
                  {contact.role && (
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {contact.role}
                    </span>
                  )}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="inline-flex items-center gap-1 hover:text-indigo-600"
                    >
                      <Mail className="h-3 w-3" /> {contact.email}
                    </a>
                  )}
                  {contact.phone && (
                    <a
                      href={`tel:${contact.phone}`}
                      className="inline-flex items-center gap-1 hover:text-indigo-600"
                    >
                      <Phone className="h-3 w-3" /> {contact.phone}
                    </a>
                  )}
                  {contact.linkedinUrl && (
                    <a
                      href={contact.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:text-indigo-600"
                    >
                      <ExternalLink className="h-3 w-3" /> LinkedIn
                    </a>
                  )}
                </div>
                {contact.notes && (
                  <p className="mt-1 text-xs text-slate-500">{contact.notes}</p>
                )}
              </div>

              {confirmingId === contact.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    Remove?
                  </span>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    loading={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(contact.id)}
                  >
                    Yes
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
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
                    onClick={() => startEdit(contact)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
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
