import { CRDTClient } from './crdtClient.js';
import { MonacoBinding } from './monacoBinding.js';
import { Whiteboard } from './whiteboard.js';
import { SessionReplay } from './replay.js';

// Random user name and color generator
const USER_NAMES = [
  'Ada Lovelace',
  'Alan Turing',
  'Grace Hopper',
  'Linus Torvalds',
  'Margaret Hamilton',
  'Claude Shannon',
  'Dennis Ritchie',
  'Katherine Johnson',
  'Tim Berners-Lee',
  'Barbara Liskov',
];

const USER_COLORS = [
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#8b5cf6', // Purple
  '#06b6d4', // Cyan
  '#f97316', // Orange
  '#14b8a6', // Teal
];

function getStoredUser() {
  const saved = localStorage.getItem('synapse_user');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (_) {}
  }
  const randomName = USER_NAMES[Math.floor(Math.random() * USER_NAMES.length)];
  const randomColor = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
  const user = { name: randomName, color: randomColor };
  localStorage.setItem('synapse_user', JSON.stringify(user));
  return user;
}

class WorkspaceApp {
  constructor() {
    this.user = getStoredUser();
    this.roomId = this._getRoomIdFromUrl();
    this.language = 'javascript';
    this.currentView = 'split'; // 'split' | 'code' | 'whiteboard' | 'replay'
    this.monacoEditor = null;
    this.monacoBinding = null;
    this.whiteboard = null;
    this.replayPlayer = null;
    this.crdtClient = null;

    this._initDOM();
    this._initCRDT();
    this._initMonaco();
    this._initWhiteboard();
    this._bindUIEvents();
  }

  _getRoomIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('room');
    if (fromQuery) return fromQuery.trim();

    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts[0] === 'room' && pathParts[1]) {
      return pathParts[1].trim();
    }
    return 'demo-room';
  }

  _initDOM() {
    // Room ID display & input
    document.getElementById('current-room-badge').textContent = this.roomId;
    document.getElementById('room-input').value = this.roomId;

    // User badge
    this._updateUserBadge();

    // Setup color pickers in canvas
    const colorPalette = document.getElementById('whiteboard-palette');
    colorPalette.innerHTML = USER_COLORS.map(
      (c) => `<button class="color-dot" style="background-color: ${c}" data-color="${c}"></button>`
    ).join('');
  }

  _updateUserBadge() {
    const avatar = document.getElementById('user-avatar');
    const nameEl = document.getElementById('user-name-display');
    if (avatar && nameEl) {
      avatar.style.backgroundColor = this.user.color;
      avatar.textContent = this.user.name.charAt(0);
      nameEl.textContent = this.user.name;
    }
  }

  _initCRDT() {
    const statusDot = document.getElementById('connection-status-dot');
    const statusText = document.getElementById('connection-status-text');

    this.crdtClient = new CRDTClient({
      roomId: this.roomId,
      user: this.user,
      onStatusChange: (status) => {
        statusDot.className = `status-indicator ${status}`;
        statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      },
      onAwarenessChange: (collaborators) => {
        this._renderCollaborators(collaborators);
        if (this.monacoBinding) {
          this.monacoBinding.updateRemoteCursors(collaborators);
        }
        if (this.whiteboard) {
          this.whiteboard.updateRemotePointers(collaborators);
        }
      },
    });

    // Bind chat
    this.crdtClient.chatArray.observe(() => {
      this._renderChat();
    });
    this._renderChat();
  }

  _renderCollaborators(collaborators) {
    const listEl = document.getElementById('collaborators-list');
    const countEl = document.getElementById('collaborators-count');

    countEl.textContent = collaborators.length;

    listEl.innerHTML = collaborators
      .map(
        (c) => `
        <div class="user-pill ${c.isSelf ? 'is-self' : ''}" title="${c.name} (${c.isSelf ? 'You' : 'Collaborator'})">
          <span class="user-pill-avatar" style="background-color: ${c.color}">${c.name.charAt(0)}</span>
          <span class="user-pill-name">${c.name} ${c.isSelf ? '<span class="text-xs text-muted">(You)</span>' : ''}</span>
        </div>
      `
      )
      .join('');
  }

  _renderChat() {
    const container = document.getElementById('chat-messages-container');
    const messages = this.crdtClient.chatArray.toArray();

    container.innerHTML = messages
      .map((m) => {
        const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const isSelf = m.user === this.user.name;
        return `
          <div class="chat-item ${isSelf ? 'chat-item-self' : ''}">
            <div class="chat-meta">
              <span class="chat-author" style="color: ${m.color}">${m.user}</span>
              <span class="chat-time">${time}</span>
            </div>
            <div class="chat-bubble">${this._escapeHTML(m.text)}</div>
          </div>
        `;
      })
      .join('');

    container.scrollTop = container.scrollHeight;
  }

  _escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _initMonaco() {
    const container = document.getElementById('monaco-editor-container');

    // Wait for Monaco AMD loader
    if (window.monaco) {
      this._setupMonacoInstance(window.monaco, container);
    } else {
      window.require.config({ paths: { vs: '/vs' } });
      window.require(['vs/editor/editor.main'], () => {
        this._setupMonacoInstance(window.monaco, container);
      });
    }
  }

  _setupMonacoInstance(monaco, container) {
    this.monacoEditor = monaco.editor.create(container, {
      value: '',
      language: this.language,
      theme: 'vs-dark',
      automaticLayout: true,
      fontSize: 14,
      fontFamily: "'Fira Code', 'JetBrains Mono', Consolas, monospace",
      fontLigatures: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      padding: { top: 12, bottom: 12 },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      renderWhitespace: 'selection',
    });

    this.monacoBinding = new MonacoBinding(
      this.crdtClient.codeText,
      this.monacoEditor,
      monaco,
      this.crdtClient
    );

    // Keyboard shortcut for running code: Ctrl+Enter or Cmd+Enter
    this.monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      this.runCode();
    });
  }

  _initWhiteboard() {
    const canvas = document.getElementById('whiteboard-canvas');
    this.whiteboard = new Whiteboard(canvas, this.crdtClient.whiteboardArray, this.crdtClient);
  }

  _bindUIEvents() {
    // 1. Language selector
    const langSelect = document.getElementById('editor-language-select');
    langSelect.addEventListener('change', (e) => {
      this.language = e.target.value;
      if (this.monacoEditor && window.monaco) {
        window.monaco.editor.setModelLanguage(this.monacoEditor.getModel(), this.language);
      }
    });

    // 2. View Switcher (Split, Code Only, Whiteboard Only)
    const viewButtons = document.querySelectorAll('[data-view]');
    viewButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        viewButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.switchView(btn.dataset.view);
      });
    });

    // 3. Run Code
    document.getElementById('btn-run-code').addEventListener('click', () => {
      this.runCode();
    });

    // 4. Whiteboard tool buttons
    const toolButtons = document.querySelectorAll('[data-tool]');
    toolButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        toolButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.whiteboard.tool = btn.dataset.tool;
      });
    });

    // Whiteboard color palette
    document.getElementById('whiteboard-palette').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-color]');
      if (btn) {
        this.whiteboard.color = btn.dataset.color;
        document
          .querySelectorAll('.color-dot')
          .forEach((d) => d.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById('custom-color-picker').value = btn.dataset.color;
      }
    });

    document.getElementById('custom-color-picker').addEventListener('input', (e) => {
      this.whiteboard.color = e.target.value;
      document
        .querySelectorAll('.color-dot')
        .forEach((d) => d.classList.remove('selected'));
    });

    document.getElementById('whiteboard-stroke-width').addEventListener('change', (e) => {
      this.whiteboard.lineWidth = parseInt(e.target.value, 10);
    });

    document.getElementById('whiteboard-fill-toggle').addEventListener('change', (e) => {
      this.whiteboard.fill = e.target.checked;
    });

    document.getElementById('btn-wb-undo').addEventListener('click', () => {
      this.whiteboard.undo();
    });

    document.getElementById('btn-wb-clear').addEventListener('click', () => {
      this.whiteboard.clear();
    });

    document.getElementById('btn-wb-export').addEventListener('click', () => {
      this.whiteboard.exportPNG();
    });

    // 5. Chat Input
    const chatInput = document.getElementById('chat-input-text');
    const sendChat = () => {
      const text = chatInput.value.trim();
      if (text) {
        this.crdtClient.sendChat(text);
        chatInput.value = '';
      }
    };

    document.getElementById('btn-chat-send').addEventListener('click', sendChat);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        sendChat();
      }
    });

    // 6. Share Room Link
    document.getElementById('btn-share-room').addEventListener('click', () => {
      const shareUrl = `${window.location.origin}/?room=${encodeURIComponent(this.roomId)}`;
      navigator.clipboard.writeText(shareUrl).then(() => {
        this.showToast('📋 Room link copied to clipboard!');
      });
    });

    // 7. Join / Change Room Form
    document.getElementById('btn-switch-room').addEventListener('click', () => {
      const targetRoom = document.getElementById('room-input').value.trim();
      if (targetRoom && targetRoom !== this.roomId) {
        window.location.search = `?room=${encodeURIComponent(targetRoom)}`;
      }
    });

    // 8. User Profile Edit
    document.getElementById('btn-edit-user').addEventListener('click', () => {
      const newName = prompt('Enter your display name:', this.user.name);
      if (newName && newName.trim()) {
        this.user.name = newName.trim();
        localStorage.setItem('synapse_user', JSON.stringify(this.user));
        this._updateUserBadge();
        this.crdtClient.updateUser(this.user);
      }
    });

    // 9. Session Replay Button
    document.getElementById('btn-toggle-replay').addEventListener('click', () => {
      this.toggleReplayMode();
    });

    // 10. Code File Download
    document.getElementById('btn-download-code').addEventListener('click', () => {
      this.downloadCodeFile();
    });

    // 11. Clear Console Output
    document.getElementById('btn-clear-console').addEventListener('click', () => {
      document.getElementById('console-output-text').textContent = '// Console ready. Run code to view output.';
      document.getElementById('console-status-badge').textContent = 'IDLE';
      document.getElementById('console-status-badge').className = 'badge-idle';
    });
  }

  switchView(view) {
    this.currentView = view;
    const splitWorkspace = document.getElementById('workspace-grid');
    splitWorkspace.className = `workspace-grid view-${view}`;

    if (this.monacoEditor) {
      setTimeout(() => this.monacoEditor.layout(), 50);
    }
    if (this.whiteboard) {
      setTimeout(() => this.whiteboard.handleResize(), 50);
    }
  }

  toggleReplayMode() {
    const replayContainer = document.getElementById('replay-drawer');
    const replayBtn = document.getElementById('btn-toggle-replay');

    if (this.currentView === 'replay') {
      // Exit replay mode
      this.switchView('split');
      replayContainer.classList.add('hidden');
      replayBtn.classList.remove('active');
      if (this.replayPlayer) {
        this.replayPlayer.destroy();
        this.replayPlayer = null;
      }
      // Restore live document content
      if (this.monacoEditor) {
        this.monacoEditor.updateOptions({ readOnly: false });
        this.monacoEditor.setValue(this.crdtClient.codeText.toString());
      }
      if (this.whiteboard) {
        this.whiteboard.render();
      }
    } else {
      // Enter replay mode
      this.switchView('split');
      replayContainer.classList.remove('hidden');
      replayBtn.classList.add('active');

      if (this.monacoEditor) {
        this.monacoEditor.updateOptions({ readOnly: true });
      }

      this.replayPlayer = new SessionReplay({
        roomId: this.roomId,
        container: replayContainer,
        onApplySnapshot: ({ code, whiteboard }) => {
          if (this.monacoEditor) {
            this.monacoEditor.setValue(code);
          }
          if (this.whiteboard) {
            // Render snapshot elements
            this.whiteboard.ctx.clearRect(0, 0, this.whiteboard.width, this.whiteboard.height);
            this.whiteboard._drawGrid(this.whiteboard.ctx);
            for (const el of whiteboard) {
              this.whiteboard._drawElement(this.whiteboard.ctx, el);
            }
          }
        },
      });

      this.replayPlayer.onExit = () => {
        this.toggleReplayMode();
      };

      this.replayPlayer.load();
    }
  }

  async runCode() {
    const code = this.monacoEditor ? this.monacoEditor.getValue() : this.crdtClient.codeText.toString();
    const btn = document.getElementById('btn-run-code');
    const badge = document.getElementById('console-status-badge');
    const outputEl = document.getElementById('console-output-text');

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Running...`;
    badge.textContent = 'RUNNING';
    badge.className = 'badge-running';

    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: this.language,
          code,
          timeoutMs: 4000,
        }),
      });

      const data = await res.json();

      if (data.timedOut) {
        badge.textContent = `TIMED OUT (${data.durationMs}ms)`;
        badge.className = 'badge-timeout';
      } else if (data.success) {
        badge.textContent = `SUCCESS (${data.durationMs}ms)`;
        badge.className = 'badge-success';
      } else {
        badge.textContent = `FAILED (exit ${data.exitCode})`;
        badge.className = 'badge-error';
      }

      let formattedOutput = '';
      if (data.stdout) {
        formattedOutput += data.stdout;
      }
      if (data.stderr) {
        if (formattedOutput) formattedOutput += '\n\n';
        formattedOutput += `[STDERR]\n${data.stderr}`;
      }
      if (!formattedOutput) {
        formattedOutput = `[Process finished with exit code ${data.exitCode} in ${data.durationMs}ms - No output]`;
      }

      outputEl.textContent = formattedOutput;
    } catch (err) {
      badge.textContent = 'ERROR';
      badge.className = 'badge-error';
      outputEl.textContent = `Execution failed to reach server: ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = `▶ Run Code <span class="shortcut-hint">Ctrl+Enter</span>`;
    }
  }

  downloadCodeFile() {
    const extensions = {
      javascript: 'js',
      python: 'py',
      typescript: 'ts',
      html: 'html',
      css: 'css',
      json: 'json',
      cpp: 'cpp',
      markdown: 'md',
    };
    const ext = extensions[this.language] || 'txt';
    const text = this.monacoEditor ? this.monacoEditor.getValue() : this.crdtClient.codeText.toString();

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.download = `workspace-${this.roomId}.${ext}`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new WorkspaceApp();
});
