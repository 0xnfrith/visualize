import type { CanvasIndex } from '../canvas/index.ts';
import type { RenderSpec } from '../canvas/types.ts';
import { render } from '../renderers/registry.ts';

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: any) => Promise<unknown>;
}

const D2_LAYOUTS = ['dagre', 'elk', 'tala'] as const;

export function buildTools(
  canvas: CanvasIndex,
  boardUrl: string,
  sessionId: string,
  port: number
): ToolDescriptor[] {
  return [
    {
      name: 'get_board_url',
      description:
        'Return the URL of the visual canvas for this session. Useful at session start, or whenever the operator asks where the board is.',
      inputSchema: { type: 'object', properties: {} },
      async handler() {
        return { url: boardUrl, session_id: sessionId, port };
      },
    },

    {
      name: 'draw',
      description:
        'Create or replace a diagram on the canvas. Provide `id` to replace an existing diagram (preserves position & size); omit for a new one (auto-placed on a grid). Pick `spec.kind` based on what you want to render:\n' +
        '- `d2` — the default and best choice for most diagrams. Flow, topology, C4 with nested containers (`{ ... }`), sequence (`shape: sequence_diagram`), ER (`shape: sql_table` + column-level FK arrows), UML class (`shape: class`). Pass optional `layout` (`dagre` for clean acyclic flows; `elk` for graphs with cycles, feedback edges, or dense relationships; `tala` for the premium engine if installed).\n' +
        '- `svg` — paste raw SVG markup for diagrams you generate yourself or pull from elsewhere.\n' +
        '- `image` — fetch a PNG/JPEG by https URL.\n\n' +
        'Validation errors come back as `{ ok: false, error: { messages: [{ line, column, text }] } }` — fix the source and call draw again. The render bytes are never returned to you (they go straight to the browser); you get back the id, position, size, and byte count.',
      inputSchema: {
        type: 'object',
        required: ['spec'],
        properties: {
          id: {
            type: 'string',
            description:
              'Optional. Provide to replace an existing diagram. If the id does not exist, a new diagram is created with that id (warning is logged).',
          },
          title: {
            type: 'string',
            description: 'Human-readable label. Defaults to the id.',
          },
          spec: {
            oneOf: [
              {
                type: 'object',
                required: ['kind', 'source'],
                properties: {
                  kind: { const: 'd2' },
                  source: { type: 'string', description: 'D2 source code.' },
                  layout: {
                    enum: D2_LAYOUTS,
                    description:
                      'D2 layout engine. `dagre` (default) for clean acyclic flows; `elk` for cycles / feedback edges; `tala` if installed.',
                  },
                },
              },
              {
                type: 'object',
                required: ['kind', 'source'],
                properties: {
                  kind: { const: 'svg' },
                  source: { type: 'string', description: 'Raw SVG markup.' },
                },
              },
              {
                type: 'object',
                required: ['kind', 'url', 'mime'],
                properties: {
                  kind: { const: 'image' },
                  url: { type: 'string', format: 'uri' },
                  mime: { enum: ['image/png', 'image/jpeg'] },
                },
              },
            ],
          },
          page: {
            type: 'string',
            description: 'tldraw page id. Defaults to the main page.',
          },
          position: {
            type: 'object',
            required: ['x', 'y'],
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
            },
            description:
              'Optional. Explicit canvas position. Omit to auto-place on a grid for new diagrams; updates preserve the existing position.',
          },
          size: {
            type: 'object',
            required: ['width', 'height'],
            properties: {
              width: { type: 'number' },
              height: { type: 'number' },
            },
            description: "Optional. Override the diagram's intrinsic size.",
          },
        },
      },
      async handler(args: {
        id?: string;
        title?: string;
        spec: RenderSpec;
        page?: string;
        position?: { x: number; y: number };
        size?: { width: number; height: number };
      }) {
        const result = await render(args.spec);
        if (!result.ok) {
          return { ok: false, error: result.error };
        }
        const entry = canvas.upsert(
          {
            id: args.id,
            title: args.title,
            spec: args.spec,
            page: args.page,
            position: args.position,
            size: args.size,
          },
          result.bytes,
          result.mime,
          result.size
        );
        return {
          ok: true,
          id: entry.id,
          page: entry.page,
          position: entry.position,
          size: entry.size,
          version: entry.version,
          bytes: result.bytes.length,
        };
      },
    },

    {
      name: 'remove',
      description: 'Remove a diagram from the canvas by id.',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      async handler(args: { id: string }) {
        const removed = canvas.remove(args.id);
        return { ok: removed };
      },
    },

    {
      name: 'get_canvas',
      description:
        'List every diagram currently on the canvas — id, title, kind, position, size, page, version. Does NOT return the rendered bytes (the browser fetches those directly); use this to enumerate what is on the board. Also returns the operator\'s active selection.',
      inputSchema: { type: 'object', properties: {} },
      async handler() {
        const entries = canvas.list().map(e => ({
          id: e.id,
          title: e.title,
          kind: e.spec.kind,
          mime: e.mime,
          size: e.size,
          position: e.position,
          page: e.page,
          version: e.version,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
        }));
        const selected = canvas.getActiveSelection();
        return {
          entries,
          activeSelection: selected ? selected.id : null,
        };
      },
    },

    {
      name: 'get_active_selection',
      description:
        'Return the diagram the operator currently has selected on the canvas — id, title, full spec (including the original source the operator is pointing at), position, size. Returns null if nothing is selected. Use this when the operator asks you to refine or update "this" diagram; the returned source is what you should base your update on.',
      inputSchema: { type: 'object', properties: {} },
      async handler() {
        const entry = canvas.getActiveSelection();
        if (!entry) return { selected: null };
        return {
          selected: {
            id: entry.id,
            title: entry.title,
            spec: entry.spec,
            position: entry.position,
            size: entry.size,
            page: entry.page,
            version: entry.version,
          },
        };
      },
    },

    {
      name: 'focus',
      description:
        "Pan and zoom the operator's viewport to a diagram. Useful after drawing something new, or to direct attention back to one you want to discuss. Fire-and-forget — affects only currently-connected browser tabs.",
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          padding: {
            type: 'number',
            description: 'Viewport padding around the diagram. Default 0.1.',
          },
          duration: {
            type: 'number',
            description: 'Animation duration in ms. Default 400.',
          },
        },
      },
      async handler(args: { id: string; padding?: number; duration?: number }) {
        canvas.focus(args.id, args.padding, args.duration);
        return { ok: true, focused: args.id };
      },
    },
  ];
}
