import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark');
    localStorage.clear();
  });

  it('shows the moon icon and no dark class by default', () => {
    render(<ThemeToggle />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(screen.getByLabelText('Toggle theme')).toBeInTheDocument();
  });

  it('adds the dark class and persists the choice on click', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByLabelText('Toggle theme'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('toggles back to light on a second click', () => {
    render(<ThemeToggle />);
    const toggle = screen.getByLabelText('Toggle theme');
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('reflects an already-dark document on mount', () => {
    document.documentElement.classList.add('dark');
    render(<ThemeToggle />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
