import { Fragment } from 'react';

/**
 * Only http(s) and bare www. links — never an arbitrary scheme, so a note
 * containing `javascript:...` stays plain text.
 */
const URL_PATTERN = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

/**
 * Sentence punctuation that usually follows a pasted URL rather than
 * belonging to it ("see https://x.com/job.").
 */
const TRAILING_PUNCTUATION = /[.,;:!?)\]'"]+$/;

/**
 * Renders free text (notes) with any pasted URL turned into a clickable link
 * that opens in a new tab. Everything else is rendered as-is, so the parent's
 * `whitespace-pre-wrap` still preserves line breaks.
 */
export function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN);

  return (
    <>
      {parts.map((part, i) => {
        // split() with a capture group puts matches at odd indexes.
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;

        const trailing = part.match(TRAILING_PUNCTUATION)?.[0] ?? '';
        const url = trailing ? part.slice(0, -trailing.length) : part;
        const href = url.toLowerCase().startsWith('www.')
          ? `https://${url}`
          : url;

        return (
          <Fragment key={i}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-accent underline underline-offset-2 hover:opacity-80"
            >
              {url}
            </a>
            {trailing}
          </Fragment>
        );
      })}
    </>
  );
}
