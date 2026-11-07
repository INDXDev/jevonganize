/** What the shell keeps in step with the page: its language, the address bar and onboarding. */
import { useEffect, useState } from 'react';
import type { Status } from '../types.ts';
import { useTool } from './api.ts';
import { setLanguage, useLanguage } from './i18n/index.ts';
import { activeTab, useTabs, useWindow } from './tabs.ts';
import { startTour, useTour } from './tour.ts';

/** Follows the saved language, else the system's, and marks the page with the one in use. */
export function useAppLanguage() {
  const language = useLanguage();
  const { data: loaded } = useTool('get_config', {}, { staleTime: Infinity });
  const savedLanguage = loaded?.config.language;
  const systemLanguage = loaded?.system_language;
  useEffect(() => {
    setLanguage(savedLanguage, systemLanguage);
  }, [savedLanguage, systemLanguage]);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
}

/** Keeps the address bar on the active tab's query, and the page on the window's density and scale. */
export function useDocumentState() {
  const query = useTabs((s) => activeTab(s).query);
  const density = useWindow((s) => s.density);
  const scale = useWindow((s) => s.scale);
  useEffect(() => {
    history.replaceState(null, '', query ? `?${query}` : location.pathname);
  }, [query]);
  useEffect(() => {
    document.documentElement.dataset.density = density;
    document.documentElement.style.fontSize = `${scale * 100}%`;
  }, [density, scale]);
}

/**
 * Whether onboarding shows: on a first run, until it is skipped. The tour follows setup, once per
 * viewer. Later it starts only from Settings or the palette.
 */
export function useOnboarding(status: Status | undefined, ready: boolean) {
  const skipped = useWindow((s) => s.skipped);
  const tourSeen = useTour((s) => s.seen);
  // Latched, because the scan in step 2 adds a library while onboarding is still open.
  const [firstRun, setFirstRun] = useState(false);
  if (status && !status.libraries.length && !firstRun) setFirstRun(true);
  const onboarding = firstRun && !skipped;
  const shellShown = ready && !onboarding;
  useEffect(() => {
    if (shellShown && firstRun && !tourSeen) startTour();
  }, [shellShown, firstRun, tourSeen]);
  return onboarding;
}
