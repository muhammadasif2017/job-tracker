// A field the LLM couldn't find still renders its row (label always shown),
// with "Unknown" in muted/italic text standing in for the value — distinct
// from a low-confidence "unverified" badge, which flags a value that *was*
// found but couldn't be confirmed against the official site.
export function FieldValue({ value }: { value: string | null | undefined }) {
  return value ? (
    <>{value}</>
  ) : (
    <span className="text-slate-400 italic">Unknown</span>
  );
}
