# --- STAGE 1: Build ---
FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json bun.lock ./

# Install project dependencies
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

# Fetch the GM soundfont for the JAYDON music generator (checksum-verified,
# cached as a layer — only re-downloads when the fetch script changes).
COPY scripts/fetch-soundfont.ts ./scripts/fetch-soundfont.ts
RUN bun scripts/fetch-soundfont.ts

# --- STAGE 2: Run ---
FROM oven/bun:1-slim
WORKDIR /app

# Create persistence directory and set permissions
RUN mkdir -p /app/persistence && chown -R bun:bun /app/persistence

# Switch to non-root user
USER bun

# Copy node_modules and code from builder
COPY --from=builder --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun . .
# Soundfont downloaded + checksum-verified in the builder stage.
COPY --from=builder --chown=bun:bun /app/data/soundfonts ./data/soundfonts

CMD ["bun", "index.ts"]
