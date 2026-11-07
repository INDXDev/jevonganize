/** The Dashboard's usage tables: the period's calls, tokens and cost by feature and by model. */
import { t } from '../i18n/index.ts';
import type { UsageReport, UsageTotals } from '../../tool-map.ts';
import { formatCost, formatCount } from '../lib.ts';
import { FEATURE_TITLES } from './dashboard-copy.ts';
import { totalTokens } from './dashboard-data.ts';
import { DataTable, type Column } from './dashboard-table.tsx';

const totalsColumns = (): Column[] => [
  { title: t('Calls'), numeric: true },
  { title: t('Tokens'), numeric: true },
  { title: t('Cost'), numeric: true },
];

/** A row's three figures. A cost covers known prices only, as the cost card says. */
const totalsCells = (row: UsageTotals) => [
  formatCount(row.calls),
  formatCount(totalTokens(row)),
  formatCost(row.cost_usd),
];

/** Calls, tokens and cost by feature, then by model. */
export function UsageTables({ usage }: { usage: UsageReport }) {
  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <DataTable
        caption={t('By feature')}
        columns={[{ title: t('Feature') }, ...totalsColumns()]}
        rows={usage.by_feature.map((row) => ({
          key: row.feature,
          cells: [t(FEATURE_TITLES[row.feature]), ...totalsCells(row)],
        }))}
      />
      <DataTable
        caption={t('By model')}
        columns={[{ title: t('Model') }, ...totalsColumns()]}
        rows={usage.by_model.map((row) => ({
          key: `${row.provider}/${row.model}`,
          cells: [`${row.provider} · ${row.model}`, ...totalsCells(row)],
        }))}
      />
    </div>
  );
}
