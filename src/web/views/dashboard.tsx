/**
 * The Dashboard screen: model usage and cost over a period, the state of the index, and beside them
 * the history of jobs and plans that the Activity screen used to show (`section=history`).
 */
import { t } from '../i18n/index.ts';
import { useState } from 'react';
import { useTool } from '../api.ts';
import { Divider, Pane, Panes } from '../components/pane.tsx';
import { ScreenHeader } from '../components/screen-header.tsx';
import { Select } from '../components/ui/field.tsx';
import { setView, useView } from '../tabs.ts';
import { SummaryCards } from './dashboard-cards.tsx';
import { DailyCostChart } from './dashboard-chart.tsx';
import { dailyStacks, PERIODS, periodDays, periodOf, periodStart } from './dashboard-data.ts';
import { DashboardHistory } from './dashboard-history.tsx';
import { LibrarySection } from './dashboard-library.tsx';
import { UsageTables } from './dashboard-usage.tsx';

function PeriodSelect({ days }: { days: number }) {
  return (
    <Select
      label={t('Period')}
      className="h-6 w-32 text-xs"
      value={String(days)}
      options={PERIODS.map((count) => ({
        value: String(count),
        label: t('Last {count} days', { count }),
      }))}
      // 30 days is the default, so it stays out of the address.
      onChange={(next) => setView({ period: next === '30' ? null : next })}
    />
  );
}

/** Cards, the daily chart and the tables for the chosen period, then the libraries. */
function Overview() {
  const days = periodOf(useView().period);
  // Read once per mount, so the period's start is a stable local midnight and the cache holds.
  const [now] = useState(() => new Date());
  const since = periodStart(days, now);
  const usage = useTool('usage_report', { since, bucket: 'day' });
  const library = useTool('library_report', {});
  return (
    <Pane
      id="overview"
      title={t('Overview')}
      actions={<PeriodSelect days={days} />}
      loading={usage.isLoading || library.isLoading}
      error={usage.error ?? library.error}
    >
      {usage.data && library.data && (
        <div className="mx-auto max-w-5xl space-y-6 p-4">
          <SummaryCards usage={usage.data} library={library.data} days={days} />
          <DailyCostChart
            stacks={dailyStacks(usage.data.by_bucket_feature, periodDays(days, now))}
          />
          <UsageTables usage={usage.data} />
          <LibrarySection library={library.data} />
        </div>
      )}
    </Pane>
  );
}

/** Usage and the library on the left, history on the right. */
export function Dashboard() {
  return (
    <>
      <ScreenHeader title={t('Dashboard')} />
      <Panes id="dashboard" panes={['overview', 'history']}>
        <Overview />
        <Divider />
        <DashboardHistory />
      </Panes>
    </>
  );
}
