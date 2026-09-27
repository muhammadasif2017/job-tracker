import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  StatusBadge,
  PriorityBadge,
  JobTypeBadge,
  SourceBadge,
  EnrichmentStatusBadge,
} from './badge';

describe('StatusBadge', () => {
  it('renders the human-readable label for a status', () => {
    render(<StatusBadge status="INTERVIEWING" />);
    expect(screen.getByText('Interviewing')).toBeInTheDocument();
  });

  it('colors the dot with the same status token the board and chart use', () => {
    render(<StatusBadge status="INTERVIEWING" />);
    expect(screen.getByTestId('badge-dot')).toHaveClass(
      'bg-status-interviewing',
    );
  });
});

describe('PriorityBadge', () => {
  it('renders the human-readable label for a priority', () => {
    render(<PriorityBadge priority="HIGH" />);
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('carries the priority in its dot, on the shared neutral chip', () => {
    render(<PriorityBadge priority="HIGH" />);
    expect(screen.getByTestId('badge-dot')).toHaveClass('bg-danger');
    expect(screen.getByText('High')).toHaveClass('bg-paper-raised');
  });
});

describe('JobTypeBadge', () => {
  it('renders the human-readable label for a job type', () => {
    render(<JobTypeBadge jobType="REMOTE" />);
    expect(screen.getByText('Remote')).toBeInTheDocument();
  });

  it('draws no dot, since a job type is not a state', () => {
    render(<JobTypeBadge jobType="REMOTE" />);
    expect(screen.queryByTestId('badge-dot')).not.toBeInTheDocument();
    expect(screen.getByText('Remote')).toHaveClass('bg-paper-raised');
  });
});

describe('SourceBadge', () => {
  it('renders a discovery-source label', () => {
    render(<SourceBadge kind="discovery" source="LINKEDIN" />);
    expect(screen.getByText('LinkedIn Post')).toBeInTheDocument();
  });

  it('renders an application-channel label', () => {
    render(<SourceBadge kind="channel" source="REFERRAL" />);
    expect(screen.getByText('Referral')).toBeInTheDocument();
  });
});

describe('EnrichmentStatusBadge', () => {
  it('marks a failed run with a danger dot', () => {
    render(<EnrichmentStatusBadge status="FAILED" />);
    expect(screen.getByText('Research failed')).toBeInTheDocument();
    expect(screen.getByTestId('badge-dot')).toHaveClass('bg-danger');
  });

  it('reads "Not researched" with no dot when there is no run', () => {
    render(<EnrichmentStatusBadge status={null} />);
    expect(screen.getByText('Not researched')).toBeInTheDocument();
    expect(screen.queryByTestId('badge-dot')).not.toBeInTheDocument();
  });
});
