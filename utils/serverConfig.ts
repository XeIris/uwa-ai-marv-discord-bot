import { parseChannelIds } from './parseChannelIds';

export const SERVER_CONFIG_KEYS = {
  POKEMON_SPAWN_RATE: 'pokemon_spawn_rate',
  POKEMON_SHINY_CHANCE: 'pokemon_shiny_chance',
  POKEMON_MYSTERY_CHANCE: 'pokemon_mystery_chance',
  SERIOUS_CHANNELS: 'serious_channels',
  MESSAGE_REACTS_ENABLED: 'message_reacts_enabled',
} as const;

export const SERVER_CHANNEL_LIST_KEYS = [
  SERVER_CONFIG_KEYS.SERIOUS_CHANNELS,
] as const;

export type ServerChannelListKey = typeof SERVER_CHANNEL_LIST_KEYS[number];

/** Role names referenced by bot commands (`role:<name>` keys). */
export const SETTABLE_ROLE_NAMES = [
  'girl',
] as const;

export type SettableRoleName = typeof SETTABLE_ROLE_NAMES[number];

export const SERVER_ROLE_KEY_PREFIX = 'role:';

export function serverRoleKey(roleName: string): string {
  return `${SERVER_ROLE_KEY_PREFIX}${roleName}`;
}

export function isServerChannelListKey(key: string): key is ServerChannelListKey {
  return (SERVER_CHANNEL_LIST_KEYS as readonly string[]).includes(key);
}

export function isSettableRoleName(name: string): name is SettableRoleName {
  return (SETTABLE_ROLE_NAMES as readonly string[]).includes(name);
}

export function validateSettableRoleName(name: string): string | null {
  if (!isSettableRoleName(name)) {
    return `Unknown role name. Supported names: ${SETTABLE_ROLE_NAMES.join(', ')}`;
  }
  return null;
}

export function validateSettableChannelKey(key: string): string | null {
  if (!isServerChannelListKey(key)) {
    return `Unknown channel key. Supported keys: ${SERVER_CHANNEL_LIST_KEYS.join(', ')}`;
  }
  return null;
}

export type DocumentedServerConfigKey = typeof SERVER_CONFIG_KEYS[keyof typeof SERVER_CONFIG_KEYS];

export const DOCUMENTED_SERVER_CONFIG_KEYS: {
  key: DocumentedServerConfigKey;
  description: string;
  defaultValue: string;
}[] = [
  {
    key: SERVER_CONFIG_KEYS.POKEMON_SPAWN_RATE,
    description: 'Per-message Pokémon spawn probability (0–1)',
    defaultValue: '0.01',
  },
  {
    key: SERVER_CONFIG_KEYS.POKEMON_SHINY_CHANCE,
    description: 'Shiny variant chance when a Pokémon spawns (0–1)',
    defaultValue: '0.03',
  },
  {
    key: SERVER_CONFIG_KEYS.POKEMON_MYSTERY_CHANCE,
    description: 'Mystery variant chance when a Pokémon spawns (0–1)',
    defaultValue: '0.3',
  },
  {
    key: SERVER_CONFIG_KEYS.SERIOUS_CHANNELS,
    description: 'Channels excluded from spawns and some keyword triggers',
    defaultValue: 'none',
  },
  {
    key: SERVER_CONFIG_KEYS.MESSAGE_REACTS_ENABLED,
    description: 'Keyword/script replies on messages (e.g. @grok, nya). 0 = off, 1 = on',
    defaultValue: '1',
  },
];

/** Keys managed via `/serverconfig setvalue`. */
export const SETTABLE_VALUE_KEYS = DOCUMENTED_SERVER_CONFIG_KEYS.filter(
  (entry) => entry.key !== SERVER_CONFIG_KEYS.SERIOUS_CHANNELS,
);

function parseEnabledFlag(raw: string | null | undefined, defaultEnabled: boolean): boolean {
  if (raw === null || raw === undefined || raw === '') return defaultEnabled;
  if (raw === '1') return true;
  if (raw === '0') return false;
  return defaultEnabled;
}

const BOOLEAN_VALUE_KEYS = new Set<string>([
  SERVER_CONFIG_KEYS.MESSAGE_REACTS_ENABLED,
]);

const DOCUMENTED_KEY_SET = new Set<string>(DOCUMENTED_SERVER_CONFIG_KEYS.map((entry) => entry.key));

const DEFAULT_RATES: Record<string, number> = {
  [SERVER_CONFIG_KEYS.POKEMON_SPAWN_RATE]: 0.01,
  [SERVER_CONFIG_KEYS.POKEMON_SHINY_CHANCE]: 0.03,
  [SERVER_CONFIG_KEYS.POKEMON_MYSTERY_CHANCE]: 0.3,
};

/** Parsed server config values used at runtime (defaults applied when unset). */
export interface ResolvedServerConfig {
  pokemonSpawnRate: number;
  pokemonShinyChance: number;
  pokemonMysteryChance: number;
  seriousChannelIds: string[];
  messageReactsEnabled: boolean;
}

type ServerConfigReader = {
  serverConfig: {
    getAllServerConfig: (serverId: string) => Promise<Record<string, any>[]>;
  };
};

function parseRate(raw: string | null | undefined, defaultValue: number): number {
  if (raw === null || raw === undefined || raw === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) return defaultValue;
  return value;
}

export function isDocumentedServerConfigKey(key: string): key is DocumentedServerConfigKey {
  return DOCUMENTED_KEY_SET.has(key);
}

function documentedDefault(key: DocumentedServerConfigKey): string {
  return DOCUMENTED_SERVER_CONFIG_KEYS.find((entry) => entry.key === key)!.defaultValue;
}

function formatUnsetDisplay(defaultValue: string): string {
  return `None (default: ${defaultValue})`;
}

export function validateServerConfigValue(key: string, value: string): string | null {
  if (!SETTABLE_VALUE_KEYS.some((entry) => entry.key === key)) {
    return `Unknown key. Supported keys: ${SETTABLE_VALUE_KEYS.map((entry) => entry.key).join(', ')}`;
  }

  if (BOOLEAN_VALUE_KEYS.has(key)) {
    if (value !== '0' && value !== '1') {
      return `${key} must be 0 or 1`;
    }
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    return `${key} must be a number between 0 and 1`;
  }
  return null;
}

export function formatChannelListValue(raw: string | null | undefined): string {
  if (!raw?.trim()) return formatUnsetDisplay(documentedDefault(SERVER_CONFIG_KEYS.SERIOUS_CHANNELS));
  const ids = parseChannelIds(raw);
  return ids.length > 0
    ? ids.map((id) => `<#${id}>`).join(', ')
    : formatUnsetDisplay(documentedDefault(SERVER_CONFIG_KEYS.SERIOUS_CHANNELS));
}

export function formatServerConfigOverview(rows: { key: string; value: string }[]): string {
  const valueByKey = new Map(rows.map((row) => [row.key, row.value]));

  const lines: string[] = [];

  lines.push('**Values**');
  SETTABLE_VALUE_KEYS.forEach((entry) => {
    const raw = valueByKey.get(entry.key);
    const display = raw?.trim() ? raw : formatUnsetDisplay(entry.defaultValue);
    lines.push(`${entry.key}: ${display}`);
  });

  lines.push('', '**Channel lists**');
  SERVER_CHANNEL_LIST_KEYS.forEach((listKey) => {
    lines.push(`${listKey}: ${formatChannelListValue(valueByKey.get(listKey))}`);
  });

  lines.push('', '**Roles**');
  SETTABLE_ROLE_NAMES.forEach((roleName) => {
    const raw = valueByKey.get(serverRoleKey(roleName));
    const display = raw?.trim() ? `<@&${raw}>` : formatUnsetDisplay('none');
    lines.push(`${roleName}: ${display}`);
  });

  return lines.join('\n');
}

export async function loadResolvedServerConfig(
  db: ServerConfigReader,
  serverId: string,
): Promise<ResolvedServerConfig> {
  const rows = await db.serverConfig.getAllServerConfig(serverId);
  const values = new Map(rows.map((row) => [row.key, row.value]));

  return {
    pokemonSpawnRate: parseRate(
      values.get(SERVER_CONFIG_KEYS.POKEMON_SPAWN_RATE),
      DEFAULT_RATES[SERVER_CONFIG_KEYS.POKEMON_SPAWN_RATE],
    ),
    pokemonShinyChance: parseRate(
      values.get(SERVER_CONFIG_KEYS.POKEMON_SHINY_CHANCE),
      DEFAULT_RATES[SERVER_CONFIG_KEYS.POKEMON_SHINY_CHANCE],
    ),
    pokemonMysteryChance: parseRate(
      values.get(SERVER_CONFIG_KEYS.POKEMON_MYSTERY_CHANCE),
      DEFAULT_RATES[SERVER_CONFIG_KEYS.POKEMON_MYSTERY_CHANCE],
    ),
    seriousChannelIds: parseChannelIds(values.get(SERVER_CONFIG_KEYS.SERIOUS_CHANNELS)),
    messageReactsEnabled: parseEnabledFlag(values.get(SERVER_CONFIG_KEYS.MESSAGE_REACTS_ENABLED), true),
  };
}
