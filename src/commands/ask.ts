/** `ask`: one request through the chat model, with the chat panel's tools. */
import { createInterface } from 'node:readline/promises';
import type { Command } from 'commander';
import { ask, type ChatTools, type PendingCall } from '../ai/chat.ts';
import { sanitizeLine } from '../core/sanitize.ts';
import { callTool, type Context, tools, waitForJob } from '../core/tools.ts';
import type { Job, Plan } from '../types.ts';
import { askEnvConsent } from './settings.ts';
import { command, type JsonFlag, note, out, outJson, printPlan, withContext } from './shared.ts';

const isJob = (value: unknown): value is Job =>
  typeof value === 'object' && value !== null && 'kind' in value && 'status' in value;
const isPlan = (value: unknown): value is Plan =>
  typeof value === 'object' && value !== null && 'ops' in value && 'summary' in value;

function describe(output: unknown): string {
  const { total } = (output ?? {}) as { total?: number };
  if (total !== undefined) return `${total} matches`;
  return Array.isArray(output) ? `${output.length} rows` : 'done';
}

/** The table, reporting each call. A job is waited for, so the model and the exit see its end. */
function reporting(flags: JsonFlag): ChatTools<Context> {
  const wrap = ([name, entry]: [string, ChatTools<Context>[string]]) => {
    const run = async (input: unknown, ctx: Context) => {
      const started = await entry.run(input, ctx);
      const output = isJob(started) ? await waitForJob(started.id) : started;
      if (flags.json) outJson({ type: 'tool', tool: name, input, output });
      else if (isPlan(output)) printPlan(output);
      else note(`${name}: ${describe(output)}`);
      return output;
    };
    return [name, { ...entry, run }];
  };
  return Object.fromEntries(Object.entries(tools as ChatTools<Context>).map(wrap));
}

/** Shows what is about to run, and asks. The default is no. */
async function approveAtPrompt(ctx: Context, call: PendingCall): Promise<boolean> {
  const { id } = call.input as { id?: string };
  if (call.tool === 'apply_plan' && id) printPlan(await callTool('get_plan', { id }, ctx));
  const question = call.tool === 'apply_plan' ? 'Apply? [y/N] ' : `Run ${call.tool}? [y/N] `;
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await reader.question(question);
  reader.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function runAsk(request: string, flags: JsonFlag) {
  await withContext(
    flags,
    async (ctx) => {
      await askEnvConsent(ctx.config.chat.name);
      const terminal = process.stdin.isTTY && process.stderr.isTTY;
      const approve = terminal ? (call: PendingCall) => approveAtPrompt(ctx, call) : undefined;
      const { text, needs_approval } = await ask(request, ctx, reporting(flags), approve);
      if (flags.json) outJson({ type: 'text', text });
      else if (text) out(text);
      for (const { tool, input } of needs_approval) {
        const { id: plan_id } = input as { id?: string };
        if (flags.json) outJson({ type: 'needs_approval', tool, plan_id });
        else if (plan_id && tool !== 'discard_plan')
          out(
            `Plan ${sanitizeLine(plan_id)} needs a person. Run: jevonganize apply ${sanitizeLine(plan_id)}`,
          );
        else out(`${tool} needs a person.`);
      }
    },
    'chat',
  );
}

/** Adds `ask`. */
export function addAskCommand(program: Command): void {
  command(program, 'ask <request>', 'Run one request through the chat model').action(runAsk);
}
