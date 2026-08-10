---
paths:
  - "utils/diagramGen.ts"
  - "data/skills/diagram-guide.md"
  - "scripts/fetch-fonts.ts"
  - "tests/utils/diagramGen.test.ts"
---

# Diagram rendering (`render_diagram`)

The chat personas' "artifacts": the model writes restricted HTML/CSS or SVG, and gets a PNG
attached to its reply. Two-tool shape copied from JAYDON — `get_diagram_guide` (serves
`data/skills/diagram-guide.md`) must be called before `render_diagram`, enforced by
`guideWasRead` in the tool loop, so the model has seen the subset before it writes markup.

## Pipeline

- **`format: "html"`** → `parseRestrictedHtml` builds a satori vnode tree → satori lays it out
  to SVG → resvg rasterises to PNG.
- **`format: "svg"`** → `sanitizeSvg` re-serialises the document → resvg. This is the only path
  that can draw arrows and curves; satori has no such primitives.

Both engines are pure JS/WASM (`satori`, `@resvg/resvg-wasm`) — **keep it that way.** The
Dockerfile's "no native build libs" property is deliberate; a headless-Chromium renderer would
add ~400 MB to the image and blow the 1 g `mem_limit`.

## Security model — do not soften these

This renders **model-authored markup**, and prompt-injected text can reach the model. Both
front-ends are allowlists that **rebuild output from parsed tokens**; they never pattern-strip a
hostile string and pass the remainder through. What that buys, and what breaks if you relax it:

- **No remote or local resource loading, at all.** No `<img>`/`<image>`, no `<style>`, no
  `@import`, and `url(...)` in CSS is refused outright; in SVG only `url(#localId)` and
  `href="#localId"` pass. Allowing any of these turns a diagram request into an SSRF probe of
  the Docker network (or a `file://` read). **Every `url(` in an attribute value is checked, not
  just the first** — an anchored single-match test accepted `url(#a) url(http://evil/#b)`, since the
  external ref was never looked at. Both that and the false rejection of `blue url(#a)` are in the
  rejection matrix; keep them there.
- **No code paths.** No `<script>`, no `on*` attributes, no `<foreignObject>`.
- **No `<!…>` or `<?…?>`** — that is what keeps entity-expansion bombs out, since the tokenizer
  refuses DOCTYPE/ENTITY/CDATA before any parser sees them.
- **`loadSystemFonts: false`** with buffers from `data/fonts` only: deterministic output, and
  the rasteriser never walks the host filesystem for fonts.

Rejections return a precise error naming the offending tag/attribute/property, because the model
is expected to fix and retry. `tests/utils/diagramGen.test.ts` holds the rejection matrix — add
a case there for any new allowlist entry.

## Limits

Source ≤ 20 000 chars; width 200–1600; height 100–1600 (omit in html format for auto-height,
which is then **re-checked** against the caps because satori, not the model, chose it); area
≤ 1 920 000 px; PNG ≤ 8 MB (Discord's non-boosted cap); 20 s timeout; `MAX_CONCURRENT_RENDERS =
1` claimed synchronously; 20 renders/user/24 h via `DiagramGenLog` (`db.diagramGen`), reserved
atomically and released on failure exactly like `MusicGenLog`.

Ordering inside `runDiagramGeneration` is load-bearing, and differs by format because only the
html path has a layout step:

- **html:** parse/validate → **claim the slot** → reserve quota → satori layout → rasterise.
- **svg:** sanitize/validate → **claim the slot** → reserve quota → rasterise.

Parsing before the claim means a render the model got wrong costs no slot and no quota. Layout
after it matters just as much — satori is the CPU-heavy step for html sources, so laying out before
the claim would leave "one render at a time" unenforced for exactly the path that needs it. The 20 000-char `source` is truncated to
500 chars by `redactToolCallArgs` before it lands in chat history.

## Fonts

`bun run fetch:fonts` pulls three DejaVu TTFs (checksum-pinned to a matplotlib commit, which
vendors the built files) into gitignored `data/fonts/`; the Dockerfile does it at build time.
DejaVu specifically, because diagrams need arrows (`→`), maths (`Σ ∇ ∂ ≈`) and box-drawing —
Noto Sans silently drops every one of those. Families registered: `sans` (400/700) and `mono`
(400, the default inside `<code>`/`<pre>`). **Emoji render as nothing**; the guide says so.

## The guide is the contract

`data/skills/diagram-guide.md` is what the model actually programs against — if you change an
allowlist, change the guide in the same commit or the model will keep writing markup that gets
rejected. Its fenced ```html / ```svg examples are real fixtures: keep them inside the subset,
because they are the worked examples the model copies.
