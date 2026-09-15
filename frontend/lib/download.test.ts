import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { filenameFromDisposition, saveBlob } from './download';

describe('saveBlob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => 'blob:file');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Firefox only dispatches the download for an anchor that is in the
  // document, and revoking in the same tick can cancel it.
  it('clicks an attached anchor and revokes the URL only after the click tick', () => {
    const clicked: { href: string; download: string; attached: boolean }[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push({
          href: this.href,
          download: this.download,
          attached: document.body.contains(this),
        });
      });

    saveBlob(new Blob(['x']), 'interview.ics');

    expect(clicked).toEqual([
      { href: 'blob:file', download: 'interview.ics', attached: true },
    ]);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:file');
    expect(document.querySelector('a[download]')).toBeNull();
    click.mockRestore();
  });
});

describe('filenameFromDisposition', () => {
  it('reads a quoted or unquoted filename', () => {
    expect(
      filenameFromDisposition('attachment; filename="jobs-offer.csv"', 'x'),
    ).toBe('jobs-offer.csv');
    expect(
      filenameFromDisposition('attachment; filename=interview.ics', 'x'),
    ).toBe('interview.ics');
  });

  it('falls back for a missing or unparseable header', () => {
    expect(filenameFromDisposition(undefined, 'jobs.csv')).toBe('jobs.csv');
    expect(filenameFromDisposition('attachment', 'jobs.csv')).toBe('jobs.csv');
  });
});
