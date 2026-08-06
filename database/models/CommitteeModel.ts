import committeeQueries from '../queries/committeeQueries';
import type Database from '../Database';

/** A committee row as returned by the DB layer (snake_case columns are camelized). */
export interface CommitteeEntry {
  id: number;
  serverId: string;
  userId: string;
  title: string;
  displayName: string | null;
  isExecutive: number;
  sortOrder: number;
  updatedAt: string;
}

export interface CommitteeInput {
  displayName?: string | null;
  isExecutive?: boolean;
  sortOrder?: number;
}

class CommitteeModel {
  private db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  /** Adds a title for a user, or refreshes the details of one they already hold. */
  async upsert(
    serverId: string,
    userId: string,
    title: string,
    opts: CommitteeInput = {},
  ): Promise<void> {
    await this.db.executeQuery(committeeQueries.UPSERT_MEMBER, [
      serverId,
      userId,
      title,
      opts.displayName ?? null,
      opts.isExecutive ? 1 : 0,
      Number.isInteger(opts.sortOrder) ? opts.sortOrder! : 100,
    ]);
  }

  /**
   * Rewrites one existing (user, title) row. Fields left undefined keep their
   * current value. Returns false when the row doesn't exist.
   */
  async updateEntry(
    serverId: string,
    userId: string,
    title: string,
    changes: CommitteeInput & { title?: string },
  ): Promise<boolean> {
    const existing = await this.getEntry(serverId, userId, title);
    if (!existing) return false;

    const result = await this.db.executeQuery(committeeQueries.UPDATE_MEMBER, [
      changes.title ?? existing.title,
      changes.displayName === undefined ? existing.displayName : changes.displayName,
      changes.isExecutive === undefined ? existing.isExecutive : Number(changes.isExecutive),
      Number.isInteger(changes.sortOrder) ? changes.sortOrder! : existing.sortOrder,
      serverId,
      userId,
      title,
    ]);
    return result.changes > 0;
  }

  /** Removes one title, or every title the user holds when title is omitted. */
  async remove(serverId: string, userId: string, title?: string): Promise<number> {
    const result = title
      ? await this.db.executeQuery(committeeQueries.DELETE_MEMBER_TITLE, [serverId, userId, title])
      : await this.db.executeQuery(committeeQueries.DELETE_MEMBER_ALL, [serverId, userId]);
    return result.changes;
  }

  async getEntry(serverId: string, userId: string, title: string): Promise<CommitteeEntry | null> {
    const row = await this.db.executeSelectQuery(committeeQueries.GET_ENTRY, [serverId, userId, title]);
    return (row as CommitteeEntry) ?? null;
  }

  /** Whole roster for a guild, executives first, then by sort order. */
  async listByServer(serverId: string): Promise<CommitteeEntry[]> {
    return this.db.executeSelectAllQuery(committeeQueries.LIST_BY_SERVER, [serverId]) as Promise<CommitteeEntry[]>;
  }

  /** Titles this user holds in this guild — empty for a non-committee member. */
  async getTitlesForUser(serverId: string, userId: string): Promise<string[]> {
    const rows = await this.db.executeSelectAllQuery(
      committeeQueries.LIST_TITLES_FOR_USER,
      [serverId, userId],
    );
    return rows.map((row: Record<string, any>) => row.title);
  }
}

export default CommitteeModel;
