import { EmbedBuilder, MessageFlags } from 'discord.js';
import { logError, log } from '../../utils/log';
import { isDev } from '../../utils/accessControl';

export interface CommandArgs {
  ephemeral?: boolean;
  skipDefer?: boolean;
  isSubcommandOf?: string | null;
}

class Command {
  client: any;
  name: string;
  description: string;
  options: any[];
  ephemeral: boolean;
  skipDefer: boolean;
  isSubcommandOf: string | null;

  constructor(
    client: any,
    name: string,
    description: string,
    options: any[],
    args: CommandArgs = {
      ephemeral: false, skipDefer: false, isSubcommandOf: null,
    },
  ) {
    this.client = client;
    this.name = name;
    this.description = description;
    this.options = options;
    this.ephemeral = args.ephemeral || false;
    this.skipDefer = args.skipDefer || false;
    this.isSubcommandOf = args.isSubcommandOf || null;
  }

  async execute(interaction: any): Promise<void> {
    const banned = await this.client.db.globalConfig.getGlobalConfig('banned');
    if (banned === '1' || banned === 'true') {
      if (!isDev(interaction)) {
        log(`Command ${this.name} blocked: global kill-switch is on`);
        const embed = new EmbedBuilder()
          .setColor('Red')
          .setTitle(`\`/${this.name}\` is temporarily unavailable`)
          .setDescription(
            'The bot\'s commands have been paused by its maintainers, usually for '
            + 'maintenance or to deal with a problem.\n\n'
            + 'Nothing is wrong on your end and you don\'t need to do anything — '
            + 'please try again later. Thanks for your patience!',
          );
        await interaction.reply({
          embeds: [embed],
        });
        return;
      }
    }

    try {
      if (this.run !== undefined) {
        // Check if deferReply should be skipped
        if (!this.skipDefer && !interaction.deferred) {
          await interaction.deferReply({
            flags: this.ephemeral ? MessageFlags.Ephemeral : undefined,
          });
        }
        await this.run(interaction); // Run the command logic
      } else {
        await interaction.editReply({
          content: 'Not implemented',
        });
        logError(`Command ${this.name} not implemented`);
      }
    } catch (error) {
      // Global error handling logic
      logError(`Error executing command ${this.name}:`, error);

      // Inform the user about the error, if needed
      await interaction.editReply({
        content: 'Sorry — something went wrong while running that command. '
        + 'Please try again in a moment, and check your inputs if it keeps happening.',
      });
    }
  }

  async run(_interaction: any): Promise<void> {
    throw new Error('run method must be implemented by subclasses');
  }

  toJSON(): object | null {
    if (this.isSubcommandOf === null) {
      return {
        name: this.name,
        description: this.description,
        options: this.options,
      };
    }
    return null;
  }
}

export { Command };
