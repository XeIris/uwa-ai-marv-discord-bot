---
paths:
  - "utils/welcomeCard.ts"
  - "classes/handlers/welcomeHandler.ts"
  - "commands/dev_welcome_test.ts"
  - "scripts/fetch-fonts.ts"
  - "data/marv-welcome.png"
  - "tests/utils/welcomeCard.test.ts"
---

# Join welcomes

When a member joins a guild that has opted in, the bot posts a rendered welcome card: a greeting
that pings them, plus an embed whose image is `data/marv-welcome.png` with their avatar composited
into the blank white circle, "Welcome to / UWA AI Club" above it and their display name below.

**Opt-in only.** Nothing is posted unless the guild sets the `welcome_channels` channel list via
`/serverconfig setchannel`. No "general" channel is guessed and nothing is DM'd — the same rule the
event reminders follow, for the same reason: the bot should be silent in a server that hasn't asked
for this.

## Pipeline

`guildMemberAdd` (wired in `classes/silverwolf.ts`) → `handleGuildMemberAdd` → `renderWelcomeCard`
→ satori lays the composite out → resvg-wasm rasterises → PNG attached to the embed via
`attachment://welcome.png`.

Same two libraries as `utils/diagramGen.ts`, but **none of that file's allowlisting applies here**:
this markup is ours, not the model's. The security boundary in this subsystem is different and
smaller — see below.

## The avatar is the only untrusted input

It is fetched in `fetchAvatarDataUri`, never handed to satori as a URL. That fetch enforces, in
order: an `https:` scheme, a `*.discordapp.com` host (anchored — `notdiscordapp.com` and
`cdn.discordapp.com.evil.test` both fail), a 5s timeout, a 4 MB cap checked against both
`content-length` *and* the actual body length, and a real PNG signature.

Every failure returns `null`, which renders a card with an empty circle rather than throwing. A
member with no avatar, a CDN blip and a hostile response all land in the same harmless place, and
the join handler never hangs on a slow fetch.

Display names are also user-controlled but only ever *drawn*: `sanitiseDisplayName` collapses
whitespace (newlines would break the single-line layout) and truncates to 32 chars.

## Layout constants are measured off the artwork

Everything in `welcomeCard.ts` is positioned in `marv-welcome.png`'s own 1376×768 pixel space —
`CIRCLE_X/Y`, `CIRCLE_DIAMETER`, `MAX_TITLE_WIDTH` (the point at which the title would collide with
Marv on the left). These are **measured off the file, not eyeballed**: the white disc spans x
526–849, y 222–546, i.e. a 324px circle centred at (687.5, 384). **If the art is replaced,
re-measure them** — decode the PNG and take the bounds of the near-white pixels.

The disc is a placeholder to *fill*, not a frame to sit inside, so `AVATAR_DIAMETER` is
`CIRCLE_DIAMETER + 2` and the avatar covers it completely; the 2px absorbs the disc's antialiased
rim. The artwork's outer glow survives as a halo. A regression test asserts this in the pixels
rather than in the constants, because a mis-centred or undersized avatar shows up as a white
crescent that constant-checking would miss.

Title and name sizes are not fixed; `fitTextSize` measures the rendered glyph paths and picks the
largest size that fits, so a long name shrinks instead of overflowing.

## Fonts

The card uses **Bruno Ace** (OFL, fetched and checksum-verified by `scripts/fetch-fonts.ts`
alongside the diagram renderer's DejaVu set). It ships a single 400 weight, so bold is faked by
stroking the glyph outlines in their own fill colour (`TITLE_STROKE`) — this thickens stems evenly
and stays on-curve, unlike skewing or squashing. Bruno Ace is basic-Latin only, so DejaVu stays
loaded behind it as a glyph fallback; accented, Greek and Cyrillic names render, CJK and emoji still
box.

`WELCOME_EMBED_COLOUR` is sampled from the artwork's own green so the embed's left bar reads as part
of the image.

## Testing it

`/dev welcome_test [user]` renders the card for you (or someone else) and replies **ephemerally in
place**. It deliberately does not post to `welcome_channels` and strips the ping, so it can be run
before the channel list is configured and without staging a fake join in front of the server.
