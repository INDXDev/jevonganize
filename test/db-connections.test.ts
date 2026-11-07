import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/core/db.ts';
import { useTempHome } from './helpers.ts';
const home = useTempHome();

describe('derived data across connections', () => {
  it('invalidates search totals and similarity after another connection commits', () => {
    const path = join(home(), 'index.db'),
      reader = openDb(path),
      writer = openDb(path);
    try {
      expect(reader.searchFiles({}).total).toBe(0);
      expect(reader.refreshIdf()).toBe(true);
      const id = writer.upsertFile(
        { path: '/synthetic/a', dev: '1', ino: '1', size: 1, mtime_ns: '1', ctime_ns: '1' },
        { edited: false },
      );
      writer.addFileTags(id, ['topic:x'], false);
      expect(reader.searchFiles({}).total).toBe(1);
      expect(reader.refreshIdf()).toBe(true);
      expect(writer.fileById(id)!.tag_w).toBeGreaterThan(0);
      expect(writer.refreshIdf()).toBe(false);
      writer.deleteFile(id);
      expect(reader.searchFiles({}).total).toBe(0);
      expect(reader.refreshIdf()).toBe(true);
    } finally {
      writer.close();
      reader.close();
    }
  });
});
