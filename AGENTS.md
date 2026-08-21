# UWA AI Marv — Agent / Contributor Technical Reference

**A fork of [Mewtwo2387/silverwolf](https://github.com/Mewtwo2387/silverwolf) stripped down to its
AI features only.** No website, no games/economy, no roleplay system, no birthday/baby/football
automation. Runs in a single Bun process with one SQLite DB.

Not a GitHub fork and no shared commit history (squashed import), so upstream changes arrive by
`git cherry-pick` from the `upstream` remote, never by merge. Upstream is **unlicensed** — don't
copy its code into anything else without asking its authors first.

**Last updated: 2026-08-21**

> **Maintenance rule.** Edit agent docs only on *substantive architectural* change — new
> architecture, new auth, new data flows/services, schema or security-model changes, or when
> something here becomes factually wrong. Do **not** touch them for routine work (adding a single
> command or a content tweak). Put each fact in the **narrowest-scoped file that covers it** — this
> root file is loaded on every turn of every session, so it stays small and holds only what's true
> everywhere. When you make a qualifying change, bump the date above and edit only the affected
> section. Keep it dense; no fluff.

## Context map

Detail lives in path-scoped rules that load automatically when you open the matching files. Don't
duplicate their content here.

| Working on | Loads |
| ------ | ------ |
| `database/**` | `.claude/rules/database.md` — DAO layering, transactions, settings tables |
| `utils/ai.ts`, `utils/aiPricing.ts`, `utils/llmRetry.ts`, `utils/aiConsent.ts`, `commands/ai*.ts`, `AiUsageModel` | `.claude/rules/ai-limits.md` — credit metering, model routing, consent gate, retry policy |
| `commands/committee_*`, `commands/event_*`, `utils/clubInfo.ts`, the club models | `.claude/rules/club-data.md` — roster, events, constitution |
| `utils/diagramGen.ts`, `data/skills/diagram-guide.md`, `scripts/fetch-fonts.ts` | `.claude/rules/diagrams.md` — render_diagram, markup allowlists |
| `utils/welcomeCard.ts`, `classes/handlers/welcomeHandler.ts`, `commands/dev_welcome_test.ts` | `.claude/rules/welcome.md` — join welcome card |
| `Dockerfile`, `docker-compose.yaml`, `scripts/**` | `.claude/rules/deploy.md` — image, volumes |

## Commands

Boot locally: `bun install` → create `.env` (see `.env.example`) → `bun run dev`. **Bun 1.4+**
is required and pinned — see `.claude/rules/deploy.md` for the places the version lives.

- `bun run dev` / `bun run start` — run `index.ts` (dev is `--watch`).
- `bun test` — Bun test runner, `tests/` with the `tests/setup.ts` preload (30s default timeout),
  Jest-like API. Runs `--parallel`, which spreads the files over one worker process per CPU core
  and implies `--isolate` (each file gets a fresh global). `bun run test:isolate` is the
  single-process equivalent — same isolation, no parallelism — for when parallel output is hard
  to read or you're bisecting a flake.
- `bun run lint` / `lint:fix` — ESLint 10, flat config in `eslint.config.mjs`
  (airbnb-extended + n + promise + typescript-eslint).
- `bun run typecheck` — `tsc --noEmit`, on **TypeScript 7** (the Go compiler).
  TS 7 dropped the programmatic API, which typescript-eslint still needs, so the two run
  side-by-side per Microsoft's guidance: `@typescript/native` is an alias for `typescript@7`
  and supplies `tsc`, while the `typescript` name is aliased to `@typescript/typescript6` so
  library importers get the 6.0 API (and `tsc6` if you want it). Collapse this back to a plain
  `typescript` dependency once typescript-eslint supports 7.1's new API.
- `bun run fetch:soundfont` — download the GM soundfont for the JAYDON music generator.
- `bun run fetch:fonts` — download the fonts for the diagram renderer (DejaVu) and the welcome
  card (Bruno Ace).
- `bun run fetch:constitution` — regenerate `data/skills/constitution.md` from the club's LaTeX source.
- `bun run seed:committee <guild-id>` — one-off seed of the `Committee` table from the gitignored
  `data/committee-seed.json` (run with the bot stopped).

Full script list is in `package.json`; env key names are in `.env.example`. Some settings also live
in the DB `GlobalConfig` table and override/augment env.

## What's here (and what was stripped)

**AI features:** keyword-triggered AI chat (say `marv`/`@grok`/`@ds`/etc. → webhook replies via
`classes/handlers/keywordsBehaviorHandler.ts` → `utils/ai.ts`), per-user chat sessions
(`/ai view|chatnew|chatswitch|chatdelete|retitle|forget`, `AiChatModel`), credit metering (`/ai usage`,
`AiUsageModel`), AI chat summaries (`/summary count|time`), and the web-search / image-generation /
music-generation (JAYDON) / diagram-rendering tools that ride along in chat. Personas live in
`data/aiPersonas.json`.

**Club data (this fork's reason to exist):** `Marv` is the UWA AI Club mascot persona. It's the only
persona with `clubTools: true`, which grants read-only tools backed by our own data: the committee
roster (`/committee`), the events calendar (`/event`), the club constitution, four hand-maintained
reference sheets (official links — also `/links`, UWA key dates, student perks, club FAQ), and UWA
handbook unit lookup. Marv is **dual-routed** — image turns take a different model from text turns;
the models and the routing rationale live in `.claude/rules/ai-limits.md`. Marv also answers to his bare name (`marv`, no `@`), matched on word
boundaries so "marvel" doesn't summon him. Every user prompt is also tagged
`[date]-[committee title]-[username]-` so any persona knows who it's talking to. See
`.claude/rules/club-data.md`.

**Stripped:** `commands/askSilverwolfAI.ts`, the entire roleplay system (`utils/rp*`,
`commands/ai_rp_*`, `classes/rpScheduler.ts`), the website (`site_src/`), games/economy,
birthday/baby/football schedulers, pokemon handlers, and the quote system. `data/keywords.json` has
a single entry (the AI triggers). Don't resurrect these without saying so.

**Join welcomes:** a member joining an opted-in guild gets a rendered welcome card — the club
artwork with their avatar composited in — posted to `welcome_channels`. Opt-in only; unset means
silent. See `.claude/rules/welcome.md`.

**Public commands:** `/links` (static club links, no AI credits), `/committee list`, `/event list`,
`/event remindme` (per-member DM reminders before an event).

**Dev/admin commands kept** (generic, not tied to stripped features): `/eval`, `/execute`,
`/ping dev`, `/dev ramstats`, `/dev welcome_test`, `/dbdump`, `/logdump`, `/serverconfig get|setchannel|
setrole|setvalue`, `/globalconfig get|set`, `/blacklist configure|view`, `/server register|
unregister`.

## Bot architecture

**Startup** (`index.ts` → `classes/silverwolf.ts`): construct `Silverwolf` (extends discord.js
`Client`) → `init()` loads commands, keywords, listeners; awaits `db.ready`; loads allowed servers
→ `login()` → `registerCommands(CLIENT_ID)`. `SIGTERM`/`SIGINT` → `shutdownMcp()` then exit.

**Adding a command.** One file per command in `commands/`, extending `Command` or `DevCommand`
(`commands/classes/`); auto-discovered on restart by `loadCommands()`. The constructor calls
`super(client, name, description, options[], opts)` where
`opts = { ephemeral, skipDefer, isSubcommandOf }`; implement `async run(interaction)`.
Subcommands: file named `group_sub.ts` with `isSubcommandOf: 'group'`, plus an entry in the group
container at `commands/commandgroups/group.ts`.

`registerCommands()` deploys to Discord: `/server` globally, everything else per-guild, honoring the
per-guild `CommandConfig` blacklist.

**Access control** (`utils/accessControl.ts`): `isDev` (user ID in `ALLOWED_USERS`), `isAdmin`
(guild admin **or** dev), `isAllowedServer` (guild in `GlobalConfig.allowed_servers`, cached), plus
a global `banned` kill-switch. `DevCommand` enforces `isDev` before running.

**Events** (wired in `classes/silverwolf.ts`): `messageCreate` → the single AI keyword trigger
(`marv`/`@grok` etc. → `keywordsBehaviorHandler`); `interactionCreate` → command dispatch +
autocomplete; `guildMemberAdd` → the join welcome card (`welcomeHandler`, off unless the guild
sets `welcome_channels`); message delete/edit tracked for history.

**Scheduler.** `classes/eventScheduler.ts` is the only background timer — started after `login()`,
stopped on shutdown. It posts event reminders and is **off** for any guild that hasn't set
`event_reminder_channels`. The same tick also delivers the per-user `/event remindme` DMs (a
separate per-member opt-in needing no guild config) and drains the `EventNotice` queue that
`/event edit` and `/event delete` fill when an event moves or is cancelled.

**Shared code:** `utils/ai.ts` is the core (provider clients, personas, `generateContent`, tools);
`utils/tokenizer.ts` (context trimming), `utils/aiPricing.ts` + `utils/discordRateLimit.ts` (credits),
`utils/llmRetry.ts` (retry policy), `utils/mcp.ts` (web-search MCP client), `utils/imageGen.ts` +
`utils/musicGen.ts` + `utils/diagramGen.ts` + `utils/aiMedia.ts` (media tools),
`utils/pdf.ts` (PDF extraction), `utils/clubInfo.ts` (club data tools),
`utils/aiConsent.ts` (one-time data-notice gate),
`utils/eventReminders.ts` (DM reminder lead times), `utils/embedColour.ts` (announce colours),
`utils/welcomeCard.ts` (join welcome card),
`utils/memoryPressure.ts` (OS low-memory notification → discord.js cache sweep).

## Security & performance guardrails

- **Validate/whitelist every input.** `Number.isFinite` / `Number.isInteger` / `Math.trunc`, enum
  whitelists. Coerce, then check; reject otherwise.
- **Never interpolate untrusted data** into SQL. Use prepared statements (`?`) only.
- **Never write raw SQL outside `database/queries/`.** Queries use `?` placeholders only.
- **Logging:** use `log()` / `logError()` (`utils/log.ts`) → `persistence/`. **Never log secrets.**
- **No dev bypass of AI metering** — everyone pays credits, devs included.
- **No AI generation without consent.** Every entry point that sends member text to a provider
  calls `ensureAiConsent` (`utils/aiConsent.ts`) first and stops silently if it returns false —
  it fails closed. New AI entry points must be gated too.

## Gotchas

- **No DB migrations.** Schema changes go in `Database.init()` (`CREATE TABLE IF NOT EXISTS` +
  `ALTER TABLE`). See `.claude/rules/database.md`.
- **`persistence/` holds all runtime data** (SQLite DB + logs) and is the Docker volume — nothing
  written elsewhere survives a redeploy.
- The JAYDON music generator needs `data/soundfonts/GeneralUser-GS.sf2` (gitignored) — fetch it
  with `bun run fetch:soundfont` before first use. The diagram renderer and the welcome card
  likewise need `data/fonts/*.ttf` — `bun run fetch:fonts`.
- **`render_diagram` renders model-authored markup.** Its HTML and SVG allowlists are a security
  boundary (no resource loading, no code, no entity expansion), not a formatting preference — see
  `.claude/rules/diagrams.md` before touching them.
- There is no website and no MCP *server* side — only the outbound web-search MCP client in
  `utils/mcp.ts`.
- **`data/skills/` is bot runtime data, not agent skills.** Those files are read at request time and
  handed to the chat model as tool results (`get_music_guide`, `recall_constitution`).
- **`data/keywords.json` gates the AI trigger separately from `data/aiPersonas.json`.** A persona
  trigger that isn't also in `keywords.json` never fires; both files are imported at boot, so
  editing either needs a restart.
