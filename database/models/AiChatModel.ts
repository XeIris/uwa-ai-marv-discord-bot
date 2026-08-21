import { stripModelTimestampPrefix } from '../../utils/ai';
import { log } from '../../utils/log';
import aiChatQueries from '../queries/aiChatQueries';
import type Database from '../Database';

/** Model for managing per-user, per-persona AI chat sessions and history. */
class AiChatModel {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Retrieves an active session for a user+persona pair, or creates one if none exists.
   */
  async getOrCreateSession(userId: string, personaName: string): Promise<Record<string, any> | null> {
    let session = await this.db.executeSelectQuery(
      aiChatQueries.GET_ACTIVE_SESSION,
      [userId, personaName],
    );

    if (!session) {
      const result = await this.db.executeQuery(
        aiChatQueries.START_SESSION,
        [userId, personaName],
      );
      if (result.lastID) {
        session = await this.getSessionById(result.lastID);
      }

      // If an insert raced and hit uniqueness constraints, recover by re-reading active session.
      if (!session) {
        session = await this.db.executeSelectQuery(
          aiChatQueries.GET_ACTIVE_SESSION,
          [userId, personaName],
        );
      }

      if (session) {
        log(`AiChat: Created session ${session.sessionId} for user ${userId} with persona ${personaName}`);
      }
    }

    return session;
  }

  /**
   * Creates a brand-new active session for a user+persona pair.
   * Deactivates any existing active sessions for that persona first.
   */
  async startNewSession(userId: string, personaName: string): Promise<Record<string, any> | null> {
    const newSessionId = await this.db.executeTransaction(async (rawDb: any) => {
      rawDb.query(aiChatQueries.END_ALL_USER_PERSONA_SESSIONS).run(userId, personaName);
      rawDb.query(aiChatQueries.START_SESSION).run(userId, personaName);
      return rawDb.query('SELECT last_insert_rowid() as id').get().id;
    });

    const session = await this.getSessionById(newSessionId);
    if (session) {
      log(`AiChat: Started new session ${session.sessionId} for user ${userId} with persona ${personaName}`);
    }
    return session;
  }

  /**
   * Returns a session row by its ID.
   */
  async getSessionById(sessionId: number): Promise<Record<string, any> | null> {
    return this.db.executeSelectQuery(aiChatQueries.GET_SESSION_BY_ID, [sessionId]);
  }

  /**
   * Returns all sessions for a user (active and inactive), newest first.
   * Includes `messageCount` for each session.
   */
  async getAllUserSessions(userId: string): Promise<Record<string, any>[]> {
    return this.db.executeSelectAllQuery(aiChatQueries.GET_ALL_USER_SESSIONS, [userId]);
  }

  /**
   * Returns only the user's web-created sessions (source='web'), newest first.
   * Used by the /games/ai-slop sidebar — keeps Discord-bot sessions hidden.
   */
  async getUserWebSessions(userId: string): Promise<Record<string, any>[]> {
    return this.db.executeSelectAllQuery(aiChatQueries.GET_USER_WEB_SESSIONS, [userId]);
  }

  /**
   * Returns only the user's Discord-created sessions (source='discord'),
   * newest first. Used by /ai view so Discord users don't see (and can't
   * manipulate) the web-created sessions that live in the same table.
   */
  async getUserDiscordSessions(userId: string): Promise<Record<string, any>[]> {
    return this.db.executeSelectAllQuery(aiChatQueries.GET_USER_DISCORD_SESSIONS, [userId]);
  }

  /**
   * Creates a new web-source session for the given user/persona. Web sessions
   * are inserted with active=0 so they never collide with the bot's
   * per-persona active-session uniqueness invariant.
   */
  async createWebSession(userId: string, personaName: string): Promise<Record<string, any> | null> {
    const result = await this.db.executeQuery(
      aiChatQueries.START_WEB_SESSION,
      [userId, personaName],
    );
    if (!result.lastID) return null;
    const session = await this.getSessionById(result.lastID);
    if (session) {
      log(`AiChat (web): Created session ${session.sessionId} for user ${userId} with persona ${personaName}`);
    }
    return session;
  }

  /**
   * Renames a session after verifying it belongs to the requesting user.
   * Unlike updateTitle (which only fires once on auto-title), this overwrites
   * an existing title.
   */
  async renameSession(userId: string, sessionId: number, title: string): Promise<boolean> {
    const session = await this.getSessionById(sessionId);
    if (!session || session.userId !== userId) return false;
    await this.db.executeQuery(aiChatQueries.RENAME_SESSION, [title, sessionId]);
    return true;
  }

  /**
   * Marks a session as inactive.
   */
  async endSession(sessionId: number): Promise<void> {
    await this.db.executeQuery(aiChatQueries.END_SESSION, [sessionId]);
    log(`AiChat: Ended session ${sessionId}`);
  }

  /**
   * Updates the generated title for a session.
   */
  async updateTitle(sessionId: number, title: string): Promise<void> {
    await this.db.executeQuery(aiChatQueries.UPDATE_SESSION_TITLE, [title, sessionId]);
    log(`AiChat: Updated title for session ${sessionId}`);
  }

  /**
   * Switches the active session for a user/persona to a specific session.
   * Deactivates all current sessions for that user/persona first, then activates the target.
   */
  async switchSession(userId: string, sessionId: number): Promise<Record<string, any> | null> {
    const session = await this.getSessionById(sessionId);
    if (!session) return null;
    await this.db.executeQuery(
      aiChatQueries.END_ALL_USER_PERSONA_SESSIONS,
      [userId, session.personaName],
    );
    await this.db.executeQuery(aiChatQueries.ACTIVATE_SESSION, [sessionId]);
    log(`AiChat: Switched user ${userId} to session ${sessionId} (${session.personaName})`);
    return this.getSessionById(sessionId);
  }

  /**
   * Permanently deletes a session and all its history.
   * Validates that the session belongs to the requesting user.
   */
  async deleteSession(userId: string, sessionId: number): Promise<boolean> {
    const session = await this.getSessionById(sessionId);
    if (!session || session.userId !== userId) {
      return false;
    }
    await this.db.executeQuery(aiChatQueries.DELETE_HISTORY_BY_SESSION, [sessionId]);
    await this.db.executeQuery(aiChatQueries.DELETE_SESSION, [sessionId]);
    log(`AiChat: Deleted session ${sessionId} for user ${userId}`);
    return true;
  }

  /**
   * Appends a message to the session's history.
   */
  async addHistory(sessionId: number, role: 'user' | 'model' | 'assistant' | 'tool', message: string): Promise<void> {
    const stored = role === 'model' || role === 'assistant'
      ? stripModelTimestampPrefix(message)
      : message;
    await this.db.executeQuery(aiChatQueries.ADD_HISTORY, [sessionId, role, stored]);
  }

  /**
   * Fetches the last N messages for a session, returned in chronological order (oldest first).
   * Capped at 30 by default per cost constraints.
   */
  async getHistory(sessionId: number, limit = 30): Promise<Record<string, any>[]> {
    // DB query returns newest-first; reverse for chronological order
    const rows = await this.db.executeSelectAllQuery(
      aiChatQueries.GET_HISTORY,
      [sessionId, limit],
    );
    return rows.reverse();
  }
}

export default AiChatModel;
