import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DashboardLayout from './layout';

vi.mock('../../components/layout/sidebar', () => ({
  Sidebar: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
    <div data-testid="sidebar" data-open={isOpen}>
      <button onClick={onClose}>close sidebar</button>
    </div>
  ),
}));

vi.mock('../../components/layout/theme-toggle', () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

function renderLayout() {
  return render(
    <DashboardLayout>
      <p>page content</p>
    </DashboardLayout>,
  );
}

describe('DashboardLayout', () => {
  it('renders children inside main', () => {
    renderLayout();
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('renders the sidebar closed by default', () => {
    renderLayout();
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-open', 'false');
  });

  it('opens the sidebar when the mobile menu button is clicked', () => {
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-open', 'true');
  });

  it('closes the sidebar when its onClose fires', () => {
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByText('close sidebar'));
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-open', 'false');
  });

  it('renders the theme toggle in the header', () => {
    renderLayout();
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
  });
});
