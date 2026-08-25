// Single re-export point for all three dashboard charts, so the three
// next/dynamic() call sites in app/(dashboard)/page.tsx resolve to one
// shared chunk instead of each pulling its own copy of the Recharts vendor bundle.
export { StatusChart } from './status-chart';
export { FunnelChart } from './funnel-chart';
export { TrendChart } from './trend-chart';
