import { CommandGroup } from '../classes/commandGroup';

export default class Committee extends CommandGroup {
  constructor(client: any) {
    super(client, 'committee', 'Manage the club committee roster', [
      'add', 'remove', 'update', 'list',
    ]);
  }
}
