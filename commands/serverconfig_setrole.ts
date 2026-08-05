import { EmbedBuilder } from 'discord.js';
import { DevCommand } from './classes/DevCommand';
import { SETTABLE_ROLE_NAMES, validateSettableRoleName } from '../utils/serverConfig';

class ServerConfigSetRole extends DevCommand {
  constructor(client: any) {
    super(client, 'setrole', 'Set a named role for this server', [
      {
        name: 'role_name',
        description: 'Logical name for the role',
        type: 3,
        required: true,
        choices: SETTABLE_ROLE_NAMES.map((name) => ({
          name,
          value: name,
        })),
      },
      {
        name: 'role',
        description: 'The Discord role to assign',
        type: 8,
        required: true,
      },
    ], { isSubcommandOf: 'serverconfig', blame: 'ei' });
  }

  async run(interaction: any): Promise<void> {
    if (!interaction.guild) {
      await interaction.editReply('This command must be used in a server.');
      return;
    }

    const roleName = interaction.options.getString('role_name');
    const role = interaction.options.getRole('role');

    const validationError = validateSettableRoleName(roleName);
    if (validationError) {
      await interaction.editReply(validationError);
      return;
    }

    await this.client.db.serverConfig.setServerRole(interaction.guild.id, roleName, role.id);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Server role set')
          .setDescription(`**${roleName}** → ${role.name}`)
          .setColor('#00FF00'),
      ],
    });
  }
}

export default ServerConfigSetRole;
