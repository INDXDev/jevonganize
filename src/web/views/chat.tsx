import { t } from '../i18n/index.ts';
import { Chat as ChatState, useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai';
import { Check, ChevronRight, CircleAlert, LoaderCircle, SendHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { chatFetch, useTool, viewOptions } from '../api.ts';
import { Block } from '../components/block.tsx';
import { Pane } from '../components/pane.tsx';
import { Button } from '../components/ui/button.tsx';
import { Textarea } from '../components/ui/field.tsx';
import { cn, formatCount, keyLabel } from '../lib.ts';
import { activeTab, goTo, useTabs, useWindow } from '../tabs.ts';
import { parseView, titleOf } from '../view-query.ts';
import { scopeNow } from '../vfolder-query.ts';

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
  const result = output as { total?: number; summary?: { files: number } } | null | undefined;
  if (typeof result?.total === 'number')
    return t('{count} matches', { count: formatCount(result.total) });
  if (result?.summary) return t('{count} files', { count: formatCount(result.summary.files) });
  return Array.isArray(output) ? t('{count} rows', { count: output.length }) : '';
}

function Approval({ part, respond }: { part: ToolPart; respond: (approved: boolean) => void }) {
  const input = part.input as { id?: string };
  const { data: plan } = useTool('get_plan', { id: input.id ?? '' }, { enabled: !!input.id });
  if (plan && toolName(part) !== 'discard_plan')
    return <Block plan={plan} onApply={() => respond(true)} onDeny={() => respond(false)} />;
  // Tools with no plan to apply, such as resolve_reviews.
  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-surface-2 p-2 text-sm">
      <span className="mr-auto font-mono text-xs">
        {t('{tool} needs approval', { tool: toolName(part) })}
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
          {part.state === 'output-denied' ? t('Deny') : summary(output)}
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

type Respond = (id: string, approved: boolean) => void;

function MessagePart(props: { part: Part; mine: boolean; respond: Respond }) {
  const { part, mine, respond } = props;
  if (part.type === 'text')
    return (
      <p className={cn('text-md whitespace-pre-wrap', !mine && 'text-muted-foreground')}>
        {part.text}
      </p>
    );
  if (!isTool(part)) return null;
  if (part.state === 'approval-requested') {
    const { id } = part.approval;
    return <Approval part={part} respond={(ok) => respond(id, ok)} />;
  }
  return <ToolLine part={part} />;
}

function Message({ message, respond }: { message: UIMessage; respond: Respond }) {
  const mine = message.role === 'user';
  return (
    <div className="space-y-1.5">
      {mine && <h3 className="label">{t('You')}</h3>}
      {message.parts.map((part, i) => (
        <MessagePart key={i} part={part} mine={mine} respond={respond} />
      ))}
    </div>
  );
}

function useComposer(sendMessage: typeof chat.sendMessage, busy: boolean) {
  const query = useTabs((s) => activeTab(s).query);
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => input.current?.focus(), []);

  const send = () => {
    if (!text.trim() || busy) return;
    void sendMessage({
      text: text.trim(),
      metadata: { scope: scopeNow(parseView(query), viewOptions()) },
    });
    setText('');
  };
  return { text, setText, input, send };
}

function useScrollToEnd(messages: UIMessage[]) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Braces matter: Chromium returns a Promise here, and React rejects that from an effect.
    end.current?.scrollIntoView({ block: 'end' });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- new messages are the trigger
  }, [messages]);
  return end;
}

function Composer({ text, setText, input, send }: ReturnType<typeof useComposer>) {
  return (
    <div className="relative">
      <Textarea
        ref={input}
        rows={2}
        aria-label={t('Message')}
        placeholder={t('Ask or describe a change…')}
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
        aria-label={t('Send')}
        className="absolute right-1 bottom-1.5 size-6"
        onClick={send}
      >
        <SendHorizontal />
      </Button>
    </div>
  );
}

function ChatFooter({ composer }: { composer: ReturnType<typeof useComposer> }) {
  const { data: server } = useTool('status', {});
  const query = useTabs((s) => activeTab(s).query);
  const title = titleOf(query);
  const total = useWindow((s) => s.total);
  const noKey = server?.has_key === false;
  return (
    <div className="space-y-1.5 p-2.5">
      <p className="truncate font-mono text-xs text-subtle">
        {t('Scope: {title}', { title })}
        {total !== null && ` · ${t('{count} files', { count: formatCount(total) })}`}
      </p>
      {noKey ? (
        <button
          type="button"
          className="text-sm text-primary hover:underline"
          onClick={() => goTo('settings')}
        >
          {t('Add a key in Settings to chat')}
        </button>
      ) : (
        <Composer {...composer} />
      )}
    </div>
  );
}

const EMPTY =
  'Ask about your files, or describe a change. Changes come back as plans for you to apply.';

/** The agent pane: `useChat` against `/api/chat`, with plans as blocks and approval on them. */
export default function ChatPanel() {
  const { messages, sendMessage, status, error, addToolApprovalResponse } = useChat({ chat });
  const busy = status === 'submitted' || status === 'streaming';
  const composer = useComposer(sendMessage, busy);
  const end = useScrollToEnd(messages);

  return (
    <Pane
      id="chat"
      title={t('Chat')}
      actions={<span className="kbd">{keyLabel('mod+i')}</span>}
      defaultSize="26%"
      minSize={300}
      maxSize="45%"
      empty={messages.length ? undefined : t(EMPTY)}
      footer={<ChatFooter composer={composer} />}
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
