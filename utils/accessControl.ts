import { PermissionsBitField, type ChatInputCommandInteraction } from 'discord.js';
// Note: Bun automatically reads .env files

const ALLOWED_USERS = process.env.ALLOWED_USERS!.split(',');
const BASEMENT_ID = '969953667597893672';

// Cache for DB-sourced allowed servers (refreshed on first use or after mutations)
let cachedAllowedServers: string[] | null = null;

/**
 * Loads allowed servers from DB (GlobalConfig key: allowed_servers).
 * Falls back to BASEMENT_ID only.
 */
async function loadAllowedServers(db: any): Promise<string[]> {
  try {
    const dbValue = await db.globalConfig.getGlobalConfig('allowed_servers');
    if (dbValue) {
      const servers = dbValue.split(',').map((s: string) => s.trim()).filter(Boolean);
      cachedAllowedServers = servers;
      return servers;
    }
  } catch {
    // DB not ready or error — fall back
  }
  cachedAllowedServers = [BASEMENT_ID];
  return [BASEMENT_ID];
}

/**
 * Invalidates the cached allowed servers so the next isAllowedServer call
 * will reload from DB. Call after register/unregister mutations.
 */
function clearCachedAllowedServers(): void {
  cachedAllowedServers = null;
}

function isUserDev(userId: string): boolean {
  return ALLOWED_USERS.includes(userId);
}

function isDev(interaction: ChatInputCommandInteraction): boolean {
  return isUserDev(interaction.user.id);
}

function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  // eslint-disable-next-line max-len
  return (interaction.member?.permissions as PermissionsBitField)?.has(PermissionsBitField.Flags.Administrator) || isDev(interaction);
}

function isBasement(interaction: ChatInputCommandInteraction): boolean {
  return interaction.guild?.id === BASEMENT_ID;
}

function isAllowedServer(interaction: ChatInputCommandInteraction): boolean {
  const servers = cachedAllowedServers ?? [BASEMENT_ID];
  return servers.includes(interaction.guild?.id ?? '');
}

export {
  isUserDev,
  isDev,
  isAdmin,
  isBasement,
  isAllowedServer,
  loadAllowedServers,
  clearCachedAllowedServers,
};
