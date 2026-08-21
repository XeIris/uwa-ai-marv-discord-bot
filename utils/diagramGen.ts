/**
 * Diagram rendering for the AI chat personas — "artifacts", Discord-style.
 *
 * The model writes a restricted subset of HTML/CSS (laid out by satori) or raw
 * SVG (rasterised by resvg), and gets back a PNG attached to its reply. Both
 * engines are pure JS/WASM: no Chromium, no native build deps, ~100ms a render.
 *
 * This renders MODEL-AUTHORED MARKUP, so both front-ends are strict allowlists
 * that **rebuild** their output from parsed tokens rather than pattern-stripping
 * a hostile string. Anything not explicitly allowed is a hard error the model
 * sees and can fix. Consequences worth keeping true:
 *   - no `<img>`, no `<image>`, no `<use href="http…">`, no `url(...)` in CSS,
 *     no `<style>` element, no `@import` — so a render can never fetch a remote
 *     resource or read a local file (no SSRF, no file exfiltration);
 *   - no `<script>`, no `on*` handlers, no `<foreignObject>`, no `javascript:`;
 *   - no `<!DOCTYPE>`/`<!ENTITY>`/CDATA, so no entity-expansion bomb;
 *   - fonts come only from data/fonts (`loadSystemFonts: false`), so output is
 *     deterministic and the renderer never enumerates the host's fonts.
 *
 * Deliberately NOT supported, and the guide says so in as many words: animation,
 * interactivity, JavaScript, 3D. A PNG in a Discord message is a still picture.
 */

import satori from 'satori';
import { Resvg } from '@resvg/resvg-wasm';
import { ensureResvgWasm } from './resvgWasm';
import { log, logError } from './log';

export const DIAGRAM_GUIDE_TOOL_NAME = 'get_diagram_guide';
export const DIAGRAM_GEN_TOOL_NAME = 'render_diagram';
export const DIAGRAM_GEN_DAILY_LIMIT = 20;

/** Renders are CPU-bound and resvg's rasterise step blocks the event loop —
 * one at a time keeps a burst from stalling every other command. */
const MAX_CONCURRENT_RENDERS = 1;

export const MAX_SOURCE_CHARS = 20_000;
export const MIN_WIDTH = 200;
export const MAX_WIDTH = 1600;
export const MIN_HEIGHT = 100;
export const MAX_HEIGHT = 1600;
/** Guards against a 1600×1600 render being requested every time. */
export const MAX_PIXELS = 1600 * 1200;
/** Discord upload cap on non-boosted servers. */
const MAX_PNG_BYTES = 8 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 20_000;
const DEFAULT_WIDTH = 900;
/** Matches the palette in the guide, so a model-set background blends with it. */
const DEFAULT_CANVAS_BACKGROUND = '#1e1f22';

const GUIDE_PATH = `${import.meta.dir}/../data/skills/diagram-guide.md`;
const FONT_DIR = `${import.meta.dir}/../data/fonts`;

const GUIDE_TOOL_DESCRIPTION = 'Returns the diagram guide: the exact HTML/CSS subset and SVG subset the renderer '
  + `accepts, size limits, and worked examples. Call this BEFORE ${DIAGRAM_GEN_TOOL_NAME} whenever the user asks `
  + 'for a diagram, chart, table, or visual — the accepted subset is narrower than real HTML and a render that '
  + 'uses anything outside it fails.';

const GEN_TOOL_DESCRIPTION = 'Render a diagram, chart, or visual explanation to a PNG image that is attached to '
  + 'your reply automatically. Use for flowcharts, architecture/pipeline diagrams, bar charts, comparison tables, '
  + 'timelines, tree/graph structures, labelled figures, and step-by-step visual explanations. '
  + 'STATIC 2D ONLY — the output is a still image in a Discord message: no animation, no interactivity, no '
  + 'JavaScript, no 3D, no live/updating data. If the user wants any of those, say plainly that you can only '
  + `produce a static 2D picture and offer that instead. Call ${DIAGRAM_GUIDE_TOOL_NAME} first for the accepted `
  + 'subset. Do not write links or placeholders for the image — it is attached for you. Limit: '
  + `${DIAGRAM_GEN_DAILY_LIMIT} renders per user per 24 hours.`;

const FORMAT_DESCRIPTION = '"html" for flexbox layout (cards, bars, tables, timelines — the layout engine sizes '
  + 'everything for you), or "svg" for hand-placed coordinate drawing (arrows, curves, node graphs, plots). '
  + 'Prefer "html" for anything box-and-text shaped; prefer "svg" when you need arrows or curves.';

const SOURCE_DESCRIPTION = `The markup, at most ${MAX_SOURCE_CHARS} characters. Must use only the tags, `
  + `attributes and CSS properties listed by ${DIAGRAM_GUIDE_TOOL_NAME} — anything else is rejected.`;

export interface DiagramGenContext {
  /** Discord user id of the requester (rate-limit key). */
  userId: string;
  /** Shared Database instance (db.diagramGen). */
  db: any;
}

export interface DiagramGenAttachment {
  attachment: Buffer;
  name: string;
}

export type DiagramGenResult =
  | { ok: true; attachment: DiagramGenAttachment; resultText: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export function diagramToolDefs(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: DIAGRAM_GUIDE_TOOL_NAME,
        description: GUIDE_TOOL_DESCRIPTION,
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: DIAGRAM_GEN_TOOL_NAME,
        description: GEN_TOOL_DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short title for the diagram (used as the file name).' },
            format: { type: 'string', enum: ['html', 'svg'], description: FORMAT_DESCRIPTION },
            source: { type: 'string', description: SOURCE_DESCRIPTION },
            width: {
              type: 'integer',
              description: `Image width in pixels (${MIN_WIDTH}-${MAX_WIDTH}). Defaults to ${DEFAULT_WIDTH}.`,
            },
            height: {
              type: 'integer',
              description: `Image height in pixels (${MIN_HEIGHT}-${MAX_HEIGHT}). Omit in "html" format to `
                + 'size to the content, which is usually what you want. Ignored in "svg" format — the svg\'s own '
                + 'width/height attributes win there.',
            },
          },
          required: ['format', 'source'],
        },
      },
    },
  ];
}

export function diagramGeminiDecls(): any[] {
  return [
    {
      name: DIAGRAM_GUIDE_TOOL_NAME,
      description: GUIDE_TOOL_DESCRIPTION,
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: DIAGRAM_GEN_TOOL_NAME,
      description: GEN_TOOL_DESCRIPTION,
      parameters: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING', description: 'Short title for the diagram (used as the file name).' },
          format: { type: 'STRING', enum: ['html', 'svg'], description: FORMAT_DESCRIPTION },
          source: { type: 'STRING', description: SOURCE_DESCRIPTION },
          width: { type: 'INTEGER', description: `Image width in pixels (${MIN_WIDTH}-${MAX_WIDTH}).` },
          height: { type: 'INTEGER', description: `Image height in pixels (${MIN_HEIGHT}-${MAX_HEIGHT}). Omit to fit content.` },
        },
        required: ['format', 'source'],
      },
    },
  ];
}

/** System-prompt note advertising the diagram tools (kept tiny — details live in the guide). */
export function buildDiagramGenNote(diagramGen?: DiagramGenContext): string {
  if (!diagramGen) return '';
  return '\n\nYou can draw **static 2D** diagrams, charts and figures as images (restricted HTML/CSS or SVG → PNG). '
    + `When a picture would explain something better than words, FIRST call ${DIAGRAM_GUIDE_TOOL_NAME} to learn the `
    + `accepted subset, then call ${DIAGRAM_GEN_TOOL_NAME}. The image is attached to your reply automatically — never `
    + 'invent an image link. You cannot make animations, interactive widgets or 3D scenes; say so plainly and offer a '
    + `static picture instead. Limit: ${DIAGRAM_GEN_DAILY_LIMIT} renders per user per 24 hours.`;
}

let cachedGuide: string | null = null;

/** The diagram guide served to the model by get_diagram_guide. */
export async function getDiagramGuide(): Promise<string> {
  if (cachedGuide !== null) return cachedGuide;
  try {
    cachedGuide = await Bun.file(GUIDE_PATH).text();
  } catch (err) {
    logError('[diagram] failed to read diagram guide:', err);
    return `Error: the diagram guide is unavailable. Do not call ${DIAGRAM_GEN_TOOL_NAME}; tell the user diagram `
      + 'rendering is temporarily down.';
  }
  return cachedGuide;
}

// ---------------------------------------------------------------------------
// Shared markup tokenizer
// ---------------------------------------------------------------------------

export interface OpenTagToken {
  kind: 'open';
  name: string;
  attrs: { name: string; value: string }[];
  selfClosing: boolean;
}
export type MarkupToken =
  | OpenTagToken
  | { kind: 'close'; name: string }
  | { kind: 'text'; text: string };

export type TokenizeResult =
  | { ok: true; tokens: MarkupToken[] }
  | { ok: false; error: string };

const TAG_NAME_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/;

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * Tolerant tokenizer for the restricted markup subset. Deliberately rejects
 * anything exotic rather than trying to recover: `<!…>` (DOCTYPE, comments,
 * ENTITY, CDATA) and `<?…?>` are refused outright, which is what keeps entity
 * expansion and processing instructions off the table for both front-ends.
 */
export function tokenizeMarkup(src: string): TokenizeResult {
  const tokens: MarkupToken[] = [];
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      const text = src.slice(i);
      if (text.trim()) tokens.push({ kind: 'text', text: decodeEntities(text) });
      break;
    }
    if (lt > i) {
      const text = src.slice(i, lt);
      if (text.trim()) tokens.push({ kind: 'text', text: decodeEntities(text) });
    }

    const next = src[lt + 1];
    if (next === '!' || next === '?') {
      return {
        ok: false,
        error: 'Error: "<!...>" and "<?...?>" are not allowed (no doctype, comments, CDATA or entity declarations). '
          + 'Send only plain elements.',
      };
    }

    const gt = src.indexOf('>', lt);
    if (gt === -1) return { ok: false, error: `Error: unterminated tag starting at character ${lt}.` };
    let inner = src.slice(lt + 1, gt);

    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim();
      if (!TAG_NAME_RE.test(name)) return { ok: false, error: `Error: malformed closing tag "</${name}>".` };
      tokens.push({ kind: 'close', name });
      i = gt + 1;
      continue;
    }

    let selfClosing = false;
    if (inner.endsWith('/')) {
      selfClosing = true;
      inner = inner.slice(0, -1);
    }

    const nameMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(inner);
    if (!nameMatch) return { ok: false, error: `Error: malformed tag "<${inner.slice(0, 40)}>".` };
    const name = nameMatch[1];

    const attrs: { name: string; value: string }[] = [];
    const attrRe = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    attrRe.lastIndex = nameMatch[1].length;
    let m = attrRe.exec(inner);
    while (m !== null) {
      attrs.push({ name: m[1], value: decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') });
      m = attrRe.exec(inner);
    }

    tokens.push({
      kind: 'open', name, attrs, selfClosing,
    });
    i = gt + 1;
  }

  return { ok: true, tokens };
}

// ---------------------------------------------------------------------------
// HTML front-end: restricted HTML/CSS -> satori vnode tree
// ---------------------------------------------------------------------------

/** Tags the HTML front-end accepts. Note the absence of `img`, `style`, `a` and
 * `table` — no remote fetches, no stylesheets, and satori has no table layout. */
const HTML_TAGS = new Set([
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'b', 'strong', 'i', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'br',
]);
const HTML_VOID_TAGS = new Set(['br']);
/** Tags that default to the mono family (there is no other way to ask for it). */
const HTML_MONO_TAGS = new Set(['code', 'pre']);

const CSS_PROPS = new Set([
  // layout
  'display', 'flexDirection', 'flexWrap', 'alignItems', 'alignSelf', 'alignContent', 'justifyContent',
  'gap', 'rowGap', 'columnGap', 'flex', 'flexGrow', 'flexShrink', 'flexBasis',
  'position', 'top', 'right', 'bottom', 'left', 'overflow',
  // box
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
  'borderWidth', 'borderStyle', 'borderColor', 'borderRadius',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
  'boxSizing', 'boxShadow', 'opacity', 'transform', 'transformOrigin',
  // text
  'color', 'fontSize', 'fontWeight', 'fontStyle', 'fontFamily', 'lineHeight', 'letterSpacing',
  'textAlign', 'textTransform', 'textDecoration', 'textOverflow', 'whiteSpace', 'wordBreak', 'textShadow',
  // background
  'background', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundClip',
]);

/** satori only implements these three display modes. */
const DISPLAY_VALUES = new Set(['flex', 'none', 'block']);
const FONT_FAMILIES = new Set(['sans', 'mono']);
const MAX_CSS_VALUE_CHARS = 200;
/** Assembled rather than written literally so eslint's no-script-url rule stays
 * happy; it is only ever used as a needle to reject markup, never as a URL. */
const SCRIPT_SCHEME = `java${'script'}:`;

function camelCase(prop: string): string {
  return prop.trim().toLowerCase().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

export type StyleResult = { ok: true; style: Record<string, any> } | { ok: false; error: string };

/**
 * Parses an inline `style` attribute into a satori style object, rejecting any
 * property outside CSS_PROPS and any value that could reference an external
 * resource. `url(...)` is refused wholesale — that is the single check standing
 * between a rendered diagram and an SSRF/file-read primitive.
 */
export function parseStyleAttr(raw: string): StyleResult {
  const style: Record<string, any> = {};
  for (const decl of raw.split(';')) {
    if (!decl.trim()) continue;
    const colon = decl.indexOf(':');
    if (colon === -1) return { ok: false, error: `Error: malformed CSS declaration "${decl.trim().slice(0, 40)}".` };

    const prop = camelCase(decl.slice(0, colon));
    const value = decl.slice(colon + 1).trim();

    if (!CSS_PROPS.has(prop)) {
      return {
        ok: false,
        error: `Error: CSS property "${decl.slice(0, colon).trim()}" is not supported. See ${DIAGRAM_GUIDE_TOOL_NAME} `
          + 'for the supported list.',
      };
    }
    if (!value) return { ok: false, error: `Error: CSS property "${prop}" has an empty value.` };
    if (value.length > MAX_CSS_VALUE_CHARS) {
      return { ok: false, error: `Error: CSS value for "${prop}" is too long (max ${MAX_CSS_VALUE_CHARS} chars).` };
    }
    const lower = value.toLowerCase();
    if (lower.includes('url(') || lower.includes('image-set(') || lower.includes(SCRIPT_SCHEME)
      || lower.includes('expression(') || lower.includes('@import') || lower.includes('var(')) {
      return {
        ok: false,
        error: `Error: CSS value for "${prop}" references an external or dynamic resource, which is never allowed. `
          + 'Use plain colours and gradients only.',
      };
    }
    if (prop === 'display' && !DISPLAY_VALUES.has(lower)) {
      return { ok: false, error: `Error: display must be one of ${[...DISPLAY_VALUES].join(', ')} (got "${value}").` };
    }
    if (prop === 'fontFamily' && !FONT_FAMILIES.has(lower)) {
      return {
        ok: false,
        error: `Error: font-family must be "sans" or "mono" (got "${value}") — those are the only fonts installed.`,
      };
    }

    // Bare numbers must reach satori/yoga as numbers, not strings.
    style[prop] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  }
  return { ok: true, style };
}

interface VNode { type: string; props: Record<string, any> }

export type HtmlParseResult = { ok: true; node: VNode } | { ok: false; error: string };

/** Restricted HTML -> satori vnode tree. Rebuilds the tree from tokens, so no
 * unrecognised tag or attribute can survive into the render. */
export function parseRestrictedHtml(src: string): HtmlParseResult {
  const tokenized = tokenizeMarkup(src);
  if (!tokenized.ok) return tokenized;

  // The wrapper fills the canvas width and paints an opaque default, so a model
  // that forgets a background (or sizes its outer element to its content) gets
  // the documented dark canvas rather than white gaps down the side.
  const root: VNode = {
    type: 'div',
    props: {
      style: {
        display: 'flex', flexDirection: 'column', width: '100%', background: DEFAULT_CANVAS_BACKGROUND,
      },
      children: [],
    },
  };
  const stack: VNode[] = [root];

  const pushChild = (child: VNode | string): void => {
    const parent = stack[stack.length - 1];
    if (!Array.isArray(parent.props.children)) parent.props.children = [];
    parent.props.children.push(child);
  };

  for (const token of tokenized.tokens) {
    if (token.kind === 'text') {
      pushChild(token.text.replace(/\s+/g, ' '));
      continue;
    }

    if (token.kind === 'close') {
      const name = token.name.toLowerCase();
      if (HTML_VOID_TAGS.has(name)) continue;
      if (stack.length <= 1) return { ok: false, error: `Error: stray closing tag "</${name}>".` };
      stack.pop();
      continue;
    }

    const name = token.name.toLowerCase();
    if (!HTML_TAGS.has(name)) {
      return {
        ok: false,
        error: `Error: tag "<${name}>" is not supported in html format. Allowed: ${[...HTML_TAGS].join(', ')}. `
          + '(Images and links cannot be rendered at all; use svg format for arrows and curves.)',
      };
    }

    let style: Record<string, any> = {};
    for (const attr of token.attrs) {
      if (attr.name.toLowerCase() !== 'style') {
        return {
          ok: false,
          error: `Error: attribute "${attr.name}" on <${name}> is not allowed — inline style is the only accepted `
            + 'attribute in html format.',
        };
      }
      const parsed = parseStyleAttr(attr.value);
      if (!parsed.ok) return parsed;
      style = parsed.style;
    }

    if (name === 'br') { pushChild('\n'); continue; }

    // Defaults that make the subset behave the way the model expects.
    if (HTML_MONO_TAGS.has(name) && style.fontFamily === undefined) style.fontFamily = 'mono';
    if ((name === 'b' || name === 'strong') && style.fontWeight === undefined) style.fontWeight = 700;
    if ((name === 'i' || name === 'em') && style.fontStyle === undefined) style.fontStyle = 'italic';
    if (name === 'span' || name === 'code') {
      // satori lays inline-ish elements out as flex items; without this a <span>
      // inside a row silently takes the parent's column direction.
      if (style.display === undefined) style.display = 'flex';
    } else if (style.display === undefined) {
      style.display = 'flex';
      if (style.flexDirection === undefined) style.flexDirection = 'column';
    }

    const node: VNode = { type: name === 'li' ? 'div' : name, props: { style, children: [] } };
    pushChild(node);
    if (!token.selfClosing && !HTML_VOID_TAGS.has(name)) stack.push(node);
  }

  if (stack.length !== 1) {
    return { ok: false, error: `Error: ${stack.length - 1} unclosed tag(s). Close every element.` };
  }
  const children = root.props.children as (VNode | string)[];
  if (children.length === 0) return { ok: false, error: 'Error: the html source produced no content.' };
  return { ok: true, node: root };
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

/** Returns an error string when the requested canvas is out of bounds. */
export function checkDimensions(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 'Error: width and height must be numbers.';
  if (width < MIN_WIDTH || width > MAX_WIDTH) {
    return `Error: width must be between ${MIN_WIDTH} and ${MAX_WIDTH} pixels (got ${width}).`;
  }
  if (height < MIN_HEIGHT || height > MAX_HEIGHT) {
    return `Error: height must be between ${MIN_HEIGHT} and ${MAX_HEIGHT} pixels (got ${height}).`;
  }
  if (width * height > MAX_PIXELS) {
    return `Error: ${width}×${height} exceeds the ${MAX_PIXELS.toLocaleString()} pixel budget. Use a smaller canvas.`;
  }
  return null;
}

/** Clamps a model-supplied dimension, falling back when absent or unparseable. */
export function clampDimension(raw: any, min: number, max: number, fallback: number | null): number | null {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.trunc(num), min), max);
}

export function sanitizeTitle(raw: any): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const cleaned = text.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '-').slice(0, 60);
  return cleaned || 'diagram';
}

// ---------------------------------------------------------------------------
// SVG front-end: allowlisted SVG -> serialised SVG for resvg
// ---------------------------------------------------------------------------

const SVG_TAGS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'symbol', 'use',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'marker', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask',
]);

const SVG_ATTRS = new Set([
  // structural / paint
  'id', 'transform', 'style', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity',
  'stroke-miterlimit', 'opacity', 'clip-path', 'clip-rule', 'mask',
  'marker-start', 'marker-mid', 'marker-end', 'vector-effect', 'shape-rendering',
  // root
  'xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio',
  // geometry
  'x', 'y', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points', 'd', 'dx', 'dy',
  // gradients
  'gradientUnits', 'gradientTransform', 'spreadMethod', 'offset', 'stop-color', 'stop-opacity',
  'fx', 'fy', 'href', 'xlink:href',
  // markers
  'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits',
  // clip / mask
  'clipPathUnits', 'maskUnits', 'maskContentUnits',
  // text
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline',
  'alignment-baseline', 'letter-spacing', 'word-spacing', 'textLength', 'lengthAdjust', 'xml:space',
]);

/** Attributes that take a reference; only same-document `#id` refs are allowed. */
const SVG_REF_ATTRS = new Set(['href', 'xlink:href']);
const MAX_SVG_ATTR_CHARS = 4_000;

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type SvgSanitizeResult =
  | { ok: true; svg: string; width: number; height: number }
  | { ok: false; error: string };

/**
 * Allowlists and re-serialises an SVG document. Output is built from parsed
 * tokens, so unknown tags/attributes cannot pass through; `url(http…)`,
 * external refs and `on*` handlers are refused rather than stripped, so the
 * model gets told what it did wrong.
 */
export function sanitizeSvg(src: string, fallbackWidth: number): SvgSanitizeResult {
  const tokenized = tokenizeMarkup(src);
  if (!tokenized.ok) return tokenized;

  const out: string[] = [];
  const stack: string[] = [];
  let rootSeen = false;
  let width = 0;
  let height = 0;

  for (const token of tokenized.tokens) {
    if (token.kind === 'text') {
      if (stack.length > 0) out.push(escapeText(token.text));
      continue;
    }

    if (token.kind === 'close') {
      const name = token.name;
      if (stack.length === 0) return { ok: false, error: `Error: stray closing tag "</${name}>".` };
      const expected = stack.pop();
      if (expected !== name) {
        return { ok: false, error: `Error: closing tag "</${name}>" does not match open tag "<${expected}>".` };
      }
      out.push(`</${name}>`);
      continue;
    }

    const { name } = token;
    if (!SVG_TAGS.has(name)) {
      return {
        ok: false,
        error: `Error: SVG element "<${name}>" is not allowed. Allowed: ${[...SVG_TAGS].join(', ')}. `
          + '(<script>, <style>, <image> and <foreignObject> are permanently refused — a diagram may not load '
          + 'external resources or run code.)',
      };
    }
    if (!rootSeen && name !== 'svg') return { ok: false, error: 'Error: the svg source must start with <svg>.' };
    if (name === 'svg' && rootSeen) return { ok: false, error: 'Error: only one <svg> root element is allowed.' };

    const rendered: string[] = [];
    for (const attr of token.attrs) {
      const attrName = attr.name;
      const lowerName = attrName.toLowerCase();
      if (lowerName.startsWith('on')) {
        return { ok: false, error: `Error: event handler attribute "${attrName}" is never allowed.` };
      }
      if (!SVG_ATTRS.has(attrName)) {
        return {
          ok: false,
          error: `Error: attribute "${attrName}" on <${name}> is not allowed. See ${DIAGRAM_GUIDE_TOOL_NAME} for the `
            + 'accepted attribute list.',
        };
      }
      if (attr.value.length > MAX_SVG_ATTR_CHARS) {
        return { ok: false, error: `Error: value of "${attrName}" is too long (max ${MAX_SVG_ATTR_CHARS} chars).` };
      }
      const lowerValue = attr.value.toLowerCase();
      if (lowerValue.includes(SCRIPT_SCHEME) || lowerValue.includes('data:') || lowerValue.includes('@import')) {
        return { ok: false, error: `Error: value of "${attrName}" contains a forbidden scheme or directive.` };
      }
      // Paint refs may only point inside this document. EVERY occurrence has to
      // be checked, not just the first: an anchored single-match test accepts
      // `url(#a) url(http://evil/#b)` (the external ref never gets looked at)
      // and wrongly rejects `blue url(#a)` (a token before the ref). Both are
      // covered in the rejection matrix.
      const urlRefs = [...lowerValue.matchAll(/url\(\s*['"]?([^)'"]*)/g)];
      if (urlRefs.some((match) => !match[1].trim().startsWith('#'))) {
        return {
          ok: false,
          error: `Error: "${attrName}" may only reference same-document ids, as url(#someId) — every url() in the `
            + 'value must point at a "#" id, and external references are never allowed.',
        };
      }
      if (SVG_REF_ATTRS.has(attrName) && !attr.value.trim().startsWith('#')) {
        return { ok: false, error: `Error: "${attrName}" may only be a same-document reference starting with "#".` };
      }
      if (attrName === 'style') {
        // Inline SVG CSS goes through the same allowlist as the HTML front-end.
        const parsed = parseStyleAttr(attr.value);
        if (!parsed.ok) return parsed;
      }

      if (name === 'svg') {
        if (attrName === 'width') width = Math.trunc(Number.parseFloat(attr.value)) || 0;
        if (attrName === 'height') height = Math.trunc(Number.parseFloat(attr.value)) || 0;
        if (attrName === 'xmlns') continue; // re-added below, canonically
      }
      rendered.push(`${attrName}="${escapeAttr(attr.value)}"`);
    }

    if (name === 'svg') {
      rootSeen = true;
      if (width <= 0 || height <= 0) {
        return {
          ok: false,
          error: 'Error: the root <svg> needs explicit width and height attributes in pixels (a viewBox alone is '
            + 'not enough).',
        };
      }
      rendered.unshift('xmlns="http://www.w3.org/2000/svg"');
    }

    const attrString = rendered.length > 0 ? ` ${rendered.join(' ')}` : '';
    if (token.selfClosing) {
      out.push(`<${name}${attrString}/>`);
    } else {
      out.push(`<${name}${attrString}>`);
      stack.push(name);
    }
  }

  if (!rootSeen) return { ok: false, error: 'Error: no <svg> root element found.' };
  if (stack.length > 0) return { ok: false, error: `Error: unclosed SVG element(s): ${stack.join(', ')}.` };

  const dimError = checkDimensions(width, height || fallbackWidth);
  if (dimError) return { ok: false, error: dimError };

  return {
    ok: true, svg: out.join(''), width, height,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

interface LoadedFont { name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' }

let cachedFonts: LoadedFont[] | null = null;
let fontLoadFailed = false;

async function getFonts(): Promise<LoadedFont[] | null> {
  if (cachedFonts) return cachedFonts;
  if (fontLoadFailed) return null;
  try {
    const [sans, bold, mono] = await Promise.all([
      Bun.file(`${FONT_DIR}/DejaVuSans.ttf`).arrayBuffer(),
      Bun.file(`${FONT_DIR}/DejaVuSans-Bold.ttf`).arrayBuffer(),
      Bun.file(`${FONT_DIR}/DejaVuSansMono.ttf`).arrayBuffer(),
    ]);
    cachedFonts = [
      {
        name: 'sans', data: sans, weight: 400, style: 'normal',
      },
      {
        name: 'sans', data: bold, weight: 700, style: 'normal',
      },
      {
        name: 'mono', data: mono, weight: 400, style: 'normal',
      },
    ];
    log('[diagram] loaded DejaVu font set');
    return cachedFonts;
  } catch (err) {
    // Missing fonts are a deployment problem; don't retry on every call.
    fontLoadFailed = true;
    logError(`[diagram] failed to load fonts from ${FONT_DIR} (run: bun scripts/fetch-fonts.ts):`, err);
    return null;
  }
}

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms).unref?.();
    }),
  ]);
}

/** Reads back the canvas satori actually produced, so auto-height can't blow past the cap. */
function svgDimensions(svg: string): { width: number; height: number } {
  const width = Number.parseFloat(/\bwidth="([\d.]+)"/.exec(svg)?.[1] ?? '0');
  const height = Number.parseFloat(/\bheight="([\d.]+)"/.exec(svg)?.[1] ?? '0');
  return { width: Math.round(width), height: Math.round(height) };
}

let inFlightRenders = 0;

export async function runDiagramGeneration(opts: {
  ctx: DiagramGenContext;
  args: Record<string, any>;
  /** Whether get_diagram_guide was called earlier in this same tool loop. */
  guideWasRead: boolean;
}): Promise<DiagramGenResult> {
  const { ctx, args, guideWasRead } = opts;

  if (!guideWasRead) {
    return {
      ok: false,
      error: `Error: you must call ${DIAGRAM_GUIDE_TOOL_NAME} before ${DIAGRAM_GEN_TOOL_NAME} so the markup stays `
        + 'inside the supported subset. Call it now, then retry.',
    };
  }

  const format = typeof args?.format === 'string' ? args.format.trim().toLowerCase() : '';
  if (format !== 'html' && format !== 'svg') {
    return { ok: false, error: 'Error: format must be exactly "html" or "svg".' };
  }
  const source = typeof args?.source === 'string' ? args.source : '';
  if (!source.trim()) return { ok: false, error: 'Error: source is empty.' };
  if (source.length > MAX_SOURCE_CHARS) {
    return {
      ok: false,
      error: `Error: source is ${source.length} characters, over the ${MAX_SOURCE_CHARS} limit. Simplify the diagram.`,
    };
  }

  const width = clampDimension(args?.width, MIN_WIDTH, MAX_WIDTH, DEFAULT_WIDTH) as number;
  const height = clampDimension(args?.height, MIN_HEIGHT, MAX_HEIGHT, null);

  // Parse and validate before claiming the slot or spending quota — a rejected
  // render is the model's mistake to fix, not the user's quota to pay for, and
  // parsing is cheap.
  let sanitizedSvg: string | null = null;
  let htmlTree: any = null;
  if (format === 'svg') {
    const sanitized = sanitizeSvg(source, width);
    if (!sanitized.ok) return sanitized;
    sanitizedSvg = sanitized.svg;
  } else {
    const parsed = parseRestrictedHtml(source);
    if (!parsed.ok) return parsed;
    const dimError = checkDimensions(width, height ?? MIN_HEIGHT);
    if (dimError) return { ok: false, error: dimError };
    htmlTree = parsed.node;
  }

  if (inFlightRenders >= MAX_CONCURRENT_RENDERS) {
    return { ok: false, error: 'Error: another diagram is rendering right now. Tell the user to try again in a moment.' };
  }
  // Claim the slot synchronously — no await between the guard and this line, so
  // concurrent tool calls cannot all pass the check before it takes effect.
  // Everything CPU-heavy has to happen after this point: satori layout is the
  // expensive step for html sources, so laying out before the claim would leave
  // the "one render at a time" guarantee unenforced for exactly the path that
  // needs it.
  inFlightRenders += 1;

  const title = sanitizeTitle(args?.title);
  try {
    let reservationId: number | null = null;
    try {
      reservationId = await ctx.db.diagramGen.reserveGeneration(ctx.userId, title, DIAGRAM_GEN_DAILY_LIMIT);
    } catch (err) {
      logError('[diagram] quota reservation failed:', err);
      return { ok: false, error: 'Error: diagram rendering is temporarily unavailable.' };
    }
    if (reservationId === null) {
      return {
        ok: false,
        error: `Error: this user has reached the diagram limit (${DIAGRAM_GEN_DAILY_LIMIT} per 24 hours). Tell them `
          + 'to try again later.',
      };
    }
    const reservedId = reservationId;
    const releaseQuota = async () => {
      await ctx.db.diagramGen.markFailed(reservedId).catch((err: any) => {
        logError('[diagram] failed to release quota slot:', err);
      });
    };

    const fonts = await getFonts();
    if (!fonts) {
      await releaseQuota();
      return { ok: false, error: 'Error: diagram rendering is unavailable (fonts missing).' };
    }

    // Layout (html only) runs here, inside the slot — see the claim comment above.
    let svgMarkup: string;
    if (sanitizedSvg !== null) {
      svgMarkup = sanitizedSvg;
    } else {
      try {
        svgMarkup = await withTimeout(
          satori(htmlTree, {
            width,
            ...(height === null ? {} : { height }),
            fonts: fonts as any,
          }),
          RENDER_TIMEOUT_MS,
          'layout',
        );
      } catch (err) {
        logError('[diagram] satori layout failed:', err);
        await releaseQuota();
        return {
          ok: false,
          error: `Error: the layout engine rejected this markup (${err instanceof Error ? err.message : 'unknown error'}). `
            + `Simplify it and stay inside the subset from ${DIAGRAM_GUIDE_TOOL_NAME}.`,
        };
      }
      // Auto-height means satori, not the model, chose the canvas — re-check it.
      const laidOut = svgDimensions(svgMarkup);
      const dimError = checkDimensions(laidOut.width || width, laidOut.height || MIN_HEIGHT);
      if (dimError) {
        await releaseQuota();
        return {
          ok: false,
          error: `${dimError} The content laid out to ${laidOut.width}×${laidOut.height}. Shorten it or set an `
            + 'explicit height.',
        };
      }
    }

    let png: Buffer;
    try {
      await ensureResvgWasm();
      const resvg = new Resvg(svgMarkup, {
        // Only our own fonts, never the host's — deterministic output, and the
        // renderer never touches the filesystem looking for font files.
        font: {
          fontBuffers: fonts.map((f) => new Uint8Array(f.data)),
          defaultFontFamily: 'sans',
          loadSystemFonts: false,
        },
      });
      png = Buffer.from(resvg.render().asPng());
    } catch (err) {
      logError('[diagram] rasterise failed:', err);
      await releaseQuota();
      return {
        ok: false,
        error: `Error: rasterising failed (${err instanceof Error ? err.message : 'unknown error'}). Check the markup `
          + 'and try a simpler diagram.',
      };
    }

    if (png.length > MAX_PNG_BYTES) {
      await releaseQuota();
      return {
        ok: false,
        error: `Error: the rendered image is ${(png.length / 1e6).toFixed(1)} MB, over Discord's 8 MB limit. Use a `
          + 'smaller canvas or a simpler diagram.',
      };
    }

    const produced = svgDimensions(svgMarkup);
    log(`[diagram] user ${ctx.userId} rendered "${title}" (${format}, ${produced.width}×${produced.height}, `
      + `${(png.length / 1024).toFixed(0)} KB)`);

    return {
      ok: true,
      attachment: { attachment: png, name: `${title}.png` },
      resultText: `Diagram rendered successfully: "${title}" — ${format} format, ${produced.width}×${produced.height} `
        + `pixels, ${(png.length / 1024).toFixed(0)} KB. The image is attached to your reply automatically — do not `
        + 'write a link or placeholder for it; just describe briefly what it shows.',
    };
  } finally {
    inFlightRenders -= 1;
  }
}
