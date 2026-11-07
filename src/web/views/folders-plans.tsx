import { t } from '../i18n/index.ts';
import type { VirtualFolder } from '../../types.ts';
import { act } from '../api.ts';
import { usePlanDialog } from '../components/plan-dialog.tsx';
import { notify } from '../tabs.ts';

/**
 * Adding files to a folder or taking them out. Each stores a plan, as every tag write does, and
 * `dialog` shows the latest one so it can be applied or discarded.
 */
export function useFolderPlans() {
  const plans = usePlanDialog();
  const addFiles = async (folder: VirtualFolder, fileIds: number[]) => {
    if (!fileIds.length) return;
    const plan = await act('add_to_vfolder', { id: folder.id, file_ids: fileIds });
    if (plan) plans.show(plan.id);
  };
  const removeFiles = async (folder: VirtualFolder, fileIds: number[]) => {
    if (!fileIds.length) {
      notify(t('Select a file first'));
      return;
    }
    const plan = await act('remove_from_vfolder', { id: folder.id, file_ids: fileIds });
    if (plan) plans.show(plan.id);
  };
  return { addFiles, removeFiles, dialog: plans.dialog };
}
