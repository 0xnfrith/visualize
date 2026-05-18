import type { ServerWebSocket } from 'bun';
import type { ChannelEmitter } from '../mcp/channel.ts';
import type { ServerMessage } from '../mcp/protocol.ts';
import type {
  Entry,
  OperatorEvent,
  Point,
  RenderKind,
  Size,
  UpsertInput,
} from './types.ts';

export type BrowserSocket = ServerWebSocket<unknown>;

const GRID_COLS = 3;
const GRID_GUTTER = 80;
const DEFAULT_PAGE = 'page:main';

export class CanvasIndex {
  private readonly entries = new Map<string, Entry>();
  private readonly browsers = new Set<BrowserSocket>();
  private activeSelection: string | null = null;
  private placementCol = 0;
  private placementRow = 0;
  private idCounter = 0;
  private channel: ChannelEmitter | null = null;

  setChannel(channel: ChannelEmitter): void {
    this.channel = channel;
  }

  upsert(
    input: UpsertInput,
    bytes: Uint8Array,
    mime: string,
    intrinsicSize: Size
  ): Entry {
    const now = Date.now();
    const existing = input.id ? this.entries.get(input.id) : undefined;

    if (existing) {
      // Update: preserve operator's drag position and size unless caller
      // explicitly overrides. Re-snapping to grid on every redraw would
      // undo the operator's arrangement.
      const next: Entry = {
        ...existing,
        title: input.title ?? existing.title,
        spec: input.spec,
        bytes,
        mime,
        size: input.size ?? existing.size,
        position: input.position ?? existing.position,
        page: input.page ?? existing.page,
        version: existing.version + 1,
        updatedAt: now,
      };
      this.entries.set(next.id, next);
      this.broadcast({ type: 'diagram_upserted', entry: toPublic(next) });
      return next;
    }

    // Create. Assign id if absent. Auto-place via grid cursor if no position
    // supplied. Log if a caller passed an id we didn't recognize — that's a
    // contract surprise worth surfacing. (The previous `input.id !== id`
    // check was unreachable because `id` is derived from `input.id ?? ...`;
    // compare against the entry map directly instead.)
    if (input.id !== undefined && !this.entries.has(input.id)) {
      console.warn(
        `[visualize] draw() called with id=${input.id} which doesn't exist; creating new`
      );
    }
    const id = input.id ?? this.allocateId(input.spec.kind);
    const position = input.position ?? this.nextGridSlot(intrinsicSize);
    const entry: Entry = {
      id,
      title: input.title ?? id,
      spec: input.spec,
      bytes,
      mime,
      size: input.size ?? intrinsicSize,
      position,
      page: input.page ?? DEFAULT_PAGE,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(id, entry);
    this.broadcast({ type: 'diagram_upserted', entry: toPublic(entry) });
    return entry;
  }

  remove(id: string): boolean {
    const existing = this.entries.get(id);
    if (!existing) return false;
    this.entries.delete(id);
    if (this.activeSelection === id) this.activeSelection = null;
    this.broadcast({ type: 'diagram_removed', id });
    this.emitOperatorEvent({ type: 'removed', id, title: existing.title });
    return true;
  }

  get(id: string): Entry | null {
    return this.entries.get(id) ?? null;
  }

  list(): Entry[] {
    return [...this.entries.values()];
  }

  updatePosition(id: string, position: Point): boolean {
    const existing = this.entries.get(id);
    if (!existing) return false;
    if (existing.position.x === position.x && existing.position.y === position.y) {
      return true;
    }
    const from = existing.position;
    const updated: Entry = { ...existing, position, updatedAt: Date.now() };
    this.entries.set(id, updated);
    this.emitOperatorEvent({ type: 'moved', id, from, to: position });
    return true;
  }

  setActiveSelection(ids: string[]): void {
    const id = ids.length > 0 ? ids[0]! : null;
    if (id === this.activeSelection) return;
    this.activeSelection = id;
    this.emitOperatorEvent({ type: 'selected', ids });
  }

  getActiveSelection(): Entry | null {
    return this.activeSelection ? this.entries.get(this.activeSelection) ?? null : null;
  }

  focus(id: string, padding?: number, duration?: number): void {
    if (!this.entries.has(id)) return;
    this.broadcast({ type: 'focus', id, padding, duration });
  }

  addBrowser(ws: BrowserSocket): void {
    this.browsers.add(ws);
    this.send(ws, {
      type: 'full_canvas',
      entries: this.list().map(toPublic),
      activeSelection: this.activeSelection,
    });
  }

  removeBrowser(ws: BrowserSocket): void {
    this.browsers.delete(ws);
  }

  private nextGridSlot(size: Size): Point {
    const cellWidth = Math.max(size.width, 400);
    const cellHeight = Math.max(size.height, 300);
    const x = this.placementCol * (cellWidth + GRID_GUTTER);
    const y = this.placementRow * (cellHeight + GRID_GUTTER);
    this.placementCol += 1;
    if (this.placementCol >= GRID_COLS) {
      this.placementCol = 0;
      this.placementRow += 1;
    }
    return { x, y };
  }

  private allocateId(kind: RenderKind): string {
    this.idCounter += 1;
    return `${kind}-${this.idCounter.toString(36).padStart(3, '0')}`;
  }

  private broadcast(msg: ServerMessage): void {
    for (const ws of this.browsers) this.send(ws, msg);
  }

  private send(ws: BrowserSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      // The socket is dead — keeping it in the set means every future
      // broadcast logs the same error. Drop it so we stop spamming.
      console.error('[visualize] ws send failed, removing browser:', err);
      this.browsers.delete(ws);
    }
  }

  private emitOperatorEvent(event: OperatorEvent): void {
    this.channel?.push(event);
  }
}

function toPublic(entry: Entry): import('../mcp/protocol.ts').PublicEntry {
  // SVG-shaped content (d2 + raw svg) is inlined into the WS message so the
  // browser can drop the markup into the DOM, where tldraw's theme class
  // scopes through. Raster image content stays behind a URL.
  const payload: import('../mcp/protocol.ts').PublicPayload =
    entry.spec.kind === 'd2' || entry.spec.kind === 'svg'
      ? { kind: 'svg', svgText: new TextDecoder().decode(entry.bytes) }
      : { kind: 'image', assetUrl: `/diagrams/${encodeURIComponent(entry.id)}` };
  return {
    id: entry.id,
    title: entry.title,
    mime: entry.mime,
    size: entry.size,
    position: entry.position,
    page: entry.page,
    version: entry.version,
    payload,
  };
}
