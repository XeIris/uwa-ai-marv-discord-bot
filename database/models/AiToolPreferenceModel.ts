import type Database from '../Database';
import aiToolPreferenceQueries from '../queries/aiToolPreferenceQueries';
import { logError } from '../../utils/log';
import {
  AI_TOOL_KEYS, defaultAiTools, isAiToolKey, type AiToolKey,
} from '../../utils/aiTools';

/**
 * Per-user AI tool switches. See utils/aiTools.ts for what the keys mean and
 * why the default is ON.
 *
 * The table stores exceptions only: `resolve` starts from all-on and applies
 * whatever rows exist, so a user who has never run `/ai tools` has no rows at
 * all.
 */
class AiToolPreferenceModel {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Every switchable tool and whether it is on for this user.
   *
   * Fails to the **default (all on)** rather than all-off. These switches are a
   * preference, not a safety control, so an unreadable exceptions table means
   * "no known exceptions" — the alternative would silently strip Marv of web
   * search and image generation mid-conversation on a transient DB error, and
   * leave him telling members he can't do things he can. The failure is logged.
   */
  async resolve(userId: string): Promise<Record<AiToolKey, boolean>> {
    const tools = defaultAiTools();
    try {
      const rows = await this.db.executeSelectAllQuery(
        aiToolPreferenceQueries.GET_ALL_FOR_USER,
        [userId],
      );
      (rows ?? []).forEach((row: any) => {
        const key: unknown = row?.tool;
        if (isAiToolKey(key)) tools[key] = row.enabled !== 0;
      });
    } catch (err) {
      logError(`[aitools] failed to read tool preferences for ${userId}; defaulting all on:`, err);
    }
    return tools;
  }

  /**
   * Turns one tool on or off. Rejects any key not in AI_TOOL_KEYS — `all` is a
   * command-level target, never a stored row, so callers expand it themselves.
   */
  async set(userId: string, tool: string, enabled: boolean): Promise<boolean> {
    if (!isAiToolKey(tool)) return false;
    const result = await this.db.executeQuery(
      aiToolPreferenceQueries.SET,
      [userId, tool, enabled ? 1 : 0],
    );
    return (result?.changes ?? 0) > 0;
  }

  /** Turns every switchable tool on or off in one transaction. */
  async setAll(userId: string, enabled: boolean): Promise<boolean> {
    await this.db.executeTransaction((rawDb) => {
      AI_TOOL_KEYS.forEach((tool) => {
        const result = rawDb.query(aiToolPreferenceQueries.SET)
          .run(userId, tool, enabled ? 1 : 0);
        if (!result || result.changes === 0) {
          throw new Error(`Failed to store the "${tool}" tool preference`);
        }
      });
    });
    return true;
  }

  /** Whether one tool is on for this user (true for an unknown key's default). */
  async isEnabled(userId: string, tool: AiToolKey): Promise<boolean> {
    const tools = await this.resolve(userId);
    return tools[tool] ?? true;
  }
}

export default AiToolPreferenceModel;
