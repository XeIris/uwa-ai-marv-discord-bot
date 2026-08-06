# UWA AI Marv (Discord Bot)

A fork of the Silverwolf Discord bot stripped down to **AI features only**: mention-triggered AI
chat (webhook replies), per-user chat sessions, credit metering, chat summaries, and web-search /
image / music generation tools. No website, no games/economy, no roleplay system.

> **Technical reference**: see [AGENTS.md](AGENTS.md).

## Setup

```bash
bun install
bun run fetch:soundfont   # optional: GM soundfont for the music generator
```

Create a `.env` file. See [`.env.example`](.env.example) for the keys (Discord `TOKEN` +
`CLIENT_ID`, `GEMINI_TOKEN` / `OPENROUTER_API_KEY`, `ALLOWED_USERS`). Bun loads `.env`
automatically.

## Run

```bash
bun run dev    # watch mode
bun run start  # production
```

After first boot, register your server with `/server register`, then mention the bot
(`@marv`, `@grok`, `@ds`, ...) in a channel to chat with an AI persona. Personas live in
`data/aiPersonas.json`; use `-n` to start a fresh session.

## What's here

- AI chat via keyword triggers (`data/keywords.json`, `classes/handlers/keywordsBehaviorHandler.ts`)
- Session management: `/ai view|chatnew|chatswitch|chatdelete|retitle`
- Credits & usage: `/ai usage`
- Chat summaries: `/summary count|time`
- Club data Marv can read: `/committee add|remove|update|list`, `/event add|edit|delete|list`
- Generic dev/admin: `/eval`, `/execute`, `/dev ramstats`, `/dbdump`, `/logdump`, `/serverconfig`,
  `/globalconfig`, `/blacklist`, `/server`

## What was stripped

- `commands/askSilverwolfAI.ts` and the whole roleplay system (`utils/rp*`, `commands/ai_rp_*`)
- Website (`site_src/`), games/economy, birthday/baby/football automation, pokemon, quotes
