import * as cheerio from 'cheerio';
import { jobPostingTextFromJsonLd } from './job-posting-json-ld.helper.js';

/** Wraps each value in its own JSON-LD script tag, as a page would. */
function pageWith(...blocks: Array<unknown>): cheerio.CheerioAPI {
  const scripts = blocks
    .map(
      (b) =>
        `<script type="application/ld+json">${typeof b === 'string' ? b : JSON.stringify(b)}</script>`,
    )
    .join('');
  return cheerio.load(`<html><head>${scripts}</head><body></body></html>`);
}

describe('jobPostingTextFromJsonLd', () => {
  it('renders the fields of a full JobPosting as labelled lines', () => {
    const $ = pageWith({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Senior React Developer',
      hiringOrganization: { '@type': 'Organization', name: 'Acme' },
      jobLocation: {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'Lahore',
          addressRegion: 'Punjab',
          addressCountry: { '@type': 'Country', name: 'PK' },
        },
      },
      jobLocationType: 'TELECOMMUTE',
      employmentType: ['FULL_TIME', 'CONTRACTOR'],
      description: '<p>Build <strong>great</strong> things.</p>',
    });

    expect(jobPostingTextFromJsonLd($)).toBe(
      [
        'Job title: Senior React Developer',
        'Company: Acme',
        'Location: Lahore, Punjab, PK',
        'Workplace: Remote',
        'Employment type: FULL_TIME, CONTRACTOR',
        'Description: Build great things.',
      ].join('\n'),
    );
  });

  it('returns an empty string when the page declares no JobPosting', () => {
    const $ = pageWith({ '@type': 'Organization', name: 'Acme' });

    expect(jobPostingTextFromJsonLd($)).toBe('');
  });

  it('finds a JobPosting inside a @graph container', () => {
    const $ = pageWith({
      '@graph': [
        { '@type': 'WebPage', name: 'Careers' },
        { '@type': 'JobPosting', title: 'QA Engineer' },
      ],
    });

    expect(jobPostingTextFromJsonLd($)).toBe('Job title: QA Engineer');
  });

  it('accepts @type as an array and a top-level array of nodes', () => {
    const $ = pageWith([
      { '@type': ['Thing', 'JobPosting'], title: 'Designer' },
    ]);

    expect(jobPostingTextFromJsonLd($)).toBe('Job title: Designer');
  });

  it('skips a malformed block without hiding a valid one', () => {
    const $ = pageWith('{ not json', { '@type': 'JobPosting', title: 'SRE' });

    expect(jobPostingTextFromJsonLd($)).toBe('Job title: SRE');
  });

  it('decodes a description that was entity-encoded twice', () => {
    const $ = pageWith({
      '@type': 'JobPosting',
      description: '&lt;p&gt;Ship &lt;em&gt;fast&lt;/em&gt;.&lt;/p&gt;',
    });

    expect(jobPostingTextFromJsonLd($)).toBe('Description: Ship fast.');
  });

  it('accepts a bare-string organization and address and joins several locations', () => {
    const $ = pageWith({
      '@type': 'JobPosting',
      hiringOrganization: 'Acme',
      jobLocation: [
        { address: 'Karachi' },
        { address: { addressLocality: 'Dubai' } },
        'not a place',
      ],
    });

    expect(jobPostingTextFromJsonLd($)).toBe(
      'Company: Acme\nLocation: Karachi; Dubai',
    );
  });

  it('ignores non-string field values instead of rendering them', () => {
    const $ = pageWith({
      '@type': 'JobPosting',
      title: 42,
      hiringOrganization: { name: null },
      employmentType: [null, 'PART_TIME'],
    });

    expect(jobPostingTextFromJsonLd($)).toBe('Employment type: PART_TIME');
  });

  it('stops descending past the depth cap', () => {
    let nested: unknown = { '@type': 'JobPosting', title: 'Too deep' };
    for (let i = 0; i < 10; i++) nested = [nested];
    const $ = pageWith(nested);

    expect(jobPostingTextFromJsonLd($)).toBe('');
  });
});
