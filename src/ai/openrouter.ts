/** A decision model over OpenRouter's alpha endpoint, whose shape may change. */
import type { TypeSafeAiProvider } from '@ai-sdk/typesafe-ai';
import { APICallError } from 'ai';
import { z } from 'zod';

type DecisionModel = ReturnType<TypeSafeAiProvider['decisionModel']>;
type CallOptions = Parameters<DecisionModel['doDecide']>[0];

const BASE_URL = 'https://openrouter.ai/api';

const distribution = z.record(z.string(), z.number()).optional();

const responseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  answers: z.record(
    z.string(),
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('noul'), noul: z.number() }),
      z.object({ type: z.literal('choice'), choice: z.string(), probabilities: distribution }),
      z.object({ type: z.literal('score'), score: z.number(), probabilities: distribution }),
      z.object({ type: z.literal('refusal') }),
    ]),
  ),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cost: z.number().optional(),
    })
    .optional(),
});

function wireState(state: CallOptions['state']): unknown[] {
  return state.map((part) => {
    if (part.type === 'text') return part.text;
    if (part.type === 'json') return JSON.stringify(part.value);
    if (part.data.type !== 'data') throw new Error('OpenRouter takes inline images only.');
    const { data } = part.data;
    const base64 = typeof data === 'string' ? data : Buffer.from(data).toString('base64');
    return { type: 'image_url', image_url: { url: `data:${part.mediaType};base64,${base64}` } };
  });
}

function wireQuestion(question: CallOptions['questions'][string]): unknown {
  if (question.type !== 'boolean') return question;
  // The reference requires both criteria, though its own guide's sample omits them.
  const { instructions, criteria } = question;
  const both = { true: criteria?.true ?? 'True.', false: criteria?.false ?? 'False.' };
  return { type: 'noul', instructions, criteria: both };
}

/** The error for a refused request. A 402 from the in-flight budget is marked as worth a retry. */
async function requestError(response: Response, url: string): Promise<APICallError> {
  const responseBody = await response.text();
  const transient = responseBody.includes('openrouter_in_flight_budget');
  return new APICallError({
    message: `OpenRouter returned HTTP ${response.status}`,
    url,
    requestBodyValues: {}, // the real body holds file content, which must not reach a log
    statusCode: response.status,
    responseBody,
    ...(transient && { isRetryable: true }),
  });
}

/** Builds the model. A 402 from the in-flight budget is transient, so the SDK retries it. */
export function openRouterModel(
  apiKey: string,
  modelId: string,
  baseURL = BASE_URL,
): DecisionModel {
  const url = `${baseURL}/alpha/decisions`;
  return {
    specificationVersion: 'v4',
    provider: 'openrouter',
    modelId,
    supportedQuestionTypes: ['choice', 'score', 'boolean'],
    async doDecide({ state, questions, abortSignal, headers }) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          state: wireState(state),
          questions: Object.fromEntries(
            Object.entries(questions).map(([id, question]) => [id, wireQuestion(question)]),
          ),
        }),
        signal: abortSignal,
      });
      if (!response.ok) throw await requestError(response, url);
      const body = responseSchema.parse(await response.json());
      return {
        answers: Object.fromEntries(
          Object.entries(body.answers).map(([id, answer]) => [
            id,
            answer.type === 'noul' ? { type: 'boolean', probability: answer.noul } : answer,
          ]),
        ),
        rounding: { probabilityDecimals: 4, scoreDecimals: 4 },
        usage: {
          inputTokens: body.usage?.input_tokens,
          outputTokens: body.usage?.output_tokens,
        },
        warnings: [],
        providerMetadata:
          body.usage?.cost === undefined ? undefined : { openrouter: { cost: body.usage.cost } },
        response: { id: body.id, modelId: body.model },
      };
    },
  };
}
