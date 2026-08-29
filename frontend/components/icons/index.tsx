import type { SVGProps } from 'react';

// Custom icon set for the app's brand touchpoints (logo mark + primary nav).
// Each glyph is built from the same primitives as the rest of the design
// system (signal nodes, trace lines, concentric rings) instead of a literal
// briefcase/building/person — but unlike the first pass, each one now has
// its own full silhouette (no shared frame) so they stay distinguishable at
// 16-20px nav size. Companies uses a target ring because the page is
// literally "Target Companies." Utility/action icons elsewhere (edit,
// delete, search, etc.) stay on lucide-react — this set is only the
// brand-visible surface.

const STROKE = 1.75;

function base(props: SVGProps<SVGSVGElement>) {
  return {
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: STROKE,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props,
  };
}

// Logo mark: a signal trace with three nodes — the pipeline concept
// (wishlist → applied → interviewing → offer) distilled into a glyph.
export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base({ viewBox: '0 0 24 24', ...props })}>
      <path d="M2.5 17h5L11 6l3 11h5.5" />
      <circle cx="2.5" cy="17" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="11" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="21.5" cy="17" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Readout meter — three ascending signal bars, for the stats overview.
export function IconDashboard(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 16.5V11M10 16.5V3.5M16.5 16.5V8" />
    </svg>
  );
}

// Pipeline trace — the app's own signature motif, at icon scale.
export function IconJobs(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 15h4L10 4l3.5 11h4" />
      <circle cx="2.5" cy="15" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="10" cy="4" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="15" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Hub — one entity branching to the roles/contacts tracked under it.
export function IconCompanies(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M10 5v2.3M10 7.3 4.5 15M10 7.3V16M10 7.3 15.5 15" />
      <circle cx="10" cy="5" r="1.7" />
      <circle cx="4.5" cy="15" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="10" cy="16" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Beacon — a broadcasting node standing in for "you."
export function IconProfile(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="10" r="1.8" fill="currentColor" stroke="none" />
      <path d="M5.8 10a4.2 4.2 0 0 1 8.4 0M2.8 10a7.2 7.2 0 0 1 14.4 0" />
    </svg>
  );
}

// Keyhole — elevated access.
export function IconAdmin(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M10 2 17 5.5v4.2c0 5-3 8.6-7 9.8-4-1.2-7-4.8-7-9.8V5.5z" />
      <circle cx="10" cy="9" r="1.7" />
      <path d="M10 10.7V13.5" />
    </svg>
  );
}

// Signal exiting through a doorway.
export function IconSignOut(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M8.5 17H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4.5" />
      <path d="M8 10h9.5M14.5 6.5 18 10l-3.5 3.5" />
    </svg>
  );
}
