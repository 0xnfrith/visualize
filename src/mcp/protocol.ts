import type { RenderKind } from '../canvas/types.ts';

export interface PublicEntry {
  id: string;
  title: string;
  kind: RenderKind;
  mime: string;
  size: { width: number; height: number };
  position: { x: number; y: number };
  page: string;
  version: number;
  /** Browser fetches the rendered bytes from this URL (relative to the server). */
  assetUrl: string;
}

export type ServerMessage =
  | { type: 'full_canvas'; entries: PublicEntry[]; activeSelection: string | null }
  | { type: 'diagram_upserted'; entry: PublicEntry }
  | { type: 'diagram_removed'; id: string }
  | { type: 'focus'; id: string; padding?: number; duration?: number };

export type BrowserMessage =
  | { type: 'browser.subscribe' }
  | { type: 'browser.shape_moved'; id: string; position: { x: number; y: number } }
  | { type: 'browser.shape_removed'; id: string }
  | { type: 'browser.selection_changed'; ids: string[] };
