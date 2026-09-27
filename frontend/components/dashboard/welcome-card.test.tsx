import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WelcomeCard } from './welcome-card';

describe('WelcomeCard', () => {
  it('links each first-run step to the page that does it', () => {
    render(<WelcomeCard />);
    expect(
      screen.getByRole('link', { name: /track your first job/i }),
    ).toHaveAttribute('href', '/jobs');
    expect(
      screen.getByRole('link', { name: /save your target companies/i }),
    ).toHaveAttribute('href', '/companies');
    expect(
      screen.getByRole('link', { name: /turn on reminders/i }),
    ).toHaveAttribute('href', '/profile');
  });

  it('numbers the steps in order', () => {
    render(<WelcomeCard />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Step 1');
    expect(items[2]).toHaveTextContent('Step 3');
  });
});
