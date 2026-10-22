import * as Y from 'yjs';
import { saveRoomState, loadRoomState, initStorage, recordHistorySnapshot } from '../server/persistence.js';

async function main() {
  await initStorage();
  const doc = new Y.Doc();
  await loadRoomState('demo-workspace', doc);

  const wb = doc.getArray('whiteboard');
  if (wb.length === 0) {
    wb.push([
      // Architecture Box 1: Client
      {
        id: 'box-1',
        type: 'rect',
        x1: 40,
        y1: 60,
        x2: 200,
        y2: 150,
        color: '#6366f1',
        width: 3,
        fill: true,
      },
      {
        id: 'text-1',
        type: 'text',
        x: 60,
        y: 110,
        text: 'Client A (Yjs CRDT)',
        color: '#ffffff',
      },

      // Arrow 1 -> Server
      {
        id: 'arrow-1',
        type: 'arrow',
        x1: 200,
        y1: 105,
        x2: 320,
        y2: 105,
        color: '#38bdf8',
        width: 3,
      },

      // Architecture Box 2: WebSocket Server
      {
        id: 'box-2',
        type: 'rect',
        x1: 320,
        y1: 50,
        x2: 500,
        y2: 170,
        color: '#10b981',
        width: 3,
        fill: true,
      },
      {
        id: 'text-2',
        type: 'text',
        x: 340,
        y: 100,
        text: 'WebSocket Sync',
        color: '#ffffff',
      },
      {
        id: 'text-2b',
        type: 'text',
        x: 340,
        y: 130,
        text: 'y-websocket + Redis',
        color: '#10b981',
      },

      // Arrow 2 -> Client B
      {
        id: 'arrow-2',
        type: 'arrow',
        x1: 410,
        y1: 170,
        x2: 410,
        y2: 270,
        color: '#f59e0b',
        width: 3,
      },

      // Architecture Box 3: Execution Sandbox
      {
        id: 'box-3',
        type: 'rect',
        x1: 300,
        y1: 270,
        x2: 520,
        y2: 380,
        color: '#f59e0b',
        width: 3,
        fill: true,
      },
      {
        id: 'text-3',
        type: 'text',
        x: 330,
        y: 320,
        text: 'Sandboxed Runner',
        color: '#ffffff',
      },
      {
        id: 'text-3b',
        type: 'text',
        x: 340,
        y: 350,
        text: 'CPU/Memory Limits',
        color: '#f59e0b',
      },
    ]);
  }

  // Also add a couple of chat messages
  const chat = doc.getArray('chat');
  if (chat.length <= 1) {
    chat.push([
      {
        id: 'msg-demo-1',
        user: 'Grace Hopper',
        color: '#10b981',
        text: 'Hey Alan! I added the distributed pipeline diagram to the whiteboard.',
        timestamp: Date.now() - 120000,
      },
      {
        id: 'msg-demo-2',
        user: 'Alan Turing',
        color: '#3b82f6',
        text: 'Awesome, concurrent edits merged flawlessly with zero merge conflicts!',
        timestamp: Date.now() - 60000,
      },
    ]);
  }

  // Save room state and record history snapshots
  await saveRoomState('demo-workspace', doc);
  await recordHistorySnapshot('demo-workspace', doc, {
    author: 'Grace Hopper',
    action: 'add_whiteboard_diagram',
  });
  await recordHistorySnapshot('demo-workspace', doc, {
    author: 'Alan Turing',
    action: 'run_sandbox_code',
  });

  console.log('Demo room populated successfully!');
}

main().catch(console.error);
