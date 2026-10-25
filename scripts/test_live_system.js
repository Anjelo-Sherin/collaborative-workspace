import http from 'node:http';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const BASE_URL = 'http://localhost:8012';
const WS_URL = 'ws://localhost:8012/ws';

async function fetchJSON(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  const data = await res.json();
  return { status: res.status, ok: res.ok, data };
}

async function runLiveTests() {
  console.log('🧪 Starting End-to-End Live System Testing on port 8012...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${testName} ${details ? '(' + details + ')' : ''}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName} ${details ? '(' + details + ')' : ''}`);
      failed++;
    }
  }

  // 1. Healthcheck
  try {
    const health = await fetchJSON('/api/health');
    assert(health.status === 200 && health.data.status === 'ok', 'GET /api/health returns 200 OK', `uptime: ${health.data.uptimeSeconds}s`);
  } catch (err) {
    assert(false, 'GET /api/health', err.message);
  }

  // 2. Room Listing
  try {
    const rooms = await fetchJSON('/api/rooms');
    assert(rooms.status === 200 && Array.isArray(rooms.data.rooms), 'GET /api/rooms returns room list', `found ${rooms.data.rooms.length} rooms`);
  } catch (err) {
    assert(false, 'GET /api/rooms', err.message);
  }

  // 3. Sandboxed Execution - JavaScript
  try {
    const jsRun = await fetchJSON('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'javascript',
        code: `
          function isPrime(n) {
            if (n < 2) return false;
            for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
            return true;
          }
          const primes = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter(isPrime);
          console.log("Primes found:", JSON.stringify(primes));
        `,
      }),
    });
    assert(
      jsRun.data.success === true && jsRun.data.stdout.includes('[2,3,5,7,11]'),
      'POST /api/run executes JavaScript algorithm',
      `${jsRun.data.durationMs}ms`
    );
  } catch (err) {
    assert(false, 'POST /api/run (JS)', err.message);
  }

  // 4. Sandboxed Execution - Python 3
  try {
    const pyRun = await fetchJSON('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'python',
        code: `
squares = [x**2 for x in range(1, 6)]
print(f"Computed squares: {squares}")
        `,
      }),
    });
    assert(
      pyRun.data.success === true && pyRun.data.stdout.includes('[1, 4, 9, 16, 25]'),
      'POST /api/run executes Python 3 comprehension',
      `${pyRun.data.durationMs}ms`
    );
  } catch (err) {
    assert(false, 'POST /api/run (Python)', err.message);
  }

  // 5. Infinite Loop Timeout Protection
  try {
    const timeoutRun = await fetchJSON('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'javascript',
        code: 'while(true) {}',
        timeoutMs: 1000,
      }),
    });
    assert(
      timeoutRun.data.timedOut === true && timeoutRun.data.success === false,
      'POST /api/run terminates infinite loop via SIGKILL',
      `killed at ${timeoutRun.data.durationMs}ms`
    );
  } catch (err) {
    assert(false, 'POST /api/run (Timeout)', err.message);
  }

  // 6. Runtime Error & Stderr Capture
  try {
    const errRun = await fetchJSON('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'javascript',
        code: 'const obj = null; obj.nonExistentMethod();',
      }),
    });
    assert(
      errRun.data.success === false && errRun.data.stderr.includes('TypeError'),
      'POST /api/run captures runtime exceptions and stderr',
      `exit code ${errRun.data.exitCode}`
    );
  } catch (err) {
    assert(false, 'POST /api/run (Error)', err.message);
  }

  // 7. Session Replay History Endpoint
  try {
    const replay = await fetchJSON('/api/room/demo-workspace/replay');
    assert(
      replay.status === 200 && Array.isArray(replay.data.snapshots),
      'GET /api/room/:id/replay returns historical timeline snapshots',
      `${replay.data.snapshots.length} checkpoints`
    );
  } catch (err) {
    assert(false, 'GET /api/room/:id/replay', err.message);
  }

  // 8. Real-Time WebSocket Multi-Client Synchronization
  try {
    const wsTestResult = await new Promise((resolve) => {
      const roomTestId = 'e2e-sync-' + Date.now();
      const wsA = new WebSocket(`${WS_URL}?room=${roomTestId}&user=TesterA&color=%233b82f6`);
      const wsB = new WebSocket(`${WS_URL}?room=${roomTestId}&user=TesterB&color=%2310b981`);

      wsA.binaryType = 'arraybuffer';
      wsB.binaryType = 'arraybuffer';

      const docA = new Y.Doc();
      const docB = new Y.Doc();

      let clientBReceivedUpdate = false;

      const finish = (ok, msg) => {
        try { wsA.close(); } catch (_) {}
        try { wsB.close(); } catch (_) {}
        resolve({ ok, msg });
      };

      const timer = setTimeout(() => {
        finish(false, 'WebSocket sync timeout after 5s');
      }, 5000);

      // When Client A writes text locally, send update to server
      docA.on('update', (update, origin) => {
        if (origin !== 'server' && wsA.readyState === WebSocket.OPEN) {
          console.log(`[ClientA] sending local update to server (${update.length} bytes)`);
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, 0);
          syncProtocol.writeUpdate(encoder, update);
          wsA.send(encoding.toUint8Array(encoder));
        }
      });

      const handleSyncMessage = (label, ws, doc, data) => {
        if (typeof data !== 'string') {
          const uint8 = new Uint8Array(data);
          const decoder = decoding.createDecoder(uint8);
          const type = decoding.readVarUint(decoder);
          console.log(`[${label}] received binary msg type=${type}, bytes=${uint8.length}`);
          if (type === 0) { // MESSAGE_SYNC
            const reply = encoding.createEncoder();
            encoding.writeVarUint(reply, 0);
            syncProtocol.readSyncMessage(decoder, reply, doc, 'server');
            if (encoding.length(reply) > 1 && ws.readyState === WebSocket.OPEN) {
              ws.send(encoding.toUint8Array(reply));
            }
          }
        }
      };

      wsA.on('open', () => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        syncProtocol.writeSyncStep1(encoder, docA);
        wsA.send(encoding.toUint8Array(encoder));
      });

      wsB.on('open', () => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        syncProtocol.writeSyncStep1(encoder, docB);
        wsB.send(encoding.toUint8Array(encoder));
      });

      wsA.on('message', (data) => handleSyncMessage('ClientA', wsA, docA, data));
      wsB.on('message', (data) => {
        handleSyncMessage('ClientB', wsB, docB, data);
        const textB = docB.getText('monaco').toString();
        if (textB.includes('CRDT_E2E_VERIFIED')) {
          clientBReceivedUpdate = true;
          clearTimeout(timer);
          finish(true, 'Client B synchronized update in real-time');
        }
      });

      // Trigger change on docA after 600ms
      setTimeout(() => {
        const textA = docA.getText('monaco');
        textA.insert(0, '// CRDT_E2E_VERIFIED - Real-time sync test\n');
      }, 600);
    });

    assert(wsTestResult.ok, 'Two concurrent WebSocket clients sync CRDT edits live', wsTestResult.msg);
  } catch (err) {
    assert(false, 'WebSocket Live Sync', err.message);
  }

  console.log(`\n=======================================================`);
  console.log(`📊 Live E2E Test Summary: ${passed} Passed, ${failed} Failed`);
  console.log(`=======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runLiveTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
