import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './crdtRoom.js';
import { executeInSandbox } from './sandbox.js';
import { listSavedRooms, getRoomHistory, initStorage } from './persistence.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const roomManager = new RoomManager();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve Monaco editor static assets directly from node_modules
app.use('/vs', express.static(path.join(ROOT_DIR, 'node_modules', 'monaco-editor', 'min', 'vs')));

// Serve public static frontend
app.use(express.static(path.join(ROOT_DIR, 'public')));

// REST Endpoints
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    activeRooms: roomManager.listActiveRooms().length,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/rooms', async (req, res) => {
  try {
    const active = roomManager.listActiveRooms();
    const saved = await listSavedRooms();

    // Merge saved metadata with active live room stats
    const roomMap = new Map();
    for (const r of saved) {
      roomMap.set(r.roomId, { ...r, connectedClients: 0 });
    }
    for (const r of active) {
      roomMap.set(r.roomId, { ...(roomMap.get(r.roomId) || {}), ...r });
    }

    res.json({ rooms: Array.from(roomMap.values()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/room/:id/replay', async (req, res) => {
  try {
    const roomId = req.params.id;
    const history = await getRoomHistory(roomId);
    res.json({ roomId, snapshots: history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/run', async (req, res) => {
  try {
    const { language, code, stdin, timeoutMs } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: code',
      });
    }

    const result = await executeInSandbox({
      language: language || 'javascript',
      code,
      stdin: stdin || '',
      timeoutMs: timeoutMs ? parseInt(timeoutMs, 10) : 4000,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Single-page application route fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'));
});

// WebSocket Upgrade Handling
server.on('upgrade', async (request, socket, head) => {
  const urlObj = new URL(request.url, `http://${request.headers.host}`);
  if (urlObj.pathname === '/ws') {
    const roomId = urlObj.searchParams.get('room') || 'default';
    const userName = urlObj.searchParams.get('user') || 'Anonymous';
    const userColor = urlObj.searchParams.get('color') || '#3b82f6';

    wss.handleUpgrade(request, socket, head, async (ws) => {
      const room = await roomManager.getOrCreateRoom(roomId);
      room.handleConnection(ws, { userName, userColor });
    });
  } else {
    socket.destroy();
  }
});

const PORT = process.env.PORT || 8012;

export async function startServer(port = PORT) {
  await initStorage();
  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`=======================================================`);
      console.log(`🌐 Synapse Collab Server running at http://localhost:${port}`);
      console.log(`⚡ WebSocket synchronization ready at ws://localhost:${port}/ws`);
      console.log(`🚀 Monaco Editor & Whiteboard Canvas loaded`);
      console.log(`=======================================================`);
      resolve({ server, port });
    });
  });
}

// If run directly via node server/index.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}

export { app, server, roomManager };
