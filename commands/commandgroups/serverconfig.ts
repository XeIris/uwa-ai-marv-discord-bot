import { CommandGroup } from '../classes/commandGroup';

export default class ServerConfig extends CommandGroup {
  constructor(client: any) {
    super(client, 'serverconfig', 'Per-server config commands', ['get', 'setrole', 'setchannel', 'setvalue']);
  }
}
