// Local server room protocol tests: boot the real HTTP + WebSocket server from
// server/index.js on a test port and drive it with `ws` clients. Covers what the
// offline Workers simulation cannot: the local server's own reconnect path
// (regression guard for the slot color after a restart swapped the seats).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8791;
const ENDPOINT = `ws://127.0.0.1:${PORT}/`;

function assert(condition, msg) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startServer() {
  const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), RECONNECT_TIMEOUT_MS: '400' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  // Poll the port until the server accepts a WebSocket handshake.
  const ready = async () => {
    for (let i = 0; i < 100; i++) {
      const probe = new WebSocket(ENDPOINT);
      try {
        await new Promise((resolve, reject) => {
          probe.once('open', resolve);
          probe.once('error', reject);
        });
        probe.close();
        return child;
      } catch {
        probe.terminate();
        await sleep(50);
      }
    }
    throw new Error(`server did not come up on port ${PORT}\n${stderr}`);
  };

  return ready().catch(async (err) => {
    child.kill();
    throw err;
  });
}

async function connect() {
  const ws = new WebSocket(ENDPOINT);
  ws.inbox = [];
  ws.on('message', (data) => ws.inbox.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return ws;
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

async function expectMsg(ws, predicate, label, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const i = ws.inbox.findIndex(predicate);
    if (i !== -1) return ws.inbox.splice(i, 1)[0];
    await sleep(20);
  }
  throw new Error(`FAIL: timed out waiting for ${label}`);
}

console.log('=== Local Server Room Protocol Tests ===');
console.log('');

const server = await startServer();

try {
  const A = await connect();
  send(A, { type: 'create' });
  const created = await expectMsg(A, (m) => m.type === 'room:created', 'room:created');
  assert(created.color === 'black', 'host creates room as black');
  const code = created.roomCode;

  const B = await connect();
  send(B, { type: 'join', roomCode: code });
  const joined = await expectMsg(B, (m) => m.type === 'room:joined', 'room:joined');
  assert(joined.color === 'white', 'guest joins as white');
  await expectMsg(A, (m) => m.type === 'game:start', 'host game:start');
  await expectMsg(B, (m) => m.type === 'game:start', 'guest game:start');

  // Out-of-turn moves are rejected server-side
  send(B, { type: 'move', row: 7, col: 7 });
  const denied = await expectMsg(B, (m) => m.type === 'error', 'out-of-turn error');
  assert(denied.message === '不是你的回合', 'out-of-turn move rejected');

  send(A, { type: 'move', row: 7, col: 7 });
  await expectMsg(B, (m) => m.type === 'move' && m.player === 'black', 'guest sees black move');

  // Surrender hands the win to the opponent
  send(A, { type: 'surrender' });
  const end = await expectMsg(B, (m) => m.type === 'game:end', 'game:end after surrender');
  assert(end.winner === 'white' && end.reason === 'surrender', 'surrender grants opponent the win');

  // Restart swaps the seats, so each player must be told their own color
  send(B, { type: 'restart' });
  const restartA = await expectMsg(A, (m) => m.type === 'game:restart', 'host game:restart');
  const restartB = await expectMsg(B, (m) => m.type === 'game:restart', 'guest game:restart');
  assert(
    restartA.color === 'white' && restartB.color === 'black',
    'restart delivers per-player swapped colors'
  );

  // Guest is black now; after a move it drops and a new socket reclaims the slot
  send(B, { type: 'move', row: 3, col: 3 });
  await expectMsg(A, (m) => m.type === 'move' && m.player === 'black', 'black move after swap');
  B.close();
  await expectMsg(A, (m) => m.type === 'opponent:disconnect', 'host sees disconnect');

  const C = await connect();
  send(C, { type: 'join', roomCode: code });
  const reconnected = await expectMsg(C, (m) => m.type === 'room:joined', 'reconnect room:joined');
  assert(
    reconnected.color === 'black',
    'reconnect keeps the swapped color (regression guard for colorSwap)'
  );
  const state = await expectMsg(C, (m) => m.type === 'game:state', 'game:state');
  assert(
    state.grid[3][3] === 'black' && state.currentPlayer === 'white',
    'game:state restores board and turn after reconnect'
  );
  await expectMsg(A, (m) => m.type === 'opponent:reconnect', 'host notified of reconnect');

  // The reclaimed slot can no longer be joined by a third player
  const D = await connect();
  send(D, { type: 'join', roomCode: code });
  const full = await expectMsg(D, (m) => m.type === 'error', 'full room error');
  assert(full.message === '房间已满', 'room with both slots filled rejects new joins');

  // Unknown rooms are rejected
  const E = await connect();
  send(E, { type: 'join', roomCode: 'ZZZZ' });
  const missing = await expectMsg(E, (m) => m.type === 'error', 'unknown room error');
  assert(missing.message === '房间不存在', 'unknown room rejected');

  // Let the reclaimed slot drop again: the timeout win must go to the
  // remaining player's actual color (A is white after the swap), not to the
  // default color of the other seat
  C.close();
  await expectMsg(A, (m) => m.type === 'opponent:disconnect', 'reconnected guest dropped');
  const timeoutEnd = await expectMsg(
    A,
    (m) => m.type === 'game:end' && m.reason === 'disconnect',
    'disconnect timeout win',
    6000
  );
  assert(
    timeoutEnd.winner === 'white',
    'disconnect timeout awards the swapped color of the remaining player'
  );

  [A, D, E].forEach((ws) => ws.close());
} finally {
  server.kill();
}

console.log('');
console.log('=== All Local Server Room Protocol Tests Completed ===');
