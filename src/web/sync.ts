import {
  createShapeId,
  type Editor,
  type TLShapeId,
} from 'tldraw';
import type { PublicEntry, ServerMessage } from '../../src/mcp/protocol.ts';
import type { DiagramContent, DiagramShape } from './diagram-shape.tsx';

const SHAPE_PREFIX = 'diagram-';

export function connectSocket(editor: Editor): WebSocket {
  const url = new URL('/ws', location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'browser.subscribe' }));
  });

  socket.addEventListener('message', ev => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(ev.data)) as ServerMessage;
    } catch (err) {
      console.error('[visualize] bad ws message:', err);
      return;
    }
    apply(editor, msg);
  });

  socket.addEventListener('close', () => {
    // No auto-reconnect for v0. Operator can refresh; the full_canvas
    // message on resubscribe rebuilds local state from scratch.
    console.warn('[visualize] websocket closed');
  });

  return socket;
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
  const props = {
    w: entry.size.width,
    h: entry.size.height,
    version: entry.version,
    content,
  };

  if (editor.getShape(shapeId)) {
    editor.updateShape<DiagramShape>({
      id: shapeId,
      type: 'diagram',
      x: entry.position.x,
      y: entry.position.y,
      props,
    });
    return;
  }

  editor.createShape<DiagramShape>({
    id: shapeId,
    type: 'diagram',
    x: entry.position.x,
    y: entry.position.y,
    props,
  });
}

function entryToContent(entry: PublicEntry): DiagramContent {
  if (entry.svgText != null) {
    return { kind: 'svg', text: entry.svgText };
  }
  // Image kind: server didn't inline SVG, fall back to URL fetch.
  return { kind: 'image', url: entry.assetUrl ?? '' };
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
