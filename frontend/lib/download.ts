// Saves a Blob the browser already holds as a file download.
//
// Firefox only dispatches the download for an anchor that is actually in the
// document, and revoking the object URL in the same tick can cancel a download
// already in flight — so attach, click, then clean up once the event loop has
// handed the blob off.
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

// `attachment; filename="jobs-offer.csv"` -> `jobs-offer.csv`. Falls back to
// the caller's default for a missing or unparseable header (e.g. a same-origin
// dev setup where the header isn't exposed).
export function filenameFromDisposition(
  header: unknown,
  fallback: string,
): string {
  if (typeof header !== 'string') return fallback;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1]?.trim() || fallback;
}
