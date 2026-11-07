/**
 * Tags the chat model suggests for one file. They never reach the file directly: each becomes a
 * review item for a person, and its value proposed vocabulary for its facet.
 */
import { resolveChatModel, resolveModel } from '../../ai/providers.ts';
import { suggest } from '../../ai/suggest.ts';
import { extractFile, isFailed } from '../../extract/index.ts';
import type { ReviewItem, Tag } from '../../types.ts';
import { UserError } from '../config.ts';
import type { Db } from '../db.ts';
import { tagFacet } from '../facets.ts';
import { refusedSuggestions } from '../names.ts';
import { usageRecorder } from '../usage.ts';
import { type Context, emitReviews, servableFile } from './shared.ts';
import { loadOpenFacetIds, valueOfTag } from './vocabulary.ts';

/** Keeps the prompt to a known size, with the most used tags first. */
const VOCABULARY_SHOWN = 500;

/** Asks the chat model for tags for one file. Models are built first, so a missing key refuses. */
async function askChatModelForTags(ctx: Context, fileId: number, path: string): Promise<Tag[]> {
  const { db, config } = ctx;
  const chatModel = await resolveChatModel(config);
  const verifier = await resolveModel(config);
  const extracted = await extractFile(path, config);
  if (isFailed(extracted)) throw new UserError(`${path}: ${extracted.warnings.join('; ')}`);
  const mostUsedTags = db
    .tagCounts()
    .slice(0, VOCABULARY_SHOWN)
    .map((row) => row.tag);
  return suggest(extracted, mostUsedTags, chatModel, {
    openFacets: await loadOpenFacetIds(config),
    retired: refusedSuggestions(db, fileId),
    verifier,
    onUsage: usageRecorder(db, 'suggest', { files: 1 }),
  });
}

/** Files suggested tags as review items, and their values as proposed vocabulary. */
function addSuggestionsForReview(db: Db, fileId: number, tags: Tag[]): void {
  const reason = 'Suggested by the chat model';
  for (const suggested of tags) {
    db.proposeVocabulary(tagFacet(suggested), valueOfTag(suggested));
    db.addReview({ file_id: fileId, kind: 'suggest', tag: suggested, confidence: null, reason });
  }
}

/** Turns the chat model's tags for one file into review items, and returns those items. */
export async function suggestTagsForReview(ctx: Context, fileId: number): Promise<ReviewItem[]> {
  const file = servableFile(ctx, fileId);
  if (!file) throw new UserError(`File ${fileId} is not in a library`);
  const tags = await askChatModelForTags(ctx, fileId, file.path);
  addSuggestionsForReview(ctx.db, fileId, tags);
  emitReviews(ctx);
  return ctx.db.reviewsForFile(fileId).filter((item) => tags.includes(item.tag));
}
