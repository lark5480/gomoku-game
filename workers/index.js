/**
 * Gomoku online mode — Worker entry point.
 *
 * Every WebSocket connection is routed to a single registry Durable Object
 * ("registry") which holds all rooms in memory and relays the game protocol,
 * mirroring the behavior of the local Node server (server/index.js).
 * The client connects to the base URL without any path, so no client-side
 * changes are needed.
 */
import { Room } from './room.js';

export default {
  async fetch(request, env) {
    const upgrade = (request.headers.get('Upgrade') || '').toLowerCase();
    if (upgrade === 'websocket') {
      const id = env.ROOMS.idFromName('registry');
      const stub = env.ROOMS.get(id);
      return stub.fetch(request);
    }

    // Plain HTTP visit (e.g. opening the URL in a browser): friendly notice.
    // Reaching this JSON from a browser is also a handy connectivity check.
    return new Response(
      JSON.stringify(
        {
          app: 'gomoku-game',
          message:
            'This endpoint serves the Gomoku WebSocket protocol. Open the game frontend instead of visiting this URL directly.',
        },
        null,
        2
      ),
      { headers: { 'content-type': 'application/json; charset=utf-8' } }
    );
  },
};
