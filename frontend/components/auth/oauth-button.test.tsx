import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OAuthButton } from './oauth-button';

describe('OAuthButton', () => {
  it('renders the Google variant with the right label and link', () => {
    render(<OAuthButton provider="google" />);
    const link = screen.getByRole('link', { name: /continue with google/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('/auth/google'));
  });

  it('renders the GitHub variant with the right label and link', () => {
    render(<OAuthButton provider="github" />);
    const link = screen.getByRole('link', { name: /continue with github/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('/auth/github'));
  });
});
