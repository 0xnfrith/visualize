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
  /**
   * Inline SVG markup. Present for `d2` and `svg` kinds; the browser injects
   * it into the DOM so tldraw's `.tl-theme__dark` class scopes through to the
   * diagram's CSS. Absent for `image` kind (use `assetUrl` instead).
   */
  svgText?: string;
  /**
   * URL to fetch rendered bytes from. Present only for `image` kind — binary
   * raster content can't be cleanly inlined into JSON. Relative to the server.
   */
  assetUrl?: string;
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
