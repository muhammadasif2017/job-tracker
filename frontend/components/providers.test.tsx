import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Providers } from './providers';

describe('Providers', () => {
  it('renders its children', () => {
    render(
      <Providers>
        <div>app content</div>
      </Providers>,
    );
    expect(screen.getByText('app content')).toBeInTheDocument();
  });
});
