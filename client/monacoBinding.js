/**
 * Binds Monaco Editor with Yjs Y.Text and renders remote cursors via Awareness.
 */
export class MonacoBinding {
  /**
   * @param {import('yjs').Text} yText
   * @param {any} monacoEditor
   * @param {any} monacoNamespace
   * @param {import('./crdtClient.js').CRDTClient} crdtClient
   */
  constructor(yText, monacoEditor, monacoNamespace, crdtClient) {
    this.yText = yText;
    this.editor = monacoEditor;
    this.monaco = monacoNamespace;
    this.client = crdtClient;
    this.model = monacoEditor.getModel();

    this.isApplyingRemote = false;
    this.remoteDecorations = new Map(); // clientId -> decorationIds[]

    this._initContent();
    this._bindEvents();
  }

  _initContent() {
    const initialText = this.yText.toString();
    if (this.model.getValue() !== initialText) {
      this.model.setValue(initialText);
    }
  }

  _bindEvents() {
    // 1. Monaco -> Yjs
    this.contentChangeDisposable = this.model.onDidChangeContent((event) => {
      if (this.isApplyingRemote) return;

      this.yText.doc.transact(() => {
        // Apply changes in reverse order to preserve offsets
        const changes = [...event.changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
        for (const change of changes) {
          this.yText.delete(change.rangeOffset, change.rangeLength);
          if (change.text.length > 0) {
            this.yText.insert(change.rangeOffset, change.text);
          }
        }
      }, 'monaco-local');
    });

    // 2. Yjs -> Monaco
    this.yTextObserver = (event) => {
      if (event.transaction.origin === 'monaco-local') return;

      this.isApplyingRemote = true;
      try {
        if (this.model.getValue() === '' && this.yText.length > 0) {
          this.model.setValue(this.yText.toString());
          return;
        }
        let index = 0;
        for (const delta of event.delta) {
          if (delta.retain !== undefined) {
            index += delta.retain;
          } else if (delta.insert !== undefined) {
            const startPos = this.model.getPositionAt(index);
            const range = new this.monaco.Range(
              startPos.lineNumber,
              startPos.column,
              startPos.lineNumber,
              startPos.column
            );
            this.model.applyEdits([{ range, text: delta.insert, forceMoveMarkers: true }]);
            index += delta.insert.length;
          } else if (delta.delete !== undefined) {
            const startPos = this.model.getPositionAt(index);
            const endPos = this.model.getPositionAt(index + delta.delete);
            const range = new this.monaco.Range(
              startPos.lineNumber,
              startPos.column,
              endPos.lineNumber,
              endPos.column
            );
            this.model.applyEdits([{ range, text: '', forceMoveMarkers: true }]);
          }
        }
      } finally {
        this.isApplyingRemote = false;
      }
    };
    this.yText.observe(this.yTextObserver);

    // 3. Local cursor change -> Awareness
    this.cursorDisposable = this.editor.onDidChangeCursorPosition((e) => {
      const position = e.position;
      const selection = this.editor.getSelection();
      this.client.setCursor({
        lineNumber: position.lineNumber,
        column: position.column,
        selection: selection
          ? {
              startLineNumber: selection.startLineNumber,
              startColumn: selection.startColumn,
              endLineNumber: selection.endLineNumber,
              endColumn: selection.endColumn,
            }
          : null,
      });
    });

    this.selectionDisposable = this.editor.onDidChangeCursorSelection((e) => {
      const selection = e.selection;
      const position = this.editor.getPosition();
      this.client.setCursor({
        lineNumber: position ? position.lineNumber : 1,
        column: position ? position.column : 1,
        selection: {
          startLineNumber: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLineNumber: selection.endLineNumber,
          endColumn: selection.endColumn,
        },
      });
    });
  }

  /**
   * Update remote cursor and selection decorations from awareness list.
   *
   * @param {Array<{ clientId: number, name: string, color: string, isSelf: boolean, cursor: any }>} collaborators
   */
  updateRemoteCursors(collaborators) {
    const activeClientIds = new Set();

    for (const peer of collaborators) {
      if (peer.isSelf || !peer.cursor) continue;
      activeClientIds.add(peer.clientId);

      const oldDecs = this.remoteDecorations.get(peer.clientId) || [];
      const newDecs = [];

      const { lineNumber, column, selection } = peer.cursor;

      // 1. Cursor line & tooltip decoration
      this._ensureUserColorStyle(peer.clientId, peer.color, peer.name);

      newDecs.push({
        range: new this.monaco.Range(lineNumber, column, lineNumber, column),
        options: {
          className: `remote-cursor-line remote-cursor-${peer.clientId}`,
          hoverMessage: { value: `**${peer.name}** is editing here` },
          before: {
            content: `\u00A0${peer.name}\u00A0`,
            inlineClassName: `remote-cursor-tag remote-cursor-tag-${peer.clientId}`,
          },
        },
      });

      // 2. Selection highlight if selection spans range
      if (
        selection &&
        (selection.startLineNumber !== selection.endLineNumber ||
          selection.startColumn !== selection.endColumn)
      ) {
        newDecs.push({
          range: new this.monaco.Range(
            selection.startLineNumber,
            selection.startColumn,
            selection.endLineNumber,
            selection.endColumn
          ),
          options: {
            className: `remote-selection remote-selection-${peer.clientId}`,
            hoverMessage: { value: `Selected by **${peer.name}**` },
          },
        });
      }

      const applied = this.editor.deltaDecorations(oldDecs, newDecs);
      this.remoteDecorations.set(peer.clientId, applied);
    }

    // Clean up disconnected peers
    for (const [clientId, oldDecs] of this.remoteDecorations.entries()) {
      if (!activeClientIds.has(clientId)) {
        this.editor.deltaDecorations(oldDecs, []);
        this.remoteDecorations.delete(clientId);
      }
    }
  }

  _ensureUserColorStyle(clientId, color, name) {
    const styleId = `style-cursor-${clientId}`;
    let styleEl = document.getElementById(styleId);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    styleEl.textContent = `
      .remote-cursor-${clientId} {
        border-left: 2px solid ${color} !important;
        position: relative;
      }
      .remote-cursor-tag-${clientId} {
        background-color: ${color} !important;
        color: #ffffff !important;
        font-size: 10px !important;
        font-weight: 600 !important;
        border-radius: 3px !important;
        position: relative !important;
        top: -14px !important;
        left: -2px !important;
        pointer-events: none !important;
        white-space: nowrap !important;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3) !important;
      }
      .remote-selection-${clientId} {
        background-color: ${color}33 !important;
      }
    `;
  }

  destroy() {
    if (this.contentChangeDisposable) this.contentChangeDisposable.dispose();
    if (this.cursorDisposable) this.cursorDisposable.dispose();
    if (this.selectionDisposable) this.selectionDisposable.dispose();
    if (this.yTextObserver) this.yText.unobserve(this.yTextObserver);

    for (const oldDecs of this.remoteDecorations.values()) {
      this.editor.deltaDecorations(oldDecs, []);
    }
    this.remoteDecorations.clear();
  }
}
