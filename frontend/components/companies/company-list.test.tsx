import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompanyList } from './company-list';
import type { Company } from '../../types';

const company: Company = {
  id: 'c-1',
  name: 'Systems Limited',
  city: 'LAHORE',
  location: null,
  priority: 'HIGH',
  personalNotes: null,
  websiteUrl: 'https://systemsltd.com',
  linkedinUrl: null,
  businessMode: 'SERVICES',
  productDescription: null,
  status: 'COMPLETED',
  industry: 'IT Services',
  companySize: null,
  techStack: [],
  cultureSummary: null,
  workPolicy: null,
  headquarters: null,
  address: null,
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
};

function renderList(props: Partial<React.ComponentProps<typeof CompanyList>> = {}) {
  const onRetry = props.onRetry ?? vi.fn();
  const onEdit = props.onEdit ?? vi.fn();
  const onDelete = props.onDelete ?? vi.fn();
  const onMerge = props.onMerge ?? vi.fn();
  render(
    <CompanyList
      companies={[]}
      isLoading={false}
      isError={false}
      onRetry={onRetry}
      onEdit={onEdit}
      onDelete={onDelete}
      onMerge={onMerge}
      {...props}
    />,
  );
  return { onRetry, onEdit, onDelete, onMerge };
}

describe('CompanyList', () => {
  it('shows skeleton rows while loading', () => {
    const { container } = render(
      <CompanyList
        companies={[]}
        isLoading
        isError={false}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onMerge={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows an error state with a retry button', () => {
    const { onRetry } = renderList({ isError: true });
    expect(screen.getByText('Failed to load companies')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows an empty state when there are no companies', () => {
    renderList({ companies: [] });
    expect(screen.getByText('No target companies yet')).toBeInTheDocument();
  });

  it('renders a company row with its badges', () => {
    renderList({ companies: [company] });
    expect(screen.getByText('Systems Limited')).toBeInTheDocument();
    expect(screen.getByText('Lahore')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Services')).toBeInTheDocument();
    expect(screen.getByText('Researched')).toBeInTheDocument();
  });

  it('links the name to the company detail page', () => {
    renderList({ companies: [company] });
    expect(screen.getByRole('link', { name: 'Systems Limited' })).toHaveAttribute(
      'href',
      '/companies/c-1',
    );
  });

  it('calls onEdit when the edit icon is clicked', () => {
    const { onEdit } = renderList({ companies: [company] });
    fireEvent.click(screen.getByLabelText(/edit systems limited/i));
    expect(onEdit).toHaveBeenCalledWith(company);
  });

  it('calls onDelete when the delete icon is clicked', () => {
    const { onDelete } = renderList({ companies: [company] });
    fireEvent.click(screen.getByLabelText(/delete systems limited/i));
    expect(onDelete).toHaveBeenCalledWith(company);
  });

  it('calls onMerge when the merge icon is clicked', () => {
    const { onMerge } = renderList({ companies: [company] });
    fireEvent.click(screen.getByLabelText(/merge systems limited/i));
    expect(onMerge).toHaveBeenCalledWith(company);
  });

  it('renders a website link when websiteUrl is set', () => {
    renderList({ companies: [company] });
    const link = screen.getByLabelText(/visit systems limited website/i);
    expect(link).toHaveAttribute('href', 'https://systemsltd.com');
  });

  it('shows "Not researched" when status is null', () => {
    renderList({ companies: [{ ...company, status: null }] });
    expect(screen.getByText('Not researched')).toBeInTheDocument();
  });
});
