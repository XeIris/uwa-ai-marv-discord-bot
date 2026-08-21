import { CommandGroup } from '../classes/commandGroup';

export default class Event extends CommandGroup {
  constructor(client: any) {
    super(client, 'event', 'Manage the club events calendar', [
      'add', 'edit', 'delete', 'list', 'setimage', 'announce', 'remindme',
    ]);
  }
}
