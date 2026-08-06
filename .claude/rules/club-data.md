---
paths:
  - "commands/committee_*.ts"
  - "commands/event_*.ts"
  - "commands/commandgroups/committee.ts"
  - "commands/commandgroups/event.ts"
  - "utils/clubInfo.ts"
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
boundary with `parsePerthDateTime()` (`utils/clubInfo.ts`), which returns `null` on anything
malformed — reject, never coerce. AWST is UTC+8 with no DST, so the fixed offset is correct; don't
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
`keywordsBehaviorHandler.ts`).

## Constitution

`data/skills/constitution.md` is **generated** by `bun run fetch:constitution` from
`UWA-AI-Club/constitution`'s `constitution.tex`, and **is committed** (unlike the soundfont) so a
fresh clone works. `utils/latexToMarkdown.ts` is a narrow converter for exactly that document — its
job is preserving the clause numbering (4.1, 14.2.3, …) from the `label=` specs so Marv cites
numbers that match the published PDF. Don't generalise it; re-run the script when the source
changes.

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
