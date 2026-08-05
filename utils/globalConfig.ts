import { parseChannelIds } from './parseChannelIds';

export const GLOBAL_CONFIG_KEYS = {
  FOOTBALL: 'football',
  BANNED: 'banned',
  SEASON: 'season',
  ALLOWED_SERVERS: 'allowed_servers',
  BIRTHDAY_CHANNELS: 'birthday_channels',
  FOOTBALL_CHANNELS: 'football_channels',
} as const;

export const GLOBAL_CHANNEL_LIST_KEYS = [
  GLOBAL_CONFIG_KEYS.BIRTHDAY_CHANNELS,
  GLOBAL_CONFIG_KEYS.FOOTBALL_CHANNELS,
] as const;

export const GLOBAL_SERVER_LIST_KEYS = [
  GLOBAL_CONFIG_KEYS.ALLOWED_SERVERS,
] as const;

export type GlobalChannelListKey = typeof GLOBAL_CHANNEL_LIST_KEYS[number];
export type GlobalServerListKey = typeof GLOBAL_SERVER_LIST_KEYS[number];
export type DocumentedGlobalConfigKey = typeof GLOBAL_CONFIG_KEYS[keyof typeof GLOBAL_CONFIG_KEYS];

export const DOCUMENTED_GLOBAL_CONFIG_KEYS: {
  key: DocumentedGlobalConfigKey;
  description: string;
  defaultValue: string;
}[] = [
  {
    key: GLOBAL_CONFIG_KEYS.FOOTBALL,
    description: 'World Cup announcement scheduler. 0 = off, 1 = on',
    defaultValue: '1',
  },
  {
    key: GLOBAL_CONFIG_KEYS.BANNED,
    description: 'Emergency command kill-switch. 0 = off, 1 = on (blocks non-dev commands)',
    defaultValue: '0',
  },
  {
    key: GLOBAL_CONFIG_KEYS.SEASON,
    description: 'Seasonal mode for claim/slots (e.g. normal, christmas)',
    defaultValue: 'normal',
  },
  {
    key: GLOBAL_CONFIG_KEYS.ALLOWED_SERVERS,
    description: 'Guild IDs where the bot is allowed to run',
    defaultValue: 'none',
  },
  {
    key: GLOBAL_CONFIG_KEYS.BIRTHDAY_CHANNELS,
    description: 'Channels that receive birthday announcements',
    defaultValue: 'none',
  },
  {
    key: GLOBAL_CONFIG_KEYS.FOOTBALL_CHANNELS,
    description: 'Channels that receive World Cup match announcements',
    defaultValue: 'none',
  },
];

/** Keys managed via `/globalconfig set` (not list keys managed by register commands). */
export const SETTABLE_GLOBAL_VALUE_KEYS = DOCUMENTED_GLOBAL_CONFIG_KEYS.filter(
  (entry) => !(GLOBAL_CHANNEL_LIST_KEYS as readonly string[]).includes(entry.key)
    && !(GLOBAL_SERVER_LIST_KEYS as readonly string[]).includes(entry.key),
);

const BOOLEAN_VALUE_KEYS = new Set<string>([
  GLOBAL_CONFIG_KEYS.FOOTBALL,
  GLOBAL_CONFIG_KEYS.BANNED,
]);

const DOCUMENTED_KEY_SET = new Set<string>(DOCUMENTED_GLOBAL_CONFIG_KEYS.map((entry) => entry.key));

function formatUnsetDisplay(defaultValue: string): string {
  return `None (default: ${defaultValue})`;
}

function documentedDefault(key: DocumentedGlobalConfigKey): string {
  return DOCUMENTED_GLOBAL_CONFIG_KEYS.find((entry) => entry.key === key)!.defaultValue;
}

export function isDocumentedGlobalConfigKey(key: string): key is DocumentedGlobalConfigKey {
  return DOCUMENTED_KEY_SET.has(key);
}

export function validateGlobalConfigValue(key: string, value: string): string | null {
  if (!SETTABLE_GLOBAL_VALUE_KEYS.some((entry) => entry.key === key)) {
    return `Unknown key. Supported keys: ${SETTABLE_GLOBAL_VALUE_KEYS.map((entry) => entry.key).join(', ')}`;
  }

  if (BOOLEAN_VALUE_KEYS.has(key)) {
    if (value !== '0' && value !== '1') {
      return `${key} must be 0 or 1`;
    }
    return null;
  }

  if (key === GLOBAL_CONFIG_KEYS.SEASON) {
    if (!value.trim()) return `${key} must not be empty`;
    return null;
  }

  return null;
}

export function formatGlobalChannelListValue(
  key: GlobalChannelListKey,
  raw: string | null | undefined,
): string {
  if (!raw?.trim()) return formatUnsetDisplay(documentedDefault(key));
  const ids = parseChannelIds(raw);
  return ids.length > 0
    ? ids.map((id) => `<#${id}>`).join(', ')
    : formatUnsetDisplay(documentedDefault(key));
}

export function formatGlobalServerListValue(
  key: GlobalServerListKey,
  raw: string | null | undefined,
): string {
  if (!raw?.trim()) return formatUnsetDisplay(documentedDefault(key));
  const ids = parseChannelIds(raw);
  return ids.length > 0
    ? ids.map((id) => `\`${id}\``).join(', ')
    : formatUnsetDisplay(documentedDefault(key));
}

export function formatGlobalConfigOverview(rows: { key: string; value: string }[]): string {
  const valueByKey = new Map(rows.map((row) => [row.key, row.value]));
  const lines: string[] = [];

  lines.push('**Values**');
  SETTABLE_GLOBAL_VALUE_KEYS.forEach((entry) => {
    const raw = valueByKey.get(entry.key);
    const display = raw?.trim() ? raw : formatUnsetDisplay(entry.defaultValue);
    lines.push(`${entry.key}: ${display}`);
  });

  lines.push('', '**Channel lists**');
  GLOBAL_CHANNEL_LIST_KEYS.forEach((listKey) => {
    lines.push(`${listKey}: ${formatGlobalChannelListValue(listKey, valueByKey.get(listKey))}`);
  });

  lines.push('', '**Server lists**');
  GLOBAL_SERVER_LIST_KEYS.forEach((listKey) => {
    lines.push(`${listKey}: ${formatGlobalServerListValue(listKey, valueByKey.get(listKey))}`);
  });

  const documentedKeys = new Set<string>(DOCUMENTED_GLOBAL_CONFIG_KEYS.map((entry) => entry.key));
  const extras = rows.filter((row) => !documentedKeys.has(row.key));
  if (extras.length > 0) {
    lines.push('', '**Other**');
    extras.forEach((row) => {
      lines.push(`${row.key}: ${row.value}`);
    });
  }

  return lines.join('\n');
}
