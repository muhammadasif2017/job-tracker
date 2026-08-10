import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './modal';

describe('Modal', () => {
  it('renders title, description, and children when open', () => {
    render(
      <Modal open onClose={vi.fn()} title="Add Job" description="Fill in the details">
        <div>form content</div>
      </Modal>,
    );
    expect(screen.getByText('Add Job')).toBeInTheDocument();
    expect(screen.getByText('Fill in the details')).toBeInTheDocument();
    expect(screen.getByText('form content')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Add Job">
        <div>form content</div>
      </Modal>,
    );
    expect(screen.queryByText('Add Job')).not.toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Add Job">
        <div>form content</div>
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
