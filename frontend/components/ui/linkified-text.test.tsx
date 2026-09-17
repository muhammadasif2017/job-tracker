import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LinkifiedText } from './linkified-text';

describe('LinkifiedText', () => {
  it('renders plain text with no links unchanged', () => {
    const { container } = render(<LinkifiedText text="Just a note" />);
    expect(container).toHaveTextContent('Just a note');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('turns an http(s) URL into a link that opens in a new tab', () => {
    render(
      <LinkifiedText text="Posting: https://example.com/jobs/1 apply soon" />,
    );
    const link = screen.getByRole('link', {
      name: 'https://example.com/jobs/1',
    });
    expect(link).toHaveAttribute('href', 'https://example.com/jobs/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('prefixes https:// on a bare www. link', () => {
    render(<LinkifiedText text="see www.example.com" />);
    expect(
      screen.getByRole('link', { name: 'www.example.com' }),
    ).toHaveAttribute('href', 'https://www.example.com');
  });

  it('keeps trailing sentence punctuation out of the link', () => {
    const { container } = render(
      <LinkifiedText text="Read https://example.com/a." />,
    );
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://example.com/a',
    );
    expect(container).toHaveTextContent('Read https://example.com/a.');
  });

  it('links several URLs and preserves the text between them', () => {
    const { container } = render(
      <LinkifiedText text={'a https://one.com\nb http://two.com'} />,
    );
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(container.textContent).toBe('a https://one.com\nb http://two.com');
  });

  it('does not link non-http schemes', () => {
    render(<LinkifiedText text="javascript:alert(1)" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
