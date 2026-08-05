import { EmbedBuilder, MessageFlags } from 'discord.js';
import { logError, log } from '../../utils/log';
import { isDev } from '../../utils/accessControl';

export interface CommandArgs {
  ephemeral?: boolean;
  skipDefer?: boolean;
  isSubcommandOf?: string | null;
  blame?: string;
}

class Command {
  client: any;
  name: string;
  description: string;
  options: any[];
  ephemeral: boolean;
  skipDefer: boolean;
  isSubcommandOf: string | null;
  blame: string;

  constructor(
    client: any,
    name: string,
    description: string,
    options: any[],
    args: CommandArgs = {
      ephemeral: false, skipDefer: false, isSubcommandOf: null, blame: '',
    },
  ) {
    this.client = client;
    this.name = name;
    this.description = description;
    this.options = options;
    this.ephemeral = args.ephemeral || false;
    this.skipDefer = args.skipDefer || false;
    this.isSubcommandOf = args.isSubcommandOf || null;
    this.blame = args.blame || '';
  }

  async execute(interaction: any): Promise<void> {
    const banned = await this.client.db.globalConfig.getGlobalConfig('banned');
    if (banned === '1' || banned === 'true') {
      if (!isDev(interaction)) {
        log('ehe banned');
        const embed = new EmbedBuilder()
          .setColor('Red')
          .setTitle(`Sorry, ${this.name} isn't available right now.`)
          .setDescription(
            `A law banning ${this.name} has been enacted in ${interaction.guild.name}. `
            + 'Unfortunately, that means you can\'t use this command here.\n\n'
            + 'We are fortunate that Iruma has indication he will work with us on a solution to '
            + `reinstate ${this.name} once he is unbanned. Please stay tuned!`,
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
        content: 'An error occurred while executing the command.\n'
        + 'Please try again later or modify the inputs.\n'
        + 'If the issue persists, run /blame command_name and spam ping whoever made the command.',
      });
    }
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
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
