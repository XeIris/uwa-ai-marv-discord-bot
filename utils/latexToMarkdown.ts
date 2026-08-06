/**
 * A deliberately narrow LaTeX → markdown converter for the club constitution
 * (scripts/fetch-constitution.ts). It handles exactly what constitution.tex uses:
 * \section, \subsection, and nested `enumerate` environments whose `label=` spec
 * carries the clause numbering (4.1, 14.2.3, …).
 *
 * Preserving those clause numbers is the whole point — Marv cites them back to
 * members, so they must match the published PDF rather than being re-derived.
 * This is not a general-purpose LaTeX parser and should not be used as one.
 */

interface EnumerateLevel {
  /** Text prefixed to the item number, e.g. "4." producing 4.1, 4.2, … */
  prefix: string;
  counter: number;
  /** Full label of the most recent item, used when a child says \theenumi. */
  lastLabel: string;
}

/** Strips `%` comments while leaving escaped `\%` alone. */
function stripComments(line: string): string {
  let out = '';
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '%' && line[i - 1] !== '\\') break;
    out += line[i];
  }
  return out;
}

/** Turns leftover inline markup into plain text. */
function cleanInline(text: string): string {
  return text
    // Drop layout-only commands outright, with their arguments.
    .replace(/\\(?:hspace|vspace|makebox|setlength|label|ref|hfill|hrulefill|noindent|clearpage|newpage|normalsize|large|Large|footnotesize|bfseries|centering)\*?(?:\[[^\]]*\])?(?:\{[^{}]*\})?/g, '')
    // Unwrap formatting commands, keeping their content.
    .replace(/\\(?:textbf|textit|emph|underline|texttt|textsf)\{([^{}]*)\}/g, '$1')
    .replace(/\\href\{([^{}]*)\}\{([^{}]*)\}/g, '$2 ($1)')
    .replace(/\\url\{([^{}]*)\}/g, '$1')
    // Escapes.
    .replace(/\\\\/g, ' ')
    .replace(/\\([&%$#_{}])/g, '$1')
    // Anything still unrecognised: drop the command, keep any braced content.
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, '')
    // …which can leave the empty argument braces of e.g. \renewcommand{\x}{} behind.
    .replace(/\{\s*\}/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Reads the numbering prefix out of an `enumerate` option list.
 * `[label=4.\arabic*]` → "4." · `[label=\theenumi.\arabic*]` → the parent item's label.
 */
function resolvePrefix(options: string, parent: EnumerateLevel | undefined): string {
  const match = /label\s*=\s*([^,\]]*)/.exec(options);
  if (!match) return parent ? `${parent.lastLabel}.` : '';

  let prefix = match[1].replace(/\\arabic\s*\*?/g, '').replace(/\\theenumi\b/g, parent ? parent.lastLabel : '');
  prefix = prefix.replace(/[{}]/g, '').trim();
  return prefix;
}

export function latexToMarkdown(tex: string): string {
  const documentStart = tex.indexOf('\\begin{document}');
  const source = documentStart === -1 ? tex : tex.slice(documentStart + '\\begin{document}'.length);

  const lines = source.split('\n').map(stripComments);
  const out: string[] = [];
  const stack: EnumerateLevel[] = [];
  let pending: string | null = null;

  const flush = (): void => {
    if (pending === null) return;
    const text = cleanInline(pending);
    pending = null;
    if (text.length === 0) return;
    out.push(text);
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (line.length === 0) {
      flush();
      continue;
    }
    if (line.startsWith('\\end{document}')) break;

    const section = /^\\section\*?\{(.*)\}$/.exec(line);
    const subsection = /^\\subsection\*?\{(.*)\}$/.exec(line);
    const beginEnum = /^\\begin\{enumerate\}(\[[^\]]*\])?/.exec(line);

    if (section) {
      flush();
      out.push('', `## ${cleanInline(section[1])}`, '');
      continue;
    }
    if (subsection) {
      flush();
      out.push('', `### ${cleanInline(subsection[1])}`, '');
      continue;
    }
    if (beginEnum) {
      flush();
      stack.push({
        prefix: resolvePrefix(beginEnum[1] ?? '', stack[stack.length - 1]),
        counter: 0,
        lastLabel: '',
      });
      continue;
    }
    if (line.startsWith('\\end{enumerate}')) {
      flush();
      stack.pop();
      continue;
    }
    if (line.startsWith('\\item')) {
      flush();
      const level = stack[stack.length - 1];
      const body = line.replace(/^\\item\s*(\[[^\]]*\])?\s*/, '');
      if (level) {
        level.counter += 1;
        level.lastLabel = `${level.prefix}${level.counter}`;
        const indent = '  '.repeat(Math.max(stack.length - 1, 0));
        pending = `${indent}${level.lastLabel} ${body}`;
      } else {
        pending = `- ${body}`;
      }
      continue;
    }

    // Continuation of the current item / paragraph.
    pending = pending === null ? line : `${pending} ${line}`;
  }
  flush();

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default latexToMarkdown;
