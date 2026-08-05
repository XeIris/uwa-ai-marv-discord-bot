---
paths:
  - "Dockerfile"
  - "docker-compose.yaml"
  - "scripts/**"
---

# Docker

- **Docker** (`Dockerfile`): multi-stage — `oven/bun:1` builder installs deps and fetches the GM
  soundfont (checksum-verified, layer-cached), then `oven/bun:1-slim` runtime as non-root user
  `bun`, `CMD ["bun","index.ts"]`. No native build libs needed (no `canvas`).
- `docker-compose.yaml` mounts `./persistence` (SQLite persistence), `mem_limit: 1g`.

**`persistence/` is the Docker volume — all runtime data (the SQLite DB, logs) lives there.** Don't
write runtime state anywhere else; it won't survive a redeploy.

No CI/CD — this fork is local-only, no `.github/` workflows.
