/**
 * Counting the files under each node of the tag tree in one pass over every file's tag ids. A file
 * with two tags under one node counts once there, which a sum of tag counts would get wrong.
 */
import type { TagNode } from '../types.ts';

/** Every file's tag ids in one flat list: file `f` holds `ids` from `ends[f - 1]` to `ends[f]`. */
export interface FileTagIds {
  ids: number[];
  ends: number[];
}

const COMMA = 44;
const DIGIT_ZERO = 48;

/** Reads comma-joined ids by hand: a split per file costs more than the query on a big index. */
export function parseFileTagIds(rows: string[]): FileTagIds {
  const ids: number[] = [];
  const ends: number[] = [];
  for (const row of rows) {
    let id = 0;
    for (let at = 0; at < row.length; at++) {
      const code = row.charCodeAt(at);
      if (code === COMMA) {
        ids.push(id);
        id = 0;
      } else {
        id = id * 10 + code - DIGIT_ZERO;
      }
    }
    ids.push(id);
    ends.push(ids.length);
  }
  return { ids, ends };
}

/** How many files carry each tag id. */
export function filesPerTag({ ids }: FileTagIds): Map<number, number> {
  const counts = new Map<number, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/** Each tag id's ancestry as positions in one node list, so counting needs no object lookups. */
function ancestryIndexes(ancestries: Map<number, TagNode[]>) {
  const nodes = [...new Set([...ancestries.values()].flat())];
  const positionOf = new Map(nodes.map((node, position) => [node, position]));
  const positions = new Map<number, number[]>();
  for (const [id, ancestry] of ancestries) {
    positions.set(
      id,
      ancestry.map((node) => positionOf.get(node)!),
    );
  }
  return { nodes, positions };
}

/**
 * Sets `total` on every node: the files carrying a tag whose ancestry holds it. `ancestries` maps a
 * tag id to its node and every node above it.
 */
export function countTotals(files: FileTagIds, ancestries: Map<number, TagNode[]>): void {
  const { nodes, positions } = ancestryIndexes(ancestries);
  const totals = new Int32Array(nodes.length);
  const lastCountedFile = new Int32Array(nodes.length).fill(-1);
  let start = 0;
  files.ends.forEach((end, file) => {
    for (let at = start; at < end; at++) {
      for (const node of positions.get(files.ids[at]!) ?? []) {
        if (lastCountedFile[node] === file) continue;
        lastCountedFile[node] = file;
        totals[node]!++;
      }
    }
    start = end;
  });
  nodes.forEach((node, position) => (node.total = totals[position]!));
}
