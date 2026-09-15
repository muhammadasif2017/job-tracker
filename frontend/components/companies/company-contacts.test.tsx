import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CompanyContacts } from './company-contacts';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

import api from '../../lib/api';

// The form and list are covered through the job wrapper in
// components/jobs/contacts.test.tsx; this checks the company wiring only.
describe('CompanyContacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the company heading and saves to the company contacts endpoint, then closes the form', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'c-new' } });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <CompanyContacts companyId="co-1" contacts={[]} />
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole('heading', { name: 'HR / Company Contacts' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add contact/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: 'Hira Khan' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(vi.mocked(api.post)).toHaveBeenCalledWith(
        '/companies/co-1/contacts',
        expect.objectContaining({ name: 'Hira Khan', email: null }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /^save$/i }),
      ).not.toBeInTheDocument(),
    );
  });
});
