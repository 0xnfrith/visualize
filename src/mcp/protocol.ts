/**
 * Payload variants the server sends per entry.
 *
 * `svg`: inline SVG markup. The browser injects it into the DOM. The agent
 *   is responsible for authoring colors that match the operator's current
 *   canvas theme (read via `get_board_url`); diagrams are rendered once and
 *   do not re-theme on operator theme flips.
 * `image`: URL to fetch rendered bytes from. Raster content can't be
 *   cleanly inlined into JSON.
 *
 * Discriminated on `kind` so `payload` and the visible payload field are
 * always in sync; the compiler enforces "exactly one of" by construction.
 */
export type PublicPayload =
  | { kind: 'svg'; svgText: string }
  | { kind: 'image'; assetUrl: string };

export interface PublicEntry {
  id: string;
  title: string;
  mime: string;
  size: { width: number; height: number };
  position: { x: number; y: number };
  page: string;
  version: number;
  payload: PublicPayload;
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
  | { type: 'browser.selection_changed'; ids: string[] }
  | { type: 'browser.theme_changed'; theme: 'light' | 'dark' };
