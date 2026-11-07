/** The Dashboard's names for things the reports return as ids. */
import type { PlainMessage } from '../i18n/index.ts';
import type { UsageFeature } from '../../tool-map.ts';

/** What each recorded feature is called on screen. */
export const FEATURE_TITLES: Record<UsageFeature, PlainMessage> = {
  organize: 'Organize',
  'organize-cache': 'Organize (from cache)',
  names: 'Names',
  suggest: 'Tag suggestions',
  topics: 'Topics',
  refresh: 'Refresh',
  chat: 'Chat',
};
