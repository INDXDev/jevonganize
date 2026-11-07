import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/core/db.ts';
import type { Answer } from '../src/types.ts';
import { addFile, db, home, setupMemoryDb } from './db-helpers.ts';

setupMemoryDb();

describe('answers', () => {
  const answer: Answer = {
    facet: 'f',
    value: 'v',
    confidence: 0.9,
    estimated: false,
    refused: false,
  };

  it('lets a new answer replace a stored one, so a corrupt row can heal', () => {
    db.putAnswer('k', 'f', []);
    db.putAnswer('k', 'f', [answer]);
    expect(db.getAnswer('k')).toEqual([answer]);
    expect(db.getAnswer('missing')).toBeUndefined();
  });

  it('links one key per file and facet', () => {
    const id = addFile('/a');
    db.putAnswer('k1', 'f', [answer]);
    db.putAnswer('k2', 'f', [{ ...answer, value: 'w' }]);
    db.linkAnswer(id, 'f', 'k1');
    db.linkAnswer(id, 'f', 'k2');
    expect(db.fileAnswers(id).map((row) => row.value)).toEqual(['w']);
  });

  it('counts a damaged row as a miss', () => {
    const file = join(home(), 'index.db');
    const opened = openDb(file);
    opened.putAnswer('bad', 'f', []);
    const raw = new DatabaseSync(file);
    raw.exec(`UPDATE answer SET body = '{oops'`);
    raw.close();
    expect(opened.getAnswer('bad')).toBeUndefined();
    opened.close();
  });
});
