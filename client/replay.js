import * as Y from 'yjs';

/**
 * Session Replay controller to inspect and step through document history.
 */
export class SessionReplay {
  /**
   * @param {Object} options
   * @param {string} options.roomId
   * @param {HTMLElement} options.container
   * @param {Function} options.onApplySnapshot - called with { code, whiteboardElements, snapshot }
   */
  constructor({ roomId, container, onApplySnapshot }) {
    this.roomId = roomId;
    this.container = container;
    this.onApplySnapshot = onApplySnapshot;

    this.snapshots = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.playSpeed = 1; // 1x, 2x, 4x
    this.timer = null;

    this._createUI();
  }

  async load() {
    try {
      const res = await fetch(`/api/room/${encodeURIComponent(this.roomId)}/replay`);
      const data = await res.json();
      this.snapshots = data.snapshots || [];
      this.currentIndex = Math.max(0, this.snapshots.length - 1);
      this._updateUI();
      if (this.snapshots.length > 0) {
        this.applyCurrentSnapshot();
      }
    } catch (err) {
      console.error('[SessionReplay] Failed to load replay:', err);
    }
  }

  _createUI() {
    this.container.innerHTML = `
      <div class="replay-bar">
        <div class="replay-controls">
          <button id="btn-replay-prev" class="btn-icon" title="Previous Checkpoint">⏮</button>
          <button id="btn-replay-play" class="btn-primary-small">▶ Play</button>
          <button id="btn-replay-next" class="btn-icon" title="Next Checkpoint">⏭</button>
          <div class="replay-speed-group">
            <span class="text-muted text-xs">Speed:</span>
            <button class="btn-chip active" data-speed="1">1x</button>
            <button class="btn-chip" data-speed="2">2x</button>
            <button class="btn-chip" data-speed="4">4x</button>
          </div>
        </div>

        <div class="replay-scrubber-container">
          <input type="range" id="replay-slider" min="0" max="0" value="0" step="1" class="slider-scrubber" />
          <div class="replay-meta">
            <span id="replay-counter" class="text-xs text-muted">0 / 0</span>
            <span id="replay-timestamp" class="text-xs text-primary font-mono">--:--:--</span>
            <span id="replay-author" class="text-xs text-muted">Author: --</span>
          </div>
        </div>

        <button id="btn-replay-exit" class="btn-secondary-small">✕ Exit Replay</button>
      </div>
    `;

    this.btnPlay = this.container.querySelector('#btn-replay-play');
    this.btnPrev = this.container.querySelector('#btn-replay-prev');
    this.btnNext = this.container.querySelector('#btn-replay-next');
    this.slider = this.container.querySelector('#replay-slider');
    this.counterEl = this.container.querySelector('#replay-counter');
    this.timestampEl = this.container.querySelector('#replay-timestamp');
    this.authorEl = this.container.querySelector('#replay-author');
    this.btnExit = this.container.querySelector('#btn-replay-exit');

    this.btnPlay.addEventListener('click', () => this.togglePlay());
    this.btnPrev.addEventListener('click', () => this.step(-1));
    this.btnNext.addEventListener('click', () => this.step(1));

    this.slider.addEventListener('input', (e) => {
      this.pause();
      this.currentIndex = parseInt(e.target.value, 10);
      this.applyCurrentSnapshot();
      this._updateUI();
    });

    const speedButtons = this.container.querySelectorAll('[data-speed]');
    speedButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        speedButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.playSpeed = parseFloat(btn.dataset.speed);
      });
    });

    this.btnExit.addEventListener('click', () => {
      this.pause();
      if (this.onExit) this.onExit();
    });
  }

  _updateUI() {
    const total = this.snapshots.length;
    this.slider.max = Math.max(0, total - 1);
    this.slider.value = this.currentIndex;

    if (total === 0) {
      this.counterEl.textContent = 'No recorded snapshots yet';
      this.timestampEl.textContent = '--';
      this.authorEl.textContent = 'Make edits to start recording history';
      return;
    }

    const current = this.snapshots[this.currentIndex];
    this.counterEl.textContent = `Checkpoint ${this.currentIndex + 1} of ${total}`;
    if (current) {
      const date = new Date(current.timestamp);
      this.timestampEl.textContent = date.toLocaleTimeString();
      this.authorEl.textContent = `Action: ${current.action} | Chars: ${current.codeLength} | Strokes: ${current.strokeCount}`;
    }
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  play() {
    if (this.snapshots.length <= 1) return;
    if (this.currentIndex >= this.snapshots.length - 1) {
      this.currentIndex = 0;
    }
    this.isPlaying = true;
    this.btnPlay.textContent = '⏸ Pause';
    this._runPlayLoop();
  }

  _runPlayLoop() {
    if (!this.isPlaying) return;
    const intervalMs = Math.max(250, 1000 / this.playSpeed);

    this.timer = setTimeout(() => {
      if (!this.isPlaying) return;
      if (this.currentIndex < this.snapshots.length - 1) {
        this.currentIndex++;
        this.applyCurrentSnapshot();
        this._updateUI();
        this._runPlayLoop();
      } else {
        this.pause();
      }
    }, intervalMs);
  }

  pause() {
    this.isPlaying = false;
    if (this.btnPlay) this.btnPlay.textContent = '▶ Play';
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  step(delta) {
    this.pause();
    const newIdx = this.currentIndex + delta;
    if (newIdx >= 0 && newIdx < this.snapshots.length) {
      this.currentIndex = newIdx;
      this.applyCurrentSnapshot();
      this._updateUI();
    }
  }

  applyCurrentSnapshot() {
    const snap = this.snapshots[this.currentIndex];
    if (!snap || !snap.updateBase64) return;

    try {
      // Create temporary doc and apply encoded base64 state
      const tempDoc = new Y.Doc();
      const binary = Uint8Array.from(atob(snap.updateBase64), (c) => c.charCodeAt(0));
      Y.applyUpdate(tempDoc, binary);

      const code = tempDoc.getText('monaco').toString();
      const whiteboard = tempDoc.getArray('whiteboard').toArray();

      if (this.onApplySnapshot) {
        this.onApplySnapshot({ code, whiteboard, snapshot: snap });
      }
      tempDoc.destroy();
    } catch (err) {
      console.error('[SessionReplay] Error applying snapshot:', err);
    }
  }

  destroy() {
    this.pause();
    this.container.innerHTML = '';
  }
}
