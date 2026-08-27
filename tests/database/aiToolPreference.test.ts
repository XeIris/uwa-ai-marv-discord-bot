import {
  describe, test, expect, beforeAll, afterAll, beforeEach,
} from 'bun:test';
import Database from '../../database/Database';
import { AI_TOOL_KEYS } from '../../utils/aiTools';

const USER = 'u1';
const OTHER = 'u2';

describe('AiToolPreferenceModel', () => {
  let db: Database;

  beforeAll(async () => {
    db = new Database(`./tests/temp/testAiTools-${Date.now()}.db`);
    await db.ready;
  });

  afterAll(() => { db.db.close(); });

  beforeEach(async () => {
    await db.executeQuery('DELETE FROM AiToolPreference');
  });

  test('a user with no rows has every tool on', async () => {
    const tools = await db.aiTools.resolve(USER);
    expect(Object.keys(tools).sort()).toEqual([...AI_TOOL_KEYS].sort());
    expect(Object.values(tools).every((v) => v === true)).toBe(true);
  });

  test('disabling one tool leaves the rest on', async () => {
    expect(await db.aiTools.set(USER, 'websearch', false)).toBe(true);

    const tools = await db.aiTools.resolve(USER);
    expect(tools.websearch).toBe(false);
    expect(tools.imagegen).toBe(true);
    expect(tools.musicgen).toBe(true);
    expect(tools.diagrams).toBe(true);
    expect(tools.pdf).toBe(true);
  });

  test('re-enabling flips it back', async () => {
    await db.aiTools.set(USER, 'imagegen', false);
    expect(await db.aiTools.isEnabled(USER, 'imagegen')).toBe(false);

    await db.aiTools.set(USER, 'imagegen', true);
    expect(await db.aiTools.isEnabled(USER, 'imagegen')).toBe(true);
  });

  test('setting the same tool twice upserts rather than duplicating', async () => {
    await db.aiTools.set(USER, 'pdf', false);
    await db.aiTools.set(USER, 'pdf', false);

    const rows = await db.executeSelectAllQuery(
      'SELECT * FROM AiToolPreference WHERE user_id = ? AND tool = ?',
      [USER, 'pdf'],
    );
    expect(rows.length).toBe(1);
  });

  test('preferences are per user', async () => {
    await db.aiTools.set(USER, 'musicgen', false);

    expect(await db.aiTools.isEnabled(USER, 'musicgen')).toBe(false);
    expect(await db.aiTools.isEnabled(OTHER, 'musicgen')).toBe(true);
  });

  test('setAll turns everything off, then everything back on', async () => {
    await db.aiTools.setAll(USER, false);
    const off = await db.aiTools.resolve(USER);
    expect(Object.values(off).every((v) => v === false)).toBe(true);

    await db.aiTools.setAll(USER, true);
    const on = await db.aiTools.resolve(USER);
    expect(Object.values(on).every((v) => v === true)).toBe(true);
  });

  test('an unknown tool key is rejected and never written', async () => {
    expect(await db.aiTools.set(USER, 'rm -rf', false)).toBe(false);
    // "all" is a command target, not a storable key.
    expect(await db.aiTools.set(USER, 'all', false)).toBe(false);

    const rows = await db.executeSelectAllQuery('SELECT * FROM AiToolPreference', []);
    expect(rows.length).toBe(0);
  });

  test('a stored row for a retired tool is ignored, not crashed on', async () => {
    // Written straight past the model's whitelist, as a leftover row would be.
    await db.executeQuery(
      'INSERT INTO AiToolPreference (user_id, tool, enabled) VALUES (?, ?, ?)',
      [USER, 'retired_tool', 0],
    );

    const tools = await db.aiTools.resolve(USER);
    expect(Object.values(tools).every((v) => v === true)).toBe(true);
    expect((tools as any).retired_tool).toBeUndefined();
  });

  test('resolve falls back to all-on when the table cannot be read', async () => {
    const broken = {
      executeSelectAllQuery: async () => { throw new Error('no such table'); },
    } as any;
    const { default: AiToolPreferenceModel } = await import('../../database/models/AiToolPreferenceModel');
    const model = new AiToolPreferenceModel(broken);

    const tools = await model.resolve(USER);
    // Fails to the default, not to all-off: these are preferences, not a safety
    // control, and stripping Marv's tools on a transient DB error is worse than
    // briefly ignoring an opt-out.
    expect(Object.values(tools).every((v) => v === true)).toBe(true);
  });
});
