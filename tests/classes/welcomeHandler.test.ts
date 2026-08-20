import {
  describe, expect, it,
} from 'bun:test';
import { handleGuildMemberAdd } from '../../classes/handlers/welcomeHandler';

const GUILD = 'g1';
/** Real Discord channel ids are 17-20 digit snowflakes — parseSnowflakeIds validates that. */
const CH_HOME = '100000000000000001';
const CH_FOREIGN = '100000000000000002';

interface Harness {
  client: any;
  member: any;
  sent: string[];
}

/**
 * The handler renders a real card, so keep the avatar null: that skips the CDN
 * fetch, and a missing avatar is an ordinary path (the disc just stays blank).
 */
function harness(opts: {
  welcomeChannels?: string;
  /** guildId each fetched channel reports; keyed by channel id. */
  channelGuilds?: Record<string, string | null>;
  textBased?: boolean;
  isBot?: boolean;
} = {}): Harness {
  const sent: string[] = [];
  const configRows = opts.welcomeChannels
    ? [{ key: 'welcome_channels', value: opts.welcomeChannels }]
    : [];

  const client = {
    db: { serverConfig: { getAllServerConfig: async () => configRows } },
    channels: {
      fetch: async (channelId: string) => ({
        guildId: opts.channelGuilds?.[channelId] ?? GUILD,
        isTextBased: () => opts.textBased ?? true,
        send: async () => { sent.push(channelId); },
      }),
    },
  };

  const member = {
    id: '42',
    displayName: 'xeiris',
    user: { username: 'xeiris', bot: opts.isBot ?? false },
    guild: { id: GUILD },
    displayAvatarURL: () => null,
  };

  return { client, member, sent };
}

describe('handleGuildMemberAdd', () => {
  it('posts to a configured channel in the joined guild', async () => {
    const h = harness({ welcomeChannels: CH_HOME });
    await handleGuildMemberAdd(h.client, h.member);
    expect(h.sent).toEqual([CH_HOME]);
  });

  it('stays silent when the guild has not opted in', async () => {
    const h = harness();
    await handleGuildMemberAdd(h.client, h.member);
    expect(h.sent).toEqual([]);
  });

  it('ignores bots', async () => {
    const h = harness({ welcomeChannels: CH_HOME, isBot: true });
    await handleGuildMemberAdd(h.client, h.member);
    expect(h.sent).toEqual([]);
  });

  it('skips a channel that resolves to another guild', async () => {
    // channels.fetch is client-wide, so a stale id can resolve to a channel in
    // some other guild the bot is in. That card must not go out.
    const h = harness({
      welcomeChannels: CH_FOREIGN,
      channelGuilds: { [CH_FOREIGN]: 'some-other-guild' },
    });
    await handleGuildMemberAdd(h.client, h.member);
    expect(h.sent).toEqual([]);
  });

  it('delivers to the home channel while skipping a foreign one', async () => {
    const h = harness({
      welcomeChannels: `${CH_FOREIGN},${CH_HOME}`,
      channelGuilds: { [CH_FOREIGN]: 'some-other-guild' },
    });
    await handleGuildMemberAdd(h.client, h.member);
    expect(h.sent).toEqual([CH_HOME]);
  });

  it('skips a channel that is not text-based', async () => {
    const h = harness({ welcomeChannels: CH_HOME, textBased: false });
    await handleGuildMemberAdd(h.client, h.member);
    expect(h.sent).toEqual([]);
  });

  it('does not throw when a send fails', async () => {
    const h = harness({ welcomeChannels: CH_HOME });
    h.client.channels.fetch = async () => ({
      guildId: GUILD,
      isTextBased: () => true,
      send: async () => { throw new Error('missing permissions'); },
    });
    await handleGuildMemberAdd(h.client, h.member);
    expect(h.sent).toEqual([]);
  });
});
