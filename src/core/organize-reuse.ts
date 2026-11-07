/**
 * The shortcut through organize for a file that has not changed: when its extraction would repeat
 * itself and every answer is cached, its last result stands in for reading it, and no model is asked.
 */
import { answerKey, cachedAnswer } from '../ai/decide.ts';
import type { Answer, Facet } from '../types.ts';
import { appliesTo } from './facets.ts';
import type { FileFacts, FileIdentity, PendingRows, Session } from './organize-session.ts';
import { facetsAskedOf } from './organize-setup.ts';

/** A file's last result with the answers its facets have for it. */
export interface ReusedFile {
  facts: FileFacts;
  /** The facets that apply to the file's type. */
  facets: Facet[];
  answers: Answer[];
}

/** The file's last result, if reading it again could only give the same state. */
function lastResult({ db }: Session, identity: FileIdentity): FileFacts | undefined {
  const { id } = identity.row;
  const stored = db.fileById(id);
  const sameExtraction = stored?.extract_key === identity.extract_key;
  if (!sameExtraction || stored.status !== 'organized') return undefined;
  const { hash, state_hash, mime, metadata } = stored;
  if (!hash || !state_hash || !mime || !metadata) return undefined;
  if (db.getContent(id) === undefined) return undefined;
  return { ...identity, hash, state_hash, mime, metadata: JSON.parse(metadata) };
}

/**
 * Every answer these facets have for a state, with the file linked to them, or `undefined` and no
 * links if one is missing.
 */
function cachedAnswers(session: Session, id: number, facets: Facet[], state_hash: string) {
  const { db, models, pending } = session;
  const answers: Answer[] = [];
  const links: PendingRows['links'] = [];
  for (const [profile, model] of models) {
    for (const facet of facetsAskedOf(facets, profile)) {
      const key = answerKey(model, facet, state_hash);
      const cached = cachedAnswer(db, key, facet);
      if (!cached) return undefined;
      answers.push(...cached);
      links.push({ id, facet: facet.id, key });
    }
  }
  pending.links.push(...links);
  return answers;
}

/** The file as it was last organized, linked to its cached answers, or `undefined` to read it. */
export function reuseLastResult(session: Session, identity: FileIdentity): ReusedFile | undefined {
  const facts = lastResult(session, identity);
  if (!facts) return undefined;
  const facets = session.facets.filter((facet) => appliesTo(facet, facts.mime));
  const answers = cachedAnswers(session, facts.row.id, facets, facts.state_hash);
  if (!answers) return undefined;
  return { facts, facets, answers };
}
