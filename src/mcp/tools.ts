import type { CanvasIndex } from '../canvas/index.ts';
import type { RenderSpec } from '../canvas/types.ts';
import { computeHints, type WorkflowGraph } from '../canvas/workflow.ts';
import { render } from '../renderers/registry.ts';

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: any) => Promise<unknown>;
}

/**
 * The single source of truth for what a workflow read returns — used by BOTH
 * the `get_workflow` tool and the `visualize://workflow` MCP resource so their
 * payloads can't drift. Returns the operator's currently-selected graph with
 * server-computed `hints` filled in, or null when nothing is selected.
 */
export function buildWorkflowPayload(canvas: CanvasIndex): WorkflowGraph | null {
  const graph = canvas.getWorkflow();
  if (!graph) return null;
  return { ...graph, hints: computeHints(graph) };
}

export function buildTools(
  canvas: CanvasIndex,
  boardUrl: string,
  sessionId: string,
  port: number,
  getTheme: () => 'light' | 'dark'
): ToolDescriptor[] {
  return [
    {
      name: 'get_board_url',
      description:
        "Return the URL of the visual canvas for this session plus the operator's current canvas theme (`light` | `dark`). Useful at session start, or whenever the operator asks where the board is. Use the returned `theme` to inform your D2 `vars.d2-config.theme-id` choice so the diagram contrasts with the canvas background.",
      inputSchema: { type: 'object', properties: {} },
      async handler() {
        return { url: boardUrl, session_id: sessionId, port, theme: getTheme() };
      },
    },

    {
      name: 'draw',
      description:
        'Create or replace a diagram on the canvas. Provide `id` to replace an existing diagram (preserves position & size); omit for a new one (auto-placed on a grid). Pick `spec.kind` based on what you want to render:\n' +
        '- `d2` — the default and best choice for most diagrams. Flow, topology, C4 with nested containers (`{ ... }`), sequence (`shape: sequence_diagram`), ER (`shape: sql_table` + column-level FK arrows), UML class (`shape: class`). Configure theme, layout engine, and palette overrides INSIDE the D2 source via `vars: { d2-config: { theme-id: ..., layout-engine: ..., theme-overrides: { ... } } }` — there are no separate params on this tool. Read the operator\'s canvas theme from `get_board_url` and pick a `theme-id` that contrasts with it.\n' +
        '- `svg` — paste raw SVG markup for diagrams you generate yourself or pull from elsewhere. Pick colors that contrast with the canvas theme from `get_board_url`.\n' +
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
                  source: {
                    type: 'string',
                    description:
                      'D2 source code. Embed `vars: { d2-config: { theme-id, layout-engine, theme-overrides } }` at the top to control rendering.',
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
        "List every diagram currently on the canvas — id, title, kind, position, size, page, version. Does NOT return the rendered bytes (the browser fetches those directly); use this to enumerate what is on the board. Also returns the operator's active selection and current canvas theme (`light` | `dark`).",
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
          theme: getTheme(),
        };
      },
    },

    {
      name: 'get_active_selection',
      description:
        'Return the diagram the operator currently has selected on the canvas — id, title, full spec (including the original source the operator is pointing at), position, size. Returns null if nothing is selected. Use this when the operator asks you to refine or update "this" diagram; the returned source is what you should base your update on. Also returns the operator\'s current canvas theme (`light` | `dark`) so a refinement can re-pick `theme-id` if the canvas has changed.',
      inputSchema: { type: 'object', properties: {} },
      async handler() {
        const entry = canvas.getActiveSelection();
        if (!entry) return { selected: null, theme: getTheme() };
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
          theme: getTheme(),
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

    {
      name: 'get_workflow',
      description:
        "Read the workflow graph the operator hand-drew on the canvas and use it to author a `.workflow.js` for the Claude Code Workflow tool. This is the INVERSE of `draw`: the operator sketches intent, you read it. Returns `{ workflow, theme }` — `workflow` is null when the operator hasn't drawn/selected one.\n\n" +
        "SELECTION-SCOPED: you only see the shapes the operator currently has SELECTED. If `workflow` is null or sparse, ask them to select the workflow shapes (select-all for the whole thing) and call again.\n\n" +
        '`workflow` has `nodes`, `edges`, and server-computed `hints`. Map each node `kind` to a Workflow primitive:\n' +
        '- `agent` → `agent({ prompt, model, schema })` from `node.agent`. If `model` is absent, choose by task (haiku for cheap classification, sonnet/opus for heavy work).\n' +
        '- `phase` → wrap its children in `phase(\'<label>\', …)`.\n' +
        '- `parallel` → `await parallel([...])` over its children (barrier fan-out).\n' +
        '- `pipeline` → `await pipeline(items, ...stages)` (no-barrier staged lane).\n' +
        '- `workflow` → `await workflow({ scriptPath, name }, args)` from `node.workflowRef` — a child script. NOTE: `workflow()` is INLINED; the child runs in the parent journal/cache chain, no runtime boundary.\n' +
        '- `gate` → a `needs_input` point: `return { status: \'needs_input\', question: <node.gate.question> }`. This is a RETURN-VALUE CONVENTION, not a runtime pause — the runtime will NOT stop for you.\n' +
        '- `branch` → an `if`/`else if` over a classifier result; each arm matches a label in `node.branch.outLabels` and the outgoing edge whose `from.port` is that label.\n' +
        '- `terminal` → a final `return { status: <node.terminal.status> }`.\n\n' +
        'Edge `class`: `control` = sequencing / branch arms; `data` = arg/return threading (answer-back-down on resume — keep upstream agent prompts from referencing answer args so the cached prefix stays valid); `propagate` = an explicit needs_input bubble-up the operator drew.\n\n' +
        'CRITICAL — propagation discipline. `hints.propagationPaths` lists, per gate, the `boundaryChain` of `workflow()` containers (outermost first) enclosing it. At EVERY boundary in that chain the generated parent MUST propagate:\n' +
        '    const child = await workflow({ scriptPath }, args);\n' +
        "    if (child && child.status === 'needs_input') return child;\n" +
        'Omit it at any boundary and the parent runs to completion with the child half-done — the runtime will not catch it.\n\n' +
        'Other hints: `entryNodes`/`topoOrder` → emit statements in topo order from the entry nodes. `loopBackEdges` → a "rejected → redo" loop; prefer the DISPATCHER-LOOP shape (return `{ status: \'rejected\' }` and let the operator re-invoke with an amended task) over an in-script `while` (which needs an explicit story for what changes each iteration). `danglingNodes`/`unknownContainerChildren` → shapes the operator drew but left unconnected or mis-parented; don\'t silently drop them — mention them and ask how they fit. Do not invent nodes the operator didn\'t draw; if the graph is ambiguous, ask before authoring the script.',
      inputSchema: { type: 'object', properties: {} },
      async handler() {
        return { workflow: buildWorkflowPayload(canvas), theme: getTheme() };
      },
    },
  ];
}
