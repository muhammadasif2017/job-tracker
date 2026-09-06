import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BarChart, Bar, Cell, PieChart, Pie } from 'recharts';
import { ChartLegend } from './chart-legend';
import { STATUS_FILL_CLASSES, STATUS_DOT_VARS } from '../../types';

// The chart colors are applied as CSS classes rather than `fill=` props,
// because var() does not resolve inside an SVG presentation attribute. That
// only works if recharts forwards a <Cell className> onto the rendered shape —
// these tests pin that behavior, since a chart that silently lost its fill
// would still render and still pass every other test in the suite.
//
// Fixed width/height, no ResponsiveContainer: it measures 0x0 in jsdom and
// renders nothing at all.

const data = [
  { name: 'Applied', value: 3, className: STATUS_FILL_CLASSES.APPLIED },
  { name: 'Offer', value: 1, className: STATUS_FILL_CLASSES.OFFER },
];

describe('recharts Cell className forwarding', () => {
  it('puts the fill class on each bar rectangle', () => {
    const { container } = render(
      <BarChart width={300} height={200} data={data}>
        <Bar dataKey="value" isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.name} className={d.className} />
          ))}
        </Bar>
      </BarChart>,
    );

    const shapes = container.querySelectorAll('.recharts-bar-rectangle path');
    expect(shapes).toHaveLength(2);
    expect(shapes[0]).toHaveClass('fill-status-applied');
    expect(shapes[1]).toHaveClass('fill-status-offer');
  });

  it('puts the fill class on each pie sector', () => {
    const { container } = render(
      <PieChart width={300} height={200}>
        <Pie data={data} dataKey="value" isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.name} className={d.className} />
          ))}
        </Pie>
      </PieChart>,
    );

    const sectors = container.querySelectorAll('.recharts-pie-sector path');
    expect(sectors).toHaveLength(2);
    expect(sectors[0]).toHaveClass('fill-status-applied');
    expect(sectors[1]).toHaveClass('fill-status-offer');
  });
});

describe('ChartLegend', () => {
  it('renders a swatch carrying the token variable for each item', () => {
    const { container, getByText } = render(
      <ChartLegend
        items={[{ label: 'Applied', color: STATUS_DOT_VARS.APPLIED }]}
      />,
    );

    expect(getByText('Applied')).toBeInTheDocument();
    const swatch = container.querySelector('span[aria-hidden="true"]');
    expect(swatch).toHaveStyle({ background: 'var(--status-applied)' });
  });
});
