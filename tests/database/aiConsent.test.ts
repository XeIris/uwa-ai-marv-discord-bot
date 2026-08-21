import {
  describe, test, expect, beforeAll, afterAll, beforeEach,
} from 'bun:test';
import Database from '../../database/Database';

const USER = 'u1';
const OTHER = 'u2';

describe('AiConsentModel', () => {
  let db: Database;

  beforeAll(async () => {
    db = new Database(`./tests/temp/testAiConsent-${Date.now()}.db`);
    await db.ready;
  });

  afterAll(() => { db.db.close(); });

  beforeEach(async () => {
    await db.executeQuery('DELETE FROM AiConsent');
    // The model caches acceptances in memory; drop it so each test starts cold.
    await db.aiConsent.revoke(USER);
    await db.aiConsent.revoke(OTHER);
  });

  test('a user with no row has not consented', async () => {
    expect(await db.aiConsent.hasConsented(USER, 1)).toBe(false);
  });

  test('recording an acceptance makes it stick', async () => {
    expect(await db.aiConsent.record(USER, 1)).toBe(true);
    expect(await db.aiConsent.hasConsented(USER, 1)).toBe(true);
    expect(await db.aiConsent.hasConsented(OTHER, 1)).toBe(false);
  });

  test('a version bump re-prompts an already-consented user', async () => {
    await db.aiConsent.record(USER, 1);
    expect(await db.aiConsent.hasConsented(USER, 2)).toBe(false);

    await db.aiConsent.record(USER, 2);
    expect(await db.aiConsent.hasConsented(USER, 2)).toBe(true);
    // Still fine against the older version — acceptance is a floor, not a match.
    expect(await db.aiConsent.hasConsented(USER, 1)).toBe(true);
  });

  test('re-accepting overwrites rather than accumulating rows', async () => {
    await db.aiConsent.record(USER, 1);
    await db.aiConsent.record(USER, 2);

    const rows = await db.executeSelectAllQuery('SELECT * FROM AiConsent WHERE user_id = ?', [USER]);
    expect(rows).toHaveLength(1);
    expect(rows[0].policyVersion).toBe(2);
  });

  test('revoking clears both the row and the cached decision', async () => {
    await db.aiConsent.record(USER, 1);
    expect(await db.aiConsent.revoke(USER)).toBe(true);
    expect(await db.aiConsent.hasConsented(USER, 1)).toBe(false);
    expect(await db.aiConsent.get(USER)).toBeNull();
  });

  test('the cache is not consulted for a user who never accepted', async () => {
    // Row written behind the model's back: a cold cache must fall through to it.
    await db.executeQuery(
      'INSERT INTO AiConsent (user_id, policy_version, accepted_at) VALUES (?, ?, ?)',
      [OTHER, 1, new Date().toISOString()],
    );
    expect(await db.aiConsent.hasConsented(OTHER, 1)).toBe(true);
  });
});
