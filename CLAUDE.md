# UWA AI Marv — agent guide

@AGENTS.md

Agent docs are two layers. `AGENTS.md` above is the always-loaded core: identity, commands, bot
architecture, security guardrails, gotchas. Subsystem detail lives in `.claude/rules/*.md`, each
scoped with `paths:` frontmatter so it loads only when you open the files it describes.

Write each fact in the narrowest file that covers it — don't promote subsystem detail into
`AGENTS.md`, and don't duplicate it across both.
