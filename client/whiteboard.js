/**
 * Collaborative Canvas Whiteboard powered by Yjs CRDT Y.Array and Awareness.
 */
export class Whiteboard {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('yjs').Array} yArray
   * @param {import('./crdtClient.js').CRDTClient} crdtClient
   */
  constructor(canvas, yArray, crdtClient) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.yArray = yArray;
    this.client = crdtClient;

    this.tool = 'pen'; // 'pen' | 'rect' | 'circle' | 'line' | 'arrow' | 'text' | 'eraser'
    this.color = '#38bdf8';
    this.lineWidth = 3;
    this.fill = false;

    this.isDrawing = false;
    this.currentPoints = [];
    this.startX = 0;
    this.startY = 0;

    // Track locally added element IDs for Undo
    this.localElementIds = [];

    // Cache remote pointers for animation
    this.remotePointers = [];

    this._resizeCanvas();
    this._bindEvents();
    this._bindCRDT();
    this.render();
  }

  _resizeCanvas() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = (rect.width || 800) * dpr;
    this.canvas.height = (rect.height || 600) * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width || 800;
    this.height = rect.height || 600;
  }

  handleResize() {
    this._resizeCanvas();
    this.render();
  }

  _bindCRDT() {
    this.yArray.observe(() => {
      this.render();
    });
  }

  _getCanvasPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  _bindEvents() {
    window.addEventListener('resize', () => this.handleResize());

    this.canvas.addEventListener('mousedown', (e) => this._onPointerDown(e));
    window.addEventListener('mousemove', (e) => this._onPointerMove(e));
    window.addEventListener('mouseup', (e) => this._onPointerUp(e));

    // Touch support for mobile / tablets
    this.canvas.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 1) {
          e.preventDefault();
          this._onPointerDown(e.touches[0]);
        }
      },
      { passive: false }
    );

    window.addEventListener(
      'touchmove',
      (e) => {
        if (this.isDrawing && e.touches.length === 1) {
          e.preventDefault();
          this._onPointerMove(e.touches[0]);
        }
      },
      { passive: false }
    );

    window.addEventListener('touchend', (e) => {
      if (this.isDrawing) {
        this._onPointerUp(e);
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.client.setWhiteboardCursor(null);
    });
  }

  _onPointerDown(e) {
    const pt = this._getCanvasPoint(e);
    if (pt.x < 0 || pt.x > this.width || pt.y < 0 || pt.y > this.height) return;

    this.isDrawing = true;
    this.startX = pt.x;
    this.startY = pt.y;

    if (this.tool === 'pen') {
      this.currentPoints = [pt];
    } else if (this.tool === 'eraser') {
      this._eraseAt(pt);
    } else if (this.tool === 'text') {
      const text = prompt('Enter text note on whiteboard:');
      if (text && text.trim()) {
        this._addElement({
          id: 'elem-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          type: 'text',
          x: pt.x,
          y: pt.y,
          text: text.trim(),
          color: this.color,
          fontSize: 16,
          author: this.client.user.name,
        });
      }
      this.isDrawing = false;
    }
  }

  _onPointerMove(e) {
    const pt = this._getCanvasPoint(e);
    const inBounds = pt.x >= 0 && pt.x <= this.width && pt.y >= 0 && pt.y <= this.height;

    // Broadcast live pointer position to awareness
    if (inBounds) {
      this.client.setWhiteboardCursor({ x: Math.round(pt.x), y: Math.round(pt.y) });
    }

    if (!this.isDrawing) return;

    if (this.tool === 'pen') {
      this.currentPoints.push(pt);
      this.render();
      this._drawCurrentPenPreview();
    } else if (this.tool === 'eraser') {
      this._eraseAt(pt);
    } else if (['rect', 'circle', 'line', 'arrow'].includes(this.tool)) {
      this.render();
      this._drawShapePreview(this.tool, this.startX, this.startY, pt.x, pt.y);
    }
  }

  _onPointerUp(e) {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    const pt = e ? this._getCanvasPoint(e) : { x: this.startX, y: this.startY };

    if (this.tool === 'pen' && this.currentPoints.length > 1) {
      this._addElement({
        id: 'elem-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        type: 'pen',
        points: this.currentPoints,
        color: this.color,
        width: this.lineWidth,
        author: this.client.user.name,
      });
      this.currentPoints = [];
    } else if (['rect', 'circle', 'line', 'arrow'].includes(this.tool)) {
      const dx = pt.x - this.startX;
      const dy = pt.y - this.startY;
      if (Math.hypot(dx, dy) > 4) {
        this._addElement({
          id: 'elem-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          type: this.tool,
          x1: this.startX,
          y1: this.startY,
          x2: pt.x,
          y2: pt.y,
          color: this.color,
          width: this.lineWidth,
          fill: this.fill,
          author: this.client.user.name,
        });
      }
    }

    this.render();
  }

  _addElement(elem) {
    this.localElementIds.push(elem.id);
    this.yArray.push([elem]);
  }

  _eraseAt(pt) {
    const elements = this.yArray.toArray();
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      let hit = false;

      if (el.type === 'pen' && el.points) {
        hit = el.points.some((p) => Math.hypot(p.x - pt.x, p.y - pt.y) < 15);
      } else if (el.type === 'rect') {
        const minX = Math.min(el.x1, el.x2) - 10;
        const maxX = Math.max(el.x1, el.x2) + 10;
        const minY = Math.min(el.y1, el.y2) - 10;
        const maxY = Math.max(el.y1, el.y2) + 10;
        hit = pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY;
      } else if (el.type === 'circle') {
        const cx = (el.x1 + el.x2) / 2;
        const cy = (el.y1 + el.y2) / 2;
        const rx = Math.abs(el.x2 - el.x1) / 2 + 10;
        const ry = Math.abs(el.y2 - el.y1) / 2 + 10;
        hit = Math.pow((pt.x - cx) / rx, 2) + Math.pow((pt.y - cy) / ry, 2) <= 1;
      } else if (el.type === 'line' || el.type === 'arrow') {
        hit = this._pointNearLine(pt, el.x1, el.y1, el.x2, el.y2, 12);
      } else if (el.type === 'text') {
        hit = Math.hypot(el.x - pt.x, el.y - pt.y) < 25;
      }

      if (hit) {
        this.yArray.delete(i, 1);
        this.render();
        break;
      }
    }
  }

  _pointNearLine(pt, x1, y1, x2, y2, threshold) {
    const L2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (L2 === 0) return Math.hypot(pt.x - x1, pt.y - y1) <= threshold;
    let t = ((pt.x - x1) * (x2 - x1) + (pt.y - y1) * (y2 - y1)) / L2;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * (x2 - x1);
    const projY = y1 + t * (y2 - y1);
    return Math.hypot(pt.x - projX, pt.y - projY) <= threshold;
  }

  undo() {
    if (this.localElementIds.length === 0) return;
    const lastId = this.localElementIds.pop();
    const elements = this.yArray.toArray();
    const idx = elements.findIndex((el) => el.id === lastId);
    if (idx !== -1) {
      this.yArray.delete(idx, 1);
      this.render();
    }
  }

  clear() {
    if (confirm('Clear the entire whiteboard for everyone in the room?')) {
      this.yArray.delete(0, this.yArray.length);
      this.localElementIds = [];
      this.render();
    }
  }

  exportPNG() {
    const link = document.createElement('a');
    link.download = `whiteboard-${this.client.roomId}-${Date.now()}.png`;
    link.href = this.canvas.toDataURL('image/png');
    link.click();
  }

  updateRemotePointers(collaborators) {
    this.remotePointers = collaborators.filter(
      (c) => !c.isSelf && c.whiteboardCursor && c.whiteboardCursor.x != null
    );
    this.render();
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // Subtle dark dot grid
    this._drawGrid(ctx);

    // Draw all CRDT stored elements
    const elements = this.yArray.toArray();
    for (const el of elements) {
      this._drawElement(ctx, el);
    }

    // Draw live collaborator pointers
    this._drawRemotePointers(ctx);
  }

  _drawGrid(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    const gap = 24;
    for (let x = gap; x < this.width; x += gap) {
      for (let y = gap; y < this.height; y += gap) {
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    }
    ctx.restore();
  }

  _drawElement(ctx, el) {
    ctx.save();
    ctx.strokeStyle = el.color || '#38bdf8';
    ctx.fillStyle = el.color || '#38bdf8';
    ctx.lineWidth = el.width || 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (el.type) {
      case 'pen': {
        if (!el.points || el.points.length === 0) break;
        ctx.beginPath();
        ctx.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length; i++) {
          const xc = (el.points[i].x + el.points[i - 1].x) / 2;
          const yc = (el.points[i].y + el.points[i - 1].y) / 2;
          ctx.quadraticCurveTo(el.points[i - 1].x, el.points[i - 1].y, xc, yc);
        }
        ctx.stroke();
        break;
      }
      case 'rect': {
        const x = Math.min(el.x1, el.x2);
        const y = Math.min(el.y1, el.y2);
        const w = Math.abs(el.x2 - el.x1);
        const h = Math.abs(el.y2 - el.y1);
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, y, w, h, 6) : ctx.rect(x, y, w, h);
        if (el.fill) {
          ctx.fillStyle = el.color + '33';
          ctx.fill();
        }
        ctx.stroke();
        break;
      }
      case 'circle': {
        const rx = Math.abs(el.x2 - el.x1) / 2;
        const ry = Math.abs(el.y2 - el.y1) / 2;
        const cx = Math.min(el.x1, el.x2) + rx;
        const cy = Math.min(el.y1, el.y2) + ry;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
        if (el.fill) {
          ctx.fillStyle = el.color + '33';
          ctx.fill();
        }
        ctx.stroke();
        break;
      }
      case 'line': {
        ctx.beginPath();
        ctx.moveTo(el.x1, el.y1);
        ctx.lineTo(el.x2, el.y2);
        ctx.stroke();
        break;
      }
      case 'arrow': {
        this._drawArrow(ctx, el.x1, el.y1, el.x2, el.y2, el.width);
        break;
      }
      case 'text': {
        ctx.font = '600 16px Inter, sans-serif';
        ctx.fillText(el.text || '', el.x, el.y);
        break;
      }
    }
    ctx.restore();
  }

  _drawArrow(ctx, x1, y1, x2, y2, width) {
    const headLength = Math.max(12, width * 3);
    const angle = Math.atan2(y2 - y1, x2 - x1);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLength * Math.cos(angle - Math.PI / 6),
      y2 - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      x2 - headLength * Math.cos(angle + Math.PI / 6),
      y2 - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  }

  _drawCurrentPenPreview() {
    if (this.currentPoints.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(this.currentPoints[0].x, this.currentPoints[0].y);
    for (let i = 1; i < this.currentPoints.length; i++) {
      ctx.lineTo(this.currentPoints[i].x, this.currentPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawShapePreview(tool, x1, y1, x2, y2) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.fillStyle = this.color;
    ctx.lineWidth = this.lineWidth;
    ctx.lineCap = 'round';
    ctx.setLineDash([6, 4]); // Dashed while dragging

    if (tool === 'rect') {
      const x = Math.min(x1, x2);
      const y = Math.min(y1, y2);
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      if (this.fill) {
        ctx.fillStyle = this.color + '22';
        ctx.fill();
      }
      ctx.stroke();
    } else if (tool === 'circle') {
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      const cx = Math.min(x1, x2) + rx;
      const cy = Math.min(y1, y2) + ry;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
      if (this.fill) {
        ctx.fillStyle = this.color + '22';
        ctx.fill();
      }
      ctx.stroke();
    } else if (tool === 'line') {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    } else if (tool === 'arrow') {
      ctx.setLineDash([]);
      this._drawArrow(ctx, x1, y1, x2, y2, this.lineWidth);
    }
    ctx.restore();
  }

  _drawRemotePointers(ctx) {
    for (const peer of this.remotePointers) {
      const { x, y } = peer.whiteboardCursor;
      const color = peer.color || '#ec4899';

      ctx.save();
      // Draw cursor arrow
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 12, y + 12);
      ctx.lineTo(x + 5, y + 13);
      ctx.lineTo(x, y + 17);
      ctx.closePath();
      ctx.fill();

      // Draw username badge
      ctx.font = '600 11px Inter, sans-serif';
      const textWidth = ctx.measureText(peer.name).width;
      const boxW = textWidth + 12;
      const boxH = 18;
      const boxX = x + 12;
      const boxY = y + 8;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(boxX, boxY, boxW, boxH, 4) : ctx.rect(boxX, boxY, boxW, boxH);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(peer.name, boxX + 6, boxY + 13);
      ctx.restore();
    }
  }
}
