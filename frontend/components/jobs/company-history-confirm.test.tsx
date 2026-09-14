import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompanyHistoryConfirm } from './company-history-confirm';

describe('CompanyHistoryConfirm', () => {
  it('falls back to a saved-jobs message when nothing was applied for', () => {
    render(
      <CompanyHistoryConfirm
        history={{
          company: { id: 'c-1', name: 'Acme' },
          stats: {
            applied: 0,
            replied: 0,
            ghosted: 0,
            replyRate: 0,
            lastAppliedAt: null,
          },
          recentJobs: [
            {
              id: 'w-1',
              position: 'Wishlist Role',
              status: 'WISHLIST',
              appliedAt: '2026-09-01T00:00:00.000Z',
            },
          ],
        }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.getByText('You already have jobs saved at Acme.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/replied,/)).not.toBeInTheDocument();
    expect(screen.getByText('Wishlist Role')).toBeInTheDocument();
  });

  it('calls back on Add anyway and Cancel', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <CompanyHistoryConfirm
        history={{ company: null, stats: null, recentJobs: [] }}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /add anyway/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
