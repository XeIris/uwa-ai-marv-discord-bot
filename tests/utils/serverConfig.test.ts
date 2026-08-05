import Database from '../../database/Database';
import {
  formatChannelListValue,
  formatServerConfigOverview,
  loadResolvedServerConfig,
  SERVER_CONFIG_KEYS,
  validateServerConfigValue,
  validateSettableChannelKey,
  validateSettableRoleName,
} from '../../utils/serverConfig';

describe('serverConfig utils', () => {
  let db: Database;

  beforeAll(async () => {
    db = new Database(`./tests/temp/testServerConfigUtil-${Date.now()}.db`);
    await db.ready;
  });

  afterAll(() => {
    db.db.close();
  });

  beforeEach(async () => {
    await db.executeQuery('DELETE FROM ServerConfig');
  });

  it('returns documented defaults when keys are unset', async () => {
    const config = await loadResolvedServerConfig(db, '123456789');
    expect(config.pokemonSpawnRate).toBe(0.01);
    expect(config.pokemonShinyChance).toBe(0.03);
    expect(config.pokemonMysteryChance).toBe(0.3);
    expect(config.seriousChannelIds).toEqual([]);
    expect(config.messageReactsEnabled).toBe(true);
  });

  it('loads configured values for a server', async () => {
    const serverId = '123456789';
    await db.serverConfig.setServerConfig(serverId, SERVER_CONFIG_KEYS.POKEMON_SPAWN_RATE, '0.05');
    await db.serverConfig.setServerConfig(serverId, SERVER_CONFIG_KEYS.POKEMON_SHINY_CHANCE, '0.1');
    await db.serverConfig.setServerConfig(serverId, SERVER_CONFIG_KEYS.POKEMON_MYSTERY_CHANCE, '0.2');
    await db.serverConfig.setServerConfig(serverId, SERVER_CONFIG_KEYS.SERIOUS_CHANNELS, '111, 222');

    const config = await loadResolvedServerConfig(db, serverId);
    expect(config.pokemonSpawnRate).toBe(0.05);
    expect(config.pokemonShinyChance).toBe(0.1);
    expect(config.pokemonMysteryChance).toBe(0.2);
    expect(config.seriousChannelIds).toEqual(['111', '222']);
    expect(config.messageReactsEnabled).toBe(true);
  });

  it('loads message_reacts_enabled flag', async () => {
    const serverId = '123456789';
    await db.serverConfig.setServerConfig(serverId, SERVER_CONFIG_KEYS.MESSAGE_REACTS_ENABLED, '0');

    const config = await loadResolvedServerConfig(db, serverId);
    expect(config.messageReactsEnabled).toBe(false);
  });

  it('falls back to defaults for invalid numeric values', async () => {
    const serverId = '123456789';
    await db.serverConfig.setServerConfig(serverId, SERVER_CONFIG_KEYS.POKEMON_SPAWN_RATE, '2');

    const config = await loadResolvedServerConfig(db, serverId);
    expect(config.pokemonSpawnRate).toBe(0.01);
  });

  describe('validateServerConfigValue', () => {
    it('accepts valid rate values', () => {
      expect(validateServerConfigValue(SERVER_CONFIG_KEYS.POKEMON_SPAWN_RATE, '0.02')).toBeNull();
    });

    it('accepts boolean flags as 0 or 1', () => {
      expect(validateServerConfigValue(SERVER_CONFIG_KEYS.MESSAGE_REACTS_ENABLED, '0')).toBeNull();
      expect(validateServerConfigValue(SERVER_CONFIG_KEYS.MESSAGE_REACTS_ENABLED, '1')).toBeNull();
      expect(validateServerConfigValue(SERVER_CONFIG_KEYS.MESSAGE_REACTS_ENABLED, '0.5')).not.toBeNull();
    });

    it('rejects invalid keys and values', () => {
      expect(validateServerConfigValue(SERVER_CONFIG_KEYS.POKEMON_SPAWN_RATE, '1.5')).not.toBeNull();
      expect(validateServerConfigValue(SERVER_CONFIG_KEYS.SERIOUS_CHANNELS, '0.1')).not.toBeNull();
      expect(validateServerConfigValue('unknown_key', '0.1')).not.toBeNull();
    });
  });

  describe('validateSettableRoleName and validateSettableChannelKey', () => {
    it('accepts functional keys only', () => {
      expect(validateSettableRoleName('girl')).toBeNull();
      expect(validateSettableChannelKey('serious_channels')).toBeNull();
    });

    it('rejects unknown keys', () => {
      expect(validateSettableRoleName('egirl')).not.toBeNull();
      expect(validateSettableChannelKey('announcements')).not.toBeNull();
    });
  });

  describe('formatServerConfigOverview', () => {
    it('shows defaults for unset values and formats set roles and channels', () => {
      const overview = formatServerConfigOverview([
        { key: 'pokemon_spawn_rate', value: '0.05' },
        { key: 'role:girl', value: '111111111' },
        { key: 'serious_channels', value: '333333333,444444444' },
      ]);

      expect(overview).toContain('pokemon_spawn_rate: 0.05');
      expect(overview).toContain('pokemon_shiny_chance: None (default: 0.03)');
      expect(overview).toContain('message_reacts_enabled: None (default: 1)');
      expect(overview).toContain('serious_channels: <#333333333>, <#444444444>');
      expect(overview).toContain('girl: <@&111111111>');
      expect(overview).not.toContain('channel:');
    });

    it('shows defaults when nothing is configured', () => {
      const overview = formatServerConfigOverview([]);
      expect(overview).toContain('pokemon_spawn_rate: None (default: 0.01)');
      expect(overview).toContain('serious_channels: None (default: none)');
      expect(overview).toContain('girl: None (default: none)');
    });
  });

  describe('formatChannelListValue', () => {
    it('returns default display for empty values', () => {
      expect(formatChannelListValue(null)).toBe('None (default: none)');
      expect(formatChannelListValue('')).toBe('None (default: none)');
    });
  });
});
