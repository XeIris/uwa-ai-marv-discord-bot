import musicGenQueries from '../queries/musicGenQueries';
import type Database from '../Database';

class MusicGenModel {
  private db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  /**
   * Atomically consume one quota slot: counts successes in the rolling 24h window
   * and inserts the generation row in a single transaction, so concurrent requests
   * for the same user cannot overshoot the limit. Returns the new row id, or null
   * when the limit is reached. Throws on DB failure (callers must fail closed).
   */
  async reserveGeneration(userId: string, title: string, limit: number): Promise<number | null> {
    return this.db.executeTransaction((rawDb) => {
      const row = rawDb.query(musicGenQueries.COUNT_LAST_24H).get(userId) as Record<string, any> | null;
      const count = row?.gen_count;
      if (typeof count !== 'number') throw new Error('Failed to read music generation usage');
      if (count >= limit) return null;
      rawDb.query(musicGenQueries.LOG_GENERATION).run(userId, title, 1);
      const idRow = rawDb.query(musicGenQueries.LAST_INSERT_ID).get() as { id: number };
      return idRow.id;
    });
  }

  /** Releases a reserved quota slot after a failed generation (failures don't count). */
  async markFailed(id: number): Promise<void> {
    await this.db.executeQuery(musicGenQueries.MARK_FAILED, [id]);
  }

  /** Successful generations by this user in the last rolling 24 hours. Throws on DB failure. */
  async countLast24h(userId: string): Promise<number> {
    const row = await this.db.executeSelectQuery(musicGenQueries.COUNT_LAST_24H, [userId]);
    if (!row || typeof row.genCount !== 'number') {
      throw new Error('Failed to read music generation usage');
    }
    return row.genCount;
  }
}

export default MusicGenModel;
