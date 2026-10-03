import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from './page-header';

describe('PageHeader', () => {
  it('renders the title as the page h1 with its subtitle', () => {
    render(<PageHeader title="Jobs" subtitle="3 jobs tracked" />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Jobs' }),
    ).toBeInTheDocument();
    expect(screen.getByText('3 jobs tracked')).toBeInTheDocument();
  });

  it('renders the actions beside the title', () => {
    render(<PageHeader title="Jobs" actions={<button>Add Job</button>} />);
    expect(screen.getByRole('button', { name: 'Add Job' })).toBeInTheDocument();
  });

  it('draws no empty subtitle line when none is given', () => {
    const { container } = render(<PageHeader title="Jobs" />);
    expect(container.querySelector('p')).not.toBeInTheDocument();
  });
});
