import { t } from '../i18n/index.ts';
import { Chat as ChatState, useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { chatFetch } from '../api.ts';
import { Pane } from '../components/pane.tsx';
import { keyLabel } from '../lib.ts';
import { ChatFooter, useComposer } from './chat-composer.tsx';
import { Message } from './chat-message.tsx';

// Module scope, so history survives closing the panel. It lives in memory only.
const chat = new ChatState<UIMessage>({
  transport: new DefaultChatTransport({ api: '/api/chat', fetch: chatFetch }),
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
});

const EMPTY =
  'Ask about your files, or describe a change. Changes come back as plans for you to apply.';

/** A ref for the end of the list, which scrolls into view whenever a message arrives. */
function useScrollToEnd(messages: UIMessage[]) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Braces matter: Chromium returns a Promise here, and React rejects that from an effect.
    end.current?.scrollIntoView({ block: 'end' });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- new messages are the trigger
  }, [messages]);
  return end;
}

/** The agent pane: `useChat` against `/api/chat`, with plans as blocks and approval on them. */
export default function ChatPanel() {
  const { messages, sendMessage, status, error, addToolApprovalResponse } = useChat({ chat });
  const isBusy = status === 'submitted' || status === 'streaming';
  const composer = useComposer(sendMessage, isBusy);
  const end = useScrollToEnd(messages);
  const respond = (id: string, approved: boolean) => void addToolApprovalResponse({ id, approved });

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
          <Message key={message.id} message={message} respond={respond} />
        ))}
        {status === 'submitted' && <LoaderCircle className="spin size-3.5 text-subtle" />}
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        <div ref={end} />
      </div>
    </Pane>
  );
}
