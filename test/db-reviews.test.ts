import { describe, expect, it } from 'vitest';
import { addFile, db, item, setupMemoryDb } from './db-helpers.ts';

setupMemoryDb();

describe('reviews', () => {
  it('lists open items by tag, then confidence, nulls last', () => {
    const id = addFile('/a');
    const other = addFile('/b');
    const third = addFile('/c');
    db.addReview(item(id, 'b'));
    db.addReview(item(id, 'a', 0.5));
    db.addReview(item(other, 'a', 0.7));
    db.addReview(item(third, 'a', null));
    expect(db.listReviews().map((row) => [row.tag, row.confidence])).toEqual([
      ['a', 0.7],
      ['a', 0.5],
      ['a', null],
      ['b', 0.6],
    ]);
    expect(db.listReviews({ tag: 'b' })).toHaveLength(1);
    expect(db.listReviews({ limit: 2 })).toHaveLength(2);
    expect(db.stats().reviews).toBe(4);
  });

  it('a rejected suggestion stays as a tombstone, and a cached answer cannot revive it', () => {
    const id = addFile('/a');
    expect(db.addReview(item(id, 't'))).toBe(true);
    const [row] = db.listReviews();
    db.resolveReviews([row!.id], 'rejected');
    expect(db.listReviews()).toEqual([]);
    expect(db.rejectedTags(id)).toEqual(['t']);
    expect(db.addReview(item(id, 't'))).toBe(false);
    expect(db.listReviews()).toEqual([]);
  });

  it('a rejected restore item is deleted', () => {
    const id = addFile('/a');
    db.addReview({ ...item(id, 't'), kind: 'restore' });
    db.resolveReviews([db.listReviews()[0]!.id], 'rejected');
    expect(db.rejectedTags(id)).toEqual([]);
    expect(db.addReview({ ...item(id, 't'), kind: 'restore' })).toBe(true);
  });

  it('an accepted restore item goes too, so a second loss can raise one again', () => {
    const id = addFile('/a');
    db.addReview({ ...item(id, 't'), kind: 'restore' });
    db.resolveReviews([db.listReviews()[0]!.id], 'accepted');
    expect(db.addReview({ ...item(id, 't'), kind: 'restore' })).toBe(true);
    expect(db.listReviews()).toHaveLength(1);
  });
});

describe('closing reviews', () => {
  it('accepting closes the item, and reviewsByIds still finds it', () => {
    const id = addFile('/a');
    db.addReview(item(id, 't'));
    const { id: review } = db.listReviews()[0]!;
    db.resolveReviews([review], 'accepted');
    expect(db.listReviews()).toEqual([]);
    expect(db.reviewsByIds([review, 999]).map((row) => row.tag)).toEqual(['t']);
    expect(db.rejectedTags(id)).toEqual([]);
  });

  it('rejectTag closes an open suggestion too', () => {
    const id = addFile('/a');
    db.addReview(item(id, 't'));
    db.rejectTag(id, 't', 'Removed by a person');
    db.rejectTag(id, 'u', 'Removed by a person');
    expect(db.reviewsForFile(id)).toEqual([]);
    expect(db.rejectedTags(id)).toEqual(['t', 'u']);
  });

  it('drops restore items whose tag is back, and only those', () => {
    const id = addFile('/a');
    db.addReview({ ...item(id, 'back'), kind: 'restore' });
    db.addReview({ ...item(id, 'lost'), kind: 'restore' });
    db.addReview(item(id, 'back'));
    db.dropRestored(id, ['back']);
    expect(db.reviewsForFile(id).map((row) => [row.kind, row.tag])).toEqual([
      ['suggest', 'back'],
      ['restore', 'lost'],
    ]);
  });
});
