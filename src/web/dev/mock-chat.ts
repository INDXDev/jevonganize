/** A scripted chat for the mock, speaking the AI SDK's UI message stream. */
import { propose } from './mock-plans.ts';
import { searchFiles } from './mock-search.ts';

/** The pause between chunks, so the reply visibly streams. */
const CHUNK_DELAY_MS = 60;
const APPROVAL_ID = 'approval-1';
const INVOICES = { tags: ['doc-type:invoice'] };

/** A response that streams `chunks` as server-sent events, then the stream's end marker. */
function eventStream(chunks: unknown[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
  });
}

/** The chunks of one text part, sent whole. */
const textChunks = (partId: string, text: string) => [
  { type: 'text-start', id: partId },
  { type: 'text-delta', id: partId, delta: text },
  { type: 'text-end', id: partId },
];

const toolCallChunk = (toolCallId: string, toolName: string, input: unknown) => ({
  type: 'tool-input-available',
  toolCallId,
  toolName,
  input,
  dynamic: true,
});

const toolOutputChunk = (toolCallId: string, output: unknown) => ({
  type: 'tool-output-available',
  toolCallId,
  output,
  dynamic: true,
});

type ChatRequest = {
  messages: { parts: { type: string; state?: string; approval?: { approved?: boolean } }[] }[];
};

/** The person's answer to the approval request, once the last message carries one. */
function approvalAnswer({ messages }: ChatRequest) {
  const answeredPart = messages.at(-1)?.parts.find((part) => part.approval?.approved !== undefined);
  return answeredPart?.approval?.approved;
}

/** The second turn: the person approved or denied the plan. */
function answerReply(approved: boolean) {
  const text = approved
    ? 'Applied. Undo it from Activity, or with Mod+Z.'
    : 'Left as it was. Nothing was written.';
  return eventStream([
    { type: 'start' },
    { type: 'tool-approval-response', approvalId: APPROVAL_ID, approved },
    ...textChunks('t2', text),
    { type: 'finish' },
  ]);
}

/** The first turn: find the invoices, propose a plan, and ask to apply it. */
function proposalReply() {
  const change = { query: INVOICES, add: ['topic:finance/tax'] };
  const plan = propose({ ...change, title: 'Tag invoices for the tax folder' }, 'chat');
  const found = searchFiles({ ...INVOICES, limit: 5 });
  return eventStream([
    { type: 'start' },
    toolCallChunk('c1', 'search_files', INVOICES),
    toolOutputChunk('c1', found),
    toolCallChunk('c2', 'propose_changes', change),
    toolOutputChunk('c2', plan),
    ...textChunks(
      't1',
      `I found ${found.total} invoices and made a plan. Nothing has changed yet.`,
    ),
    toolCallChunk('c3', 'apply_plan', { id: plan.id }),
    { type: 'tool-approval-request', approvalId: APPROVAL_ID, toolCallId: 'c3' },
    { type: 'finish' },
  ]);
}

/** Stands in for `POST /api/chat`: finds files, proposes a plan, and asks to apply it. */
export const chatFetch: typeof fetch = async (_url, init) => {
  const request = JSON.parse(init?.body as string) as ChatRequest;
  const approved = approvalAnswer(request);
  return approved === undefined ? proposalReply() : answerReply(approved);
};
