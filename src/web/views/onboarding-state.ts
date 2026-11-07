import { useMemo, useState } from 'react';
import type { Library, Status } from '../../types.ts';
import { call, queryClient, useTool } from '../api.ts';

/** Runs a mutation, clearing the last error first and recording what the mutation throws. */
export type RunRecordingError = (run: () => Promise<unknown>) => Promise<void>;

/** The last failure, and a wrapper that clears it, runs a mutation and records what it threw. */
export function useLastError() {
  const [error, setError] = useState('');
  const runRecordingError: RunRecordingError = async (run) => {
    setError('');
    try {
      await run();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return { error, runRecordingError };
}

/** The OpenAI key: typing and saving one, or allowing the one already in the environment. */
export function useOpenAiKey(status: Status | undefined, runRecordingError: RunRecordingError) {
  const [typedKey, setTypedKey] = useState('');
  const [savedHere, setSavedHere] = useState(false);
  const saveKey = () =>
    runRecordingError(async () => {
      await call('set_api_key', { provider: 'openai', key: typedKey });
      setTypedKey('');
      setSavedHere(true);
    });
  // Keys in the environment wait for consent. This button is that consent.
  const { data: keyList } = useTool('list_keys', {});
  const openaiKey = keyList?.keys.find((row) => row.provider === 'openai');
  const adoptEnvKey = () =>
    runRecordingError(async () => {
      await call('set_env_keys', { allowed: true });
      await queryClient.invalidateQueries({ queryKey: ['list_keys'] });
      setSavedHere(true);
    });
  return {
    typedKey,
    setTypedKey,
    saveKey,
    envKeyFound: openaiKey?.in_env === true,
    usingEnvKey: openaiKey?.source === 'env',
    adoptEnvKey,
    haveKey: savedHere || !!status?.has_key,
  };
}

/** The folder to start with: picking it adds it as a library and scans it when it can be tagged. */
export function useStartFolder(runRecordingError: RunRecordingError) {
  const [library, setLibrary] = useState<Library>();
  const [isPicking, setIsPicking] = useState(false);
  const addAndScanFolder = (path: string) => {
    setIsPicking(false);
    void runRecordingError(async () => {
      const addedLibrary = await call('add_library', { path });
      setLibrary(addedLibrary);
      if (addedLibrary.taggable) await call('scan', { path: addedLibrary.path });
    });
  };
  const isTaggable = library?.taggable === true;
  return { library, isPicking, setIsPicking, addAndScanFolder, isTaggable };
}

/** The question packs, each on when any of its questions is enabled, and switching one. */
export function usePacks(runRecordingError: RunRecordingError) {
  const { data: facets } = useTool('list_facets', {});
  const packs = useMemo(() => {
    const facetsByPack = Map.groupBy(facets ?? [], (facet) => facet.pack);
    return [...facetsByPack].map(([id, packFacets]) => ({
      id,
      on: packFacets.some((facet) => facet.enabled),
    }));
  }, [facets]);
  const setPackEnabled = (id: string, enabled: boolean) =>
    runRecordingError(async () => {
      await call('set_enabled', { ids: [id], enabled });
      await queryClient.invalidateQueries({ queryKey: ['list_facets'] });
    });
  return { packs, setPackEnabled };
}
