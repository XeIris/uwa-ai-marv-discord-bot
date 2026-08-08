---
paths:
  - "commands/committee_*.ts"
  - "commands/event_*.ts"
  - "commands/commandgroups/committee.ts"
  - "commands/commandgroups/event.ts"
  - "utils/clubInfo.ts"
  - "utils/referenceSheets.ts"
  - "utils/clubLinks.ts"
  - "utils/unitLookup.ts"
  - "utils/eventImage.ts"
  - "utils/perthTime.ts"
  - "classes/eventScheduler.ts"
  - "data/skills/club-links.md"
  - "data/skills/uwa-calendar.md"
  - "data/skills/student-perks.md"
  - "data/skills/faq.md"
  - "utils/committeeOptions.ts"
  - "utils/eventOptions.ts"
  - "utils/latexToMarkdown.ts"
  - "database/models/CommitteeModel.ts"
  - "database/models/EventModel.ts"
  - "scripts/fetch-constitution.ts"
  - "scripts/seed-committee.ts"
---

# Club data (committee, events, constitution)

Live data the `Marv` persona reads through tools instead of carrying in its system prompt, so it
never goes stale. Everything is **per-guild** — always scope by `interaction.guild.id` /
`club.guildId`.

## Tables

- **`Committee`** (`db.committee`) — unique on `(server_id, user_id, title)`, deliberately *not* on
  the user: one title can be held by two people (Tech Leads) and one person can hold two titles.
  `is_executive` splits the roster into sections, `sort_order` orders within a section.
- **`Event`** (`db.event`) — `starts_at` / `ends_at` are **ISO-8601 UTC strings**. An event counts as
  upcoming until `COALESCE(ends_at, starts_at)`.

## Time

Operators type **Perth local time** (`YYYY-MM-DD HH:MM`); storage is UTC. Convert at the command
boundary with `parsePerthDateTime()` (`utils/perthTime.ts`, re-exported by `clubInfo`), which
returns `null` on anything malformed — reject, never coerce. AWST is UTC+8 with no DST, so the fixed offset is correct; don't
reach for a timezone library. Output uses `discordTimestamp()` (`<t:epoch:F>`) so each reader sees
their own zone — never render a bare Perth time to users.

## Commands

Writes extend `AdminCommand` (`commands/classes/AdminCommand.ts`, gated on `isAdmin`); `list`
subcommands are plain `Command` and open to everyone. Note **autocomplete bypasses
`Command.execute` entirely** (`classes/silverwolf.ts` `handleAutocomplete`), so neither the `banned`
kill-switch nor the admin gate applies to it — don't surface anything through autocomplete that the
caller shouldn't see.

`/event edit` uses the literal string `none` to clear an optional field; a missing option leaves the
stored value alone (`EventModel.update` only writes what it's given).

## AI tools

`utils/clubInfo.ts` exports `recall_constitution` / `list_committee` / `list_events` in both the
OpenRouter and Gemini shapes, mirroring the `get_music_guide` skill pattern. They're wired into
`utils/ai.ts` behind the `club?: ClubContext` option and gated by the persona's `clubTools` flag.
Results are **trusted** — first-party DB/repo content, so they are not wrapped in
`<<MCP_TOOL_RESULT>>` markers. Adding a tool means touching both provider branches plus
`CLUB_TOOL_NAMES` (which also drives the `nonSearchTools` reply footer in
`keywordsBehaviorHandler.ts`). The sheet and unit tools below ride the same `club` gate, so all of
Marv's extras appear and disappear together.

## Constitution

`data/skills/constitution.md` is **generated** by `bun run fetch:constitution` from
`UWA-AI-Club/constitution`'s `constitution.tex`, and **is committed** (unlike the soundfont) so a
fresh clone works. `utils/latexToMarkdown.ts` is a narrow converter for exactly that document — its
job is preserving the clause numbering (4.1, 14.2.3, …) from the `label=` specs so Marv cites
numbers that match the published PDF. Don't generalise it; re-run the script when the source
changes.

## Reference sheets (`utils/referenceSheets.ts`)

Four hand-maintained markdown sheets in `data/skills/`, served verbatim as tool results:
`recall_club_links`, `recall_key_dates`, `recall_student_perks`, `recall_faq`. They are declared as
**one table-driven registry**, not four near-identical tool implementations — adding a sheet is one
row in `SHEETS` plus a file. Everything in them is public.

Two mechanisms exist because hand-maintained content rots, and both matter more than they look:

- **`<!-- covers: 2026 -->`.** When the current Perth year isn't in a year-scoped sheet's coverage,
  the served text is prefixed with a blunt "OUT OF DATE, do not extrapolate" banner. This is why a
  forgotten yearly update degrades to "I don't know" instead of Marv confidently inventing next
  year's census date. **Don't remove the marker from `uwa-calendar.md` or `student-perks.md`** —
  without it the sheet silently becomes an unverified-dates warning instead.
- **`<!-- TODO -->`.** A section whose body is a TODO marker is stripped before the model sees it,
  and the model is told how many were omitted and to say it doesn't know. This is what lets `faq.md`
  ship half-written: committee fills sections in over time and Marv never reads a placeholder aloud
  or improvises club policy.

Sheets are read on first use and cached in-process, so an edit needs a restart.

`utils/clubLinks.ts` holds the same links in structured form for the `/links` command (an embed
needs fields, not prose). `tests/utils/clubLinks.test.ts` asserts the two agree **in both
directions**, so updating one and forgetting the other fails the suite rather than shipping a
half-updated bot.

## Unit lookup (`utils/unitLookup.ts`)

`lookup_unit` fetches `handbooks.uwa.edu.au/unitdetails?code=XXXX0000` and scrapes title, points,
offering, level, prerequisites and outcomes. No search engine involved — the URL is deterministic.

**The URL is built from a code matched against `/^[A-Z]{4}\d{4}$/`, never from caller text.** Adding
a URL or host argument here would turn the tool into an SSRF primitive against the Docker network;
don't. The extraction is best-effort HTML scraping anchored on the page's real structure (the
description is the paragraph before `Credit N points`; a bare `/Content/` match hits the "unit
content may change" boilerplate instead), so the result **always** carries the handbook URL and
tells the model to link it. Unlike the sheets, this result is wrapped in `<<MCP_TOOL_RESULT>>`
markers — it's scraped from a website, not first-party data.

## Event images and reminders

Event images are stored as `image_channel_id` + `image_message_id` + `image_attachment_id`, **never
as a CDN URL**: Discord attachment links are signed and expire within about a day. `/event add
image:` and `/event setimage` re-upload onto the bot's own confirmation message and store a pointer
to it, and `utils/eventImage.ts` re-fetches that message to mint a fresh signed URL on demand. The
organiser is told not to delete the confirmation message; if they do, resolution reports `missing`
and the dead reference is cleared so we stop retrying it every tick.

`classes/eventScheduler.ts` sweeps every 5 minutes for two windows (24 h and 1 h before start) and
is **off unless a guild sets `event_reminder_channels`** (`/serverconfig setchannel`) — no DM
fallback, no guessing a channel, and the skip is logged once per guild rather than once per tick.
Duplicate suppression lives in the DB: `reminder_day_sent_at` / `reminder_soon_sent_at` are claimed
by an UPDATE conditional on the column still being NULL, and the claim happens **before** the post,
so restarts and overlapping ticks can't double-announce. An unconfigured guild deliberately does
*not* consume the marker, so reminders start working the moment a channel is set. The window is
`now < starts_at <= now + window`, so a bot that was offline overnight comes back quiet instead of
announcing yesterday.

## Seeding

`bun run seed:committee <guild-id>` reads **`data/committee-seed.json`, which is gitignored** — it
maps real people's names to Discord IDs and must not go into a public repo. The committed
`data/committee-seed.example.json` documents the shape. Don't inline a roster into the script.

## Prompt metadata

`keywordsBehaviorHandler.ts` prefixes every user prompt with `[date]-[title]-[username]-`, looking
the title up from `Committee` and defaulting to `Ordinary Member`. The lookup is wrapped in
try/catch — a roster failure must never cost the reply. The prefix is stored in chat history and
replayed, which is intended. `unwrapDiscordUserMessage()` (`utils/ai.ts`) is deliberately not
anchored to line start because of it — keep it that way or TitleGen silently breaks.
