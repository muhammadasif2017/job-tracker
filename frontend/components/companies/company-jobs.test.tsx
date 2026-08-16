import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompanyJobs } from './company-jobs';
import type { CompanyJobSummary } from '../../types';

const job: CompanyJobSummary = {
  id: 'job-1',
  position: 'Senior Backend Engineer',
  status: 'APPLIED',
  priority: 'HIGH',
  appliedAt: '2026-06-01T00:00:00Z',
};

describe('CompanyJobs', () => {
  it('shows an empty state when there are no linked jobs', () => {
    render(<CompanyJobs jobs={[]} />);
    expect(
      screen.getByText('No jobs linked to this company yet.'),
    ).toBeInTheDocument();
  });

  it('lists each job with a link to its detail page', () => {
    render(<CompanyJobs jobs={[job]} />);

    const link = screen.getByRole('link', {
      name: /senior backend engineer/i,
    });
    expect(link).toHaveAttribute('href', '/jobs/job-1');
    expect(screen.getByText('Applied')).toBeInTheDocument();
  });
});
