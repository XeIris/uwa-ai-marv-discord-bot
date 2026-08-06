/**
 * The `-n` flag asks the mention handler to start a fresh chat session.
 *
 * It replaces the base repo's "kys", which matched anywhere in a message and so
 * wiped your history if you happened to use the word. `-n` has to be its own
 * token, and unlike "kys" it's a flag rather than content, so it's stripped
 * before the message reaches the model.
 */

/** Matches a standalone `-n` token: start-of-string or whitespace either side. */
const NEW_SESSION_FLAG = /(?:^|\s)-n(?=\s|$)/i;

export interface NewSessionFlag {
  /** Whether the flag was present. */
  requested: boolean;
  /** The message with the flag removed — what the model should actually see. */
  text: string;
}

export function parseNewSessionFlag(content: string): NewSessionFlag {
  if (typeof content !== 'string' || !NEW_SESSION_FLAG.test(content)) {
    return { requested: false, text: typeof content === 'string' ? content : '' };
  }
  // Only the first occurrence: a later "-n" is the user's own text. The match
  // swallows the whitespace *before* the flag and the lookahead leaves the
  // whitespace after it, so removing the match keeps exactly one separator and
  // doesn't disturb newlines elsewhere in the message.
  return { requested: true, text: content.replace(NEW_SESSION_FLAG, '').trim() };
}

export default parseNewSessionFlag;
