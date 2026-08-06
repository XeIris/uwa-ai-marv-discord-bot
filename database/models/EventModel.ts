import eventQueries from '../queries/eventQueries';
import type Database from '../Database';

/** An event row as returned by the DB layer (snake_case columns are camelized). */
export interface EventEntry {
  id: number;
  serverId: string;
  name: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  url: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface EventInput {
  name?: string;
  description?: string | null;
  startsAt?: string;
  endsAt?: string | null;
  location?: string | null;
  url?: string | null;
}

class EventModel {
  private db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  /** Creates an event and returns its id. startsAt/endsAt are ISO-8601 UTC strings. */
  async create(
    serverId: string,
    fields: EventInput & { name: string; startsAt: string },
    createdBy: string | null = null,
  ): Promise<number | null> {
    return this.db.executeTransaction((rawDb) => {
      rawDb.query(eventQueries.CREATE_EVENT).run(
        serverId,
        fields.name,
        fields.description ?? null,
        fields.startsAt,
        fields.endsAt ?? null,
        fields.location ?? null,
        fields.url ?? null,
        createdBy,
      );
      const idRow = rawDb.query(eventQueries.LAST_INSERT_ID).get() as { id: number };
      return idRow.id;
    });
  }

  /** Rewrites an event; fields left undefined keep their current value. */
  async update(serverId: string, id: number, changes: EventInput): Promise<boolean> {
    const existing = await this.getById(serverId, id);
    if (!existing) return false;

    const pick = <T>(next: T | undefined, current: T): T => (next === undefined ? current : next);
    const result = await this.db.executeQuery(eventQueries.UPDATE_EVENT, [
      pick(changes.name, existing.name),
      pick(changes.description, existing.description),
      pick(changes.startsAt, existing.startsAt),
      pick(changes.endsAt, existing.endsAt),
      pick(changes.location, existing.location),
      pick(changes.url, existing.url),
      id,
      serverId,
    ]);
    return result.changes > 0;
  }

  async delete(serverId: string, id: number): Promise<boolean> {
    const result = await this.db.executeQuery(eventQueries.DELETE_EVENT, [id, serverId]);
    return result.changes > 0;
  }

  async getById(serverId: string, id: number): Promise<EventEntry | null> {
    const row = await this.db.executeSelectQuery(eventQueries.GET_EVENT, [id, serverId]);
    return (row as EventEntry) ?? null;
  }

  async listAll(serverId: string, limit = 50): Promise<EventEntry[]> {
    return this.db.executeSelectAllQuery(eventQueries.LIST_ALL, [serverId, limit]) as Promise<EventEntry[]>;
  }

  /** Events that haven't finished yet, soonest first. */
  async listUpcoming(serverId: string, limit = 25, now: Date = new Date()): Promise<EventEntry[]> {
    return this.db.executeSelectAllQuery(
      eventQueries.LIST_UPCOMING,
      [serverId, now.toISOString(), limit],
    ) as Promise<EventEntry[]>;
  }
}

export default EventModel;
