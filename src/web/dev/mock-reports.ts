/** The mock's favorite tags and its Dashboard numbers. All data is fictional. */
import type { ToolMap, UsageFeature, UsageTotals } from '../../tool-map.ts';
import { DAY, files, NOW } from './mock-files.ts';
import { listLibraries, listTags } from './mock-library.ts';

let favorites = ['topic:finance', 'doc-type:invoice'];

/** Stands in for `list_favorite_tags`. */
export function listFavoriteTags() {
  const counts = new Map(listTags({}).map((row) => [row.tag, row]));
  return favorites.map((tag, position) => ({
    tag,
    facet: counts.get(tag)?.facet ?? null,
    count: counts.get(tag)?.count ?? 0,
    position,
  }));
}

/** Stands in for `set_favorite_tag`. */
export function setFavoriteTag({ tag, favorite, position }: ToolMap['set_favorite_tag'][0]) {
  const others = favorites.filter((name) => name !== tag);
  if (!favorite) {
    favorites = others;
    return;
  }
  const at = Math.min(position ?? others.length, others.length);
  favorites = [...others.slice(0, at), tag, ...others.slice(at)];
}

const FEATURES: UsageFeature[] = ['organize', 'names', 'suggest', 'chat'];

/** A day's made-up calls for one feature: more organizing on weekdays. */
function totalsFor(day: number, feature: UsageFeature): UsageTotals {
  const calls = feature === 'organize' ? 20 + ((day * 7) % 13) : 1 + (day % 3);
  const input_tokens = calls * 2400;
  return {
    calls,
    files: feature === 'chat' ? 0 : calls,
    input_tokens,
    output_tokens: calls * 40,
    cost_usd: (input_tokens * 0.1) / 1_000_000,
    unknown_cost_calls: 0,
  };
}

const sum = (rows: UsageTotals[]): UsageTotals => ({
  calls: rows.reduce((total, row) => total + row.calls, 0),
  files: rows.reduce((total, row) => total + row.files, 0),
  input_tokens: rows.reduce((total, row) => total + row.input_tokens, 0),
  output_tokens: rows.reduce((total, row) => total + row.output_tokens, 0),
  cost_usd: rows.reduce((total, row) => total + row.cost_usd, 0),
  unknown_cost_calls: rows.reduce((total, row) => total + row.unknown_cost_calls, 0),
});

/** The mock's day `day` of 30, as a local `YYYY-MM-DD` like the real report's buckets. */
const startOf = (day: number) => new Date(NOW - (29 - day) * DAY).toLocaleDateString('sv');

/** Stands in for `usage_report`: 30 days of calls, by day whatever the bucket. */
export function usageReport() {
  const days = Array.from({ length: 30 }, (_, index) => index);
  const by_bucket = days.map((day) => ({
    start: startOf(day),
    ...sum(FEATURES.map((feature) => totalsFor(day, feature))),
  }));
  const by_bucket_feature = days.flatMap((day) =>
    FEATURES.map((feature) => ({ start: startOf(day), feature, ...totalsFor(day, feature) })),
  );
  const by_feature = FEATURES.map((feature) => ({
    feature,
    ...sum(days.map((day) => totalsFor(day, feature))),
  }));
  const totals = sum(by_bucket);
  return {
    totals,
    by_bucket,
    by_feature,
    by_bucket_feature,
    by_model: [{ provider: 'openai', model: 'gpt-6-luna', ...totals }],
  };
}

/** Stands in for `library_report`. */
export function libraryReport() {
  const libraries = listLibraries().map(({ path, files: count, scanned_at }) => ({
    path,
    files: count,
    organized: Math.floor(count * 0.8),
    tagged: Math.floor(count * 0.9),
    failed: count > 10 ? 1 : 0,
    scanned_at,
  }));
  const kinds = new Map<string, number>();
  for (const file of files) {
    const group = file.mime?.split('/')[0] ?? 'unknown';
    kinds.set(group, (kinds.get(group) ?? 0) + 1);
  }
  return {
    libraries,
    kinds: [...kinds].map(([mime_group, count]) => ({ mime_group, files: count })),
    top_tags: listTags({}).slice(0, 10),
    reviews_open: 3,
    plans: { applied: 4, undone: 1, proposed: 2 },
    cache: { answers: 412, hit_rate_30d: 0.37 },
  };
}
