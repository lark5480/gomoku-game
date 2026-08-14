// Workers room protocol tests: run the Durable Object registry logic offline
// against a mocked Cloudflare runtime (WebSocketPair + DO state), exercising
// the full online-mode protocol without network access.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function assert(condition, msg) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

// ---- Load the real Room class with a mocked WebSocketPair ----
const roomSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'workers', 'room.js'),
  'utf8'
);
const body = roomSrc
  .replace(/import \{ WebSocketPair \} from ['"]cloudflare:workers['"];/, '')
  .replace('export class Room', 'class Room');
const fakePairModule = { exports: {} };
const loadRoom = (WebSocketPair) =>
  new Function('WebSocketPair', 'Response', 'TextDecoder', `${body}\nreturn Room;`)(
    WebSocketPair,
    Response,
    TextDecoder
  );

class MockWS {
  constructor() {
    this.sent = [];
    this.closed = false;
    this.closeCode = null;
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000, reason = '') {
    this.closed = true;
    this.closeCode = code;
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
  has(type) {
    return this.sent.some((m) => m.type === type);
  }
  lastOf(type) {
    return [...this.sent].reverse().find((m) => m.type === type);
  }
}

class MockState {
  constructor() {
    this.alarmAt = 0;
    this.accepted = [];
  }
  async storage_get() {}
  setAlarmAt(ms) {
    this.alarmAt = ms;
  }
  get storage() {
    return { setAlarm: (ms) => this.setAlarmAt(ms) };
  }
  acceptWebSocket(ws) {
    this.accepted.push(ws);
  }
}

function makeRegistry() {
  let serverWs = null;
  const state = new MockState();
  const Room = loadRoom(
    class {
      constructor() {
        return [new MockWS(), (serverWs = new MockWS())];
      }
    }
  );
  const registry = new Room(state, {});
  const connect = async () => {
    try {
      await registry.fetch({});
    } catch {
      // Node's Response rejects status 101 (upgrade responses are only valid
      // in the Workers runtime). The WebSocketPair was already constructed
      // and acceptWebSocket already ran before that throw, so just continue.
    }
    return serverWs;
  };
  const send = async (ws, msg) => {
    await registry.webSocketMessage(ws, JSON.stringify(msg));
  };
  return { registry, state, connect, send };
}

console.log('=== Workers Room Protocol Tests ===\n');

{
  const { registry, state, connect, send } = makeRegistry();
  const A = await connect();
  const B = await connect();

  await send(A, { type: 'create' });
  const created = A.last();
  assert(created.type === 'room:created', 'host receives room:created');
  assert(
    /^[A-HJ-NP-Z2-9]{4}$/.test(created.roomCode),
    `room code is 4 unambiguous chars (${created.roomCode})`
  );
  assert(created.color === 'black', 'host plays black');
  const code = created.roomCode;

  await send(B, { type: 'join', roomCode: code.toLowerCase() });
  assert(B.lastOf('room:joined').color === 'white', 'guest plays white');
  assert(A.has('game:start') && B.has('game:start'), 'both receive game:start');

  // Out-of-turn move rejected (black opens, guest is white)
  await send(B, { type: 'move', row: 0, col: 0 });
  assert(B.lastOf('error')?.message === '不是你的回合', 'out-of-turn move rejected');

  // Moves synchronize
  await send(A, { type: 'move', row: 7, col: 7 });
  assert(B.last().type === 'move' && B.last().player === 'black', 'guest sees black move');
  await send(B, { type: 'move', row: 0, col: 0 });

  // Black builds a winning row
  let blackTurn = true; // after B's (0,0) it is black's turn again
  for (const [r, c] of [
    [7, 8],
    [0, 1],
    [7, 9],
    [0, 2],
    [7, 10],
    [0, 3],
    [7, 11],
  ]) {
    await send(blackTurn ? A : B, { type: 'move', row: r, col: c });
    blackTurn = !blackTurn;
  }
  const end = A.lastOf('game:end');
  assert(end && end.winner === 'black', 'black win broadcast');

  // Restart swaps colors
  await send(A, { type: 'restart' });
  assert(A.lastOf('game:restart').color === 'white', 'host becomes white after swap');
  assert(B.lastOf('game:restart').color === 'black', 'guest becomes black after swap');
  await send(B, { type: 'move', row: 7, col: 7 });
  assert(A.last().player === 'black', 'move uses swapped colors');

  // Disconnect + reconnect restores state
  await registry.webSocketClose(B, 1000, '', true);
  assert(A.lastOf('opponent:disconnect'), 'opponent:disconnect delivered');
  const B2 = await connect();
  await send(B2, { type: 'join', roomCode: code });
  assert(B2.lastOf('room:joined').color === 'black', 'reconnect keeps swapped color');
  assert(B2.lastOf('game:state').grid[7][7] === 'black', 'game:state restores board');
  assert(A.has('opponent:reconnect'), 'host notified of reconnect');

  // Reconnect timeout judges a win for the remaining player
  await registry.webSocketClose(B2, 1000, '', true);
  registry.rooms.get(code).reconnectDeadline = Date.now() - 1;
  await registry.alarm();
  const dc = A.lastOf('game:end');
  assert(dc && dc.winner === 'white' && dc.reason === 'disconnect', 'timeout grants win');

  // TTL cleanup closes the room
  registry.rooms.get(code).lastActivity = Date.now() - 11 * 60 * 1000;
  await registry.alarm();
  assert(registry.rooms.size === 0, 'stale room cleaned up');
  assert(state.alarmAt === 0 || state.alarmAt > 0, 'alarm re-armed appropriately');
}

{
  const { registry, connect, send } = makeRegistry();
  const C = await connect();
  await send(C, { type: 'join', roomCode: 'ZZZZ' });
  assert(C.lastOf('error')?.message === '房间不存在', 'unknown room rejected');

  const A = await connect();
  const B = await connect();
  const D = await connect();
  await send(A, { type: 'create' });
  const code = A.last().roomCode;
  await send(B, { type: 'join', roomCode: code });
  await send(D, { type: 'join', roomCode: code });
  assert(D.lastOf('error')?.message === '房间已满', 'full room rejected');
}

console.log('');
console.log('=== All Workers Room Protocol Tests Completed ===');
