import { describe, expect, it } from 'vitest';
import {
  canFollow,
  modelOf,
  modelProblems,
  providersFor,
  sameModel,
  visibleFields,
} from '../src/web/views/settings-models.ts';

describe('AI model fields', () => {
  it('shows the endpoint only where needed or already set, and the account only for Cloudflare', () => {
    expect(visibleFields({ name: 'openai' })).toEqual({ endpoint: false, account: false });
    expect(visibleFields({ name: 'chat' })).toEqual({ endpoint: true, account: false });
    expect(visibleFields({ name: 'compatible' }).endpoint).toBe(true);
    expect(visibleFields({ name: 'cloudflare' })).toEqual({ endpoint: false, account: true });
    // A stale address on a provider that would use it must stay in sight.
    expect(visibleFields({ name: 'openai', base_url: 'http://x' }).endpoint).toBe(true);
  });

  it('marks what a provider needs, and refuses an address that is not http', () => {
    expect(modelProblems({ name: 'openai' }, 'decision')).toEqual({});
    expect(modelProblems({ name: 'chat' }, 'chat')).toEqual({
      model: 'Required for this provider.',
      base_url: 'Required for this provider.',
    });
    expect(
      modelProblems({ name: 'chat', model: 'llama3.1', base_url: 'file:///etc' }, 'chat').base_url,
    ).toMatch(/http/);
    expect(modelProblems({ name: 'cloudflare' }, 'decision')).toEqual({
      account_id: 'Required for this provider.',
    });
    expect(modelProblems({ name: 'openrouter', model: ' ' }, 'decision').model).toBeDefined();
  });

  it('keeps decision-only providers out of the chat and name-reading jobs', () => {
    expect(providersFor('decision')).toHaveLength(7);
    expect(providersFor('chat')).toEqual(['openai', 'gateway', 'openrouter', 'chat']);
    expect(modelProblems({ name: 'typesafe' }, 'ner').name).toBeDefined();
    expect(canFollow({ name: 'typesafe' })).toBe(false);
    expect(canFollow({ name: 'openai' })).toBe(true);
  });

  it('counts two tables as the same model after defaults, ignoring keys the provider ignores', () => {
    expect(sameModel({ name: 'openai' }, { name: 'openai', model: 'gpt-6-luna' })).toBe(true);
    expect(sameModel({ name: 'openai' }, { name: 'openai', model: 'gpt-5.4-mini' })).toBe(false);
    expect(sameModel({ name: 'openai', account_id: 'old' }, { name: 'openai' })).toBe(true);
    expect(sameModel({ name: 'openai', base_url: 'http://x' }, { name: 'openai' })).toBe(false);
  });

  it('copies only the four model keys', () => {
    expect(modelOf({ name: 'chat', model: 'm', extra: 1, base_url: 2 })).toEqual({
      name: 'chat',
      model: 'm',
    });
    expect(modelOf(undefined)).toEqual({ name: 'openai' });
  });
});
