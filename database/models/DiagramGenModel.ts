import diagramGenQueries from '../queries/diagramGenQueries';
import type Database from '../Database';

class DiagramGenModel {
  private db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  /**
   * Atomically consume one quota slot: counts successes in the rolling 24h window
   * and inserts the render row in a single transaction, so concurrent requests
   * for the same user cannot overshoot the limit. Returns the new row id, or null
   * when the limit is reached. Throws on DB failure (callers must fail closed).
   */
  async reserveGeneration(userId: string, title: string, limit: number): Promise<number | null> {
    return this.db.executeTransaction((rawDb) => {
      const row = rawDb.query(diagramGenQueries.COUNT_LAST_24H).get(userId) as Record<string, any> | null;
      const count = row?.gen_count;
      if (typeof count !== 'number') throw new Error('Failed to read diagram render usage');
      if (count >= limit) return null;
      rawDb.query(diagramGenQueries.LOG_GENERATION).run(userId, title, 1);
      const idRow = rawDb.query(diagramGenQueries.LAST_INSERT_ID).get() as { id: number };
      return idRow.id;
    });
  }

  /** Releases a reserved quota slot after a failed render (failures don't count). */
  async markFailed(id: number): Promise<void> {
    await this.db.executeQuery(diagramGenQueries.MARK_FAILED, [id]);
  }

  /** Successful renders by this user in the last rolling 24 hours. Throws on DB failure. */
  async countLast24h(userId: string): Promise<number> {
    const row = await this.db.executeSelectQuery(diagramGenQueries.COUNT_LAST_24H, [userId]);
    if (!row || typeof row.genCount !== 'number') {
      throw new Error('Failed to read diagram render usage');
    }
    return row.genCount;
  }
}

export default DiagramGenModel;
