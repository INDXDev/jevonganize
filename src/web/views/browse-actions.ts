import { t } from '../i18n/index.ts';
import { act } from '../api.ts';
import { notify, setView, useActions, useWindow } from '../tabs.ts';
import type { View } from '../view-query.ts';

/** Whether anything is selected in the list, by ticks or by "select all". */
function hasSelection() {
  const { selection } = useWindow.getState();
  return selection.all || selection.ids.size > 0;
}

/** Esc steps back one level: the selection, then the open file, then the filters. */
function clearOneLevel(view: View) {
  if (hasSelection()) {
    useWindow.setState({ selection: { ids: new Set(), all: false } });
    return;
  }
  if (view.file) {
    setView({ file: null });
    return;
  }
  setView({ tag: [], not: [], mime: null, status: null, text: null, match: null });
}

/** Opens the tag or untag dialog, which needs a selection or an open file to work on. */
function openTagDialog(view: View, overlay: 'tag' | 'untag') {
  if (!view.file && !hasSelection()) {
    notify(t('Select a file first'));
    return;
  }
  useWindow.setState({ overlay });
}

/** The browser's keyboard actions. */
export function useBrowseActions(view: View) {
  useActions({
    switchView: () => setView({ view: view.view === 'grid' ? 'list' : 'grid' }),
    tag: () => openTagDialog(view, 'tag'),
    untag: () => openTagDialog(view, 'untag'),
    matchTags: () => setView({ match: view.match === 'any' ? 'all' : 'any' }),
    reveal: () => view.file && void act('reveal_file', { id: view.file }),
    clear: () => clearOneLevel(view),
  });
}
