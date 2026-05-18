import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { OperatorEvent } from '../canvas/types.ts';

/**
 * Buffer operator-originated events and ship a single semantic summary to
 * Claude over the experimental `claude/channel/message` MCP notification.
 *
 * Coalescing keeps a rapid drag (which can fire dozens of position events
 * per second) from flooding the session with raw deltas. The summary
 * Claude receives reads like "Operator moved 2 diagrams. Call get_canvas
 * to see the current state."
 */
const COALESCE_MS = 500;

export class ChannelEmitter {
  private buffer: OperatorEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly server: Server) {}

  push(event: OperatorEvent): void {
    this.buffer.push(event);
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), COALESCE_MS);
  }

  private flush(): void {
    this.timer = null;
    if (this.buffer.length === 0) return;
    const summary = summarize(this.buffer);
    this.buffer = [];

    void this.server
      .notification({
        method: 'claude/channel/message',
        params: { source: 'visualize', text: summary },
      })
      .catch((err: unknown) => {
        if (process.env.VISUALIZE_DEBUG) {
          console.error('[visualize] channel notify failed:', err);
        }
      });
  }
}

function summarize(events: OperatorEvent[]): string {
  const counts = { moved: 0, removed: 0, selected: 0 };
  const movedIds = new Set<string>();
  const removedTitles: string[] = [];
  let lastSelection: string[] = [];
  for (const e of events) {
    counts[e.type]++;
    if (e.type === 'moved') movedIds.add(e.id);
    if (e.type === 'removed') removedTitles.push(e.title);
    if (e.type === 'selected') lastSelection = e.ids;
  }

  const parts: string[] = [];
  if (movedIds.size) parts.push(`moved ${movedIds.size} diagram${s(movedIds.size)}`);
  if (counts.removed) {
    parts.push(
      `removed ${counts.removed} diagram${s(counts.removed)} (${removedTitles
        .slice(0, 3)
        .map(t => `"${t}"`)
        .join(', ')}${removedTitles.length > 3 ? '…' : ''})`
    );
  }
  if (counts.selected) {
    const sel = lastSelection.length;
    parts.push(
      sel === 0
        ? 'cleared selection'
        : sel === 1
          ? `selected "${lastSelection[0]}"`
          : `selected ${sel} diagrams`
    );
  }

  if (parts.length === 0) return 'Operator made changes to the canvas.';
  return `Operator ${parts.join(', ')}. Call get_canvas to see current state, or get_active_selection for the focused diagram.`;
}

function s(n: number): string {
  return n === 1 ? '' : 's';
}
