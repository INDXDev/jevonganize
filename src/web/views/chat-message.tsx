import { t } from '../i18n/index.ts';
import type { UIMessage } from 'ai';
import { Check, ChevronRight, CircleAlert, LoaderCircle, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { Button } from '../components/ui/button.tsx';
import { cn, formatCount } from '../lib.ts';

type Part = UIMessage['parts'][number];
type ToolPart = Extract<Part, { toolCallId: string }>;

/** Answers an approval request by its id. */
export type Respond = (id: string, approved: boolean) => void;

const isTool = (part: Part): part is ToolPart => 'toolCallId' in part;

/** The tool a part called. Static tools carry the name in their type, as `tool-<name>`. */
const toolName = (part: ToolPart) =>
  part.type === 'dynamic-tool' ? part.toolName : part.type.slice('tool-'.length);

/** A short count for a tool's result: matches, files or rows, or nothing for other shapes. */
function toolSummary(output: unknown): string {
  const result = output as { total?: number; summary?: { files: number } } | null | undefined;
  if (typeof result?.total === 'number')
    return t('{count} matches', { count: formatCount(result.total) });
  if (result?.summary) return t('{count} files', { count: formatCount(result.summary.files) });
  return Array.isArray(output) ? t('{count} rows', { count: output.length }) : '';
}

/** A call waiting for approval: its plan with apply and deny, or plain approve and deny. */
function Approval({ part, respond }: { part: ToolPart; respond: (approved: boolean) => void }) {
  const input = part.input as { id?: string };
  const { data: plan } = useTool('get_plan', { id: input.id ?? '' }, { enabled: !!input.id });
  const name = toolName(part);
  // A discard request gets plain approve and deny, as Apply on its plan would read as applying it.
  if (plan && name !== 'discard_plan')
    return <Block plan={plan} onApply={() => respond(true)} onDeny={() => respond(false)} />;
  // Tools with no plan to apply, such as resolve_reviews.
  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-surface-2 p-2 text-sm">
      <span className="mr-auto font-mono text-xs">
        {t('{tool} needs approval', { tool: name })}
      </span>
      <Button variant="ghost" onClick={() => respond(false)}>
        {t('Deny')}
      </Button>
      <Button variant="primary" onClick={() => respond(true)}>
        {t('Approve')}
      </Button>
    </div>
  );
}

/** A tool's output in full: as a plan when it is one, otherwise as raw tool output. */
function ToolResult({ name, output }: { name: string; output: unknown }) {
  const maybePlan = output as { id?: string; summary?: object; ops?: unknown };
  if (maybePlan?.summary && maybePlan.ops) return <Block plan={output as never} />;
  return <Block tool={{ name, output }} />;
}

const STATE_ICONS: Partial<Record<ToolPart['state'], ReactNode>> = {
  'output-available': <Check className="text-ok" />,
  'output-error': <CircleAlert className="text-destructive" />,
  'output-denied': <X className="text-subtle" />,
};

/** One tool call as a line: its state, name and summary, which opens on the full output. */
function ToolLine({ part }: { part: ToolPart }) {
  const [isOpen, setIsOpen] = useState(false);
  const name = toolName(part);
  const output = part.state === 'output-available' ? part.output : undefined;
  const hasOutput = output !== undefined;
  const summary = part.state === 'output-denied' ? t('Deny') : toolSummary(output);
  return (
    <div>
      <button
        type="button"
        aria-expanded={isOpen}
        disabled={!hasOutput}
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-1.5 py-0.5 text-left font-mono text-xs text-muted-foreground hover:text-foreground [&_svg]:size-3"
      >
        {STATE_ICONS[part.state] ?? <LoaderCircle className="spin" />}
        {name}
        <span className="text-subtle">{summary}</span>
        {hasOutput && <ChevronRight className={cn('ml-auto text-subtle', isOpen && 'rotate-90')} />}
      </button>
      {isOpen && (
        <div className="mt-1">
          <ToolResult name={name} output={output} />
        </div>
      )}
    </div>
  );
}

function MessagePart(props: { part: Part; isMine: boolean; respond: Respond }) {
  const { part, isMine, respond } = props;
  if (part.type === 'text') {
    return (
      <p className={cn('text-md whitespace-pre-wrap', !isMine && 'text-muted-foreground')}>
        {part.text}
      </p>
    );
  }
  if (!isTool(part)) return null;
  if (part.state === 'approval-requested') {
    const approvalId = part.approval.id;
    return <Approval part={part} respond={(approved) => respond(approvalId, approved)} />;
  }
  return <ToolLine part={part} />;
}

/** One message: its text, its tool calls, and any approval it waits for. */
export function Message({ message, respond }: { message: UIMessage; respond: Respond }) {
  const isMine = message.role === 'user';
  return (
    <div className="space-y-1.5">
      {isMine && <h3 className="label">{t('You')}</h3>}
      {message.parts.map((part, index) => (
        <MessagePart key={index} part={part} isMine={isMine} respond={respond} />
      ))}
    </div>
  );
}
