/** The one block component: plans, jobs and tool results all show through it. */
import type { Job, Plan } from '../../types.ts';
import { JobBlock } from './block-job.tsx';
import { PlanBlock, type Approval } from './block-plan.tsx';
import { BlockShell } from './block-shell.tsx';

type ToolResult = { name: string; output: unknown };

/** The output is cut here: a block is a summary of a result, not a viewer for it. */
const MAX_OUTPUT_CHARS = 1200;

function ToolBlock({ tool }: { tool: ToolResult }) {
  const text = JSON.stringify(tool.output, null, 1) ?? '';
  const shown = text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}…` : text;
  return (
    <BlockShell tone="ok" title={tool.name}>
      <pre className="max-h-40 overflow-hidden font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
        {shown}
      </pre>
    </BlockShell>
  );
}

type Props =
  | ({ plan: Plan; job?: never; tool?: never } & Approval)
  | ({ job: Job; plan?: never; tool?: never } & Approval)
  | ({ tool: ToolResult; plan?: never; job?: never } & Approval);

/** The only way to show a plan, a job or a tool result. */
export function Block({ plan, job, tool, ...approval }: Props) {
  if (plan) return <PlanBlock plan={plan} {...approval} />;
  if (job) return <JobBlock job={job} />;
  return <ToolBlock tool={tool} />;
}
