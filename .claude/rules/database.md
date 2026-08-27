---
paths:
  - "database/**"
---

# Database layer

`bun:sqlite`, file `persistence/database.db`. Layered: `tables/` (TableDefinition schema objects) →
`models/` (DAOs) → `queries/` (SQL strings).

**Access pattern:** `this.client.db.<model>.<method>` — e.g. `db.aiChat.getOrCreateSession(userId,
personaName)`, `db.aiUsage.addUsage(...)`.

- Field names auto-convert camelCase ↔ snake_case (`camelToSnake` / `snakeToCamelJSON`) — pass
  camelCase.
- **No formal migration system.** `Database.init()` does `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE`
  to add missing columns, manual index creation, and `PRAGMA foreign_keys = ON`. Schema changes go
  there. Legacy `ServerRoles` rows auto-migrate into `ServerConfig` (`role:<name>` keys) on boot.
- **`PRAGMA foreign_keys = ON`, so a FK target that doesn't exist breaks every write to that
  table** — SQLite resolves targets at statement-prepare time and throws `no such table: main.X`.
  This fork inherited `AiChatSession.user_id REFERENCES User(id)` after the `User` table was
  stripped, which silently killed all chat-session persistence. When stripping a table, grep the
  `constraints` arrays for references to it. `tests/database/aiChat.test.ts` has a schema-integrity
  test that walks `PRAGMA foreign_key_list` over every table and fails on a dangling target.
- Multi-statement atomicity: `db.executeTransaction((rawDb) => { ... })`. Transactions are
  serialized through an in-process FIFO queue (a single connection can't interleave BEGINs — the
  second used to roll back the first's writes). **Never call `executeTransaction` from inside a
  transaction fn** — there is a guard that throws.

## Tables

- **AI chat:** `AiChatSession` + `AiChatHistory` (`db.aiChat`) — one active session per
  user+persona (unique index enforces it, `source='discord'`), history rows are `user`/`assistant`
  (legacy `model` rows from the retired Gemini provider are still normalised on read) plus
  audit-only `tool` rows that are filtered out on replay. `persona_name` is a free-text string, not
  an enum, so sessions belonging to retired personas (Grok, GPT, …) survive the persona being
  deleted from `data/aiPersonas.json` — they stay readable and deletable in `/ai view` /
  `/ai chatdelete` but nothing can write to them again.
  **Moderation pause:** `AiChatSession.moderation_flagged` (0/1) + `moderation_categories` (audit
  string) mark a session paused by the content-safety screen — `active` stays 1 so the session is
  still returned and refused rather than silently replaced. `ADD_HISTORY` is a conditional INSERT
  (`… WHERE EXISTS (SELECT 1 FROM AiChatSession WHERE session_id = ? AND moderation_flagged = 0)`),
  so the check and the write are one statement and a turn that was mid-generation when another turn
  paused the session cannot persist into it. See `.claude/rules/ai-limits.md`.
- **AI consent:** `AiConsent` (`db.aiConsent`) — one row per user recording which version of the
  data notice they accepted; absence means no consent and no generation. See
  `.claude/rules/ai-limits.md`.
- **Credit metering:** `AiUsage` (audit log, raw tokens + derived USD cost) + `AiRateLimitWindow`
  (`tokens` column stores credits) via `db.aiUsage` — see `.claude/rules/ai-limits.md`. Generated
  images log a zero-token row here too.
- **AI tool switches:** `AiToolPreference` (`db.aiTools`, PK `(user_id, tool)`) — per-user on/off
  for Marv's optional tools. Stores **exceptions only**: every tool is on by default, so a missing
  row means enabled and a user who has never run `/ai tools` has no rows. `tool` is whitelisted
  against `AI_TOOL_KEYS` before it reaches SQL. See `.claude/rules/ai-limits.md`.
- **Per-guild settings:** `ServerConfig` (`db.serverConfig`, keyed by `server_id` + `key`) — named
  roles use `role:<name>` keys; `messageReactsEnabled` gates the AI keyword trigger, so don't make
  the Marv keyword reply depend on it silently. `CommandConfig` stays separate, for per-guild
  command blacklists.
- **Global:** `GlobalConfig` — allowed servers (`allowed_servers`), the `banned` kill-switch.
  These override/augment the corresponding env vars.
- **Media logs:** `ImageGenLog` / `MusicGenLog` (`db.imageGen` / `db.musicGen`) — per-user
  rolling-24h generation rate limits.
