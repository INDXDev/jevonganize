/**
 * The questions a facet puts to the model, as plain data. Each kind asks in its own shape: `flag` one
 * yes-or-no question, `choice` one pick of its labels, `multi` a yes-or-no question per label,
 * `level` a score on its scale, and `date` a year, then a month if it wants one. Every choice offers
 * `other`, so the model is never forced into a wrong label. `facetHash` names exactly these
 * questions, so the answer cache changes only when they do.
 */
import { createHash } from 'node:crypto';
import type { Facet } from '../types.ts';

/** A question as plain data. Its shape matches the SDK's, so `core/` need not import it. */
export type Question =
  | { type: 'boolean'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] };

/** Fixed, because a span that moved with the clock would change `facetHash` each January. */
export const FIRST_YEAR = 1990;
/** The last year a `date` facet offers. */
export const LAST_YEAR = 2039;
/** The escape option every choice offers, so the model is never forced into a wrong label. */
const OTHER = 'None of the other options fits, or the question does not apply.';

/** Choice criteria with these labels and no definitions, plus `other`. */
function bareCriteria(labels: string[]): Record<string, string | null> {
  const options: Record<string, string | null> = {};
  for (const label of labels) options[label] = null;
  return { ...options, other: OTHER };
}

/** Every year from `FIRST_YEAR` to `LAST_YEAR`, as choice criteria. */
function yearCriteria(): Record<string, string | null> {
  const yearCount = LAST_YEAR - FIRST_YEAR + 1;
  const years = Array.from({ length: yearCount }, (_, offset) => String(FIRST_YEAR + offset));
  return bareCriteria(years);
}

/** `01` to `12`, as choice criteria. */
function monthCriteria(): Record<string, string | null> {
  const months = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
  return bareCriteria(months);
}

/** One yes-or-no question per label of a `multi`. */
function multiQuestions(facet: Facet, instructions: string): Record<string, Question> {
  return Object.fromEntries(
    Object.entries(facet.values ?? {}).map(([label, definition]) => [
      `${facet.id}.${label}`,
      { type: 'boolean', instructions: `${instructions}\n${label}: ${definition}` },
    ]),
  );
}

/** A year question, and a month question too when the facet asks for one. */
function dateQuestions(facet: Facet, instructions: string): Record<string, Question> {
  const yearQuestion: Question = {
    type: 'choice',
    instructions: `${instructions} Give the year.`,
    criteria: yearCriteria(),
  };
  if (facet.precision !== 'month') return { [`${facet.id}.year`]: yearQuestion };
  const monthQuestion: Question = {
    type: 'choice',
    instructions: `${instructions} Give the month, as two digits.`,
    criteria: monthCriteria(),
  };
  return { [`${facet.id}.year`]: yearQuestion, [`${facet.id}.month`]: monthQuestion };
}

/** The SDK questions for a facet. `field`, and an open facet with no values, ask nothing. */
export function toQuestions(facet: Facet): Record<string, Question> {
  const instructions = facet.instructions ?? '';
  switch (facet.kind) {
    case 'flag':
      return { [facet.id]: { type: 'boolean', instructions } };
    case 'choice': {
      const criteria = { ...facet.values, other: OTHER };
      return { [facet.id]: { type: 'choice', instructions, criteria } };
    }
    case 'multi':
      return multiQuestions(facet, instructions);
    case 'level':
      return { [facet.id]: { type: 'score', instructions, criteria: facet.levels ?? [] } };
    case 'date':
      return dateQuestions(facet, instructions);
    case 'field':
      break;
  }
  return {};
}

/** Facets are never changed in place: `withVocabulary` makes new ones. */
const facetHashes = new WeakMap<Facet, string>();

/** Hashes exactly what the model sees, so weights, titles and aliases never cost a re-ask. */
export function facetHash(facet: Facet): string {
  const cached = facetHashes.get(facet);
  if (cached !== undefined) return cached;
  const questions = JSON.stringify(toQuestions(facet));
  const hash = createHash('sha256').update(questions).digest('hex');
  facetHashes.set(facet, hash);
  return hash;
}
