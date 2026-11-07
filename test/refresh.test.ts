import { describe, expect, test } from 'vitest';
import { tools } from '../src/core/tools.ts';
import type { ToolName } from '../src/tool-map.ts';
import { JOB_READS, refreshedBy } from '../src/web/refresh.ts';

const isRead = (name: ToolName) => !tools[name].writes;

describe('what a write refreshes', () => {
  test('names only reads', () => {
    for (const name of Object.keys(tools) as ToolName[]) {
      for (const read of refreshedBy(name) ?? [])
        expect([name, read, isRead(read)]).toEqual([name, read, true]);
    }
    expect(JOB_READS.filter((read) => !isRead(read))).toEqual([]);
  });

  test('falls back to everything for a write not listed', () => {
    expect(refreshedBy('add_library')).toBeUndefined();
    expect(refreshedBy('remove_library')).toBeUndefined();
  });

  test.each<[ToolName, ToolName[]]>([
    ['propose_changes', ['list_plans', 'get_plan']],
    ['rename_tag', ['list_plans', 'get_plan']],
    ['discard_plan', ['list_plans', 'get_plan']],
    ['apply_plan', ['status', 'get_plan']],
    ['undo_plan', ['status', 'get_plan']],
    ['resolve_reviews', ['list_reviews', 'status', 'get_file', 'list_plans', 'cleanup_report']],
    ['suggest_tags', ['list_reviews', 'get_file', 'status']],
    ['set_config', ['get_config', 'estimate', 'list_facets']],
    ['set_enabled', ['list_facets', 'estimate']],
    ['save_facet', ['list_facets', 'estimate']],
    ['delete_facet', ['list_facets', 'estimate']],
    ['set_vocabulary', ['list_vocabulary', 'list_facets', 'estimate']],
    ['set_api_key', ['list_keys', 'status', 'doctor']],
    ['remove_api_key', ['list_keys', 'status', 'doctor']],
    ['set_env_keys', ['list_keys', 'status']],
    ['save_vfolder', ['list_vfolders', 'vfolder_files']],
    ['delete_vfolder', ['list_vfolders', 'vfolder_files']],
    ['add_to_vfolder', ['list_plans', 'get_plan']],
    ['remove_from_vfolder', ['list_plans', 'get_plan']],
  ])('%s reaches what shows its effect', (tool, reads) => {
    expect(refreshedBy(tool)).toEqual(expect.arrayContaining(reads));
  });

  test('a job, once over, reaches everything its files show', () => {
    expect(JOB_READS).toEqual(
      expect.arrayContaining(['search_files', 'get_file', 'get_plan', 'list_tags', 'status']),
    );
  });

  test('revealing a file changes nothing', () => {
    expect(refreshedBy('reveal_file')).toEqual([]);
  });
});
