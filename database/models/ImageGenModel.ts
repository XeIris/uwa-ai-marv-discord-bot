import imageGenQueries from '../queries/imageGenQueries';
import type Database from '../Database';

class ImageGenModel {
  private db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  async logGeneration(userId: string, prompt: string, model: string | null, success: boolean): Promise<void> {
    await this.db.executeQuery(
      imageGenQueries.LOG_GENERATION,
      [userId, prompt, model, success ? 1 : 0],
    );
  }

  /**
   * Atomically consume one quota slot: counts successes in the rolling 24h window
   * and inserts the generation row in a single transaction, so concurrent requests
   * for the same user cannot overshoot the limit. Returns the new row id, or null
   * when the limit is reached. Throws on DB failure (callers must fail closed).
   */
  async reserveGeneration(userId: string, prompt: string, model: string | null, limit: number): Promise<number | null> {
    return this.db.executeTransaction((rawDb) => {
      const row = rawDb.query(imageGenQueries.COUNT_LAST_24H).get(userId) as Record<string, any> | null;
      const count = row?.gen_count;
      if (typeof count !== 'number') throw new Error('Failed to read image generation usage');
      if (count >= limit) return null;
      rawDb.query(imageGenQueries.LOG_GENERATION).run(userId, prompt, model, 1);
      const idRow = rawDb.query(imageGenQueries.LAST_INSERT_ID).get() as { id: number };
      return idRow.id;
    });
  }

  /** Releases a reserved quota slot after a failed generation (failures don't count). */
  async markFailed(id: number): Promise<void> {
    await this.db.executeQuery(imageGenQueries.MARK_FAILED, [id]);
  }

  /** Successful generations by this user in the last rolling 24 hours. Throws on DB failure. */
  async countLast24h(userId: string): Promise<number> {
    const row = await this.db.executeSelectQuery(imageGenQueries.COUNT_LAST_24H, [userId]);
    if (!row || typeof row.genCount !== 'number') {
      throw new Error('Failed to read image generation usage');
    }
    return row.genCount;
  }
}

export default ImageGenModel;
