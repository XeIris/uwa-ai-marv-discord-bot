/**
 * Parses comma-separated channel-ID config values.
 *
 * Both parsers **de-duplicate**: a stored value is semantically a set, and a
 * repeat would make the event scheduler post the same reminder twice to the same
 * channel.
 */

/** Discord snowflakes are 17-20 digit decimal ids. */
const SNOWFLAKE_RE = /^\d{17,20}$/;

/**
 * Trims, drops blanks, de-duplicates. Deliberately does *not* enforce the
 * snowflake shape: these values are also rendered back to admins by
 * `/serverconfig get` and `/globalconfig get`, and silently hiding an entry an
 * admin can see stored would be worse than showing it.
 */
export function parseChannelIds(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const part of (raw || '').split(',')) {
    const id = part.trim();
    if (id) seen.add(id);
  }
  return [...seen];
}

/**
 * As above, but keeps only well-formed snowflakes. Use this where the ids are
 * about to be handed to the Discord API unattended — the event reminder
 * scheduler — so a malformed value can't turn into a failed fetch every tick.
 */
export function parseSnowflakeIds(raw: string | null | undefined): string[] {
  return parseChannelIds(raw).filter((id) => SNOWFLAKE_RE.test(id));
}
