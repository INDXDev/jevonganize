/**
 * The first stage from a model's reply to tags: checking it. `fromAnswers` turns a raw reply into
 * `Answer` rows, which are what the cache keeps, and `validAnswer` checks a cached row again before
 * it is used. Either way a value is only ever a label the facet defines: a model's text is never a
 * tag. The second stage, thresholds, is in answer-tags.ts.
 */
import type { Answer, Facet } from '../types.ts';
import { FIRST_YEAR, LAST_YEAR } from './facet-questions.ts';

/** An answer as the SDK returns it. */
export type RawAnswer =
  | { type: 'boolean'; probability: number }
  | { type: 'choice'; choice: string; probabilities?: Record<string, number> }
  | { type: 'score'; score: number; probabilities?: Record<string, number> }
  | { type: 'refusal' };

/** A model's raw answers to one request. */
export type RawAnswers = Record<string, RawAnswer>;

/** The step of a `level` meaning "does not apply". Like `other`, it writes no tag. */
const NO_LEVEL = 'none';
/** A `date` answer as stored: `2024` or `2024-03`. */
const STORED_DATE = /^\d{4}(-\d{2})?$/;
/** A month as the model picks it: `01` to `12`. */
const MONTH = /^(0[1-9]|1[0-2])$/;

/** Whether a stored answer could have come from this facet as it stands. See docs/security.md. */
export function validAnswer(facet: Facet, answer: Answer): boolean {
  const { value, confidence } = answer;
  if (answer.facet !== facet.id) return false;
  const confidenceInRange = confidence === null || (confidence >= 0 && confidence <= 1);
  if (!confidenceInRange) return false;
  if (value === null) return true;
  if (facet.kind === 'flag') return value === 'yes';
  if (facet.kind === 'level') return facet.levels?.includes(value) ?? false;
  if (facet.kind === 'date') return STORED_DATE.test(value);
  return facet.kind !== 'field' && Object.hasOwn(facet.values ?? {}, value);
}

/** An answer the model gave, before any threshold. */
const modelAnswer = (facet: Facet, value: string | null, confidence: number | null): Answer => ({
  facet: facet.id,
  value,
  confidence,
  estimated: false,
  refused: false,
});

/** A reply missing or of the wrong type counts as a refusal, which says nothing about a tag. */
const refusedAnswer = (facet: Facet): Answer => ({
  ...modelAnswer(facet, null, null),
  refused: true,
});

type ChoiceReply = Extract<RawAnswer, { type: 'choice' }>;

const choiceConfidence = ({ choice, probabilities }: ChoiceReply) =>
  probabilities?.[choice] ?? null;

/** A `flag` asks one yes-or-no question, so its confidence is P(yes). */
function flagAnswer(facet: Facet, reply: RawAnswer | undefined): Answer {
  if (reply?.type !== 'boolean') return refusedAnswer(facet);
  return modelAnswer(facet, 'yes', reply.probability);
}

/** A `choice` picks one label. A label the facet does not define becomes no value. */
function choiceAnswer(facet: Facet, reply: RawAnswer | undefined): Answer {
  if (reply?.type !== 'choice') return refusedAnswer(facet);
  const isDefinedLabel = Object.hasOwn(facet.values ?? {}, reply.choice);
  return modelAnswer(facet, isDefinedLabel ? reply.choice : null, choiceConfidence(reply));
}

/** A `multi` asks one yes-or-no question per label, under `<facet>.<label>`. */
function multiAnswers(facet: Facet, replies: RawAnswers): Answer[] {
  return Object.keys(facet.values ?? {}).map((label) => {
    const reply = replies[`${facet.id}.${label}`];
    if (reply?.type !== 'boolean') return refusedAnswer(facet);
    return modelAnswer(facet, label, reply.probability);
  });
}

/** A `level` scores an index into its levels, clamped to the scale. */
function levelAnswer(facet: Facet, reply: RawAnswer | undefined): Answer {
  if (reply?.type !== 'score') return refusedAnswer(facet);
  const levels = facet.levels ?? [];
  const lastIndex = levels.length - 1;
  const index = Math.min(Math.max(Math.round(reply.score), 0), lastIndex);
  const level = levels[index] ?? null;
  const confidence = reply.probabilities?.[index] ?? null;
  return modelAnswer(facet, level === NO_LEVEL ? null : level, confidence);
}

/**
 * A `date` picks a year under `<facet>.year`, and a month under `<facet>.month` if it asks for one.
 * A year outside the offered range is no value, and a missing month leaves the year alone.
 */
function dateAnswer(facet: Facet, replies: RawAnswers): Answer {
  const year = replies[`${facet.id}.year`];
  if (year?.type !== 'choice') return refusedAnswer(facet);
  const yearConfidence = choiceConfidence(year);
  const yearNumber = Number(year.choice);
  const yearOffered = yearNumber >= FIRST_YEAR && yearNumber <= LAST_YEAR;
  if (!yearOffered) return modelAnswer(facet, null, yearConfidence);

  const month = replies[`${facet.id}.month`];
  if (month?.type !== 'choice' || !MONTH.test(month.choice)) {
    return modelAnswer(facet, year.choice, yearConfidence);
  }
  const monthConfidence = choiceConfidence(month);
  const bothKnown = yearConfidence !== null && monthConfidence !== null;
  const confidence = bothKnown ? Math.min(yearConfidence, monthConfidence) : null;
  return modelAnswer(facet, `${year.choice}-${month.choice}`, confidence);
}

/** Turns a model's raw replies into `Answer` rows for one facet, one per label for `multi`. */
export function fromAnswers(facet: Facet, raw: RawAnswers): Answer[] {
  const reply = raw[facet.id];
  switch (facet.kind) {
    case 'flag':
      return [flagAnswer(facet, reply)];
    case 'choice':
      return [choiceAnswer(facet, reply)];
    case 'multi':
      return multiAnswers(facet, raw);
    case 'level':
      return [levelAnswer(facet, reply)];
    case 'date':
      return [dateAnswer(facet, raw)];
    case 'field':
      break;
  }
  // A `field` copies metadata and asks the model nothing.
  return [];
}
