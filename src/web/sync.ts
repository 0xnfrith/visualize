import {
  createShapeId,
  type Editor,
  type TLShapeId,
} from 'tldraw';
import type { PublicEntry, ServerMessage } from '../../src/mcp/protocol.ts';
import type { DiagramShape } from './diagram-shape.tsx';
import { payloadToContent, type DiagramContent } from './payload-utils.ts';

const SHAPE_PREFIX = 'diagram-';

// Exponential backoff for reconnect: 500ms, 1s, 2s, 4s, capped at 8s.
const RECONNECT_BASE_MS = 500;
const RECONNECT_CAP_MS = 8000;

export interface SocketHandle {
  /** Stop reconnecting and close whichever socket is current. */
  close: () => void;
  /** Send to the current socket; no-op when disconnected. */
  send: (msg: string) => void;
}

/**
 * Open a self-reconnecting WebSocket. Returns a handle whose `close()` stops
 * the reconnect chain — the raw socket isn't exposed because reconnect swaps
 * the underlying instance and any external reference would dangle.
 */
export function connectSocket(editor: Editor): SocketHandle {
  let current: WebSocket | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let attempt = 0;

  const open = () => {
    if (stopped) return;
    const url = new URL('/ws', location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    current = socket;

    socket.addEventListener('open', () => {
      // Reset backoff on every successful connect — a session with occasional
      // drops shouldn't permanently climb to the 8s cap.
      attempt = 0;
      socket.send(JSON.stringify({ type: 'browser.subscribe' }));
    });

    socket.addEventListener('message', ev => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch (err) {
        console.error(
          '[visualize] bad ws message:',
          err,
          '\n  payload:',
          String(ev.data).slice(0, 500)
        );
        return;
      }
      try {
        apply(editor, msg);
      } catch (err) {
        // Don't let one bad entry kill the socket — log loudly and keep going.
        console.error('[visualize] failed to apply ws message:', err, msg);
      }
    });

    socket.addEventListener('close', () => {
      if (stopped) return;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_CAP_MS);
      attempt++;
      console.warn(`[visualize] websocket closed; reconnecting in ${delay}ms`);
      timeoutId = setTimeout(open, delay);
    });
  };

  open();

  return {
    close: () => {
      stopped = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      current?.close();
    },
    send: (msg: string) => {
      if (current?.readyState === WebSocket.OPEN) current.send(msg);
    },
  };
}

function apply(editor: Editor, msg: ServerMessage): void {
  switch (msg.type) {
    case 'full_canvas':
      replaceAll(editor, msg.entries);
      return;
    case 'diagram_upserted':
      upsertOne(editor, msg.entry);
      return;
    case 'diagram_removed':
      removeOne(editor, msg.id);
      return;
    case 'focus':
      focusOne(editor, msg.id, msg.padding, msg.duration);
      return;
  }
}

function replaceAll(editor: Editor, entries: PublicEntry[]): void {
  const existing = ourShapeIds(editor);
  if (existing.length > 0) editor.deleteShapes(existing);
  for (const entry of entries) upsertOne(editor, entry);
}

function upsertOne(editor: Editor, entry: PublicEntry): void {
  const shapeId = toShapeId(entry.id);
  const content = entryToContent(entry);

  if (editor.getShape<DiagramShape>(shapeId)) {
    // Preserve the operator's manual resize. After first create, the client's
    // w/h wins — re-running the same source won't snap the shape back to the
    // server's natural size. If a source edit grows the diagram beyond the
    // resized box, the operator can delete + redraw to reset.
    editor.updateShape<DiagramShape>({
      id: shapeId,
      type: 'diagram',
      x: entry.position.x,
      y: entry.position.y,
      props: { version: entry.version, content },
    });
    return;
  }

  editor.createShape<DiagramShape>({
    id: shapeId,
    type: 'diagram',
    x: entry.position.x,
    y: entry.position.y,
    props: {
      w: entry.size.width,
      h: entry.size.height,
      version: entry.version,
      content,
    },
  });
}

/**
 * Server boundary. Discriminator validation + sanitization live in
 * `payload-utils.ts` so they're testable without a DOM; this just plumbs
 * in the browser-only `sanitizeSvg`.
 */
function entryToContent(entry: PublicEntry): DiagramContent {
  return payloadToContent(entry.payload, entry.id, sanitizeSvg);
}

/**
 * Defense-in-depth: removes obvious XSS vectors (`<script>`, `on*` handler
 * attrs) from SVG markup before injecting into the DOM. NOT a full sanitizer
 * — SVG XSS can also ride `<a xlink:href="javascript:...">`, `<foreignObject>`
 * HTML, `<style>` with `url(javascript:...)`, and `<use href="data:...">`.
 * For this localhost dev tool the trust boundary is the operator (they
 * authored the source); this pass exists so a future remote-canvas mode
 * doesn't ship a wide-open injection surface.
 */
function sanitizeSvg(svgText: string): string {
  if (svgText === '') return '';
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.querySelector('parsererror') !== null) {
    console.warn('[visualize] malformed SVG dropped at sanitize boundary');
    return '';
  }
  doc.querySelectorAll('script').forEach(n => n.remove());
  doc.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      // javascript: URLs in hrefs (covers href and xlink:href).
      if (
        (name === 'href' || name === 'xlink:href') &&
        attr.value.trim().toLowerCase().startsWith('javascript:')
      ) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return new XMLSerializer().serializeToString(doc);
}

function removeOne(editor: Editor, id: string): void {
  const shapeId = toShapeId(id);
  if (editor.getShape(shapeId)) editor.deleteShapes([shapeId]);
}

function focusOne(editor: Editor, id: string, padding?: number, duration?: number): void {
  const shape = editor.getShape(toShapeId(id));
  if (!shape) return;
  const bounds = editor.getShapePageBounds(shape);
  if (!bounds) return;
  editor.zoomToBounds(bounds, {
    inset: (padding ?? 0.1) * Math.min(bounds.width, bounds.height),
    animation: { duration: duration ?? 400 },
  });
}

export function toShapeId(diagramId: string): TLShapeId {
  return createShapeId(`${SHAPE_PREFIX}${diagramId}`);
}

export function fromShapeId(shapeId: TLShapeId): string | null {
  const raw = String(shapeId);
  // tldraw shape ids look like "shape:<our-id>" — strip the prefix and then
  // our SHAPE_PREFIX to get back the entry id.
  const m = /^shape:(.+)$/.exec(raw);
  if (!m) return null;
  if (!m[1]!.startsWith(SHAPE_PREFIX)) return null;
  return m[1]!.slice(SHAPE_PREFIX.length);
}

function ourShapeIds(editor: Editor): TLShapeId[] {
  return editor
    .getCurrentPageShapeIds()
    .values()
    .toArray()
    .filter(id => fromShapeId(id) !== null);
}
