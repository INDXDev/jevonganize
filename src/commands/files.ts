/** Declares the commands over files: scan, organize, plans, tags, search, review. Thin: tools do the work. */
import { t } from './i18n/index.ts';
import type { Command } from 'commander';
import { runSearch, runShow, runSimilar } from './lookup.ts';
import { runOrganize } from './organize.ts';
import { runApply, runPlans, runUndo } from './plans.ts';
import { runReview, runSuggest } from './review.ts';
import { runScan } from './scan.ts';
import { runTagMove, runTagsTree } from './tag-tree.ts';
import { runCleanup, runTagChange, runTagRename, runTagsList } from './tags.ts';
import { command, commaList, queryFlags } from './shared.ts';

function addPlanCommands(program: Command): void {
  command(program, 'scan [path]', t('Update the index. Free and local')).action(runScan);
  command(program, 'organize <path>', t('Classify files and produce a plan'))
    .option('--dry-run', t('Print the estimate and stop'))
    .option('--apply', t('Apply the plan when it is ready'))
    .option('--no-apply', t('Stop at the plan, and write no tags'))
    .option('--facets <ids>', t('Comma-separated facets or packs for this run'), commaList)
    .option('--limit <n>', t('Organize at most this many files'), Number)
    .action(runOrganize);
  command(program, 'plans [id]', t('List plans, or show one'))
    .option('--status <status>', t('proposed, applied, undone or failed'))
    .action(runPlans);
  command(program, 'apply <id>', t('Apply a stored plan')).action(runApply);
  command(program, 'undo <id>', t('Reverse an applied plan')).action(runUndo);
}

function addTagCommands(program: Command): void {
  const tags = program.command('tags').description(t('List and change tags'));
  command(tags, 'list', t('Tags with counts'))
    .option('--folder <path>', t('Only this folder'))
    .option('--facet <id>', t('Only this facet'))
    .action(runTagsList);
  queryFlags(command(tags, 'add <path> <tag...>', t('Plan to add tags')))
    .option('--apply', t('Apply the plan at once'))
    .action(runTagChange('add'));
  queryFlags(command(tags, 'remove <path> <tag...>', t('Plan to remove tags')))
    .option('--apply', t('Apply the plan at once'))
    .action(runTagChange('remove'));
  command(tags, 'rename <from> <to>', t('Plan to rename a tag on every file that has it'))
    .option('--children', t('Rename every tag under it too'))
    .option('--apply', t('Apply the plan at once'))
    .action(runTagRename);
  command(tags, 'tree', t('Tags as a tree, by facet and "/"'))
    .option('--folder <path>', t('Only this folder'))
    .option('--facet <id>', t('Only this facet'))
    .action(runTagsTree);
  command(tags, 'move <tag>', t('Plan to move a tag, and every tag under it'))
    .option('--under <parent>', t('Move it under this tag'))
    .option('--top', t('Move it to the top of its facet'))
    .option('--apply', t('Apply the plan at once'))
    .action(runTagMove);
}

function addLookupAndReviewCommands(program: Command): void {
  queryFlags(command(program, 'search [text]', t('Search by text and file name'))).action(
    runSearch,
  );
  command(program, 'show <file>', t('Show one file')).action(runShow);
  command(program, 'similar <file>', t('List similar files'))
    .option('--limit <n>', t('Files to list'), Number)
    .action(runSimilar);
  command(program, 'review', t('List items waiting for a person, or resolve them'))
    .option('--tag <tag>', t('Only this tag'))
    .option('--limit <n>', t('Items to list'), Number)
    .option('--accept <ids>', t('Accept comma-separated ids, or all'))
    .option('--reject <ids>', t('Reject comma-separated ids, or all'))
    .action(runReview);
  command(program, 'suggest <file>', t('Ask the chat model for candidate tags')).action(runSuggest);
  command(program, 'cleanup', t('Report near-duplicate, one-file and over-broad tags')).action(
    runCleanup,
  );
}

/** Adds the commands of this file, in the order `--help` lists them. */
export function addFileCommands(program: Command): void {
  addPlanCommands(program);
  addTagCommands(program);
  addLookupAndReviewCommands(program);
}
