/**
 * Proper names, read as part of every organize run: a decision model finds the files that hold
 * them, and a light chat model reads those files out. The names become tags with no review, by the
 * owner's choice, but only names the file really contains, and through a plan that can be undone.
 */
import { type ResolvedChatModel, resolveChatModel } from '../ai/providers.ts';
import type { Answer } from '../types.ts';
import { type Config, UserError } from './config.ts';
import type { Db } from './db.ts';

/** The flag facet that decides which files are worth reading for names. It never becomes a tag. */
export const NAME_GATE = 'has-proper-names';
const GATE_ABOVE = 0.5;

/** Tags a model must not offer for a file. */
export function refusedSuggestions(db: Db, id: number): string[] {
  const retired = db
    .listVocabulary()
    .filter((entry) => entry.state === 'retired')
    .map((entry) => `${entry.facet}:${entry.value}`);
  return [...retired, ...db.rejectedTags(id)];
}

/** The model that reads names. Without its key a run goes on and reads none. */
export async function nameReader(config: Config): Promise<ResolvedChatModel | undefined> {
  return resolveChatModel(config, 'ner').catch((error: unknown) => {
    if (error instanceof UserError) return undefined;
    throw error;
  });
}

/** True when the gate says this file holds names. A chat model's answer has no number. */
export function holdsNames(answers: Answer[]): boolean {
  const gate = answers.find((answer) => answer.facet === NAME_GATE);
  return gate?.value === 'yes' && (gate.confidence ?? 1) >= GATE_ABOVE;
}
