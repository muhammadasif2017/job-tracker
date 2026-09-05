// Replaces recharts' <Legend />. Recharts colors its legend swatch from the
// series' `fill`/`stroke` *prop*, so a series colored by CSS class (the only
// way to get a themeable var() onto an SVG shape) would render a legend swatch
// in recharts' default gray-blue. Rendering the legend ourselves keeps swatch
// and series on the same tokens, and makes the labels real selectable text.
export function ChartLegend({
  items,
}: {
  items: { label: string; color: string }[];
}) {
  return (
    <ul className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
