import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge, PriorityBadge, JobTypeBadge, SourceBadge } from './badge';

describe('StatusBadge', () => {
  it('renders the human-readable label for a status', () => {
    render(<StatusBadge status="INTERVIEWING" />);
    expect(screen.getByText('Interviewing')).toBeInTheDocument();
  });
});

describe('PriorityBadge', () => {
  it('renders the human-readable label for a priority', () => {
    render(<PriorityBadge priority="HIGH" />);
    expect(screen.getByText('High')).toBeInTheDocument();
  });
});

describe('JobTypeBadge', () => {
  it('renders the human-readable label for a job type', () => {
    render(<JobTypeBadge jobType="REMOTE" />);
    expect(screen.getByText('Remote')).toBeInTheDocument();
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
