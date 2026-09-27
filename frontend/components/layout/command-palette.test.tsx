import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommandPalette } from './command-palette';
import type { Job, PaginatedJobs } from '../../types';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

vi.mock('../../lib/api', () => ({ default: { get: vi.fn() } }));

import api from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

function makeJob(overrides: Partial<Job>): Job {
  return {
    id: 'j-1',
    company: 'Stripe',
    position: 'Backend Engineer',
    status: 'INTERVIEWING',
    jobType: 'REMOTE',
    appliedAt: '2026-06-01T00:00:00Z',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    userId: 'u-1',
    ...overrides,
  };
}

function page(data: Job[]): PaginatedJobs {
  return {
    data,
    meta: { total: data.length, page: 1, limit: 10, totalPages: 1 },
  };
}

function renderPalette() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CommandPalette />
    </QueryClientProvider>,
  );
}

function openWithShortcut() {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  return screen.findByRole('combobox', { name: 'Search pages and jobs' });
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({
      data: page([
        makeJob({ id: 'j-1', company: 'Stripe' }),
        makeJob({ id: 'j-2', company: 'Vercel', status: 'APPLIED' }),
      ]),
    });
  });

  it('offers the Admin page to admins only', async () => {
    renderPalette();
    await openWithShortcut();
    await screen.findByRole('option', { name: /Stripe/ });
    expect(
      screen.queryByRole('option', { name: /Admin/ }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    useAuthStore.setState({
      user: { id: 'u-1', email: 'a@x.dev', name: 'Ada', role: 'ADMIN' },
    });
    await openWithShortcut();
    expect(
      await screen.findByRole('option', { name: /Admin/ }),
    ).toBeInTheDocument();
    useAuthStore.setState({ user: null });
  });

  it('labels the shortcut Ctrl off a Mac', () => {
    renderPalette();
    expect(screen.getByRole('button', { name: /search/i })).toHaveTextContent(
      'Ctrl K',
    );
  });

  it('labels the shortcut ⌘ on a Mac', () => {
    const platform = vi
      .spyOn(navigator, 'platform', 'get')
      .mockReturnValue('MacIntel');
    renderPalette();
    expect(screen.getByRole('button', { name: /search/i })).toHaveTextContent(
      '⌘ K',
    );
    platform.mockRestore();
  });

  it('does not search jobs until it is opened', () => {
    renderPalette();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('opens on Ctrl+K and from the header button', async () => {
    renderPalette();
    expect(await openWithShortcut()).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() =>
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
  });

  it('lists the pages and recent jobs, and filters pages by the typed text', async () => {
    renderPalette();
    const input = await openWithShortcut();
    expect(
      await screen.findByRole('option', { name: /Stripe — Backend Engineer/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Companies/ }),
    ).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'comp' } });
    await waitFor(() =>
      expect(
        screen.queryByRole('option', { name: /Dashboard/ }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('option', { name: /Companies/ }),
    ).toBeInTheDocument();
  });

  it('ignores Enter while a newer search is still pending', async () => {
    renderPalette();
    const input = await openWithShortcut();
    await screen.findByRole('option', { name: /Stripe/ });
    fireEvent.change(input, { target: { value: 'acme' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(push).not.toHaveBeenCalled();
  });

  it('does not open over another dialog', () => {
    renderPalette();
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    document.body.appendChild(other);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    other.remove();
  });

  it('ignores keydown events that carry no key, as autofill sends', () => {
    renderPalette();
    // A plain Event, not a KeyboardEvent, so `key` is undefined. jsdom turns
    // a listener that throws into a window `error` event, not a rethrow.
    const errors = vi.fn();
    window.addEventListener('error', errors);
    const e = Object.assign(new Event('keydown'), { ctrlKey: true });
    window.dispatchEvent(e);
    window.removeEventListener('error', errors);
    expect(errors).not.toHaveBeenCalled();
  });

  it('sends the typed text to the jobs search', async () => {
    renderPalette();
    const input = await openWithShortcut();
    fireEvent.change(input, { target: { value: 'vercel' } });
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('search=vercel'),
      ),
    );
  });

  it('moves the selection with the arrow keys and opens it with Enter', async () => {
    renderPalette();
    const input = await openWithShortcut();
    await screen.findByRole('option', { name: /Vercel/ });

    expect(screen.getByRole('option', { name: /Dashboard/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /^Jobs/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    // Wraps from the first row to the last: the second job.
    expect(screen.getByRole('option', { name: /Vercel/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/jobs/j-2');
    await waitFor(() =>
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument(),
    );
  });

  it('navigates to a clicked result', async () => {
    renderPalette();
    await openWithShortcut();
    fireEvent.click(await screen.findByRole('option', { name: /Stripe/ }));
    expect(push).toHaveBeenCalledWith('/jobs/j-1');
  });

  it('says so when nothing matches', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: page([]) });
    renderPalette();
    const input = await openWithShortcut();
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(
      await screen.findByText('Nothing matches “zzz”.'),
    ).toBeInTheDocument();
  });
});
