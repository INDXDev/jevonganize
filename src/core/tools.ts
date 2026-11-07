/** The tool table: every operation, defined once. The CLI, HTTP, chat and MCP all call it. */
import { keepWorkersWarm } from '../extract/index.ts';
import type { ToolMap, ToolName } from '../tool-map.ts';
import { loadConfig, parseWith, UserError } from './config.ts';
import { openDb } from './db.ts';
import { catalogTools } from './tools/catalog.ts';
import { facetTools } from './tools/facets.ts';
import { fileTools } from './tools/files.ts';
import { libraryTools } from './tools/libraries.ts';
import { planTools } from './tools/plans.ts';
import { refreshTools } from './tools/refresh.ts';
import { reportTools } from './tools/reports.ts';
import { reviewTools } from './tools/reviews.ts';
import { settingsTools } from './tools/settings.ts';
import { tagTreeTools } from './tools/tag-tree.ts';
import { vfolderTools } from './tools/vfolders.ts';
import { type Context, isModel, type Tool, type ToolTable } from './tools/shared.ts';

export { waitForJob } from './tools/jobs.ts';
export { type Context, servableFile, thumbnailFile } from './tools/shared.ts';
export { watchLibraries } from './tools/watching.ts';

/** Every operation. `writes`, `agent` and `approval` are the table in docs/contracts.md. */
export const tools: ToolTable = {
  ...libraryTools,
  ...fileTools,
  ...facetTools,
  ...catalogTools,
  ...planTools,
  ...reviewTools,
  ...refreshTools,
  ...settingsTools,
  ...vfolderTools,
  ...reportTools,
  ...tagTreeTools,
};

/** True when `name` is in the table, for input from outside. */
export const isToolName = (name: string): name is ToolName => Object.hasOwn(tools, name);

/**
 * The one way in for everything but chat, whose SDK validates with the same schema and holds
 * approval itself. The checks here are the last line behind each front end's own.
 */
export async function callTool<K extends ToolName>(
  name: K,
  input: ToolMap[K][0],
  ctx: Context,
): Promise<ToolMap[K][1]> {
  const tool = tools[name] as unknown as Tool<unknown, ToolMap[K][1]>;
  if (isModel(ctx) && !tool.agent) throw new UserError(`${name} is not offered to a model`);
  if (isModel(ctx) && tool.approval && !ctx.approved) {
    throw new UserError(`${name} needs a person to approve it`);
  }
  return tool.run(parseWith(tool.input, input, name), ctx);
}

/** Opens what a front end needs. The caller closes `db`. */
export async function openContext(
  caller: Context['caller'],
  emit: Context['emit'] = () => {},
): Promise<Context> {
  if (caller === 'ui') keepWorkersWarm();
  const config = await loadConfig();
  return { db: openDb(), config, caller, emit };
}
