import {
  describe, test, expect, beforeAll, afterAll, beforeEach,
} from 'bun:test';
import { Database as BunDatabase } from 'bun:sqlite';
import Database from '../../database/Database';

const USER = '100000000000000009';

/**
 * These exist because the fork inherited `FOREIGN KEY (user_id) REFERENCES User(id)`
 * on AiChatSession while the User table had been stripped. SQLite resolves FK
 * targets when it prepares a statement, so with PRAGMA foreign_keys = ON every
 * single INSERT died with "no such table: main.User" — the bot could answer but
 * never remembered anything. Nothing in the suite touched AiChatModel, so it
 * went unnoticed.
 */
describe('AiChatModel', () => {
  let db: Database;

  beforeAll(async () => {
    db = new Database(`./tests/temp/testAiChat-${Date.now()}.db`);
    await db.ready;
  });

  afterAll(() => { db.db.close(); });

  beforeEach(async () => {
    await db.executeQuery('DELETE FROM AiChatHistory');
    await db.executeQuery('DELETE FROM AiChatSession');
  });

  test('foreign key enforcement is actually on (the bug needed it)', () => {
    expect(db.db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });

  test('getOrCreateSession inserts a session', async () => {
    const session = await db.aiChat.getOrCreateSession(USER, 'Marv');
    expect(session?.sessionId).toBeGreaterThan(0);
  });

  test('getOrCreateSession reuses the active session', async () => {
    const first = await db.aiChat.getOrCreateSession(USER, 'Marv');
    const second = await db.aiChat.getOrCreateSession(USER, 'Marv');
    expect(second?.sessionId).toBe(first!.sessionId);
  });

  test('sessions are per persona', async () => {
    const marv = await db.aiChat.getOrCreateSession(USER, 'Marv');
    const grok = await db.aiChat.getOrCreateSession(USER, 'Grok');
    expect(grok?.sessionId).not.toBe(marv!.sessionId);
  });

  test('history round-trips', async () => {
    const session = await db.aiChat.getOrCreateSession(USER, 'Marv');
    await db.aiChat.addHistory(session!.sessionId, 'user', '[2026-08-06]-[Treasurer]-[ruan]-User ruan said: hi');
    await db.aiChat.addHistory(session!.sessionId, 'assistant', 'Hello!');

    const history = await db.aiChat.getHistory(session!.sessionId, 10);
    expect(history).toHaveLength(2);
    expect(history[0].message).toContain('[Treasurer]');
  });

  test('startNewSession supersedes the active one (the "-n" path)', async () => {
    const first = await db.aiChat.getOrCreateSession(USER, 'Marv');
    const second = await db.aiChat.startNewSession(USER, 'Marv');

    expect(second?.sessionId).not.toBe(first!.sessionId);
    expect((await db.aiChat.getSessionById(first!.sessionId))?.active).toBe(0);
    expect((await db.aiChat.getOrCreateSession(USER, 'Marv'))?.sessionId).toBe(second!.sessionId);
  });
});

describe('schema integrity', () => {
  let db: Database;

  beforeAll(async () => {
    db = new Database(`./tests/temp/testSchema-${Date.now()}.db`);
    await db.ready;
  });

  afterAll(() => { db.db.close(); });

  test('every foreign key points at a table that exists', () => {
    const tableNames = (db.db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]).map((row) => row.name);

    const dangling: string[] = [];
    for (const name of tableNames) {
      const keys = db.db.query(`PRAGMA foreign_key_list(${name})`).all() as { table: string }[];
      for (const key of keys) {
        if (!tableNames.includes(key.table)) dangling.push(`${name} -> ${key.table}`);
      }
    }

    expect(dangling).toEqual([]);
  });
});

describe('AiChatSession legacy migration', () => {
  test('rebuilds a table that still carries the dangling User foreign key', async () => {
    const path = `./tests/temp/testAiChatLegacy-${Date.now()}.db`;

    // Recreate the pre-fix schema exactly as shipped in the fork.
    const raw = new BunDatabase(path, { create: true });
    raw.run(`CREATE TABLE AiChatSession (
      session_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id VARCHAR NOT NULL,
      persona_name VARCHAR NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      title TEXT DEFAULT NULL,
      source TEXT NOT NULL DEFAULT 'discord',
      FOREIGN KEY (user_id) REFERENCES User(id)
    )`);
    raw.run("INSERT INTO AiChatSession (user_id, persona_name, title) VALUES ('legacy', 'Grok', 'old chat')");
    raw.close();

    const db = new Database(path);
    await db.ready;

    const schema = db.db
      .query("SELECT sql FROM sqlite_master WHERE type='table' AND name='AiChatSession'")
      .get() as { sql: string };
    expect(schema.sql).not.toMatch(/REFERENCES\s+User/i);

    // Existing rows survive the rebuild...
    const kept = await db.executeSelectAllQuery('SELECT * FROM AiChatSession', []);
    expect(kept).toHaveLength(1);
    expect(kept[0].title).toBe('old chat');

    // ...the indexes DROP TABLE removed are back...
    const indexes = (db.db
      .query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='AiChatSession'")
      .all() as { name: string }[]).map((row) => row.name);
    expect(indexes).toContain('idx_aichatsession_user_discord_active');
    expect(indexes).toContain('idx_aichatsession_user_source');

    // ...and inserts work again.
    expect((await db.aiChat.getOrCreateSession(USER, 'Marv'))?.sessionId).toBeGreaterThan(0);

    db.db.close();
  });
});
