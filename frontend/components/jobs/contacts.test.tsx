import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Contacts } from './contacts';
import type { Contact } from '../../types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import api from '../../lib/api';
import { toast } from 'sonner';

const contact: Contact = {
  id: 'c-1',
  jobId: 'j-1',
  name: 'Jane Doe',
  role: 'Recruiter',
  email: 'jane.doe@example.com',
  phone: '+15551234567',
  linkedinUrl: 'https://www.linkedin.com/in/janedoe',
  notes: 'Met at the referral call',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
};

function renderContacts(contacts: Contact[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Contacts jobId="j-1" contacts={contacts} />
    </QueryClientProvider>,
  );
  return { qc };
}

describe('Contacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('empty state', () => {
    it('shows the empty message when there are no contacts', () => {
      renderContacts([]);
      expect(screen.getByText('No contacts added yet.')).toBeInTheDocument();
    });
  });

  describe('list rendering', () => {
    it('renders name, role badge, email/phone/linkedin links, and notes', () => {
      renderContacts([contact]);
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('Recruiter')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /jane\.doe@example\.com/ })).toHaveAttribute(
        'href',
        'mailto:jane.doe@example.com',
      );
      expect(screen.getByRole('link', { name: /\+15551234567/ })).toHaveAttribute(
        'href',
        'tel:+15551234567',
      );
      expect(screen.getByRole('link', { name: /linkedin/i })).toHaveAttribute(
        'href',
        'https://www.linkedin.com/in/janedoe',
      );
      expect(screen.getByText('Met at the referral call')).toBeInTheDocument();
    });

    it('omits optional fields that are null', () => {
      renderContacts([{ ...contact, role: null, email: null, phone: null, linkedinUrl: null, notes: null }]);
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.queryByText('Recruiter')).not.toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
  });

  describe('add flow', () => {
    it('opens a blank form on Add Contact', () => {
      renderContacts([]);
      fireEvent.click(screen.getByRole('button', { name: /add contact/i }));
      expect(screen.getByLabelText(/^name$/i)).toHaveValue('');
      expect(screen.getByLabelText(/role/i)).toHaveValue('');
    });

    it('never submits when name is blank', async () => {
      renderContacts([]);
      fireEvent.click(screen.getByRole('button', { name: /add contact/i }));
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await new Promise((r) => setTimeout(r, 50));
      expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    });

    it('posts blank optional fields as null, not undefined', async () => {
      vi.mocked(api.post).mockResolvedValue({ data: { id: 'c-new' } });
      renderContacts([]);
      fireEvent.click(screen.getByRole('button', { name: /add contact/i }));
      fireEvent.change(screen.getByLabelText(/^name$/i), {
        target: { value: 'New Contact' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() => expect(vi.mocked(api.post)).toHaveBeenCalled());
      const [url, payload] = vi.mocked(api.post).mock.calls[0];
      expect(url).toBe('/jobs/j-1/contacts');
      expect(payload).toEqual({
        name: 'New Contact',
        role: null,
        email: null,
        phone: null,
        linkedinUrl: null,
        notes: null,
      });
    });

    it('shows a success toast and closes the form', async () => {
      vi.mocked(api.post).mockResolvedValue({ data: { id: 'c-new' } });
      renderContacts([]);
      fireEvent.click(screen.getByRole('button', { name: /add contact/i }));
      fireEvent.change(screen.getByLabelText(/^name$/i), {
        target: { value: 'New Contact' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Contact added'),
      );
      expect(screen.queryByLabelText(/^name$/i)).not.toBeInTheDocument();
    });
  });

  describe('edit flow — clearing a field sends null (P0 regression guard)', () => {
    it('pre-fills the form from the contact', () => {
      renderContacts([contact]);
      fireEvent.click(screen.getByRole('button', { name: /edit jane doe/i }));
      expect(screen.getByLabelText(/^name$/i)).toHaveValue('Jane Doe');
      expect(screen.getByLabelText(/email/i)).toHaveValue('jane.doe@example.com');
    });

    it('sends email: null when an existing email is cleared, not omitted/undefined', async () => {
      vi.mocked(api.patch).mockResolvedValue({ data: contact });
      renderContacts([contact]);
      fireEvent.click(screen.getByRole('button', { name: /edit jane doe/i }));
      fireEvent.change(screen.getByLabelText(/email/i), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() => expect(vi.mocked(api.patch)).toHaveBeenCalled());
      const [url, payload] = vi.mocked(api.patch).mock.calls[0];
      expect(url).toBe('/jobs/j-1/contacts/c-1');
      expect(payload).toMatchObject({ email: null });
      expect('email' in (payload as object)).toBe(true);
    });

    it('shows a success toast on update', async () => {
      vi.mocked(api.patch).mockResolvedValue({ data: contact });
      renderContacts([contact]);
      fireEvent.click(screen.getByRole('button', { name: /edit jane doe/i }));
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Contact updated'),
      );
    });
  });

  describe('cancel', () => {
    it('closes the form without submitting', () => {
      renderContacts([]);
      fireEvent.click(screen.getByRole('button', { name: /add contact/i }));
      fireEvent.change(screen.getByLabelText(/^name$/i), {
        target: { value: 'Someone' },
      });
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(screen.queryByLabelText(/^name$/i)).not.toBeInTheDocument();
      expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    });
  });

  describe('delete flow', () => {
    it('toggles a confirm prompt and reverts on No', () => {
      renderContacts([contact]);
      fireEvent.click(screen.getByRole('button', { name: /^remove jane doe$/i }));
      expect(screen.getByText('Remove?')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /cancel remove/i }));
      expect(screen.queryByText('Remove?')).not.toBeInTheDocument();
      expect(vi.mocked(api.delete)).not.toHaveBeenCalled();
    });

    it('deletes on Yes and shows a success toast', async () => {
      vi.mocked(api.delete).mockResolvedValue({ data: {} });
      renderContacts([contact]);
      fireEvent.click(screen.getByRole('button', { name: /^remove jane doe$/i }));
      fireEvent.click(screen.getByRole('button', { name: /confirm remove jane doe/i }));
      await waitFor(() =>
        expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/jobs/j-1/contacts/c-1'),
      );
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Contact removed');
    });
  });

  describe('error handling', () => {
    it('shows the server error message on create failure', async () => {
      vi.mocked(api.post).mockRejectedValue({
        isAxiosError: true,
        response: { data: { message: 'Duplicate contact' } },
      });
      renderContacts([]);
      fireEvent.click(screen.getByRole('button', { name: /add contact/i }));
      fireEvent.change(screen.getByLabelText(/^name$/i), {
        target: { value: 'New Contact' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Duplicate contact'),
      );
    });

    it('falls back to a generic message when the error has no server message', async () => {
      vi.mocked(api.delete).mockRejectedValue(new Error('network down'));
      renderContacts([contact]);
      fireEvent.click(screen.getByRole('button', { name: /^remove jane doe$/i }));
      fireEvent.click(screen.getByRole('button', { name: /confirm remove jane doe/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to remove contact'),
      );
    });
  });
});
