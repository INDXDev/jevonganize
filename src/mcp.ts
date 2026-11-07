/** The MCP server: every `agent: true` tool, over stdio only. See docs/llm-native.md. */
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { UserError } from './core/config.ts';
import { callTool, type Context, tools } from './core/tools.ts';
import type { ToolName } from './tool-map.ts';

/** A tool result as MCP content: the value as JSON text. */
const jsonContent = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value ?? null) }],
  ...(isError && { isError }),
});

/** Tools that send file data to the provider, and so cost money. */
const SPENDING_TOOLS: readonly string[] = ['organize', 'suggest_tags', 'pick_topics'];

function approvalMessage(tool: ToolName, planId: string | undefined): string {
  if (tool === 'apply_plan' || tool === 'undo_plan') {
    const command = tool === 'undo_plan' ? 'undo' : 'apply';
    return `A person must approve this in Jevonganize's Review queue, or with: jevonganize ${command} ${planId}`;
  }
  if (SPENDING_TOOLS.includes(tool)) {
    return `A person must run this in Jevonganize. It sends file data to the provider and costs money.`;
  }
  return `A person must do this in Jevonganize's Review queue.`;
}

/** The refusal a client's model sees. The tool has not run. */
export function needsApproval(tool: ToolName, input: { id?: unknown }) {
  const actsOnPlan = tool === 'apply_plan' || tool === 'undo_plan' || tool === 'discard_plan';
  const planId = actsOnPlan ? String(input.id) : undefined;
  return {
    status: 'needs_approval',
    tool,
    ...(planId !== undefined && { plan_id: planId }),
    message: approvalMessage(tool, planId),
  };
}

/** Runs a tool for the client. A `UserError` is reported to its model; anything else is a bug. */
async function runForClient(name: ToolName, input: unknown, ctx: Context) {
  try {
    return jsonContent(await callTool(name, input as never, ctx));
  } catch (error) {
    if (error instanceof UserError) return jsonContent({ error: error.message }, true);
    throw error;
  }
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
        const needsPerson = 'approval' in tool && !ctx.approved;
        if (needsPerson) return jsonContent(needsApproval(name, input as object));
        return runForClient(name, input, ctx);
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
