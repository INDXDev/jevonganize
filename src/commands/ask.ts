/** `ask`: one request through the chat model, with the chat panel's tools. */
import { t } from './i18n/index.ts';
import { createInterface } from 'node:readline/promises';
import type { Command } from 'commander';
import type { ChatTools, PendingCall } from '../ai/chat.ts';
import { sanitizeLine } from '../core/sanitize.ts';
import type { Context } from '../core/tools.ts';
import { usageRecorder } from '../core/usage.ts';
import type { Job, Plan } from '../types.ts';
import { askEnvConsent } from './prompts.ts';
import {
  callTool,
  command,
  type JsonFlag,
  note,
  out,
  outJson,
  printPlan,
  withContext,
} from './shared.ts';

type ChatTool = ChatTools<Context>[string];

const isJob = (value: unknown): value is Job =>
  typeof value === 'object' && value !== null && 'kind' in value && 'status' in value;
const isPlan = (value: unknown): value is Plan =>
  typeof value === 'object' && value !== null && 'ops' in value && 'summary' in value;

/** A tool's output in a few words, for the stderr log of calls. */
function describeOutput(output: unknown): string {
  const { total } = (output ?? {}) as { total?: number };
  if (total !== undefined) return t('{count} matches', { count: total });
  return Array.isArray(output) ? t('{count} rows', { count: output.length }) : t('done');
}

function reportCall(name: string, input: unknown, output: unknown, flags: JsonFlag): void {
  if (flags.json) outJson({ type: 'tool', tool: name, input, output });
  else if (isPlan(output)) printPlan(output);
  else note(`${name}: ${describeOutput(output)}`);
}

/** The tool table, reporting each call. A job is waited for, so the model and the exit see its end. */
async function reportingTools(flags: JsonFlag): Promise<ChatTools<Context>> {
  const { tools, waitForJob } = await import('../core/tools.ts');
  const withReport = ([name, entry]: [string, ChatTool]): [string, ChatTool] => {
    const run = async (input: unknown, ctx: Context) => {
      const started = await entry.run(input, ctx);
      const output = isJob(started) ? await waitForJob(started.id) : started;
      reportCall(name, input, output, flags);
      return output;
    };
    return [name, { ...entry, run }];
  };
  return Object.fromEntries(Object.entries(tools as ChatTools<Context>).map(withReport));
}

/** Shows what is about to run, and asks. The default is no. */
async function approveAtPrompt(ctx: Context, call: PendingCall): Promise<boolean> {
  const isApply = call.tool === 'apply_plan';
  const { id } = call.input as { id?: string };
  if (isApply && id) printPlan(await callTool('get_plan', { id }, ctx));
  const question = isApply ? t('Apply? [y/N] ') : t('Run {tool}? [y/N] ', { tool: call.tool });
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await reader.question(question);
  reader.close();
  return /^y(es)?$/i.test(answer.trim());
}

/** Tells a person how to run a call the model was not allowed to make. */
function printNeedsApproval({ tool, input }: PendingCall, flags: JsonFlag): void {
  const { id: planId } = input as { id?: string };
  if (flags.json) return outJson({ type: 'needs_approval', tool, plan_id: planId });
  if (!planId || tool === 'discard_plan') return out(t('{tool} needs a person.', { tool }));
  const id = sanitizeLine(planId);
  if (tool === 'undo_plan') {
    return out(t('Plan {id} needs a person. Run: jevonganize undo {id}', { id }));
  }
  return out(t('Plan {id} needs a person. Run: jevonganize apply {id}', { id }));
}

async function runAsk(request: string, flags: JsonFlag): Promise<void> {
  await withContext(
    flags,
    async (ctx) => {
      await askEnvConsent(ctx.config.chat.name);
      const inTerminal = process.stdin.isTTY && process.stderr.isTTY;
      const approve = inTerminal ? (call: PendingCall) => approveAtPrompt(ctx, call) : undefined;
      const { ask } = await import('../ai/chat.ts');
      const tools = await reportingTools(flags);
      const onUsage = usageRecorder(ctx.db, 'chat');
      const { text, needs_approval } = await ask(request, ctx, tools, { approve, onUsage });
      if (flags.json) outJson({ type: 'text', text });
      else if (text) out(text);
      for (const call of needs_approval) printNeedsApproval(call, flags);
    },
    'chat',
  );
}

/** Adds `ask`. */
export function addAskCommand(program: Command): void {
  command(program, 'ask <request>', t('Run one request through the chat model')).action(runAsk);
}
