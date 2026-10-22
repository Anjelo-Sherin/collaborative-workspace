import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/crdtRoom.js';
import { executeInSandbox } from '../server/sandbox.js';
import { listSavedRooms, getRoomHistory, initStorage } from '../server/persistence.js';
import { EventEmitter } from 'node:events';

describe('Room Manager & Server Logic (In-Memory)', () => {
  let roomManager;

  before(async () => {
    await initStorage();
    roomManager = new RoomManager();
  });

  after(() => {
    if (roomManager) {
      roomManager.destroy();
    }
  });

  test('RoomManager creates and initializes a room with default starter state', async () => {
    const room = await roomManager.getOrCreateRoom('unit-test-room');
    assert.equal(room.roomId, 'unit-test-room');

    const info = room.getInfo();
    assert.equal(info.roomId, 'unit-test-room');
    assert.ok(info.codeLength > 0); // Has default starter code
    assert.ok(info.chatMessages >= 1); // Has system welcome message
  });

  test('Room handles mock client connection and sends initial sync handshake', async () => {
    const room = await roomManager.getOrCreateRoom('unit-test-handshake');
    const sentMessages = [];

    // Create a mock WebSocket client
    const mockWs = new EventEmitter();
    mockWs.readyState = 1; // OPEN
    mockWs.send = (msg) => {
      sentMessages.push(msg);
    };

    room.handleConnection(mockWs, { userName: 'TestUser', userColor: '#10b981' });

    // Must have sent at least the SyncStep1 message
    assert.ok(sentMessages.length >= 1);
    assert.ok(sentMessages[0] instanceof Uint8Array || Buffer.isBuffer(sentMessages[0]));
    assert.equal(room.conns.size, 1);

    // Close mock connection
    mockWs.emit('close');
    assert.equal(room.conns.size, 0);
  });

  test('Room handles incoming chat message over JSON protocol', async () => {
    const room = await roomManager.getOrCreateRoom('unit-test-chat');
    const mockWs = new EventEmitter();
    mockWs.readyState = 1;
    mockWs.send = () => {};

    room.handleConnection(mockWs, { userName: 'Alice', userColor: '#3b82f6' });

    const initialChatCount = room.ydoc.getArray('chat').length;
    room.handleJsonMessage(
      mockWs,
      JSON.stringify({
        type: 'chat_message',
        user: 'Alice',
        color: '#3b82f6',
        text: 'Hello collaborative team!',
      })
    );

    const chatArr = room.ydoc.getArray('chat');
    assert.equal(chatArr.length, initialChatCount + 1);
    const lastMsg = chatArr.get(chatArr.length - 1);
    assert.equal(lastMsg.user, 'Alice');
    assert.equal(lastMsg.text, 'Hello collaborative team!');
  });

  test('Room lists active rooms properly', async () => {
    const active = roomManager.listActiveRooms();
    assert.ok(Array.isArray(active));
    assert.ok(active.some((r) => r.roomId === 'unit-test-room'));
  });

  test('Sandbox executes code requested by API', async () => {
    const res = await executeInSandbox({
      language: 'javascript',
      code: 'const nums = [1, 2, 3, 4]; console.log("sum=" + nums.reduce((a, b) => a + b, 0));',
    });

    assert.equal(res.success, true);
    assert.ok(res.stdout.includes('sum=10'));
  });
});
