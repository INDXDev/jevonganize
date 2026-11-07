/** Small formatting helpers shared by views. */
import { getLanguage, t } from './i18n/index.ts';
import { clsx, type ClassValue } from 'clsx';
import { useState } from 'react';
import { twMerge } from 'tailwind-merge';
import type { Status } from '../types.ts';

/** Runs `reset` during render when `key` changes, which is how React resets state from props. */
export function useReset(key: unknown, reset: () => void) {
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    reset();
  }
}

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatSize(bytes: number) {
  const unit = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1000)), 4);
  const value = bytes / 1000 ** unit;
  const digits = value < 10 && unit > 0 ? 1 : 0;
  const number = value.toLocaleString(getLanguage(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${number} ${sizes[unit]}`;
}

export const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString(getLanguage(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

export const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString(getLanguage(), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

export const formatCount = (n: number) => n.toLocaleString(getLanguage());

/** A share from 0 to 1, as a whole percentage. */
export const formatPercent = (share: number) =>
  share.toLocaleString(getLanguage(), { style: 'percent', maximumFractionDigits: 0 });

/** A span of time, rounded for reading. */
export const formatDuration = (ms: number) =>
  ms < 60_000
    ? t('{count}s', { count: Math.max(1, Math.round(ms / 1000)) })
    : t('{count}m', { count: Math.round(ms / 60_000) });

/** Below this a cost rounds to nothing, so it shows as less than a cent rather than as free. */
const CENT = 0.01;

/** `null` means the provider's prices are unknown, which is not the same as free. */
export const formatCost = (usd: number | null | undefined) =>
  usd === null
    ? t('cost unknown')
    : usd && usd > 0 && usd < CENT / 2
      ? t('under ${cost}', {
          cost: CENT.toLocaleString(getLanguage(), { minimumFractionDigits: 2 }),
        })
      : t('about ${cost}', {
          cost: (usd ?? 0).toLocaleString(getLanguage(), {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
        });

/** True when the provider cannot run for want of a key. A local server may need none. */
export const needsKey = ({ has_key, provider }: Pick<Status, 'has_key' | 'provider'>) =>
  !has_key && provider !== 'compatible' && provider !== 'chat';

/** `~/Docs` style, for a path that is shown and never used. */
export const shortPath = (path: string) => path.replace(/^\/(Users|home)\/[^/]+/, '~');

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** True in the Electron window, which loads these same pages. */
export const isDesktop = navigator.userAgent.includes('Electron');

/** Turns `mod+shift+a` into what this keyboard shows. */
export const keyLabel = (keys: string) =>
  (keys.split(',')[0] ?? '')
    .replace('>', ' ')
    .split('+')
    .map((k) => {
      const names: Record<string, string> = {
        mod: isMac ? '⌘' : 'Ctrl+',
        shift: isMac ? '⇧' : 'Shift+',
        alt: isMac ? '⌥' : 'Alt+',
        enter: '↵',
        space: 'Space',
        escape: 'Esc',
        period: '.',
        down: '↓',
        up: '↑',
        left: '←',
        right: '→',
      };
      return names[k] ?? (k.length === 1 ? k.toUpperCase() : k);
    })
    .join('');
