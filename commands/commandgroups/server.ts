import { CommandGroup } from '../classes/commandGroup';

export default class Server extends CommandGroup {
  constructor(client: any) {
    super(client, 'server', 'Server management commands', ['register', 'unregister']);
  }
}
