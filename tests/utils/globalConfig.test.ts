import { describe, expect, test } from 'bun:test';
import {
  formatGlobalConfigOverview,
  GLOBAL_CONFIG_KEYS,
  validateGlobalConfigValue,
} from '../../utils/globalConfig';

describe('globalConfig utils', () => {
  describe('validateGlobalConfigValue', () => {
    test('accepts football 0/1', () => {
      expect(validateGlobalConfigValue(GLOBAL_CONFIG_KEYS.FOOTBALL, '0')).toBeNull();
      expect(validateGlobalConfigValue(GLOBAL_CONFIG_KEYS.FOOTBALL, '1')).toBeNull();
      expect(validateGlobalConfigValue(GLOBAL_CONFIG_KEYS.FOOTBALL, '2')).not.toBeNull();
    });

    test('accepts banned 0/1', () => {
      expect(validateGlobalConfigValue(GLOBAL_CONFIG_KEYS.BANNED, '0')).toBeNull();
      expect(validateGlobalConfigValue(GLOBAL_CONFIG_KEYS.BANNED, '1')).toBeNull();
      expect(validateGlobalConfigValue(GLOBAL_CONFIG_KEYS.BANNED, 'true')).not.toBeNull();
    });

    test('rejects list keys and unknown keys', () => {
      expect(validateGlobalConfigValue(GLOBAL_CONFIG_KEYS.FOOTBALL_CHANNELS, '1')).not.toBeNull();
      expect(validateGlobalConfigValue('unknown_key', '1')).not.toBeNull();
    });
  });

  describe('formatGlobalConfigOverview', () => {
    test('shows defaults for unset values and formats set lists', () => {
      const overview = formatGlobalConfigOverview([
        { key: 'football', value: '0' },
        { key: 'birthday_channels', value: '111,222' },
        { key: 'allowed_servers', value: '999' },
        { key: 'custom_legacy', value: 'keep-me' },
      ]);

      expect(overview).toContain('football: 0');
      expect(overview).toContain('banned: None (default: 0)');
      expect(overview).toContain('season: None (default: normal)');
      expect(overview).toContain('birthday_channels: <#111>, <#222>');
      expect(overview).toContain('football_channels: None (default: none)');
      expect(overview).toContain('allowed_servers: `999`');
      expect(overview).toContain('custom_legacy: keep-me');
    });

    test('shows defaults when nothing is configured', () => {
      const overview = formatGlobalConfigOverview([]);
      expect(overview).toContain('football: None (default: 1)');
      expect(overview).toContain('birthday_channels: None (default: none)');
      expect(overview).toContain('allowed_servers: None (default: none)');
    });
  });
});
