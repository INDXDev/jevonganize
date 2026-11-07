import { describe, expect, it } from 'vitest';
import { createScheduler } from '../src/extract/scheduler.ts';

describe('extraction scheduling', () => {
  it('lets previews pass queued extraction, with a background turn after three previews', async () => {
    const schedule = createScheduler(1);
    const gate = Promise.withResolvers<void>();
    const order: string[] = [];
    const running = schedule(() => gate.promise);
    const job = (name: string, foreground = false) =>
      schedule(async () => {
        order.push(name);
      }, foreground);
    const queued = [
      job('background'),
      ...['one', 'two', 'three', 'four'].map((name) => job(name, true)),
    ];
    gate.resolve();
    await Promise.all([running, ...queued]);
    expect(order).toEqual(['one', 'two', 'three', 'background', 'four']);
  });

  it('releases capacity after a failure', async () => {
    const schedule = createScheduler(1);
    const broken = schedule(async () => {
      throw new Error('broken');
    });
    const good = schedule(async () => 'next');
    await expect(broken).rejects.toThrow('broken');
    await expect(good).resolves.toBe('next');
  });
});
