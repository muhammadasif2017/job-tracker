/** Props for `PageHeader`. */
interface PageHeaderProps {
  title: React.ReactNode;
  /** One muted line under the title: a count, a tagline or a load error. */
  subtitle?: React.ReactNode;
  /** Buttons or controls on the right; they wrap under the title when narrow. */
  actions?: React.ReactNode;
}

/**
 * The title block at the top of a dashboard page: the page's h1, a muted line
 * under it and optional actions beside it. One component so every page sets
 * its title the same way.
 */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
