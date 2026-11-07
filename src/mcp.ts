/** The MCP server: every `agent: true` tool, over stdio only. See docs/llm-native.md. */
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { UserError } from './core/config.ts';
import { callTool, type Context, tools } from './core/tools.ts';
import type { ToolName } from './types.ts';

const text = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value ?? null) }],
  ...(isError && { isError }),
});

/** The refusal a client's model sees. The tool has not run. */
export function needsApproval(tool: ToolName, input: { id?: unknown }) {
  const runsPlan = tool === 'apply_plan' || tool === 'undo_plan';
  const plan = runsPlan || tool === 'discard_plan' ? String(input.id) : undefined;
  const command = tool === 'undo_plan' ? 'undo' : 'apply';
  const spends = ['organize', 'suggest_tags', 'pick_topics'].includes(tool);
  return {
    status: 'needs_approval',
    tool,
    ...(plan !== undefined && { plan_id: plan }),
    message: runsPlan
      ? `A person must approve this in Jevonganize's Review queue, or with: jevonganize ${command} ${plan}`
      : spends
        ? `A person must run this in Jevonganize. It sends file data to the provider and costs money.`
        : `A person must do this in Jevonganize's Review queue.`,
  };
}

/** Builds the server. With `ctx.approved`, tools marked `approval` run with no person. */
function createMcpServer(ctx: Context, version: string): McpServer {
  const server = new McpServer({ name: 'jevonganize', version });
  for (const [key, tool] of Object.entries(tools)) {
    if (!tool.agent) continue;
    const name = key as ToolName;
    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: tool.input,
        annotations: { readOnlyHint: !tool.writes },
      },
      async (input: unknown) => {
        if ('approval' in tool && !ctx.approved) return text(needsApproval(name, input as object));
        try {
          return text(await callTool(name, input as never, ctx));
        } catch (error) {
          if (error instanceof UserError) return text({ error: error.message }, true);
          throw error;
        }
      },
    );
  }
  return server;
}

/** Serves until the client closes stdin. stdout carries only MCP messages. */
export async function serveMcp(ctx: Context, version: string): Promise<void> {
  const closed = new Promise((done) => {
    process.stdin.once('end', done);
  });
  await createMcpServer(ctx, version).connect(new StdioServerTransport());
  await closed;
}
