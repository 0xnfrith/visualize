import type { Editor, TLShape } from 'tldraw';
import type { BrowserMessage } from '../../src/mcp/protocol.ts';
import { fromShapeId } from './sync.ts';

const POSITION_DEBOUNCE_MS = 250;
const SELECTION_DEBOUNCE_MS = 150;

export function attachOperatorListeners(editor: Editor, socket: WebSocket): () => void {
  const send = (msg: BrowserMessage) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(msg));
  };

  // Position changes — debounce per shape so a mid-drag burst collapses to
  // one event with the final coords. Server already coalesces at 500ms, but
  // doing the first reduction client-side keeps WS traffic sane.
  const pendingMoves = new Map<string, ReturnType<typeof setTimeout>>();
  const lastSeen = new Map<string, { x: number; y: number }>();

  const unsubStore = editor.store.listen(
    ev => {
      for (const [from, to] of Object.values(ev.changes.updated) as [TLShape, TLShape][]) {
        if (to.typeName !== 'shape') continue;
        const diagramId = fromShapeId(to.id);
        if (!diagramId) continue;
        if (from.x === to.x && from.y === to.y) continue;

        lastSeen.set(diagramId, { x: to.x, y: to.y });
        const prev = pendingMoves.get(diagramId);
        if (prev) clearTimeout(prev);
        pendingMoves.set(
          diagramId,
          setTimeout(() => {
            pendingMoves.delete(diagramId);
            const pos = lastSeen.get(diagramId);
            if (!pos) return;
            send({ type: 'browser.shape_moved', id: diagramId, position: pos });
          }, POSITION_DEBOUNCE_MS)
        );
      }

      for (const removed of Object.values(ev.changes.removed) as TLShape[]) {
        if (removed.typeName !== 'shape') continue;
        const diagramId = fromShapeId(removed.id);
        if (!diagramId) continue;
        send({ type: 'browser.shape_removed', id: diagramId });
      }
    },
    { source: 'user', scope: 'document' }
  );

  // Selection changes — separate path because they live in session state,
  // not the document store. Debounce to absorb click-drag-release bursts.
  let selectionTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSelection: string = '';
  const reactSelection = () => {
    const ids = editor
      .getSelectedShapeIds()
      .map(id => fromShapeId(id))
      .filter((id): id is string => id !== null);
    const key = ids.sort().join(',');
    if (key === lastSelection) return;
    lastSelection = key;
    send({ type: 'browser.selection_changed', ids });
  };

  const unsubSession = editor.store.listen(
    () => {
      if (selectionTimer) return;
      selectionTimer = setTimeout(() => {
        selectionTimer = null;
        reactSelection();
      }, SELECTION_DEBOUNCE_MS);
    },
    { scope: 'session' }
  );

  return () => {
    unsubStore();
    unsubSession();
    for (const t of pendingMoves.values()) clearTimeout(t);
    if (selectionTimer) clearTimeout(selectionTimer);
  };
}
