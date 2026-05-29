import type { Editor } from 'tldraw';
import type { SocketHandle } from '../sync.ts';
import { selectedSnapshot, serializeWorkflow } from './serialize.ts';

const DEBOUNCE_MS = 250;

/**
 * Push the operator's currently-SELECTED workflow subgraph to the server
 * whenever the selection or a `wf-*` shape changes. Mirrors the debounce +
 * dedupe-by-key + re-send-on-reconnect pattern in `attachOperatorListeners`
 * (operator.ts). The server fills hints on read; we send only nodes+edges.
 */
export function attachWorkflowSerializer(editor: Editor, socket: SocketHandle): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastKey = '';

  const recompute = () => {
    const graph = serializeWorkflow(selectedSnapshot(editor));
    const key = JSON.stringify(graph);
    if (key === lastKey) return; // nothing meaningful changed
    lastKey = key;
    socket.send(JSON.stringify({ type: 'browser.workflow_changed', graph }));
  };

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      recompute();
    }, DEBOUNCE_MS);
  };

  // One all-scope listener catches both selection (session) and wf-* edits
  // (document). The dedupe-by-key guard makes camera/pointer churn a no-op.
  const unsubStore = editor.store.listen(() => schedule());

  // Re-send on every (re)connect so the server snapshot survives reconnects —
  // the same reason operator.ts re-sends theme on open.
  const unsubOpen = socket.onOpen(() => {
    lastKey = '';
    recompute();
  });

  return () => {
    if (timer) clearTimeout(timer);
    unsubStore();
    unsubOpen();
  };
}
