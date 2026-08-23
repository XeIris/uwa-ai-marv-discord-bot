import { withUserLock } from './userLock';

/**
 * Per-AI-session serialization.
 *
 * Content-safety pausing is a read-check-write across separate operations: a
 * turn reads `moderation_flagged`, generates (seconds to minutes), then writes
 * history and delivers. Without serialization a concurrent turn can flag the
 * session in that gap, and the in-flight turn still lands — persisting into and
 * replying from a chat that is now paused. Re-reading before the write narrows
 * that window but cannot close it, because the read and the insert are not
 * atomic.
 *
 * Holding this lock for the whole check → generate → persist → deliver sequence
 * closes it. Two messages to the same conversation queue instead of racing,
 * which is the desired behaviour for a chat session regardless of moderation.
 *
 * Deliberately a **separate registry** from `userLocks`: those chain the economy
 * mutations, and an LLM call can run for minutes — sharing the registry would
 * stall a user's other operations behind their own AI reply.
 */
const aiSessionLocks = new Map<string, Promise<any>>();

export function withAiSessionLock<T>(sessionId: number, inner: () => Promise<T>): Promise<T> {
  return withUserLock(aiSessionLocks, `ai-session:${sessionId}`, inner);
}
