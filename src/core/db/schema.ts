/** The tables, and the migrations that build them. */
import { UserError } from '../config.ts';
import type { Sql } from './connection.ts';
import { fileName } from './paths.ts';

/** Applied in order. `PRAGMA user_version` counts how many have run. */
const MIGRATIONS = [
  `
CREATE TABLE library (path TEXT PRIMARY KEY, scanned_at INTEGER);

CREATE TABLE file (
  id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE,
  dev TEXT, ino TEXT, size INTEGER, mtime_ns TEXT, ctime_ns TEXT,
  hash TEXT, state_hash TEXT, mime TEXT, metadata TEXT,
  status TEXT NOT NULL DEFAULT 'new', tag_w REAL NOT NULL DEFAULT 0, error TEXT
);
CREATE INDEX file_hash ON file(hash);
CREATE INDEX file_inode ON file(dev, ino);

CREATE TABLE tag (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, facet TEXT,
  weight REAL NOT NULL DEFAULT 1, df INTEGER NOT NULL DEFAULT 0, idf REAL NOT NULL DEFAULT 0
);
CREATE TABLE file_tag (
  tag_id INTEGER NOT NULL, file_id INTEGER NOT NULL,
  ai INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tag_id, file_id)
) WITHOUT ROWID;
CREATE INDEX file_tag_file ON file_tag(file_id, tag_id);

CREATE TABLE answer (
  key TEXT PRIMARY KEY, facet TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE file_answer (file_id INTEGER NOT NULL, facet TEXT NOT NULL, key TEXT NOT NULL,
  PRIMARY KEY (file_id, facet));

CREATE TABLE review (
  id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL, kind TEXT NOT NULL, tag TEXT NOT NULL,
  confidence REAL, reason TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  UNIQUE (file_id, kind, tag)
);
CREATE TABLE plan (id TEXT PRIMARY KEY, body TEXT NOT NULL, status TEXT NOT NULL,
  created_at INTEGER NOT NULL);
CREATE TABLE vocabulary (facet TEXT NOT NULL, value TEXT NOT NULL,
  state TEXT NOT NULL,
  PRIMARY KEY (facet, value));
CREATE VIRTUAL TABLE content USING fts5(text, tokenize='trigram');
`,
  `
CREATE INDEX file_name ON file(${fileName('path')} COLLATE NOCASE);
ALTER TABLE plan ADD COLUMN claimed_at INTEGER;
CREATE TABLE plan_op (plan_id TEXT NOT NULL, file_id INTEGER NOT NULL, body TEXT NOT NULL,
  PRIMARY KEY (plan_id, file_id)) WITHOUT ROWID;
`,
  `
CREATE TABLE similarity_state (id INTEGER PRIMARY KEY CHECK (id = 1), dirty INTEGER NOT NULL);
INSERT INTO similarity_state VALUES (1, 1);
CREATE TRIGGER similarity_file_insert AFTER INSERT ON file
WHEN (SELECT dirty FROM similarity_state WHERE id = 1) = 0
BEGIN UPDATE similarity_state SET dirty = 1 WHERE id = 1; END;
CREATE TRIGGER similarity_file_delete AFTER DELETE ON file
WHEN (SELECT dirty FROM similarity_state WHERE id = 1) = 0
BEGIN UPDATE similarity_state SET dirty = 1 WHERE id = 1; END;
CREATE TRIGGER similarity_tag_insert AFTER INSERT ON file_tag
WHEN (SELECT dirty FROM similarity_state WHERE id = 1) = 0
BEGIN UPDATE similarity_state SET dirty = 1 WHERE id = 1; END;
CREATE TRIGGER similarity_tag_delete AFTER DELETE ON file_tag
WHEN (SELECT dirty FROM similarity_state WHERE id = 1) = 0
BEGIN UPDATE similarity_state SET dirty = 1 WHERE id = 1; END;
CREATE TRIGGER similarity_tag_update AFTER UPDATE OF tag_id, file_id ON file_tag
WHEN (old.tag_id <> new.tag_id OR old.file_id <> new.file_id)
 AND (SELECT dirty FROM similarity_state WHERE id = 1) = 0
BEGIN UPDATE similarity_state SET dirty = 1 WHERE id = 1; END;
CREATE TRIGGER similarity_weight_update AFTER UPDATE OF weight ON tag
WHEN old.weight <> new.weight AND (SELECT dirty FROM similarity_state WHERE id = 1) = 0
BEGIN UPDATE similarity_state SET dirty = 1 WHERE id = 1; END;
`,
  `ALTER TABLE file ADD COLUMN extract_key TEXT;`,
  `
CREATE TABLE vfolder (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  parent INTEGER REFERENCES vfolder(id) ON DELETE CASCADE,
  rule TEXT NOT NULL, tag TEXT, created_at INTEGER NOT NULL,
  UNIQUE (parent, name)
);
CREATE UNIQUE INDEX vfolder_root_name ON vfolder(name) WHERE parent IS NULL;
`,
];

/** The schema version of this index. */
export const schemaVersion = (sql: Sql) =>
  sql.get<{ user_version: number }>('PRAGMA user_version')!.user_version;

/** Brings the index up to date. An index from a newer version is refused untouched. */
export function migrate(sql: Sql, location: string): void {
  const found = schemaVersion(sql);
  if (found > MIGRATIONS.length) {
    throw new UserError(
      `${location} was written by a newer version of Jevonganize. Update it to use this index`,
    );
  }
  sql.exec('PRAGMA journal_mode = WAL');
  if (found === MIGRATIONS.length) return;
  sql.transaction(() => {
    // Another process may have migrated while this one waited for the lock.
    for (const migration of MIGRATIONS.slice(schemaVersion(sql))) sql.exec(migration);
    sql.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
  });
}
