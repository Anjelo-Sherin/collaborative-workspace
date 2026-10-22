import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { loadRoomState, saveRoomState, recordHistorySnapshot } from './persistence.js';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_CUSTOM = 2;

const DEFAULT_CODE_STARTER = `// Welcome to Synapse Collab - Real-Time Collaborative Workspace
// Powered by Yjs CRDTs, Monaco Editor, Canvas Whiteboard & Sandboxed Runner

function fibonacci(n) {
  const seq = [0, 1];
  for (let i = 2; i <= n; i++) {
    seq.push(seq[i - 1] + seq[i - 2]);
  }
  return seq;
}

console.log("🚀 Real-Time Collaborative Workspace Active!");
console.log("Fibonacci(10):", fibonacci(10));

// Try editing with a teammate simultaneously across tabs!
// Click '▶ Run Code' (or Ctrl/Cmd + Enter) to execute in the secure sandbox.
`;

export class CRDTRoom {
  /**
   * @param {string} roomId
   */
  constructor(roomId) {
    this.roomId = roomId;
    this.ydoc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.ydoc);
    /** @type {Set<import('ws').WebSocket>} */
    this.conns = new Set();
    this.createdAt = new Date().toISOString();
    this.lastActive = Date.now();

    // Map connection to user info
    this.connMeta = new WeakMap();

    this.saveTimeout = null;
    this.historyThrottle = null;

    this._setupYjsListeners();
  }

  async init() {
    const loaded = await loadRoomState(this.roomId, this.ydoc);
    if (!loaded) {
      // Initialize with default starter code if brand new room
      const text = this.ydoc.getText('monaco');
      if (text.length === 0) {
        text.insert(0, DEFAULT_CODE_STARTER);
      }
      const chat = this.ydoc.getArray('chat');
      if (chat.length === 0) {
        chat.push([
          {
            id: 'sys-welcome',
            user: 'System',
            color: '#6366f1',
            text: `Welcome to room "${this.roomId}"! Edits, drawings, and presence sync in real time via CRDT.`,
            timestamp: Date.now(),
          },
        ]);
      }
      await saveRoomState(this.roomId, this.ydoc);
    }
  }

  _setupYjsListeners() {
    // When Y.Doc updates, broadcast update to all other connected peers
    this.ydoc.on('update', (update, origin) => {
      this.lastActive = Date.now();
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);

      for (const conn of this.conns) {
        if (conn !== origin && conn.readyState === 1) { // 1 = OPEN
          this.sendBinary(conn, message);
        }
      }

      this._scheduleSave();
      this._scheduleHistorySnapshot();
    });

    // When awareness changes, broadcast awareness update
    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      const changedClients = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
      );
      const message = encoding.toUint8Array(encoder);

      for (const conn of this.conns) {
        if (conn !== origin && conn.readyState === 1) {
          this.sendBinary(conn, message);
        }
      }
    });
  }

  _scheduleSave() {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(async () => {
      this.saveTimeout = null;
      await saveRoomState(this.roomId, this.ydoc);
    }, 1500); // 1.5s debounce
  }

  _scheduleHistorySnapshot() {
    if (this.historyThrottle) return;
    this.historyThrottle = setTimeout(async () => {
      this.historyThrottle = null;
      await recordHistorySnapshot(this.roomId, this.ydoc, {
        action: 'collaborative_edit',
        author: 'Collaborator',
      });
    }, 5000); // Record history at most once every 5 seconds
  }

  sendBinary(conn, message) {
    try {
      if (conn.readyState === 1) {
        conn.send(message);
      }
    } catch (err) {
      console.error(`[Room ${this.roomId}] Error sending to client:`, err.message);
    }
  }

  /**
   * Handle a new client connection.
   *
   * @param {import('ws').WebSocket} conn
   * @param {Object} [meta]
   */
  handleConnection(conn, meta = {}) {
    this.conns.add(conn);
    this.connMeta.set(conn, meta);
    this.lastActive = Date.now();

    // 1. Send sync step 1 to client so client replies with its state vector / missing updates
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.ydoc);
    this.sendBinary(conn, encoding.toUint8Array(encoder));

    // 2. Send current awareness states to new client
    const awarenessStates = this.awareness.getStates();
    if (awarenessStates.size > 0) {
      const awEncoder = encoding.createEncoder();
      encoding.writeVarUint(awEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awEncoder,
        awarenessProtocol.encodeAwarenessUpdate(
          this.awareness,
          Array.from(awarenessStates.keys())
        )
      );
      this.sendBinary(conn, encoding.toUint8Array(awEncoder));
    }

    // 3. Listen for incoming messages from this connection
    conn.on('message', (message) => {
      try {
        if (typeof message === 'string') {
          // Custom JSON protocol message (e.g. chat, room events)
          this.handleJsonMessage(conn, message);
          return;
        }

        // Binary message (Yjs sync or awareness)
        const uint8 = new Uint8Array(message);
        const decoder = decoding.createDecoder(uint8);
        const messageType = decoding.readVarUint(decoder);

        switch (messageType) {
          case MESSAGE_SYNC: {
            const replyEncoder = encoding.createEncoder();
            encoding.writeVarUint(replyEncoder, MESSAGE_SYNC);
            syncProtocol.readSyncMessage(decoder, replyEncoder, this.ydoc, conn);
            if (encoding.length(replyEncoder) > 1) {
              this.sendBinary(conn, encoding.toUint8Array(replyEncoder));
            }
            break;
          }
          case MESSAGE_AWARENESS: {
            const update = decoding.readVarUint8Array(decoder);
            awarenessProtocol.applyAwarenessUpdate(this.awareness, update, conn);
            break;
          }
          default:
            console.warn(`[Room ${this.roomId}] Unknown binary message type: ${messageType}`);
        }
      } catch (err) {
        console.error(`[Room ${this.roomId}] Error processing message:`, err);
      }
    });

    conn.on('close', () => {
      this.conns.delete(conn);
      this.lastActive = Date.now();
      // Remove awareness state for this client if registered
      const clientMeta = this.connMeta.get(conn);
      if (clientMeta && clientMeta.clientId != null) {
        awarenessProtocol.removeAwarenessStates(
          this.awareness,
          [clientMeta.clientId],
          null
        );
      }
    });
  }

  handleJsonMessage(conn, text) {
    try {
      const data = JSON.parse(text);
      if (data.type === 'register_client') {
        const meta = this.connMeta.get(conn) || {};
        meta.clientId = data.clientId;
        meta.userName = data.userName;
        meta.userColor = data.userColor;
        this.connMeta.set(conn, meta);
      } else if (data.type === 'chat_message') {
        const chat = this.ydoc.getArray('chat');
        chat.push([
          {
            id: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            user: data.user || 'Anonymous',
            color: data.color || '#3b82f6',
            text: data.text || '',
            timestamp: Date.now(),
          },
        ]);
      }
    } catch (err) {
      console.error(`[Room ${this.roomId}] Error handling JSON message:`, err.message);
    }
  }

  destroy() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (this.historyThrottle) {
      clearTimeout(this.historyThrottle);
      this.historyThrottle = null;
    }
    for (const conn of this.conns) {
      try { conn.close(); } catch (_) {}
    }
    this.conns.clear();
    this.awareness.destroy();
    this.ydoc.destroy();
  }

  getInfo() {
    return {
      roomId: this.roomId,
      connectedClients: this.conns.size,
      codeLength: this.ydoc.getText('monaco').length,
      whiteboardElements: this.ydoc.getArray('whiteboard').length,
      chatMessages: this.ydoc.getArray('chat').length,
      createdAt: this.createdAt,
      lastActive: new Date(this.lastActive).toISOString(),
    };
  }
}

/**
 * Global Room Registry
 */
export class RoomManager {
  constructor() {
    /** @type {Map<string, CRDTRoom>} */
    this.rooms = new Map();
  }

  /**
   * Get or create room.
   *
   * @param {string} roomId
   * @returns {Promise<CRDTRoom>}
   */
  async getOrCreateRoom(roomId) {
    const cleanId = (roomId || 'default').trim();
    if (!this.rooms.has(cleanId)) {
      const room = new CRDTRoom(cleanId);
      await room.init();
      this.rooms.set(cleanId, room);
    }
    return this.rooms.get(cleanId);
  }

  listActiveRooms() {
    return Array.from(this.rooms.values()).map((r) => r.getInfo());
  }

  destroy() {
    for (const room of this.rooms.values()) {
      room.destroy();
    }
    this.rooms.clear();
  }
}
