import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'font-geist-mock' }),
}));

import RootLayout, { metadata } from './layout';

// RootLayout is a plain function component with no hooks of its own, so
// calling it directly (instead of mounting via RTL, which can't render a
// top-level <html>/<body> into a container div) gives back the React
// element tree to inspect without needing to execute child components.
function renderTree() {
  return RootLayout({ children: null }) as unknown as {
    props: { lang: string; className: string; children: unknown[] };
  };
}

function findByType(children: unknown[], type: string) {
  return children.find(
    (c): c is { type: string; props: Record<string, unknown> } =>
      !!c && typeof c === 'object' && (c as { type?: unknown }).type === type,
  );
}

function getThemeInitScript(): string {
  const el = renderTree();
  const head = findByType(el.props.children, 'head')!;
  const script = findByType(head.props.children as unknown[], 'script')!;
  return (
    script.props as unknown as { dangerouslySetInnerHTML: { __html: string } }
  ).dangerouslySetInnerHTML.__html;
}

function runThemeInit() {
  // eslint-disable-next-line no-eval
  eval(getThemeInitScript());
}

describe('RootLayout metadata', () => {
  it('sets the page title and description', () => {
    expect(metadata.title).toBe('Job Tracker');
    expect(metadata.description).toBe(
      'Track your job applications in one place',
    );
  });
});

describe('RootLayout structure', () => {
  it('sets lang and h-full on <html>', () => {
    const el = renderTree();
    expect(el.props.lang).toBe('en');
    expect(el.props.className).toContain('h-full');
  });

  it('applies base background/text classes on <body>', () => {
    const el = renderTree();
    const body = findByType(el.props.children, 'body')!;
    expect(body.props.className).toContain('antialiased');
    expect(body.props.className).toContain('dark:bg-slate-950');
  });

  it('includes a preconnect link to the API when NEXT_PUBLIC_API_URL is set', () => {
    const prev = process.env.NEXT_PUBLIC_API_URL;
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';
    const el = renderTree();
    const head = findByType(el.props.children, 'head')!;
    const link = findByType(head.props.children as unknown[], 'link') as
      | { props: { href: string; rel: string } }
      | undefined;
    expect(link?.props.href).toBe('http://localhost:3001');
    expect(link?.props.rel).toBe('preconnect');
    process.env.NEXT_PUBLIC_API_URL = prev;
  });

  it('omits the preconnect link when NEXT_PUBLIC_API_URL is unset', () => {
    const prev = process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_API_URL;
    const el = renderTree();
    const head = findByType(el.props.children, 'head')!;
    const link = findByType(head.props.children as unknown[], 'link');
    expect(link).toBeUndefined();
    process.env.NEXT_PUBLIC_API_URL = prev;
  });
});

describe('theme-init script (inline, runs before hydration)', () => {
  const originalClassName = document.documentElement.className;

  beforeEach(() => {
    document.documentElement.className = '';
  });

  afterEach(() => {
    document.documentElement.className = originalClassName;
    vi.restoreAllMocks();
    // @ts-expect-error jsdom doesn't implement matchMedia; drop our stub
    delete window.matchMedia;
  });

  it('applies the dark class when localStorage theme is "dark"', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('dark');
    runThemeInit();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('does not apply the dark class when localStorage theme is "light"', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('light');
    runThemeInit();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('falls back to the system preference when no theme is stored', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    runThemeInit();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('respects a light system preference when no theme is stored', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    runThemeInit();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('swallows errors instead of throwing (e.g. localStorage blocked)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });
    expect(() => runThemeInit()).not.toThrow();
  });
});
