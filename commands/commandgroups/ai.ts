import { CommandGroup } from '../classes/commandGroup';

export default class Ai extends CommandGroup {
  constructor(client: any) {
    super(client, 'ai', 'Manage your AI chat sessions', [
      'view', 'chatnew', 'chatswitch', 'chatdelete', 'retitle', 'usage',
    ]);
  }
}
