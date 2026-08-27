/**
 * Single-letter flags the mention handler reads off a message before the model
 * ever sees it.
 *
 *   `-n`  start a fresh chat session
 *   `-f`  forget the last turn (your message and the reply to it)
 *
 * They replace the base repo's bare command words ("kys", "amnesia"), which
 * matched anywhere in a message and so fired on ordinary sentences that happened
 * to contain them. A flag has to be its own token, and unlike a command word it
 * is content-free, so it's stripped before the message reaches the model.
 *
 * Both are standalone commands: the handler acts on the flag and returns rather
 * than also answering the message.
 */

/**
 * Matches a standalone single-letter flag: start-of-string or whitespace before,
 * whitespace or end-of-string after. The lookahead (rather than a consumed
 * character) is what keeps `-n` from eating the newline in a multi-line message.
 */
function flagPattern(letter: string): RegExp {
  return new RegExp(`(?:^|\\s)-${letter}(?=\\s|$)`, 'i');
}

export interface SessionFlag {
  /** Whether the flag was present. */
  requested: boolean;
  /** The message with the flag removed — what the model should actually see. */
  text: string;
}

/**
 * Strips the first occurrence of one flag. Only the first: a later `-n` is the
 * user's own text (as in "what does -n do?"). The match swallows the whitespace
 * *before* the flag and the lookahead leaves the whitespace after it, so removing
 * it keeps exactly one separator and doesn't disturb newlines elsewhere.
 */
function parseFlag(content: string, letter: string): SessionFlag {
  const pattern = flagPattern(letter);
  if (typeof content !== 'string' || !pattern.test(content)) {
    return { requested: false, text: typeof content === 'string' ? content : '' };
  }
  return { requested: true, text: content.replace(pattern, '').trim() };
}

/** `-n` — start a fresh chat session. */
export function parseNewSessionFlag(content: string): SessionFlag {
  return parseFlag(content, 'n');
}

/** `-f` — forget the last turn. */
export function parseForgetFlag(content: string): SessionFlag {
  return parseFlag(content, 'f');
}

export interface SessionFlags {
  newSession: boolean;
  forgetLast: boolean;
  /** The message with every recognised flag removed. */
  text: string;
}

/**
 * Parses every flag in one pass. `-n` and `-f` are mutually exclusive in effect
 * — starting a fresh session already discards the last turn — so when both are
 * present the handler treats it as `-n` alone; both are still stripped here so
 * neither can leak into the prompt.
 */
export function parseSessionFlags(content: string): SessionFlags {
  const newSession = parseNewSessionFlag(content);
  const forgetLast = parseForgetFlag(newSession.text);
  return {
    newSession: newSession.requested,
    forgetLast: forgetLast.requested,
    text: forgetLast.text,
  };
}

export default parseNewSessionFlag;
