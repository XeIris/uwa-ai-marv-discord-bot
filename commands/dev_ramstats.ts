import * as Discord from 'discord.js';
import { DevCommand } from './classes/DevCommand';
import { collectMemStats } from '../utils/memStats';
import { logError } from '../utils/log';

const toMB = (bytes: number): string => (bytes / 1024 / 1024).toFixed(2);

/**
 * Dev diagnostic: RAM breakdown plus discord.js cache sizes and DB footprint.
 * Run it periodically while the bot grows to see WHERE the memory lives (JS
 * heap vs native, which cache). The `gc` option forces a full GC first — if rss
 * drops a lot, it's heap high-water/lazy GC rather than a true leak.
 */
class RamStats extends DevCommand {
  constructor(client: any) {
    super(client, 'ramstats', 'show RAM usage breakdown for the bot process', [
      {
        name: 'gc',
        description: 'Force a full GC before measuring (synchronous — briefly stalls the bot)',
        type: 5,
        required: false,
      },
    ], {
      isSubcommandOf: 'dev',
      blame: 'ei',
    });
  }

  async run(interaction: any): Promise<void> {
    try {
      const stats = await collectMemStats(this.client, interaction.options.getBoolean('gc') ?? false);
      const { mem, before } = stats;

      const {
        rss, heapTotal, heapUsed, external, arrayBuffers,
      } = mem;
      const other = Math.max(0, rss - heapTotal - external);

      const embed = new Discord.EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`RAM Stats — Silverwolf Process${stats.forceGc ? ' (after forced GC)' : ''}`)
        .setDescription(`\`\`\`\nRSS (total footprint)   : ${toMB(rss)} MB\n\`\`\``)
        .addFields(
          {
            name: '📦 RSS Breakdown',
            value: [
              `**Heap (JS allocated)** \`${toMB(heapTotal)} MB\`  (${((heapTotal / rss) * 100).toFixed(1)}% of RSS)`,
              `**External (native)**   \`${toMB(external)} MB\`  *(incl. ArrayBuffers: \`${toMB(arrayBuffers)} MB\`)*`,
              `**Other (stack/libs)**  \`${toMB(other)} MB\``,
            ].join('\n'),
          },
          {
            name: '🧠 Heap Detail',
            value: [
              `**Used**  \`${toMB(heapUsed)} MB\``,
              `**Total** \`${toMB(heapTotal)} MB\``,
            ].join('\n'),
          },
        );

      if (stats.forceGc) {
        embed.addFields({
          name: '♻️ Freed by GC',
          value: `rss \`${toMB(before.rss - rss)} MB\` | heapUsed \`${toMB(before.heapUsed - heapUsed)} MB\``,
        });
      }

      embed.addFields(
        {
          name: '📚 discord.js Caches',
          value: [
            `**Guilds** \`${stats.guilds}\` | **Channels** \`${stats.channels}\` | **Users** \`${stats.users}\``,
            `**Messages (all channels)** \`${stats.messageCacheTotal}\` | **Members (all guilds)** \`${stats.memberCacheTotal}\``,
          ].join('\n'),
        },
        {
          name: '📝 Tracked Message History',
          value: `**Deleted** \`${stats.deletedMessages}\` | **Edited** \`${stats.editedMessages}\``,
        },
        {
          name: '💾 Persistence',
          value: `**database.db** \`${toMB(stats.dbFileBytes)} MB\``,
        },
      );

      embed
        .setFooter({ text: `PID ${process.pid} · uptime ${(process.uptime() / 60).toFixed(1)} min` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logError('ramstats failed:', error);
      await interaction.editReply({ content: 'Failed to collect memory stats.' });
    }
  }
}

export default RamStats;
