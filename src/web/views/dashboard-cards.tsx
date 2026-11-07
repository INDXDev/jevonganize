/** The four headline figures at the top of the Dashboard. */
import { getLanguage, t } from '../i18n/index.ts';
import type { ReactNode } from 'react';
import type { LibraryReport, UsageReport } from '../../tool-map.ts';
import { formatCost, formatCount, formatPercent } from '../lib.ts';
import { goTo } from '../tabs.ts';
import { organizedShare, totalTokens } from './dashboard-data.ts';

const formatCompact = (n: number) =>
  n.toLocaleString(getLanguage(), { notation: 'compact', maximumFractionDigits: 1 });

function Card(props: { title: string; value: string; children?: ReactNode; onClick?: () => void }) {
  const Body = props.onClick ? 'button' : 'div';
  return (
    <Body
      type={props.onClick ? 'button' : undefined}
      onClick={props.onClick}
      data-card
      className="flex min-w-0 flex-col gap-1 rounded-lg border bg-surface-2 p-3 text-left enabled:hover:border-strong"
    >
      <span className="truncate text-xs text-subtle">{props.title}</span>
      <span className="font-mono text-2xl text-foreground">{props.value}</span>
      <span className="text-xs text-muted-foreground">{props.children}</span>
    </Body>
  );
}

/** Cost and tokens in the period, then the organized share and the open reviews of the index now. */
export function SummaryCards(props: { usage: UsageReport; library: LibraryReport; days: number }) {
  const { totals } = props.usage;
  const { libraries, reviews_open } = props.library;
  const { files, organized, share } = organizedShare(libraries);
  return (
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      <Card
        title={t('Cost, last {count} days', { count: props.days })}
        value={formatCost(totals.cost_usd)}
      >
        {totals.unknown_cost_calls > 0 ? (
          <span className="text-warn">
            {t('Some prices are unknown ({count} calls)', {
              count: formatCount(totals.unknown_cost_calls),
            })}
          </span>
        ) : (
          t('Estimated from list prices. Decision models bill input only.')
        )}
      </Card>
      <Card title={t('Tokens, in and out')} value={formatCompact(totalTokens(totals))}>
        {t('{input} in · {output} out', {
          input: formatCount(totals.input_tokens),
          output: formatCount(totals.output_tokens),
        })}
      </Card>
      <Card title={t('Organized')} value={share === null ? '–' : formatPercent(share)}>
        {t('{organized} of {files} files', {
          organized: formatCount(organized),
          files: formatCount(files),
        })}
      </Card>
      <Card
        title={t('Open reviews')}
        value={formatCount(reviews_open)}
        onClick={() => goTo('tags', 'review')}
      />
    </div>
  );
}
