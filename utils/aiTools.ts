/**
 * Per-user switches for Marv's optional tools.
 *
 * Every tool costs system-prompt tokens on every turn even when it is never
 * called: each one appends a note explaining itself, and web search additionally
 * injects its JSON schemas. `/ai tools` lets a member turn off the ones they
 * don't want and stop paying for them.
 *
 * **Everything is ON by default** — a missing row in AiToolPreference means
 * enabled. This is the deliberate inverse of the upstream project, which
 * defaults every tool off: Marv exists to be useful to club members who will
 * never read a settings command, and a tool nobody knows to enable is a tool
 * nobody uses. The switches are an escape hatch for the minority who want a
 * leaner, cheaper Marv, not a gate on the majority.
 *
 * The club data tools (constitution, committee roster, events, reference sheets,
 * unit lookup) are deliberately NOT switchable — they are the reason this fork
 * exists, they are the only source of truth Marv has about the club, and turning
 * them off would leave him guessing at exactly the questions he's for.
 */

/** Whitelist of switchable tool keys. Anything not in here never reaches SQL. */
export const AI_TOOL_KEYS = ['websearch', 'imagegen', 'musicgen', 'diagrams', 'pdf'] as const;

export type AiToolKey = (typeof AI_TOOL_KEYS)[number];

/** Command-only target meaning "every switchable tool". Never a stored key. */
export const AI_TOOL_ALL = 'all';

export interface AiToolInfo {
  /** Name shown in command output. */
  label: string;
  /** One line explaining what turning it off costs you. */
  description: string;
}

export const AI_TOOL_INFO: Record<AiToolKey, AiToolInfo> = {
  websearch: {
    label: 'Web search',
    description: 'Lets Marv look things up online for current events, prices, and anything newer '
      + 'than his training data. The most expensive tool to leave on — it injects its full schemas '
      + 'into every request.',
  },
  imagegen: {
    label: 'Image generation',
    description: 'Lets Marv draw pictures, and edit an image you attach. Also spends a large share '
      + 'of your AI credit budget per image.',
  },
  musicgen: {
    label: 'Music generation',
    description: 'Lets Marv compose short pieces of music and send them back as audio.',
  },
  diagrams: {
    label: 'Diagram rendering',
    description: 'Lets Marv draw flowcharts, tables, and other diagrams as images instead of ASCII art.',
  },
  pdf: {
    label: 'PDF reading',
    description: 'Lets Marv read the text of PDF files you attach. With this off, an attached PDF '
      + 'is ignored.',
  },
};

export function isAiToolKey(value: unknown): value is AiToolKey {
  return typeof value === 'string' && (AI_TOOL_KEYS as readonly string[]).includes(value);
}

/** All switchable tools, all on — the default every user starts from. */
export function defaultAiTools(): Record<AiToolKey, boolean> {
  return AI_TOOL_KEYS.reduce((acc, key) => {
    acc[key] = true;
    return acc;
  }, {} as Record<AiToolKey, boolean>);
}
