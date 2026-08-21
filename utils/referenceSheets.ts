/**
 * Markdown-backed reference sheets served to the AI personas as tool results.
 *
 * All four sheets (official links, UWA key dates, student perks, club FAQ) are
 * the same shape — a hand-maintained file in data/skills/ read at first use and
 * cached — so they are declared as data here rather than copy-pasted into four
 * near-identical tool implementations. Adding a sheet means adding one row to
 * SHEETS.
 *
 * Two behaviours exist because hand-maintained content rots:
 *
 *  - **Coverage years.** A sheet may declare `<!-- covers: 2026 -->`. When the
 *    current Perth year is outside that set, the served text is prefixed with a
 *    hard warning telling the model it has no data for this year and must not
 *    guess. A forgotten yearly update therefore degrades into "I don't know"
 *    instead of a confident wrong answer about next year's census date.
 *  - **Unfilled entries.** A sheet may mark sections `<!-- TODO -->`. Those are
 *    stripped before the model sees them, so a half-written FAQ can ship without
 *    Marv reading "TODO" aloud to a member.
 *
 * Results are TRUSTED (not wrapped in <<MCP_TOOL_RESULT>> markers) — they come
 * from our own repo, not the open web.
 */

import { logError } from './log';
import { perthYear } from './perthTime';

export interface SheetDef {
  /** Tool name exposed to the model. */
  toolName: string;
  /** File under data/skills/. */
  file: string;
  description: string;
  /**
   * Years this sheet's content is valid for, parsed from its `covers:` marker
   * at load time. Sheets without a marker are evergreen.
   */
  yearScoped: boolean;
}

const SHEETS: SheetDef[] = [
  {
    toolName: 'recall_club_links',
    file: 'club-links.md',
    description: 'Returns the club\'s official public links (UWA Student Guild club page and membership sign-up, '
      + 'LinkedIn, Instagram, permanent Discord invite) plus UWA\'s own AI course and library-guide pages. Call this '
      + 'whenever someone asks how to join, where to find the club online, for an invite link, or for UWA study/'
      + 'library resources on AI — never guess or recall a URL from memory.',
    yearScoped: false,
  },
  {
    toolName: 'recall_key_dates',
    file: 'uwa-calendar.md',
    description: 'Returns UWA\'s academic calendar: semester teaching periods, mid-semester and study breaks, census '
      + 'dates, withdrawal deadlines, exam periods and results release. Call this whenever someone asks when semester '
      + 'starts or ends, when the census/withdrawal deadline is, when exams are, or how many teaching weeks are left. '
      + 'These dates carry money and academic-record consequences, so quote the sheet and always link the official '
      + 'page — never estimate a date.',
    yearScoped: true,
  },
  {
    toolName: 'recall_student_perks',
    file: 'student-perks.md',
    description: 'Returns free and discounted tools available to students (developer packs, cloud and AI credits, '
      + 'software, compute). Call this when someone asks how to get a tool for free, what student discounts exist, or '
      + 'where to get compute/GPU access for a project. Every entry carries a last-checked date — say when an entry '
      + 'was last verified and tell the user to confirm on the provider\'s page, because these offers change often.',
    yearScoped: true,
  },
  {
    toolName: 'recall_faq',
    file: 'faq.md',
    description: 'Returns answers to common practical questions about the club: joining, fees, whether you need to '
      + 'code, who events are for, which channel to use, and Discord etiquette. Call this for any "how does the club '
      + 'work" question. For governance, rules, committee duties or elections use recall_constitution instead — this '
      + 'sheet is the practical side only.',
    yearScoped: false,
  },
];

export const SHEET_TOOL_NAMES = SHEETS.map((s) => s.toolName);

const SKILLS_DIR = `${import.meta.dir}/../data/skills`;

const COVERS_RE = /<!--\s*covers:\s*([\d,\s-]+)\s*-->/i;
/** A section whose body is only a TODO marker is not ready to be served. */
const TODO_MARKER_RE = /<!--\s*TODO[^>]*-->/i;

/** Parses `<!-- covers: 2026 -->` (or `2026, 2027`) into a set of years. */
export function parseCoverageYears(text: string): number[] {
  const match = COVERS_RE.exec(text);
  if (!match) return [];
  const years = new Set<number>();
  for (const part of match[1].split(',')) {
    const range = /^\s*(\d{4})\s*-\s*(\d{4})\s*$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to - from <= 20) {
        for (let y = from; y <= to; y += 1) years.add(y);
      }
      continue;
    }
    const single = Number(part.trim());
    if (Number.isInteger(single) && single > 1900 && single < 3000) years.add(single);
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * Drops sections whose body is an unfilled TODO. A section runs from a `##`/`###`
 * heading to the next heading of the same or higher level, so an unanswered FAQ
 * entry disappears cleanly instead of leaking a placeholder.
 */
export function stripTodoSections(text: string): { text: string; strippedCount: number } {
  const lines = text.split('\n');
  const out: string[] = [];
  let strippedCount = 0;
  let i = 0;

  while (i < lines.length) {
    const headingMatch = /^(#{2,6})\s/.exec(lines[i]);
    if (!headingMatch) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    const level = headingMatch[1].length;
    let end = i + 1;
    while (end < lines.length) {
      const nextHeading = /^(#{2,6})\s/.exec(lines[end]);
      if (nextHeading && nextHeading[1].length <= level) break;
      end += 1;
    }

    const body = lines.slice(i + 1, end).join('\n');
    if (TODO_MARKER_RE.test(body)) {
      strippedCount += 1;
    } else {
      out.push(...lines.slice(i, end));
    }
    i = end;
  }

  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), strippedCount };
}

/**
 * The staleness banner prepended when a year-scoped sheet doesn't cover today.
 * Deliberately blunt: the failure mode we're guarding against is the model
 * confidently inventing next year's dates.
 */
export function buildCoverageNotice(
  toolName: string,
  coverage: number[],
  currentYear: number,
): string | null {
  if (coverage.length === 0) {
    return 'NOTE: this sheet does not declare which year it covers, so treat every date in it as unverified — '
      + 'tell the user to confirm on the official page.';
  }
  if (coverage.includes(currentYear)) return null;
  return `WARNING: it is now ${currentYear}, but this sheet only covers ${coverage.join(', ')}. It is OUT OF DATE. `
    + `Do NOT use, adapt, or extrapolate any date below for ${currentYear} — the pattern does not repeat reliably. `
    + `Tell the user plainly that ${toolName} has no ${currentYear} data yet, point them at the official UWA page, `
    + 'and suggest they ask committee to update the sheet.';
}

interface CachedSheet { text: string }
const cache = new Map<string, CachedSheet>();

export function sheetByToolName(toolName: string): SheetDef | undefined {
  return SHEETS.find((s) => s.toolName === toolName);
}

/** Reads, caches, and post-processes a sheet for the model. */
export async function getSheet(toolName: string, now: Date = new Date()): Promise<string> {
  const sheet = sheetByToolName(toolName);
  if (!sheet) return `Error: unknown reference sheet "${toolName}".`;

  let raw = cache.get(sheet.file)?.text;
  if (raw === undefined) {
    try {
      raw = await Bun.file(`${SKILLS_DIR}/${sheet.file}`).text();
      cache.set(sheet.file, { text: raw });
    } catch (err) {
      logError(`[sheets] failed to read ${sheet.file}:`, err);
      return `Error: the ${sheet.file} reference sheet is unavailable right now. Tell the user you cannot look this `
        + 'up and suggest they ask a committee member.';
    }
  }

  const { text: body, strippedCount } = stripTodoSections(raw);
  const parts: string[] = [];

  if (sheet.yearScoped) {
    const notice = buildCoverageNotice(sheet.toolName, parseCoverageYears(raw), perthYear(now));
    if (notice) parts.push(notice);
  }
  if (strippedCount > 0) {
    const noun = strippedCount === 1 ? 'entry is' : 'entries are';
    parts.push(`NOTE: ${strippedCount} ${noun} not filled in yet and ha${strippedCount === 1 ? 's' : 've'} been `
      + 'omitted. If the question is not answered below, say you do not have an official answer yet and point the '
      + 'user at a committee member — do not improvise one.');
  }
  if (body.trim().length === 0) {
    return `Error: the ${sheet.file} sheet has no filled-in content yet. Tell the user you don't have an official `
      + 'answer and point them at a committee member.';
  }
  parts.push(body);

  return parts.join('\n\n');
}

export function sheetToolDefs(): any[] {
  return SHEETS.map((sheet) => ({
    type: 'function',
    function: {
      name: sheet.toolName,
      description: sheet.description,
      parameters: { type: 'object', properties: {} },
    },
  }));
}

/** System-prompt note advertising the sheets (kept tiny — detail is in the tool descriptions). */
export function buildSheetsNote(): string {
  return `\n\nReference sheets you can read: ${SHEET_TOOL_NAMES.join(', ')}. These are the ONLY source for club `
    + 'links, UWA dates and student offers — never recall a URL or a date from memory, and if a sheet says it is out '
    + 'of date, say so rather than guessing.';
}
