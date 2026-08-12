# Diagram rendering guide

You render a **static 2D picture** to a PNG that gets attached to your reply. Call
`render_diagram` with `format`, `source`, and optionally `title`, `width`, `height`.

## What this is for, and what it is not

Good uses: flowcharts and pipelines, architecture diagrams, bar/column charts, comparison
tables, timelines, tree and graph structures, labelled figures, state machines, before/after
layouts, step-by-step visual explanations.

**You cannot do these, ever — the output is a still image in a Discord message:**

- no animation, transitions or motion of any kind
- no interactivity — nothing hoverable, clickable, draggable, zoomable or scrollable
- no JavaScript, no `<script>`, no libraries (no D3, no Chart.js, no Mermaid)
- no 3D, no perspective scenes, no WebGL
- no live, updating or fetched data — everything must be a value you already know
- no external images, fonts or stylesheets; nothing is loaded over the network

If someone asks for an interactive simulation, an animated explainer or a 3D visualisation,
say plainly that you can only produce a static 2D picture, then offer the closest still
version (e.g. a few labelled frames side by side instead of an animation). Don't pretend, and
don't promise a link.

## Sizes

- `width`: 200–1600 px, default 900.
- `height`: 100–1600 px. **In `html` format, leave it out** — the layout engine sizes to the
  content, which is almost always what you want. Set it only when you want a fixed canvas.
- `width × height` must stay under 1,920,000 pixels.
- `source` must be under 20,000 characters.
- Limit: 20 renders per user per 24 hours. Get it right the first time rather than iterating.

## Fonts

Two families only: `sans` (DejaVu Sans, the default) and `mono` (DejaVu Sans Mono, the default
inside `<code>` and `<pre>`). Weights 400 and 700.

These cover Latin, Greek, Cyrillic, arrows (`→ ← ↑ ↓ ↔`), maths (`Σ ∇ ∈ ∂ ≈ ≤ ≥ × ÷ ± ∞`) and
box-drawing (`│ ─ ┌ ┐ └ ┘ ├ ┤`). **Emoji do not render at all — they vanish silently.** Never
put emoji in a diagram.

---

## `format: "html"` — flexbox layout

Best for anything box-and-text shaped: cards, rows, columns, bars, tables, timelines. The
layout engine measures and positions everything, so you don't do arithmetic.

**Tags:** `div span p h1 h2 h3 b strong i em code pre ul ol li br`
Nothing else. There is no `<img>`, no `<a>`, no `<table>` and no `<style>`.

**The only attribute allowed is `style`.** No `class`, no `id`.

**CSS properties:**

- Layout: `display` (`flex`/`block`/`none` only), `flex-direction`, `flex-wrap`, `align-items`,
  `align-self`, `align-content`, `justify-content`, `gap`, `row-gap`, `column-gap`, `flex`,
  `flex-grow`, `flex-shrink`, `flex-basis`, `position` (`relative`/`absolute`), `top`, `right`,
  `bottom`, `left`, `overflow`
- Box: `width`, `height`, `min/max-width`, `min/max-height`, `margin*`, `padding*`, `border*`
  (including `border-radius` and per-side/per-corner variants), `box-sizing`, `box-shadow`,
  `opacity`, `transform`, `transform-origin`
- Text: `color`, `font-size`, `font-weight`, `font-style`, `font-family` (`sans` or `mono`
  only), `line-height`, `letter-spacing`, `text-align`, `text-transform`, `text-decoration`,
  `text-overflow`, `white-space`, `word-break`, `text-shadow`
- Background: `background`, `background-color`, `background-image` (gradients only),
  `background-size`, `background-position`, `background-clip`

Anything outside this list is a hard error. **`url(...)`, `var(...)`, `@import` and
`calc(...)`-style dynamic values are rejected** — write literal numbers and colours.

**Rules that will bite you if you ignore them:**

1. There is no CSS grid, no float, no `position: fixed`. Everything is flexbox.
2. Every element defaults to `display: flex`. Block-level elements default to
   `flex-direction: column`; set `flex-direction: row` explicitly for a row.
3. A `<div>` cannot contain both raw text and child elements. Put text in its own leaf element.
4. Set `width: 100%` on your outermost element and give it a `background`. Without the width it
   shrinks to fit its content and the canvas shows the default dark backing beside it.
5. No table layout. Build tables as a column of rows, each row a `flex-direction: row` with
   fixed-width cells.

### Worked example — bar chart

```html
<div style="display:flex;flex-direction:column;width:100%;padding:32px;background:#1e1f22;font-size:16px;color:#f2f3f5">
  <div style="font-size:26px;font-weight:700;color:#5865F2">Training loss by epoch</div>
  <div style="margin-top:6px;font-size:14px;color:#b5bac1">lower is better</div>
  <div style="display:flex;flex-direction:row;align-items:flex-end;height:200px;margin-top:24px;gap:18px">
    <div style="display:flex;flex-direction:column;align-items:center">
      <div style="width:60px;height:180px;background:#5865F2;border-radius:6px 6px 0 0"></div>
      <div style="margin-top:8px;font-size:13px;color:#b5bac1">e1</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center">
      <div style="width:60px;height:120px;background:#5865F2;border-radius:6px 6px 0 0"></div>
      <div style="margin-top:8px;font-size:13px;color:#b5bac1">e2</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center">
      <div style="width:60px;height:70px;background:#57F287;border-radius:6px 6px 0 0"></div>
      <div style="margin-top:8px;font-size:13px;color:#b5bac1">e3</div>
    </div>
  </div>
</div>
```

Scale bar heights yourself: `height = round(value / maxValue * 180)`.

### Worked example — comparison table

```html
<div style="display:flex;flex-direction:column;width:100%;padding:28px;background:#1e1f22;color:#f2f3f5">
  <div style="display:flex;flex-direction:row;padding-bottom:10px;border-bottom:2px solid #5865F2;font-weight:700">
    <div style="width:220px">Approach</div>
    <div style="width:140px">Speed</div>
    <div style="width:200px">When to use</div>
  </div>
  <div style="display:flex;flex-direction:row;padding-top:12px">
    <div style="width:220px">Fine-tuning</div>
    <div style="width:140px;color:#ED4245">slow</div>
    <div style="width:200px">fixed domain, lots of data</div>
  </div>
  <div style="display:flex;flex-direction:row;padding-top:12px">
    <div style="width:220px">RAG</div>
    <div style="width:140px;color:#57F287">fast</div>
    <div style="width:200px">changing knowledge base</div>
  </div>
</div>
```

---

## `format: "svg"` — coordinate drawing

Best when you need **arrows, curves, connected node graphs, or plotted lines** — things
flexbox cannot express. You place everything by coordinate yourself.

**The root `<svg>` must carry explicit `width` and `height` in pixels** (a `viewBox` alone is
rejected). The `width`/`height` arguments to `render_diagram` are ignored in this format.

**Elements:** `svg g defs title desc symbol use path rect circle ellipse line polyline polygon
text tspan marker linearGradient radialGradient stop clipPath mask`

`<script>`, `<style>`, `<image>` and `<foreignObject>` are permanently refused.

**Attributes:** geometry (`x y width height rx ry cx cy r x1 y1 x2 y2 points d dx dy`), paint
(`fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray opacity fill-opacity
stroke-opacity`), text (`font-family font-size font-weight font-style text-anchor
dominant-baseline letter-spacing`), refs (`id transform clip-path mask marker-start marker-mid
marker-end`), gradients (`gradientUnits offset stop-color stop-opacity`), markers
(`markerWidth markerHeight refX refY orient markerUnits`), root (`xmlns viewBox
preserveAspectRatio`).

No `on*` handlers. `href`/`xlink:href` may only be a same-document `#id`. `url(...)` may only
be `url(#someId)`.

**Rules that will bite you:**

1. Add an opaque background rect first: `<rect width="100%" height="100%" fill="#1e1f22"/>`.
2. `font-family` must be `sans` or `mono`.
3. There is no text wrapping or auto-sizing in SVG — one `<text>` per line, and estimate width
   as roughly `0.6 × font-size` per character to avoid overflowing a box.
4. Define arrowheads once as a `<marker>` in `<defs>` and reference with `marker-end`.

### Worked example — pipeline with arrows

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="820" height="220">
  <rect width="820" height="220" fill="#1e1f22"/>
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#b5bac1"/>
    </marker>
  </defs>
  <text x="30" y="46" font-family="sans" font-size="22" font-weight="700" fill="#5865F2">Retrieval-augmented answer</text>
  <rect x="30" y="90" width="170" height="64" rx="8" fill="#5865F2"/>
  <text x="115" y="128" font-family="sans" font-size="16" fill="#ffffff" text-anchor="middle">Question</text>
  <line x1="208" y1="122" x2="268" y2="122" stroke="#b5bac1" stroke-width="2" marker-end="url(#arrow)"/>
  <rect x="276" y="90" width="170" height="64" rx="8" fill="#4e5058"/>
  <text x="361" y="122" font-family="sans" font-size="16" fill="#f2f3f5" text-anchor="middle">Retrieve</text>
  <text x="361" y="142" font-family="mono" font-size="12" fill="#b5bac1" text-anchor="middle">top-k chunks</text>
  <line x1="454" y1="122" x2="514" y2="122" stroke="#b5bac1" stroke-width="2" marker-end="url(#arrow)"/>
  <rect x="522" y="90" width="170" height="64" rx="8" fill="#57F287"/>
  <text x="607" y="128" font-family="sans" font-size="16" fill="#1e1f22" text-anchor="middle">Answer</text>
  <path d="M361 90 C361 60 115 60 115 88" stroke="#faa61a" stroke-width="2" fill="none" stroke-dasharray="5 4" marker-end="url(#arrow)"/>
</svg>
```

---

## Choosing colours

A dark palette that reads well in Discord: background `#1e1f22`, panels `#2b2d31`, borders
`#4e5058`, primary text `#f2f3f5`, muted text `#b5bac1`, accents `#5865F2` (blue), `#57F287`
(green), `#FEE75C` (yellow), `#ED4245` (red), `#faa61a` (orange). Use light text on dark fills
and dark text on light fills.

## If a render fails

The error names exactly what was rejected. Fix that one thing and retry — do not switch to
describing the picture in words unless you've failed twice, and never claim the image is
attached when the tool returned an error.
