import { describe, expect, test } from 'vitest';
import type { TagNode } from '../src/types.ts';
import { dropParent, fixedReason } from '../src/web/views/tags-drag.ts';

/** A node as `list_tag_tree` returns it, with only what a drop reads filled in. */
const node = (path: string, depth: number, facet: string | null = 'topic', movable = true) =>
  ({
    path,
    depth,
    facet,
    label: path,
    direct: 1,
    total: 1,
    implicit: false,
    movable,
    children: [],
  }) satisfies TagNode;

const root = node('topic:', 0, 'topic', false);
const tax = node('topic:tax', 1);
const finance = node('topic:finance', 1);
const financeTax = node('topic:finance/tax', 2);
const taxVat = node('topic:tax/vat', 2);

describe('dropping a tag in the tree', () => {
  test('onto another tag of its facet asks for that tag as the parent', () => {
    expect(dropParent(tax, finance, false)).toBe('topic:finance');
  });

  test('between rows or on the facet root moves a nested tag to the top, and a top one nowhere', () => {
    expect(dropParent(financeTax, tax, true)).toBeNull();
    expect(dropParent(financeTax, root, false)).toBeNull();
    expect(dropParent(tax, finance, true)).toBeUndefined();
    expect(dropParent(tax, root, false)).toBeUndefined();
  });

  test('onto itself, a tag under it, its parent now or another facet does nothing', () => {
    expect(dropParent(tax, tax, false)).toBeUndefined();
    expect(dropParent(tax, taxVat, false)).toBeUndefined();
    expect(dropParent(financeTax, finance, false)).toBeUndefined();
    expect(dropParent(tax, node('party:acme', 1, 'party'), false)).toBeUndefined();
  });

  test('a name that only starts like the dragged tag is not under it', () => {
    expect(dropParent(tax, node('topic:taxes', 1), false)).toBe('topic:taxes');
  });

  test('only a fixed tag explains why it cannot move', () => {
    expect(fixedReason(node('doc-type:invoice', 1, 'doc-type', false))).toMatch(/closed facet/);
    expect(fixedReason(root)).toBeUndefined();
    expect(fixedReason(tax)).toBeUndefined();
  });
});
