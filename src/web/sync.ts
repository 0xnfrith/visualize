import {
  AssetRecordType,
  createShapeId,
  type Editor,
  type TLAssetId,
  type TLImageShape,
  type TLShapeId,
} from 'tldraw';
import type { PublicEntry, ServerMessage } from '../../src/mcp/protocol.ts';

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
  const assetId = toAssetId(entry.id);
  const versionedSrc = `${entry.assetUrl}?v=${entry.version}`;

  if (editor.getShape(shapeId)) {
    // Existing — replace the asset's src so the browser refetches the new
    // bytes, then nudge the shape's w/h if the new render changed size.
    editor.updateAssets([
      {
        id: assetId,
        type: 'image',
        typeName: 'asset',
        props: {
          name: entry.title,
          src: versionedSrc,
          w: entry.size.width,
          h: entry.size.height,
          mimeType: entry.mime,
          isAnimated: false,
        },
        meta: {},
      } as never,
    ]);
    editor.updateShape({
      id: shapeId,
      type: 'image',
      x: entry.position.x,
      y: entry.position.y,
      props: { w: entry.size.width, h: entry.size.height, assetId },
    });
    return;
  }

  // New shape — create asset first, then the shape that references it.
  editor.createAssets([
    {
      id: assetId,
      type: 'image',
      typeName: 'asset',
      props: {
        name: entry.title,
        src: versionedSrc,
        w: entry.size.width,
        h: entry.size.height,
        mimeType: entry.mime,
        isAnimated: false,
      },
      meta: {},
    } as never,
  ]);
  editor.createShape<TLImageShape>({
    id: shapeId,
    type: 'image',
    x: entry.position.x,
    y: entry.position.y,
    props: { w: entry.size.width, h: entry.size.height, assetId },
  });
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

export function toAssetId(diagramId: string): TLAssetId {
  return AssetRecordType.createId(`${SHAPE_PREFIX}${diagramId}`);
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
