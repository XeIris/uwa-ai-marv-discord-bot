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
  (`model` for Gemini) plus audit-only `tool` rows that are filtered out on replay.
- **Credit metering:** `AiUsage` (audit log, raw tokens + derived USD cost) + `AiRateLimitWindow`
  (`tokens` column stores credits) via `db.aiUsage` — see `.claude/rules/ai-limits.md`.
- **Per-guild settings:** `ServerConfig` (`db.serverConfig`, keyed by `server_id` + `key`) — named
  roles use `role:<name>` keys; `messageReactsEnabled` gates the AI keyword trigger, so don't make
  the grok mention reply depend on it silently. `CommandConfig` stays separate, for per-guild
  command blacklists.
- **Global:** `GlobalConfig` — allowed servers (`allowed_servers`), the `banned` kill-switch.
  These override/augment the corresponding env vars.
- **Media logs:** `ImageGenLog` / `MusicGenLog` (`db.imageGen` / `db.musicGen`) — per-user
  rolling-24h generation rate limits.
