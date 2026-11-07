/** The daily cost chart: hand-drawn SVG bars, one per day, stacked by feature. */
import { t } from '../i18n/index.ts';
import { formatCost } from '../lib.ts';
import { FEATURE_TITLES } from './dashboard-copy.ts';
import { CHART_FEATURES, layoutBars, type ChartFeature, type DayStack } from './dashboard-data.ts';

/** The drawing's own units. The SVG scales to the pane's width and keeps this aspect. */
const BOX = { width: 600, height: 140, gap: 2 };

/**
 * Each feature's colour, from the tag tokens, so both themes are covered. The order was checked for
 * colour-blind separation, and the legend and the tables carry the same numbers as text.
 */
const FEATURE_COLORS: Record<ChartFeature, string> = {
  organize: 'var(--tag-blue)',
  names: 'var(--tag-orange)',
  suggest: 'var(--tag-green)',
  topics: 'var(--tag-purple)',
  refresh: 'var(--tag-yellow)',
  chat: 'var(--tag-pink)',
};

function Legend({ features }: { features: ChartFeature[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {features.map((feature) => (
        <li key={feature} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 rounded-sm"
            style={{ background: FEATURE_COLORS[feature] }}
          />
          {t(FEATURE_TITLES[feature])}
        </li>
      ))}
    </ul>
  );
}

/** Cost per day in the period, stacked by feature. Each segment's `<title>` holds its value. */
export function DailyCostChart({ stacks }: { stacks: DayStack[] }) {
  const { bars, max } = layoutBars(stacks, BOX);
  const present = new Set(bars.flatMap((bar) => bar.segments.map((segment) => segment.feature)));
  const features = CHART_FEATURES.filter((feature) => present.has(feature));
  return (
    <figure className="space-y-2">
      <figcaption className="flex items-baseline justify-between text-xs text-subtle">
        <span>{t('Cost per day')}</span>
        <span className="font-mono">{max > 0 && t('Top: {cost}', { cost: formatCost(max) })}</span>
      </figcaption>
      <svg viewBox={`0 0 ${BOX.width} ${BOX.height}`} className="h-auto w-full">
        <title>{t('Cost per day, stacked by feature')}</title>
        <line x1={0} x2={BOX.width} y1={BOX.height} y2={BOX.height} stroke="var(--border-strong)" />
        {bars.map((bar) => (
          <g key={bar.day} data-day={bar.day}>
            <title>{`${bar.day} · ${formatCost(bar.total)}`}</title>
            {bar.segments.map((segment) => (
              <rect
                key={segment.feature}
                x={bar.x}
                y={segment.y}
                width={bar.width}
                height={segment.height}
                fill={FEATURE_COLORS[segment.feature]}
              >
                <title>
                  {`${bar.day} · ${t(FEATURE_TITLES[segment.feature])}: ${formatCost(segment.cost)}`}
                </title>
              </rect>
            ))}
          </g>
        ))}
      </svg>
      <div className="flex justify-between font-mono text-2xs text-subtle">
        <span>{stacks[0]?.day}</span>
        <span>{stacks.at(-1)?.day}</span>
      </div>
      {features.length > 0 ? (
        <Legend features={features} />
      ) : (
        <p className="text-xs text-subtle">{t('No model calls in this period.')}</p>
      )}
    </figure>
  );
}
