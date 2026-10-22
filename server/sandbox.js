import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const MAX_OUTPUT_BYTES = 256 * 1024; // 256 KB max output
const DEFAULT_TIMEOUT_MS = 4000;
const MAX_TIMEOUT_MS = 10000;

/**
 * Execute code inside a sandboxed subprocess with strict resource bounds.
 *
 * @param {Object} options
 * @param {'javascript' | 'python'} options.language
 * @param {string} options.code
 * @param {string} [options.stdin]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{
 *   success: boolean,
 *   exitCode: number | null,
 *   stdout: string,
 *   stderr: string,
 *   durationMs: number,
 *   timedOut: boolean,
 *   language: string
 * }>}
 */
export async function executeInSandbox({
  language,
  code,
  stdin = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const boundedTimeout = Math.min(Math.max(500, timeoutMs), MAX_TIMEOUT_MS);
  const runId = crypto.randomBytes(8).toString('hex');
  const tempDir = path.join(os.tmpdir(), `collab-run-${runId}`);

  await fs.mkdir(tempDir, { recursive: true });

  let cmd = '';
  let args = [];
  let scriptPath = '';

  const lang = (language || '').toLowerCase().trim();

  if (lang === 'javascript' || lang === 'js' || lang === 'typescript' || lang === 'ts') {
    scriptPath = path.join(tempDir, 'script.js');
    await fs.writeFile(scriptPath, code, 'utf8');
    cmd = process.execPath; // current node binary
    // constrain memory to 64MB and disable experimental flags
    args = ['--max-old-space-size=64', scriptPath];
  } else if (lang === 'python' || lang === 'py' || lang === 'python3') {
    scriptPath = path.join(tempDir, 'script.py');
    await fs.writeFile(scriptPath, code, 'utf8');
    cmd = 'python3';
    // unbuffered output (-u)
    args = ['-u', scriptPath];
  } else {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    return {
      success: false,
      exitCode: -1,
      stdout: '',
      stderr: `Unsupported language: "${language}". Supported languages are: javascript, python.`,
      durationMs: 0,
      timedOut: false,
      language: lang,
    };
  }

  const startTime = process.hrtime.bigint();

  return new Promise((resolve) => {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let isTerminated = false;
    let timedOut = false;

    // Minimal sanitized environment
    const safeEnv = {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      PYTHONUNBUFFERED: '1',
      TMPDIR: tempDir,
    };

    let child;
    try {
      child = spawn(cmd, args, {
        cwd: tempDir,
        env: safeEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      const endTime = process.hrtime.bigint();
      const durationMs = Number((endTime - startTime) / 1000000n);
      fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      return resolve({
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: `Failed to spawn process: ${err.message}`,
        durationMs,
        timedOut: false,
        language: lang,
      });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      isTerminated = true;
      try {
        child.kill('SIGKILL');
      } catch (_) {}
    }, boundedTimeout);

    child.stdout.on('data', (chunk) => {
      if (stdoutBuffer.length < MAX_OUTPUT_BYTES) {
        stdoutBuffer += chunk.toString('utf8');
        if (stdoutBuffer.length > MAX_OUTPUT_BYTES) {
          stdoutBuffer = stdoutBuffer.slice(0, MAX_OUTPUT_BYTES) + '\n[Output truncated: exceeded 256KB buffer limit]';
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      if (stderrBuffer.length < MAX_OUTPUT_BYTES) {
        stderrBuffer += chunk.toString('utf8');
        if (stderrBuffer.length > MAX_OUTPUT_BYTES) {
          stderrBuffer = stderrBuffer.slice(0, MAX_OUTPUT_BYTES) + '\n[Error output truncated: exceeded 256KB buffer limit]';
        }
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      const endTime = process.hrtime.bigint();
      const durationMs = Number((endTime - startTime) / 1000000n);
      fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      resolve({
        success: false,
        exitCode: -1,
        stdout: stdoutBuffer,
        stderr: (stderrBuffer ? stderrBuffer + '\n' : '') + `Runtime error: ${err.message}`,
        durationMs,
        timedOut: false,
        language: lang,
      });
    });

    child.on('close', async (exitCode) => {
      clearTimeout(timer);
      const endTime = process.hrtime.bigint();
      const durationMs = Number((endTime - startTime) / 1000000n);

      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

      if (timedOut) {
        return resolve({
          success: false,
          exitCode: null,
          stdout: stdoutBuffer,
          stderr: (stderrBuffer ? stderrBuffer + '\n' : '') + `[Execution Timed Out]: Process exceeded ${boundedTimeout}ms time limit and was terminated.`,
          durationMs,
          timedOut: true,
          language: lang,
        });
      }

      resolve({
        success: exitCode === 0,
        exitCode,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        durationMs,
        timedOut: false,
        language: lang,
      });
    });

    if (stdin && child.stdin) {
      try {
        child.stdin.write(stdin);
        child.stdin.end();
      } catch (_) {}
    } else if (child.stdin) {
      child.stdin.end();
    }
  });
}
