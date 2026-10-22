import fs from 'node:fs/promises';
import path from 'node:path';
import * as Y from 'yjs';

const ROOMS_DIR = path.resolve(process.cwd(), 'data', 'rooms');

/**
 * Ensure storage directory exists.
 */
export async function initStorage() {
  await fs.mkdir(ROOMS_DIR, { recursive: true });
}

/**
 * Get file paths for a room.
 */
function getRoomPaths(roomId) {
  const safeId = roomId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return {
    binPath: path.join(ROOMS_DIR, `${safeId}.bin`),
    metaPath: path.join(ROOMS_DIR, `${safeId}.meta.json`),
    historyPath: path.join(ROOMS_DIR, `${safeId}.history.json`),
  };
}

/**
 * Load persisted room state into a Y.Doc if it exists.
 *
 * @param {string} roomId
 * @param {Y.Doc} ydoc
 * @returns {Promise<boolean>} whether state was loaded
 */
export async function loadRoomState(roomId, ydoc) {
  await initStorage();
  const { binPath } = getRoomPaths(roomId);
  try {
    const data = await fs.readFile(binPath);
    if (data && data.length > 0) {
      Y.applyUpdate(ydoc, new Uint8Array(data));
      return true;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[Persistence] Error loading room ${roomId}:`, err.message);
    }
  }
  return false;
}

/**
 * Save Y.Doc state to disk.
 *
 * @param {string} roomId
 * @param {Y.Doc} ydoc
 * @param {Object} [metadata]
 */
export async function saveRoomState(roomId, ydoc, metadata = {}) {
  await initStorage();
  const { binPath, metaPath } = getRoomPaths(roomId);
  try {
    const update = Y.encodeStateAsUpdate(ydoc);
    await fs.writeFile(binPath, Buffer.from(update));

    const meta = {
      roomId,
      updatedAt: new Date().toISOString(),
      codeLength: ydoc.getText('monaco').length,
      whiteboardElements: ydoc.getArray('whiteboard').length,
      chatMessages: ydoc.getArray('chat').length,
      ...metadata,
    };
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  } catch (err) {
    console.error(`[Persistence] Error saving room ${roomId}:`, err.message);
  }
}

/**
 * Record a historical snapshot event for session replay.
 *
 * @param {string} roomId
 * @param {Y.Doc} ydoc
 * @param {Object} eventDetails
 */
export async function recordHistorySnapshot(roomId, ydoc, eventDetails = {}) {
  await initStorage();
  const { historyPath } = getRoomPaths(roomId);
  try {
    let history = [];
    try {
      const existing = await fs.readFile(historyPath, 'utf8');
      history = JSON.parse(existing);
    } catch (_) {
      history = [];
    }

    const code = ydoc.getText('monaco').toString();
    const whiteboard = ydoc.getArray('whiteboard').toArray();
    const update = Y.encodeStateAsUpdate(ydoc);

    const snapshot = {
      id: history.length + 1,
      timestamp: Date.now(),
      author: eventDetails.author || 'Anonymous',
      action: eventDetails.action || 'edit',
      codeSnippet: code.slice(0, 100),
      codeLength: code.length,
      strokeCount: whiteboard.length,
      // Store state update in base64 so client can replay exact state
      updateBase64: Buffer.from(update).toString('base64'),
    };

    history.push(snapshot);

    // Keep up to 200 history checkpoints to prevent unbounded file growth
    if (history.length > 200) {
      history = history.slice(history.length - 200);
    }

    await fs.writeFile(historyPath, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error(`[Persistence] Error recording history for room ${roomId}:`, err.message);
  }
}

/**
 * Get room history for session replay.
 *
 * @param {string} roomId
 * @returns {Promise<Array>}
 */
export async function getRoomHistory(roomId) {
  const { historyPath } = getRoomPaths(roomId);
  try {
    const raw = await fs.readFile(historyPath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}

/**
 * List all saved rooms.
 *
 * @returns {Promise<Array>}
 */
export async function listSavedRooms() {
  await initStorage();
  try {
    const files = await fs.readdir(ROOMS_DIR);
    const metaFiles = files.filter((f) => f.endsWith('.meta.json'));
    const rooms = [];
    for (const f of metaFiles) {
      try {
        const content = await fs.readFile(path.join(ROOMS_DIR, f), 'utf8');
        rooms.push(JSON.parse(content));
      } catch (_) {}
    }
    return rooms.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } catch (_) {
    return [];
  }
}
