import { DevCommand } from './classes/DevCommand';
import { logError, logErrorFilePath, logFilePath } from '../utils/log';
import { timestampedFileName } from '../utils/dumpFileName';

class LogDump extends DevCommand {
  constructor(client: any) {
    super(client, 'logdump', 'dump the log files', [
      {
        name: 'lines',
        description: 'last n lines of the error logs',
        type: 4,
        required: true,
      },
      {
        name: 'type',
        description: 'the type of log to dump',
        type: 3,
        required: true,
        choices: [
          { name: 'error', value: 'error' },
          { name: 'log', value: 'log' },
        ],
      },
    ], { blame: 'ei' });
  }

  async run(interaction: any): Promise<void> {
    const lines = interaction.options.getInteger('lines');

    if (lines < 1) {
      await interaction.editReply({ content: 'Invalid number of lines' });
      return;
    }
    const type = interaction.options.getString('type');
    const filePath = type === 'error' ? logErrorFilePath : logFilePath;
    try {
      const log = await Bun.file(filePath).text();
      const logLines = log.split('\n').slice(-lines);
      const content = logLines.join('\n');
      if (content.length > 1990) {
        const buffer = Buffer.from(content);
        await interaction.editReply({ files: [{ attachment: buffer, name: timestampedFileName(`${type}.txt`) }] });
      } else {
        await interaction.editReply({ content: `\`\`\`${content}\`\`\`` });
      }
    } catch (error) {
      logError('Error dumping log:', error);
      await interaction.editReply({ content: 'Error dumping log' });
    }
  }
}

export default LogDump;
