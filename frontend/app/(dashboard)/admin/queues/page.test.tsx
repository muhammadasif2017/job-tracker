import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminQueuesPage from './page';

// The panel owns its own fetch and is covered by
// components/admin/queue-health-panel.test.tsx — stubbed here so this stays a
// test of the route shell.
vi.mock('../../../../components/admin/queue-health-panel', () => ({
  QueueHealthPanel: () => <div data-testid="queue-health-panel" />,
}));

describe('AdminQueuesPage', () => {
  it('renders the queue health panel', () => {
    render(<AdminQueuesPage />);
    expect(screen.getByTestId('queue-health-panel')).toBeInTheDocument();
  });

  it('adds no page heading of its own, leaving the title to the layout', () => {
    render(<AdminQueuesPage />);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });
});
