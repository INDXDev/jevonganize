import { Chat as ChatState, useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai';
import { Check, ChevronRight, CircleAlert, LoaderCircle, SendHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { chatFetch, useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { Pane } from '../components/pane.tsx';
import { Button } from '../components/ui/button.tsx';
import { Textarea } from '../components/ui/field.tsx';
import { cn, formatCount, keyLabel } from '../lib.ts';
import { activeTab, goTo, useTabs, useWindow } from '../tabs.ts';
import { parseView, toFileQuery } from '../view-query.ts';

// Module scope, so history survives closing the panel. It lives in memory only.
const chat = new ChatState<UIMessage>({
  transport: new DefaultChatTransport({ api: '/api/chat', fetch: chatFetch }),
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
});

type Part = UIMessage['parts'][number];
type ToolPart = Extract<Part, { toolCallId: string }>;

const isTool = (part: Part): part is ToolPart => 'toolCallId' in part;
const toolName = (part: ToolPart) =>
  part.type === 'dynamic-tool' ? part.toolName : part.type.slice('tool-'.length);

function summary(output: unknown): string {
  const o = output as { total?: number; summary?: { files: number } } | null | undefined;
  if (typeof o?.total === 'number') return `${formatCount(o.total)} matches`;
  if (o?.summary) return `${formatCount(o.summary.files)} files`;
  return Array.isArray(output) ? `${output.length} rows` : '';
}

function Approval({ part, respond }: { part: ToolPart; respond: (approved: boolean) => void }) {
  const input = part.input as { id?: string };
  const { data: plan } = useTool('get_plan', { id: input.id ?? '' }, { enabled: !!input.id });
  if (plan && toolName(part) !== 'discard_plan')
    return <Block plan={plan} onApply={() => respond(true)} onDeny={() => respond(false)} />;
  // Tools with no plan to apply, such as resolve_reviews.
  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-surface-2 p-2 text-sm">
      <span className="mr-auto font-mono text-xs">{toolName(part)} needs approval</span>
      <Button variant="ghost" onClick={() => respond(false)}>
        Deny
      </Button>
      <Button variant="primary" onClick={() => respond(true)}>
        Approve
      </Button>
    </div>
  );
}

function ToolLine({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const name = toolName(part);
  const icons: Partial<Record<ToolPart['state'], ReactNode>> = {
    'output-available': <Check className="text-ok" />,
    'output-error': <CircleAlert className="text-destructive" />,
    'output-denied': <X className="text-subtle" />,
  };
  const output = part.state === 'output-available' ? part.output : undefined;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        disabled={output === undefined}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 py-0.5 text-left font-mono text-xs text-muted-foreground hover:text-foreground [&_svg]:size-3"
      >
        {icons[part.state] ?? <LoaderCircle className="spin" />}
        {name}
        <span className="text-subtle">
          {part.state === 'output-denied' ? 'denied' : summary(output)}
        </span>
        {output !== undefined && (
          <ChevronRight className={cn('ml-auto text-subtle', open && 'rotate-90')} />
        )}
      </button>
      {open && (
        <div className="mt-1">
          <ToolResult name={name} output={output} />
        </div>
      )}
    </div>
  );
}

function ToolResult({ name, output }: { name: string; output: unknown }) {
  const plan = output as { id?: string; summary?: object; ops?: unknown };
  if (plan?.summary && plan.ops) return <Block plan={output as never} />;
  return <Block tool={{ name, output }} />;
}

function Message({
  message,
  respond,
}: {
  message: UIMessage;
  respond: (id: string, approved: boolean) => void;
}) {
  const mine = message.role === 'user';
  return (
    <div className="space-y-1.5">
      {mine && <h3 className="label">You</h3>}
      {message.parts.map((part, i) => {
        if (part.type === 'text')
          return (
            <p
              key={i}
              className={cn('text-md whitespace-pre-wrap', !mine && 'text-muted-foreground')}
            >
              {part.text}
            </p>
          );
        if (!isTool(part)) return null;
        if (part.state === 'approval-requested') {
          const { id } = part.approval;
          return <Approval key={i} part={part} respond={(ok) => respond(id, ok)} />;
        }
        return <ToolLine key={i} part={part} />;
      })}
    </div>
  );
}

/** The agent pane: `useChat` against `/api/chat`, with plans as blocks and approval on them. */
export default function ChatPanel() {
  const { messages, sendMessage, status, error, addToolApprovalResponse } = useChat({ chat });
  const { data: server } = useTool('status', {});
  const query = useTabs((s) => activeTab(s).query);
  const title = useTabs((s) => activeTab(s).title);
  const total = useWindow((s) => s.total);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const noKey = server?.has_key === false;
  const busy = status === 'submitted' || status === 'streaming';

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    // Braces matter: Chromium returns a Promise here, and React rejects that from an effect.
    end.current?.scrollIntoView({ block: 'end' });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- new messages are the trigger
  }, [messages]);

  const send = () => {
    if (!text.trim() || busy) return;
    void sendMessage({
      text: text.trim(),
      metadata: { scope: toFileQuery(parseView(query)) },
    });
    setText('');
  };

  return (
    <Pane
      id="chat"
      title="Chat"
      actions={<span className="kbd">{keyLabel('mod+i')}</span>}
      defaultSize="26%"
      minSize={300}
      maxSize="45%"
      empty={
        messages.length
          ? undefined
          : 'Ask about your files, or describe a change. Changes come back as plans for you to apply.'
      }
      footer={
        <div className="space-y-1.5 p-2.5">
          <p className="truncate font-mono text-xs text-subtle">
            Scope: {title}
            {total !== null && ` · ${formatCount(total)} files`}
          </p>
          {noKey ? (
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() => goTo('settings')}
            >
              Add a key in Settings to chat
            </button>
          ) : (
            <div className="relative">
              <Textarea
                ref={input}
                rows={2}
                aria-label="Message"
                placeholder="Ask or describe a change…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  send();
                }}
                className="resize-none pr-8"
              />
              <Button
                variant="ghost"
                icon
                aria-label="Send"
                className="absolute right-1 bottom-1.5 size-6"
                onClick={send}
              >
                <SendHorizontal />
              </Button>
            </div>
          )}
        </div>
      }
    >
      <div className="space-y-4 p-3">
        {messages.map((message) => (
          <Message
            key={message.id}
            message={message}
            respond={(id, approved) => void addToolApprovalResponse({ id, approved })}
          />
        ))}
        {status === 'submitted' && <LoaderCircle className="spin size-3.5 text-subtle" />}
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        <div ref={end} />
      </div>
    </Pane>
  );
}
