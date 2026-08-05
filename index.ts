import { GatewayIntentBits, Options, Sweepers } from 'discord.js';
import { log, logError } from './utils/log';
import { Silverwolf } from './classes/silverwolf';
import { shutdownMcp } from './utils/mcp';

// Note: Bun automatically reads .env files, no dotenv needed

if (!process.env.TOKEN) {
  logError('No token provided');
  throw new Error('No token provided');
}

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

log(`CLIENT_ID: ${CLIENT_ID}`);

const silverwolf = new Silverwolf(TOKEN, {
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 50,
    GuildMemberManager: 200,
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: {
      interval: 300,
      lifetime: 1800,
    },
    guildMembers: {
      interval: 300,
      filter: Sweepers.filterByLifetime({ lifetime: 3600 }),
    },
  },
});

silverwolf.login().then(() => silverwolf.registerCommands(CLIENT_ID));

const gracefulShutdown = async (signal: string) => {
  log(`Received ${signal}; shutting down`);
  try { await shutdownMcp(); } catch (err) { logError('shutdown: mcp close failed', err); }
  // eslint-disable-next-line no-process-exit
  process.exit(0);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
