/** Small formatting helpers shared by views. */
import { clsx, type ClassValue } from 'clsx';
import { useState } from 'react';
import { twMerge } from 'tailwind-merge';

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
  return `${value < 10 && unit ? value.toFixed(1) : Math.round(value)} ${sizes[unit]}`;
}

export const formatDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export const formatCount = (n: number) => n.toLocaleString('en-US');

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
