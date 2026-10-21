/* Study Tracker connector. Two kinds of caller:
     /mcp/<MCP_KEY>   the MCP connector, added as a custom connector in a chat app
     /sync/...        the PC app, with "Authorization: Bearer <PC_TOKEN>"
   Everything else, and any wrong key, gets the same 404. All state lives in one Durable Object. */
import { DurableObject } from 'cloudflare:workers';
import { route } from './routes.js';

export class Tracker extends DurableObject {
  fetch(request) {
    return route(request, this.ctx.storage, this.env);
  }
}

export default {
  fetch(request, env) {
    return route(request, null, env, () => env.TRACKER.get(env.TRACKER.idFromName('main')));
  },
};
