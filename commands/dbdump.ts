import path from 'path';
import { unlinkSync } from 'fs';
import { MessageFlags } from 'discord.js';
import { DevCommand } from './classes/DevCommand';
import { logError } from '../utils/log';
import { timestampedFileName } from '../utils/dumpFileName';

interface DumpDefinition {
  choiceName: string;
  value: string;
  tableName: string;
  fileName: string;
  formatUserIds: string[];
}

const DUMP_DEFINITIONS: DumpDefinition[] = [
  {
    choiceName: 'Command Config Data',
    value: 'commandConfig',
    tableName: 'CommandConfig',
    fileName: 'Command_Config_Data.csv',
    formatUserIds: [],
  },
  {
    choiceName: 'Server Config Data',
    value: 'serverConfig',
    tableName: 'ServerConfig',
    fileName: 'Server_Config_Data.csv',
    formatUserIds: [],
  },
  {
    choiceName: 'Global Config Data',
    value: 'globalConfig',
    tableName: 'GlobalConfig',
    fileName: 'Global_Config_Data.csv',
    formatUserIds: [],
  },
  {
    choiceName: 'Game UID Data',
    value: 'gameUID',
    tableName: 'GameUID',
    fileName: 'Game_UID_Data.csv',
    formatUserIds: ['user_id'],
  },
  {
    choiceName: 'AI Chat History Data',
    value: 'aiChatHistory',
    tableName: 'AiChatHistory',
    fileName: 'AI_Chat_History_Data.csv',
    formatUserIds: [],
  },
  {
    choiceName: 'AI Chat Session Data',
    value: 'aiChatSession',
    tableName: 'AiChatSession',
    fileName: 'AI_Chat_Session_Data.csv',
    formatUserIds: ['user_id'],
  },
  {
    choiceName: 'AI Usage Data',
    value: 'aiUsage',
    tableName: 'AiUsage',
    fileName: 'AI_Usage_Data.csv',
    formatUserIds: ['user_id'],
  },
  {
    choiceName: 'Image Gen Log Data',
    value: 'imageGenLog',
    tableName: 'ImageGenLog',
    fileName: 'Image_Gen_Log_Data.csv',
    formatUserIds: ['user_id'],
  },
  {
    choiceName: 'Music Gen Log Data',
    value: 'musicGenLog',
    tableName: 'MusicGenLog',
    fileName: 'Music_Gen_Log_Data.csv',
    formatUserIds: ['user_id'],
  },
];

class DBDump extends DevCommand {
  constructor(client: any) {
    super(client, 'dbdump', 'Output a specific database table or all tables.', [
      {
        name: 'table',
        description: 'Select the table to dump',
        type: 3,
        required: true,
        choices: [
          ...DUMP_DEFINITIONS.map((definition) => ({ name: definition.choiceName, value: definition.value })),
          { name: 'All Data', value: 'all' },
        ],
      },
    ], { blame: 'both', ephemeral: true });
  }

  async run(interaction: any): Promise<void> {
    const table = interaction.options.getString('table');

    const filesToDump: { attachment: string; name: string }[] = [];
    const dumpTime = new Date();
    try {
      const selectedDefinitions = table === 'all'
        ? DUMP_DEFINITIONS
        : DUMP_DEFINITIONS.filter((definition) => definition.value === table);

      for (const definition of selectedDefinitions) {
        const tableData = await this.client.db.dumpTable(definition.tableName, definition.formatUserIds);
        const fileName = timestampedFileName(definition.fileName, dumpTime);
        const filePath = await this.createCSVFile(fileName, tableData);
        filesToDump.push({ attachment: filePath, name: fileName });
      }

      if (filesToDump.length === 0) {
        await interaction.editReply({ content: 'No database dump files were generated.' });
      } else {
        const ATTACHMENTS_PER_MESSAGE = 10;
        for (let i = 0; i < filesToDump.length; i += ATTACHMENTS_PER_MESSAGE) {
          const chunk = filesToDump.slice(i, i + ATTACHMENTS_PER_MESSAGE);
          const content = i === 0 ? 'Database dump files:' : 'Additional database dump files:';

          if (i === 0) {
            await interaction.editReply({ content, files: chunk });
          } else {
            await interaction.followUp({ content, files: chunk, flags: MessageFlags.Ephemeral });
          }
        }
      }

      const databasePath = path.join(import.meta.dir, '../persistence/database.db');

      if (await Bun.file(databasePath).exists()) {
        const dbFileName = timestampedFileName('database.db', dumpTime);
        await interaction.followUp({
          content: 'database:',
          files: [{ attachment: databasePath, name: dbFileName }],
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      logError('Error dumping database:', error);
      await interaction.followUp({ content: 'An error occurred while executing the command.', flags: MessageFlags.Ephemeral });
    } finally {
      filesToDump.forEach((file) => {
        this.cleanupFile(file.attachment);
      });
    }
  }

  async createCSVFile(fileName: string, data: string): Promise<string> {
    const filePath = path.join(import.meta.dir, fileName);
    await Bun.write(filePath, data);
    return filePath;
  }

  cleanupFile(filePath: string): void {
    try {
      unlinkSync(filePath);
    } catch (err) {
      logError(`Failed to delete file ${filePath}:`, err);
    }
  }
}

export default DBDump;
