import fs from 'fs';
import path from 'path';

/**
 * Memory diagnostics for the /dev ramstats command. Collects process memory,
 * discord.js cache sizes, and DB footprint so a leak can be localised (JS heap
 * vs native, which cache, or just DB/log growth) without attaching an
 * inspector to the prod container.
 */

const DB_PATH = path.join(import.meta.dir, '../persistence/database.db');

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export interface MemStats {
  forceGc: boolean;
  /** process.memoryUsage() after the optional GC */
  mem: NodeJS.MemoryUsage;
  /** process.memoryUsage() before the GC (equal to mem when forceGc is false) */
  before: NodeJS.MemoryUsage;
  guilds: number;
  channels: number;
  users: number;
  messageCacheTotal: number;
  memberCacheTotal: number;
  deletedMessages: number;
  editedMessages: number;
  dbFileBytes: number;
}

export async function collectMemStats(client: any, forceGc = false): Promise<MemStats> {
  const before = process.memoryUsage();
  if (forceGc) Bun.gc(true);
  const mem = forceGc ? process.memoryUsage() : before;

  // discord.js caches
  let messageCacheTotal = 0;
  let memberCacheTotal = 0;
  for (const channel of client.channels.cache.values()) {
    messageCacheTotal += (channel as any).messages?.cache?.size ?? 0;
  }
  for (const guild of client.guilds.cache.values()) {
    memberCacheTotal += (guild as any).members?.cache?.size ?? 0;
  }

  return {
    forceGc,
    mem,
    before,
    guilds: client.guilds.cache.size,
    channels: client.channels.cache.size,
    users: client.users.cache.size,
    messageCacheTotal,
    memberCacheTotal,
    deletedMessages: client.deletedMessages?.length ?? 0,
    editedMessages: client.editedMessages?.length ?? 0,
    dbFileBytes: fileSize(DB_PATH),
  };
}
