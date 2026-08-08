/**
 * UWA unit lookup (`lookup_unit`).
 *
 * The handbook exposes a deterministic URL per unit code
 * (`handbooks.uwa.edu.au/unitdetails?code=CITS3001`), so this needs no search
 * engine: validate the code, fetch that one page, extract the useful fields.
 *
 * The URL is BUILT from a code matched against /^[A-Z]{4}\d{4}$/ — never from
 * model- or user-supplied text — so this cannot be pointed at another host. Keep
 * it that way: taking a URL argument here would turn the tool into an SSRF
 * primitive against the Docker network.
 *
 * Unit availability, prerequisites and points change between handbook years, and
 * the extraction below is best-effort HTML scraping. The tool result therefore
 * always carries the canonical URL and tells the model to link it, because a
 * confidently wrong prerequisite is worse for a student than no answer.
 */

import { logError, log } from './log';

export const UNIT_TOOL_NAME = 'lookup_unit';

const UNIT_CODE_RE = /^[A-Z]{4}\d{4}$/;
const HANDBOOK_HOST = 'handbooks.uwa.edu.au';
const FETCH_TIMEOUT_MS = 12_000;
/** Handbook pages are ~100-200 KB; anything far past that isn't the page we want. */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_FIELD_CHARS = 600;

const TOOL_DESCRIPTION = 'Looks up a UWA unit by its code (e.g. CITS3001, STAT2062, PHIL1001) in the official UWA '
  + 'Handbook and returns its title, level, credit points, prerequisites and outline. Call this whenever someone asks '
  + 'what a unit is, what its prerequisites are, how many points it is, or whether they can take it. Always include '
  + 'the handbook link from the result in your reply, and say that availability and prerequisites can change — the '
  + 'handbook is authoritative, not you. This looks up ONE unit per call; call it again for another code.';

const CODE_DESCRIPTION = 'The unit code: exactly four letters then four digits, e.g. "CITS3001". Case-insensitive. '
  + 'Not a unit name — if the user gave a name rather than a code, ask them for the code instead of guessing one.';

export function unitToolDef(): any {
  return {
    type: 'function',
    function: {
      name: UNIT_TOOL_NAME,
      description: TOOL_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: CODE_DESCRIPTION } },
        required: ['code'],
      },
    },
  };
}

export function unitGeminiDecl(): any {
  return {
    name: UNIT_TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: {
      type: 'OBJECT',
      properties: { code: { type: 'STRING', description: CODE_DESCRIPTION } },
      required: ['code'],
    },
  };
}

/** System-prompt note advertising the unit tool. */
export function buildUnitNote(): string {
  return `\n\nYou can look up any UWA unit by code with ${UNIT_TOOL_NAME} (e.g. CITS3001). Use it instead of `
    + 'recalling unit details from memory, and always pass on the handbook link it returns.';
}

/** Normalises and validates a unit code. Returns null when it isn't one. */
export function normalizeUnitCode(raw: any): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase().replace(/\s+/g, '');
  return UNIT_CODE_RE.test(code) ? code : null;
}

export function handbookUrl(code: string): string {
  return `https://${HANDBOOK_HOST}/unitdetails?code=${code}`;
}

/** Strips markup to readable text. Script/style bodies go first so their contents don't leak in. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Collapse runs of spaces/tabs/non-breaking spaces, but keep newlines.
    .replace(/[^\S\n]+/g, ' ')
    // Trim each line and drop blank ones. Without this every line inherits the
    // leading space left by the stripped tag, which leaks into extracted values.
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

export interface UnitDetails {
  code: string;
  title: string | null;
  fields: { label: string; value: string }[];
}

/**
 * Pulls the fields we care about out of a handbook page. Best-effort by design:
 * a missing field is omitted rather than guessed, and the caller always shows
 * the URL so the user can check the real page.
 */
export function parseUnitPage(html: string, code: string): UnitDetails {
  // <title>Advanced Algorithms [CITS3001] : Handbook 2026 : ...</title>
  const rawTitle = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  const titleText = htmlToText(rawTitle);
  let title: string | null = null;
  const titleMatch = new RegExp(`^(.*?)\\s*\\[${code}\\]`).exec(titleText);
  if (titleMatch && titleMatch[1].trim()) title = titleMatch[1].trim();

  const text = htmlToText(html);
  const fields: { label: string; value: string }[] = [];

  // Patterns anchored on the page's real structure (verified against live pages),
  // not on guessed "Label\nValue" pairs:
  //  - the unit description is the paragraph immediately before "Credit N points";
  //  - the offering row follows the "Availability Location Mode" table header;
  //  - a bare /Content/ match would hit the "unit content may change" boilerplate,
  //    so the description is captured positionally instead.
  const LABELS: [string, RegExp][] = [
    ['About', /([^\n]{40,})\r?\n\s*Credit\s+\d/i],
    ['Credit points', /\bCredit\s+(\d+(?:\.\d+)?)\s*points?/i],
    ['Offered', /\bAvailability\s+Location\s+Mode\s*\r?\n?\s*([^\n]{3,})/i],
    ['Level', /\bLevel\s+(\d[^\n]*)/i],
    ['Prerequisites', /\bPrerequisites?\s*\r?\n?\s*([^\n]{3,})/i],
    ['Corequisites', /\bCo-?requisites?\s*\r?\n?\s*([^\n]{3,})/i],
    ['Incompatibility', /\bIncompatibility\s*\r?\n?\s*([^\n]{3,})/i],
    ['Outcomes', /\bOutcomes?\s*\r?\n?\s*([^\n]{3,})/i],
    ['Assessment', /\bAssessment\s*\r?\n?\s*([^\n]{3,})/i],
  ];

  for (const [label, re] of LABELS) {
    const value = re.exec(text)?.[1]?.trim();
    if (value) fields.push({ label, value: value.slice(0, MAX_FIELD_CHARS) });
  }

  return { code, title, fields };
}

export function formatUnitDetails(details: UnitDetails, url: string): string {
  const lines: string[] = [];
  lines.push(details.title ? `**${details.title}** (${details.code})` : `**${details.code}**`);
  for (const field of details.fields) lines.push(`${field.label}: ${field.value}`);
  if (details.fields.length === 0) {
    lines.push('(No structured details could be read from the page — send the user the link and let them read it.)');
  }
  lines.push(`Handbook: ${url}`);
  lines.push('Reproduce that handbook link in your reply, and note that availability and prerequisites can change '
    + 'between years — the handbook is authoritative.');
  return lines.join('\n');
}

/** Handler for the lookup_unit tool. Never throws; returns an `Error: …` string instead. */
export async function runUnitLookup(args: { code?: string } = {}): Promise<string> {
  const code = normalizeUnitCode(args?.code);
  if (!code) {
    return `Error: "${String(args?.code ?? '')}" is not a UWA unit code. A code is four letters then four digits, `
      + 'like CITS3001. If the user gave you a unit name instead, ask them for the code — do not guess one.';
  }

  const url = handbookUrl(code);
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'text/html' },
      redirect: 'follow',
    });

    if (res.status === 404) {
      return `Error: the handbook has no unit ${code} for the current year. Tell the user the code may be wrong or `
        + `the unit may not be offered, and point them at ${url} to check.`;
    }
    if (!res.ok) {
      return `Error: the UWA handbook returned HTTP ${res.status} for ${code}. Tell the user to check ${url} directly.`;
    }

    // Guard against an unexpectedly huge body before reading it all into memory.
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      return `Error: the handbook page for ${code} was unexpectedly large. Tell the user to check ${url} directly.`;
    }

    const html = (await res.text()).slice(0, MAX_RESPONSE_BYTES);
    const details = parseUnitPage(html, code);

    // A redirect to a search/landing page yields neither title nor fields.
    if (!details.title && details.fields.length === 0) {
      return `Error: no unit page could be read for ${code} — the code is probably wrong or the unit isn't in the `
        + `current handbook. Point the user at ${url}.`;
    }

    log(`[unit] looked up ${code} (${details.fields.length} field(s))`);
    return formatUnitDetails(details, url);
  } catch (err) {
    logError(`[unit] lookup failed for ${code}:`, err);
    return `Error: couldn't reach the UWA handbook for ${code} just now. Tell the user to try ${url} directly.`;
  }
}
