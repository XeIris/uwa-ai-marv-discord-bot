import Database from '../../database/Database';
import type AiChatModel from '../../database/models/AiChatModel';

// The content-safety pause is enforced partly in SQL (ADD_HISTORY is conditional
// on moderation_flagged = 0), so it needs a real database to verify.
describe('AiChatModel content-safety pause', () => {
  let db: Database;
  let aiChat: AiChatModel;

  beforeAll(async () => {
    db = new Database(`./tests/temp/testAiChatModeration-${Date.now()}.db`);
    await db.ready;
    aiChat = db.aiChat;
  });

  afterAll(() => {
    db.db.close();
  });

  beforeEach(async () => {
    await db.executeQuery('DELETE FROM AiChatHistory');
    await db.executeQuery('DELETE FROM AiChatSession');
  });

  async function newSession(userId = 'u-mod') {
    const session = await aiChat.getOrCreateSession(userId, 'Marv');
    return session!.sessionId as number;
  }

  describe('flagSessionModeration', () => {
    it('flags the session and reports success', async () => {
      const sessionId = await newSession();
      expect(await aiChat.flagSessionModeration(sessionId, 'Violence')).toBe(true);

      const row = await aiChat.getSessionById(sessionId);
      expect(row!.moderationFlagged).toBe(1);
      expect(row!.moderationCategories).toBe('Violence');
    });

    it('leaves the session active so getOrCreateSession keeps refusing it', async () => {
      const sessionId = await newSession();
      await aiChat.flagSessionModeration(sessionId);

      const row = await aiChat.getSessionById(sessionId);
      expect(row!.active).toBe(1);
      // Same row comes back rather than a fresh, unflagged one.
      const again = await aiChat.getOrCreateSession('u-mod', 'Marv');
      expect(again!.sessionId).toBe(sessionId);
      expect(again!.moderationFlagged).toBe(1);
    });

    it('reports failure for a session that does not exist', async () => {
      expect(await aiChat.flagSessionModeration(999999)).toBe(false);
    });

    it('reports failure for an invalid session id instead of writing', async () => {
      expect(await aiChat.flagSessionModeration(0)).toBe(false);
      expect(await aiChat.flagSessionModeration(-1)).toBe(false);
      expect(await aiChat.flagSessionModeration(NaN)).toBe(false);
    });

    it('normalizes blank categories to null', async () => {
      const sessionId = await newSession();
      await aiChat.flagSessionModeration(sessionId, '   ');
      expect((await aiChat.getSessionById(sessionId))!.moderationCategories).toBeNull();
    });
  });

  describe('addHistory', () => {
    it('writes normally while the session is unflagged', async () => {
      const sessionId = await newSession();
      expect(await aiChat.addHistory(sessionId, 'user', 'hello')).toBe(true);
      expect(await aiChat.getHistory(sessionId)).toHaveLength(1);
    });

    // The race this closes: a turn that began before another turn paused the
    // session must not be able to persist into it afterwards.
    it('refuses to write into a paused session', async () => {
      const sessionId = await newSession();
      await aiChat.addHistory(sessionId, 'user', 'before');
      await aiChat.flagSessionModeration(sessionId, 'Violence');

      expect(await aiChat.addHistory(sessionId, 'user', 'after')).toBe(false);
      expect(await aiChat.addHistory(sessionId, 'assistant', 'reply')).toBe(false);

      const history = await aiChat.getHistory(sessionId);
      expect(history).toHaveLength(1);
      expect(history[0].message).toBe('before');
    });
  });
});
