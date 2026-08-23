// One shared registry of in-flight per-user operations. Upstream chained every
// economy mutation through this so the same user can't run two of them
// concurrently (they read-check-write the same balances non-atomically). This
// fork stripped the economy, but the generic primitive is still useful: the AI
// session lock (utils/aiSessionLock.ts) uses its own registry, keyed per chat
// session, to serialize content-safety pause checks against in-flight turns.
export const userLocks = new Map<string, Promise<any>>();

// Serialize concurrent calls for the same key through a per-key promise chain.
//
// Callers should pass a shared registry rather than a private per-module map,
// so every mutation for a key chains on the same map entry and can't race. We
// capture the previous in-flight promise and register our own `run`
// synchronously in the same tick, so two callers arriving back-to-back are
// guaranteed to chain rather than both observe an empty slot and race through the
// inner work. (A `while (existing) await existing` loop that re-reads the map after
// awaiting can let callers resume in parallel as soon as a predecessor settles —
// this avoids that.)
export function withUserLock<T>(
  locks: Map<string, Promise<any>>,
  key: string,
  inner: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(key);
  const run: Promise<T> = (async () => {
    if (previous) await previous.catch(() => undefined);
    return inner();
  })();
  locks.set(key, run);
  return (async () => {
    try {
      return await run;
    } finally {
      if (locks.get(key) === run) locks.delete(key);
    }
  })();
}
