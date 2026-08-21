import { log, logError } from './log';

/**
 * Reacts to the OS low-memory notification (Bun 1.4's `process.on('memoryPressure')`).
 *
 * The bot runs under a hard 1 GB container limit (`docker-compose.yaml`), where the
 * usual outcome of a slow leak is an OOM kill with no warning. discord.js caches are
 * the biggest reclaimable thing in the process, and the periodic sweepers configured
 * in `index.ts` only run on their own interval — this drops them on demand instead,
 * when the kernel says memory is actually short.
 *
 * `warning` (macOS only) is logged but not acted on: it fires routinely and sweeping
 * every cache each time would just cost re-fetches. Only `critical` sweeps.
 */

/**
 * A sweep is cheap but the refetches afterwards are not, and pressure notifications
 * arrive in bursts — one sweep per minute is enough to matter without thrashing.
 */
const SWEEP_COOLDOWN_MS = 60_000;

const MB = 1024 * 1024;

let lastSweepAt = 0;

/** Test seam — forgets the last sweep so the cooldown doesn't leak between tests. */
export function resetMemoryPressureState(): void {
  lastSweepAt = 0;
}

/**
 * Sweeps the reclaimable discord.js caches and forces a GC. Exported for the tests;
 * `registerMemoryPressureHandler` is the real entry point.
 *
 * Returns true if a sweep ran, false if the level was advisory or the cooldown was
 * still in effect.
 */
export function handleMemoryPressure(
  client: any,
  level: 'warning' | 'critical',
  now: number = Date.now(),
): boolean {
  if (level !== 'critical') {
    log(`[mem] os reports memory pressure (${level}); not sweeping`);
    return false;
  }
  if (now - lastSweepAt < SWEEP_COOLDOWN_MS) return false;
  lastSweepAt = now;

  const before = process.memoryUsage().rss;
  let swept = 0;
  try {
    // Messages and users are pure cache — anything dropped here is re-fetched from
    // Discord on demand. Members are left alone: the AI prompt tagger and the
    // welcome card read them per request, so evicting them buys little and costs
    // a round trip on the next message.
    swept += client.sweepers?.sweepMessages?.(() => true) ?? 0;
    swept += client.sweepers?.sweepUsers?.((user: any) => user.id !== client.user?.id) ?? 0;
  } catch (err) {
    logError('[mem] cache sweep under memory pressure failed', err);
  }

  Bun.gc(true);

  const after = process.memoryUsage().rss;
  log(
    `[mem] critical memory pressure: swept ${swept} cached entries, `
    + `rss ${Math.round(before / MB)}MB -> ${Math.round(after / MB)}MB`,
  );
  return true;
}

/** Wires the handler up. Safe to call once at startup; a no-op on runtimes without the event. */
export function registerMemoryPressureHandler(client: any): void {
  process.on('memoryPressure', (level) => {
    try {
      handleMemoryPressure(client, level);
    } catch (err) {
      logError('[mem] memory pressure handler failed', err);
    }
  });
}
