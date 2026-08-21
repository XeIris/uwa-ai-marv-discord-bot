import aiConsentQueries from '../queries/aiConsentQueries';
import type Database from '../Database';

/** A user's stored acceptance of the AI data notice. */
export interface AiConsentEntry {
  userId: string;
  policyVersion: number;
  acceptedAt: string;
}

class AiConsentModel {
  private db: Database;

  /**
   * User IDs known to have accepted, keyed by the version they accepted.
   *
   * The gate runs on every AI-triggering message, so the common case (an
   * already-consented regular) must not cost a query. Only ever populated from
   * the DB, and cleared on revoke — a cache miss falls through to a read, so the
   * worst a stale entry could do is skip a prompt, and nothing writes an entry
   * without a committed row behind it.
   */
  private accepted = new Map<string, number>();

  constructor(database: Database) {
    this.db = database;
  }

  /** True when this user has accepted at least the given notice version. */
  async hasConsented(userId: string, version: number): Promise<boolean> {
    const cached = this.accepted.get(userId);
    if (cached !== undefined && cached >= version) return true;

    const row = await this.db.executeSelectQuery(
      aiConsentQueries.GET,
      [userId],
    ) as AiConsentEntry | null;
    if (!row) return false;

    this.accepted.set(userId, row.policyVersion);
    return row.policyVersion >= version;
  }

  /**
   * Stores an acceptance. False means the write didn't land (executeQuery
   * swallows SQL errors into changes: 0) — the cache is left alone so the user
   * is prompted again rather than being treated as consented on nothing.
   */
  async record(userId: string, version: number, now: Date = new Date()): Promise<boolean> {
    const result = await this.db.executeQuery(
      aiConsentQueries.RECORD,
      [userId, version, now.toISOString()],
    );
    if (result.changes === 0) return false;
    this.accepted.set(userId, version);
    return true;
  }

  async get(userId: string): Promise<AiConsentEntry | null> {
    return this.db.executeSelectQuery(
      aiConsentQueries.GET,
      [userId],
    ) as Promise<AiConsentEntry | null>;
  }

  /** Withdraws consent; the next AI interaction re-prompts. */
  async revoke(userId: string): Promise<boolean> {
    const result = await this.db.executeQuery(aiConsentQueries.REVOKE, [userId]);
    this.accepted.delete(userId);
    return result.changes > 0;
  }
}

export default AiConsentModel;
