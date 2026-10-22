import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { executeInSandbox } from '../server/sandbox.js';

describe('Sandboxed Code Execution', () => {
  test('Executes valid JavaScript and returns stdout', async () => {
    const res = await executeInSandbox({
      language: 'javascript',
      code: 'console.log("Hello from sandbox!"); console.log(2 + 2);',
      timeoutMs: 3000,
    });

    assert.equal(res.success, true);
    assert.equal(res.exitCode, 0);
    assert.equal(res.timedOut, false);
    assert.ok(res.stdout.includes('Hello from sandbox!'));
    assert.ok(res.stdout.includes('4'));
    assert.ok(res.durationMs >= 0);
  });

  test('Executes valid Python and returns stdout', async () => {
    const res = await executeInSandbox({
      language: 'python',
      code: 'print("Python result:", sum([1, 2, 3, 4, 5]))',
      timeoutMs: 3000,
    });

    assert.equal(res.success, true);
    assert.equal(res.exitCode, 0);
    assert.equal(res.timedOut, false);
    assert.ok(res.stdout.includes('Python result: 15'));
  });

  test('Captures stderr and returns non-zero exit code on runtime error', async () => {
    const res = await executeInSandbox({
      language: 'javascript',
      code: 'throw new Error("Deliberate failure in sandbox");',
      timeoutMs: 3000,
    });

    assert.equal(res.success, false);
    assert.notEqual(res.exitCode, 0);
    assert.ok(res.stderr.includes('Deliberate failure in sandbox'));
  });

  test('Terminates infinite loops and reports timeout', async () => {
    const res = await executeInSandbox({
      language: 'javascript',
      code: 'while (true) {}',
      timeoutMs: 1000, // 1 second timeout
    });

    assert.equal(res.success, false);
    assert.equal(res.timedOut, true);
    assert.ok(res.stderr.includes('Timed Out'));
  });

  test('Handles unsupported languages gracefully', async () => {
    const res = await executeInSandbox({
      language: 'cobol',
      code: 'DISPLAY "HELLO"',
    });

    assert.equal(res.success, false);
    assert.ok(res.stderr.includes('Unsupported language'));
  });
});
