import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

describe('CRDT Concurrency & Convergence', () => {
  test('Two concurrent clients edit code without conflicts', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const text1 = doc1.getText('monaco');
    const text2 = doc2.getText('monaco');

    // Initial synchronized state
    text1.insert(0, 'Hello World');
    const initialUpdate = Y.encodeStateAsUpdate(doc1);
    Y.applyUpdate(doc2, initialUpdate);

    assert.equal(text2.toString(), 'Hello World');

    // Client 1 edits the beginning: "Super Hello World"
    text1.insert(0, 'Super ');

    // Client 2 edits the end: "Hello World!!!"
    text2.insert(11, '!!!');

    // Exchange updates
    const update1 = Y.encodeStateAsUpdate(doc1);
    const update2 = Y.encodeStateAsUpdate(doc2);

    Y.applyUpdate(doc2, update1);
    Y.applyUpdate(doc1, update2);

    // Both documents must converge to the exact same string
    assert.equal(text1.toString(), text2.toString());
    assert.equal(text1.toString(), 'Super Hello World!!!');
  });

  test('Concurrent whiteboard drawing elements merge deterministically', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const wb1 = doc1.getArray('whiteboard');
    const wb2 = doc2.getArray('whiteboard');

    // Client 1 adds a rectangle
    wb1.push([{ id: 'rect-1', type: 'rect', x1: 10, y1: 10, x2: 100, y2: 100, color: '#ff0000' }]);

    // Client 2 concurrently adds a circle
    wb2.push([{ id: 'circle-1', type: 'circle', x1: 200, y1: 200, x2: 250, y2: 250, color: '#00ff00' }]);

    // Sync
    const u1 = Y.encodeStateAsUpdate(doc1);
    const u2 = Y.encodeStateAsUpdate(doc2);

    Y.applyUpdate(doc2, u1);
    Y.applyUpdate(doc1, u2);

    assert.equal(wb1.length, 2);
    assert.equal(wb2.length, 2);

    const ids1 = wb1.toArray().map((e) => e.id);
    const ids2 = wb2.toArray().map((e) => e.id);

    assert.deepEqual(ids1, ids2);
    assert.ok(ids1.includes('rect-1'));
    assert.ok(ids1.includes('circle-1'));
  });

  test('Whiteboard deletion synchronizes across peers', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const wb1 = doc1.getArray('whiteboard');
    const wb2 = doc2.getArray('whiteboard');

    wb1.push([
      { id: 'item-1', type: 'pen' },
      { id: 'item-2', type: 'line' },
    ]);

    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
    assert.equal(wb2.length, 2);

    // Delete item at index 0 on doc2
    wb2.delete(0, 1);
    Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));

    assert.equal(wb1.length, 1);
    assert.equal(wb1.get(0).id, 'item-2');
  });

  test('Chat message log maintains append order', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const chat1 = doc1.getArray('chat');
    const chat2 = doc2.getArray('chat');

    chat1.push([{ id: '1', user: 'Alice', text: 'Hi', timestamp: 1000 }]);
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

    chat2.push([{ id: '2', user: 'Bob', text: 'Hello Alice', timestamp: 2000 }]);
    Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));

    assert.equal(chat1.length, 2);
    assert.equal(chat2.length, 2);
    assert.equal(chat1.get(0).user, 'Alice');
    assert.equal(chat1.get(1).user, 'Bob');
  });
});
