import { t } from '../i18n/index.ts';
import { SendHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTool, viewOptions } from '../api.ts';
import { Button } from '../components/ui/button.tsx';
import { Textarea } from '../components/ui/field.tsx';
import { formatCount } from '../lib.ts';
import { activeTab, goTo, useTabs, useWindow } from '../tabs.ts';
import { parseView, titleOf } from '../view-query.ts';
import { scopeNow } from '../vfolder-query.ts';

/** Sends one user message, with the tab's scope as metadata so the agent knows which files. */
type SendMessage = (message: { text: string; metadata: unknown }) => Promise<void>;

/** The message being typed, and sending it with the active tab's scope. */
export function useComposer(sendMessage: SendMessage, isBusy: boolean) {
  const query = useTabs((s) => activeTab(s).query);
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => input.current?.focus(), []);

  const send = () => {
    const message = text.trim();
    if (!message || isBusy) return;
    const scope = scopeNow(parseView(query), viewOptions());
    void sendMessage({ text: message, metadata: { scope } });
    setText('');
  };
  return { text, setText, input, send };
}

type ComposerState = ReturnType<typeof useComposer>;

function Composer({ text, setText, input, send }: ComposerState) {
  // Enter sends; Shift+Enter breaks the line, and Enter while an IME composes confirms the word.
  const sendOnEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send();
  };
  return (
    <div className="relative">
      <Textarea
        ref={input}
        rows={2}
        aria-label={t('Message')}
        placeholder={t('Ask or describe a change…')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={sendOnEnter}
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

/** Under the messages: the scope a message carries, then the composer, or the way to add a key. */
export function ChatFooter({ composer }: { composer: ComposerState }) {
  const { data: serverStatus } = useTool('status', {});
  const query = useTabs((s) => activeTab(s).query);
  const total = useWindow((s) => s.total);
  const hasNoKey = serverStatus?.has_key === false;
  const fileCount = total === null ? '' : ` · ${t('{count} files', { count: formatCount(total) })}`;
  return (
    <div className="space-y-1.5 p-2.5">
      <p className="truncate font-mono text-xs text-subtle">
        {t('Scope: {title}', { title: titleOf(query) })}
        {fileCount}
      </p>
      {hasNoKey ? (
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
