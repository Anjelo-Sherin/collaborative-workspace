import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  saveRoomState,
  loadRoomState,
  recordHistorySnapshot,
  getRoomHistory,
  listSavedRooms,
  initStorage,
} from '../server/persistence.js';

describe('Room Persistence & Session Replay History', () => {
  before(async () => {
    await initStorage();
  });

  test('Persists Y.Doc binary update and restores state identically', async () => {
    const testRoomId = 'test-persist-' + Date.now();
    const doc1 = new Y.Doc();
    const text1 = doc1.getText('monaco');
    text1.insert(0, 'console.log("persisted code test");');

    const wb1 = doc1.getArray('whiteboard');
    wb1.push([{ id: 'p1', type: 'pen', points: [{ x: 10, y: 10 }] }]);

    await saveRoomState(testRoomId, doc1);

    // Create a new doc and restore
    const doc2 = new Y.Doc();
    const loaded = await loadRoomState(testRoomId, doc2);

    assert.equal(loaded, true);
    assert.equal(doc2.getText('monaco').toString(), 'console.log("persisted code test");');
    assert.equal(doc2.getArray('whiteboard').length, 1);
    assert.equal(doc2.getArray('whiteboard').get(0).id, 'p1');
  });

  test('Records and retrieves history snapshots for session replay', async () => {
    const testRoomId = 'test-replay-' + Date.now();
    const doc = new Y.Doc();
    const text = doc.getText('monaco');

    text.insert(0, 'step 1');
    await recordHistorySnapshot(testRoomId, doc, { author: 'UserA', action: 'type_step1' });

    text.insert(6, ' -> step 2');
    await recordHistorySnapshot(testRoomId, doc, { author: 'UserB', action: 'type_step2' });

    const history = await getRoomHistory(testRoomId);
    assert.equal(history.length, 2);
    assert.equal(history[0].author, 'UserA');
    assert.equal(history[1].author, 'UserB');
    assert.ok(history[1].updateBase64.length > 0);

    // Replay step 1 from base64
    const replayDoc = new Y.Doc();
    const bin1 = Uint8Array.from(Buffer.from(history[0].updateBase64, 'base64'));
    Y.applyUpdate(replayDoc, bin1);
    assert.equal(replayDoc.getText('monaco').toString(), 'step 1');
  });

  test('Lists saved rooms with metadata', async () => {
    const rooms = await listSavedRooms();
    assert.ok(Array.isArray(rooms));
    assert.ok(rooms.length > 0);
  });
});
