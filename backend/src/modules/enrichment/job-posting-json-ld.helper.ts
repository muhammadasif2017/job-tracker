import * as cheerio from 'cheerio';

/** A parsed JSON-LD node; every property is untrusted page data. */
type JsonLdNode = Record<string, unknown>;

/**
 * How far down nested arrays and `@graph` containers the search goes. Real
 * pages nest one or two levels; the cap only stops a hostile page from
 * making the walk recurse without bound.
 */
const MAX_JSON_LD_DEPTH = 4;

/**
 * Reads every schema.org `JobPosting` a page declares in
 * `<script type="application/ld+json">` and renders it as labelled plain
 * text for the job-parsing prompt. Returns an empty string when there is
 * none.
 *
 * This has to run on the page before `WebFetchService` strips `<script>`
 * tags. ATS pages (Greenhouse, Lever, Workday, Ashby) are mostly
 * client-rendered, so the server's HTML often carries no readable posting
 * at all, but they publish the posting as JSON-LD for search engines. The
 * strip used to throw exactly that block away, and Quick Add from an ATS
 * URL then fell through to the search fallback or failed.
 */
export function jobPostingTextFromJsonLd($: cheerio.CheerioAPI): string {
  const postings: JsonLdNode[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    // One malformed block must not hide a valid one elsewhere on the page.
    try {
      collectJobPostings(JSON.parse($(el).text()), postings, 0);
    } catch {
      return;
    }
  });
  return postings.map(describeJobPosting).filter(Boolean).join('\n\n');
}

/**
 * Walks one parsed JSON-LD value and gathers its `JobPosting` nodes. A
 * script may hold a single node, an array of nodes, or a `@graph`
 * container, and `@type` may be a string or an array of strings.
 */
function collectJobPostings(
  value: unknown,
  into: JsonLdNode[],
  depth: number,
): void {
  if (depth > MAX_JSON_LD_DEPTH || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v) => collectJobPostings(v, into, depth + 1));
    return;
  }
  const node = value as JsonLdNode;
  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes('JobPosting')) into.push(node);
  if (node['@graph']) collectJobPostings(node['@graph'], into, depth + 1);
}

/**
 * Renders one posting as `Label: value` lines. Labels rather than raw JSON:
 * the model reads prose better, and raw JSON spends the context budget on
 * keys and punctuation.
 */
function describeJobPosting(posting: JsonLdNode): string {
  const remote = posting.jobLocationType === 'TELECOMMUTE';
  const lines: Array<[string, string]> = [
    ['Job title', asText(posting.title)],
    ['Company', nameOf(posting.hiringOrganization)],
    ['Location', locationOf(posting.jobLocation)],
    ['Workplace', remote ? 'Remote' : ''],
    ['Employment type', listOf(posting.employmentType)],
    ['Description', htmlToText(asText(posting.description))],
  ];
  return lines
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

/** A string property, trimmed, or empty for anything that is not a string. */
function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * An organization or country, which schema.org allows as either a bare
 * string or an object with a `name`.
 */
function nameOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    return asText((value as JsonLdNode).name);
  }
  return '';
}

/** `employmentType` is a string or an array of them (`FULL_TIME`). */
function listOf(value: unknown): string {
  const items = Array.isArray(value) ? value : [value];
  return items.map(asText).filter(Boolean).join(', ');
}

/**
 * Every `jobLocation` as "city, region, country", joined with "; ". A
 * posting may list several places, and each `address` may be a
 * `PostalAddress` object or a bare string.
 */
function locationOf(value: unknown): string {
  const places = Array.isArray(value) ? value : [value];
  return places
    .map((place) => {
      if (!place || typeof place !== 'object') return '';
      const address = (place as JsonLdNode).address;
      if (typeof address === 'string') return address.trim();
      if (!address || typeof address !== 'object') return '';
      const a = address as JsonLdNode;
      return [
        asText(a.addressLocality),
        asText(a.addressRegion),
        nameOf(a.addressCountry),
      ]
        .filter(Boolean)
        .join(', ');
    })
    .filter(Boolean)
    .join('; ');
}

/**
 * `description` is HTML. Some ATS pages (Greenhouse among them) entity-encode
 * it a second time, so one decode leaves literal `<p>` tags; a second pass
 * runs only when the first one still looks like markup.
 */
function htmlToText(html: string): string {
  if (!html) return '';
  let text = cheerio.load(html).text();
  if (/<[a-z][^>]*>/i.test(text)) text = cheerio.load(text).text();
  return text.replace(/\s+/g, ' ').trim();
}
