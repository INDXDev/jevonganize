/**
 * The shape a facet must have, checked whenever one is read from a preset or a user's file, or is
 * saved. Each kind takes only its own keys. Ids and labels become parts of tags, so they follow
 * the tag grammar, and the limits match what providers accept in a question.
 */
import { z } from 'zod';

/** Providers take at most 255 options in a choice, and `other` is always one of them. */
const MAX_CHOICE_LABELS = 254;
/** Providers take 2 to 10 steps on a score. */
const LEVEL_STEPS = { min: 2, max: 10 };
/** Stricter than a tag: a label is one word of the tag grammar, so it holds no space either. */
const LABEL_FORBIDDEN = /[\p{Cc}\s,;"\\*?]/u;

/** A facet id, which is also the prefix of its tags. */
const facetId = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be lowercase kebab-case')
  .refine((value) => value !== 'flag', '"flag" is reserved');

/** One label of a facet, which becomes the value part of a tag. */
const facetLabel = z
  .string()
  .refine((value) => value !== 'other', '"other" is reserved')
  .refine(
    (value) => !LABEL_FORBIDDEN.test(value) && value.split('/').every(Boolean),
    'breaks the tag grammar',
  );

/** Keys every kind of facet has. */
const commonKeys = {
  id: facetId,
  pack: z.string().min(1),
  title: z.string().min(1),
  applies_to: z.array(z.string()).default([]),
  weight: z.number().nonnegative().default(1),
};

/** Keys of the kinds that put a question to the model. */
const askedKeys = {
  ...commonKeys,
  instructions: z.string().min(1),
  apply_above: z.number().min(0).max(1).optional(),
  profile: z.string().optional(),
};

const aliases = z.record(z.string(), z.string()).optional();
const hasValues = (values: Record<string, string>) => Object.keys(values).length > 0;

/** One facet, with the keys that belong to its kind and no others. */
export const facetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...askedKeys, kind: z.literal('flag') }),
  z.strictObject({
    ...askedKeys,
    kind: z.literal('choice'),
    values: z
      .record(facetLabel, z.string().min(1))
      .refine(hasValues, 'needs values')
      .refine(
        (values) => Object.keys(values).length <= MAX_CHOICE_LABELS,
        `more than ${MAX_CHOICE_LABELS} labels`,
      ),
    aliases,
  }),
  z
    .strictObject({
      ...askedKeys,
      kind: z.literal('multi'),
      values: z.record(facetLabel, z.string().min(1)).default({}),
      open: z.boolean().optional(),
      aliases,
    })
    .refine((facet) => facet.open || hasValues(facet.values), 'needs values unless it is open'),
  z.strictObject({
    ...askedKeys,
    kind: z.literal('level'),
    levels: z.array(facetLabel).min(LEVEL_STEPS.min).max(LEVEL_STEPS.max),
    aliases,
  }),
  z.strictObject({
    ...askedKeys,
    kind: z.literal('date'),
    precision: z.enum(['year', 'month']).default('year'),
  }),
  z.strictObject({
    ...commonKeys,
    kind: z.literal('field'),
    field: z.string().min(1),
    format: z.enum(['year', 'month', 'fiscal-year']).optional(),
  }),
]);

/** A facet file: one pack, holding facets that are checked one by one. */
export const facetFileSchema = z.strictObject({
  pack: facetId,
  title: z.string().min(1),
  facet: z.array(z.record(z.string(), z.unknown())).default([]),
});
