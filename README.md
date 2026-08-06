# UWA AI Marv (Discord Bot)

A fork of [Mewtwo2387/silverwolf](https://github.com/Mewtwo2387/silverwolf) stripped down to
**AI features only**: mention-triggered AI chat (webhook replies), per-user chat sessions, credit
metering, chat summaries, and web-search / image / music generation tools. No website, no
games/economy, no roleplay system. Adds club-specific features for the UWA AI Club — the `Marv`
mascot persona and the committee / events / constitution data it reads.

It isn't a GitHub fork and shares no commit history with upstream (this repo starts from a squashed
import), so upstream fixes come across by cherry-pick rather than merge:

```bash
git remote add upstream https://github.com/Mewtwo2387/silverwolf.git
git fetch upstream
git cherry-pick <sha>   # patch application by path — works without a common ancestor
```

> **Technical reference**: see [AGENTS.md](AGENTS.md).

## Licence

Upstream publishes no licence, so the inherited code is under its authors' default copyright
(all rights reserved) and this fork is redistributed with their knowledge rather than under a
grant. Ask upstream to add a licence before reusing any of this elsewhere; `package.json` is
marked `UNLICENSED` until then.

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
