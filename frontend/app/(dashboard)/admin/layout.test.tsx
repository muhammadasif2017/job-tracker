import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminLayout from './layout';

let pathname = '/admin/users';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

describe('AdminLayout', () => {
  it('links to both admin sections', () => {
    pathname = '/admin/users';
    render(
      <AdminLayout>
        <p>content</p>
      </AdminLayout>,
    );
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute(
      'href',
      '/admin/users',
    );
    expect(screen.getByRole('link', { name: 'Queues' })).toHaveAttribute(
      'href',
      '/admin/queues',
    );
  });

  it('marks the active tab with aria-current', () => {
    pathname = '/admin/queues';
    render(
      <AdminLayout>
        <p>content</p>
      </AdminLayout>,
    );
    expect(screen.getByRole('link', { name: 'Queues' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Users' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('renders the page below the tabs', () => {
    pathname = '/admin/users';
    render(
      <AdminLayout>
        <p>content</p>
      </AdminLayout>,
    );
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});
