/** A scripted chat for the mock. */
import { propose } from './mock-plans.ts';
import { search } from './mock-search.ts';

const sse = (chunks: unknown[]) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        await new Promise((resolve) => setTimeout(resolve, 60));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
  });
};

const say = (id: string, text: string) => [
  { type: 'text-start', id },
  { type: 'text-delta', id, delta: text },
  { type: 'text-end', id },
];

const toolCall = (toolCallId: string, toolName: string, input: unknown) => [
  { type: 'tool-input-available', toolCallId, toolName, input, dynamic: true },
];

/** Stands in for `POST /api/chat`: finds files, proposes a plan, and asks to apply it. */
export const chatFetch: typeof fetch = async (_url, init) => {
  const { messages } = JSON.parse(init?.body as string) as {
    messages: { parts: { type: string; state?: string; approval?: { approved?: boolean } }[] }[];
  };
  const answered = messages.at(-1)?.parts.find((p) => p.approval?.approved !== undefined)
    ?.approval?.approved;
  if (answered !== undefined)
    return sse([
      { type: 'start' },
      { type: 'tool-approval-response', approvalId: 'approval-1', approved: answered },
      ...say(
        't2',
        answered
          ? 'Applied. Undo it from Activity, or with Mod+Z.'
          : 'Left as it was. Nothing was written.',
      ),
      { type: 'finish' },
    ]);
  const made = propose(
    {
      query: { tags: ['doc-type:invoice'] },
      add: ['topic:finance/tax'],
      title: 'Tag invoices for the tax folder',
    },
    'chat',
  );
  const found = search({ tags: ['doc-type:invoice'], limit: 5 });
  return sse([
    { type: 'start' },
    ...toolCall('c1', 'search_files', { tags: ['doc-type:invoice'] }),
    { type: 'tool-output-available', toolCallId: 'c1', output: found, dynamic: true },
    ...toolCall('c2', 'propose_changes', {
      query: { tags: ['doc-type:invoice'] },
      add: ['topic:finance/tax'],
    }),
    { type: 'tool-output-available', toolCallId: 'c2', output: made, dynamic: true },
    ...say('t1', `I found ${found.total} invoices and made a plan. Nothing has changed yet.`),
    ...toolCall('c3', 'apply_plan', { id: made.id }),
    { type: 'tool-approval-request', approvalId: 'approval-1', toolCallId: 'c3' },
    { type: 'finish' },
  ]);
};
