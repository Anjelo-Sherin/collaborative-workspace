import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export class CRDTClient {
  constructor({ roomId, user, onStatusChange, onAwarenessChange }) {
    this.roomId = roomId;
    this.user = user;
    this.onStatusChange = onStatusChange || (() => {});
    this.onAwarenessChange = onAwarenessChange || (() => {});

    this.ydoc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.ydoc);
    this.ws = null;
    this.synced = false;
    this.reconnectAttempts = 0;
    this._destroyed = false;

    // Shared CRDT structures
    this.codeText = this.ydoc.getText('monaco');
    this.whiteboardArray = this.ydoc.getArray('whiteboard');
    this.chatArray = this.ydoc.getArray('chat');

    this._setupListeners();
    this.connect();
  }

  _setupListeners() {
    // When local doc updates, send to server
    this.ydoc.on('update', (update, origin) => {
      if (origin !== 'server' && this.ws && this.ws.readyState === WebSocket.OPEN) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeUpdate(encoder, update);
        this.ws.send(encoding.toUint8Array(encoder));
      }
    });

    // When awareness changes, notify UI and broadcast local state to server
    this.awareness.on('change', ({ added, updated, removed }, origin) => {
      this.onAwarenessChange(this.getCollaborators());

      if (origin !== 'server' && this.ws && this.ws.readyState === WebSocket.OPEN) {
        const changedClients = added.concat(updated, removed);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
        );
        this.ws.send(encoding.toUint8Array(encoder));
      }
    });
  }

  connect() {
    if (this._destroyed) return;
    this.onStatusChange('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws?room=${encodeURIComponent(this.roomId)}&user=${encodeURIComponent(
      this.user.name
    )}&color=${encodeURIComponent(this.user.color)}`;

    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.onStatusChange('connected');

      // Send initial register
      this.ws.send(
        JSON.stringify({
          type: 'register_client',
          clientId: this.awareness.clientID,
          userName: this.user.name,
          userColor: this.user.color,
        })
      );

      // Send SyncStep1 to start CRDT handshake
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.ydoc);
      this.ws.send(encoding.toUint8Array(encoder));

      // Set local user awareness
      this.awareness.setLocalState({
        user: {
          name: this.user.name,
          color: this.user.color,
          id: this.awareness.clientID,
        },
        cursor: null,
        whiteboardCursor: null,
      });
    };

    this.ws.onmessage = (event) => {
      try {
        if (typeof event.data === 'string') {
          return;
        }

        const uint8 = new Uint8Array(event.data);
        const decoder = decoding.createDecoder(uint8);
        const messageType = decoding.readVarUint(decoder);

        switch (messageType) {
          case MESSAGE_SYNC: {
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, MESSAGE_SYNC);
            const syncType = syncProtocol.readSyncMessage(decoder, encoder, this.ydoc, 'server');
            if (encoding.length(encoder) > 1 && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(encoding.toUint8Array(encoder));
            }
            if (syncType === syncProtocol.messageYjsSyncStep2 && !this.synced) {
              this.synced = true;
              this.onStatusChange('synced');
            }
            break;
          }
          case MESSAGE_AWARENESS: {
            const update = decoding.readVarUint8Array(decoder);
            awarenessProtocol.applyAwarenessUpdate(this.awareness, update, 'server');
            break;
          }
          default:
            console.warn('[CRDTClient] Unknown message type:', messageType);
        }
      } catch (err) {
        console.error('[CRDTClient] Message handling error:', err);
      }
    };

    this.ws.onclose = () => {
      this.synced = false;
      this.onStatusChange('disconnected');
      if (!this._destroyed) {
        const timeout = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 8000);
        this.reconnectAttempts++;
        setTimeout(() => this.connect(), timeout);
      }
    };

    this.ws.onerror = (err) => {
      console.error('[CRDTClient] WebSocket error:', err);
      this.onStatusChange('error');
    };
  }

  setCursor(cursor) {
    const state = this.awareness.getLocalState() || {};
    this.awareness.setLocalStateField('cursor', cursor);
  }

  setWhiteboardCursor(pos) {
    this.awareness.setLocalStateField('whiteboardCursor', pos);
  }

  updateUser(user) {
    this.user = { ...this.user, ...user };
    this.awareness.setLocalStateField('user', {
      name: this.user.name,
      color: this.user.color,
      id: this.awareness.clientID,
    });
  }

  getCollaborators() {
    const list = [];
    const states = this.awareness.getStates();
    for (const [clientId, state] of states.entries()) {
      if (state && state.user) {
        list.push({
          clientId,
          isSelf: clientId === this.awareness.clientID,
          name: state.user.name || 'Anonymous',
          color: state.user.color || '#3b82f6',
          cursor: state.cursor || null,
          whiteboardCursor: state.whiteboardCursor || null,
        });
      }
    }
    return list;
  }

  sendChat(text) {
    if (!text || !text.trim()) return;
    this.chatArray.push([
      {
        id: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        user: this.user.name,
        color: this.user.color,
        text: text.trim(),
        timestamp: Date.now(),
      },
    ]);
  }

  destroy() {
    this._destroyed = true;
    if (this.ws) {
      this.ws.close();
    }
    this.awareness.destroy();
    this.ydoc.destroy();
  }
}
