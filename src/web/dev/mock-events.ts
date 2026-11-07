/** Events of the mock, standing in for the server's stream. */
import type { ServerEvent } from '../../types.ts';

const listeners = new Set<(event: ServerEvent) => void>();

/** Sends an event to every subscriber. */
export const emit = (event: ServerEvent) => listeners.forEach((l) => l(event));

/** Stands in for `/api/events`. */
export function subscribe(listener: (event: ServerEvent) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
