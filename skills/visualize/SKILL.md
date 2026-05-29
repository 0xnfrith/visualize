---
name: visualize
description: >-
  Open the visualize board and draw the requested diagram on it. Use when
  the user types /visualize <topic>, asks to "draw this on the canvas",
  "visualize this system", "put X on the board", or wants a diagram rendered
  live alongside the conversation. With nothing selected and no topic it just
  opens the board; with a diagram already selected on the canvas, it refines
  that one in place instead of creating a new one. Also handles the REVERSE
  direction: when the operator has hand-drawn a workflow on the canvas (e.g.
  "read my workflow", "turn this into a workflow script"), reads it via
  get_workflow and authors a .workflow.js from it.
disable-model-invocation: true
user-invocable: true
---

# /visualize — paint a diagram on the canvas

The user wants you to draw or refine a diagram on the `visualize` board.
Follow these steps in order. The user may pass a `<topic>` argument; the
surrounding conversation is also part of the context.

## Step 1 — Open the board in the browser (MANDATORY, every invocation)

This step has **two required actions**. Do BOTH on every `/visualize` call,
even if you think the board is already open — sessions restart, the MCP
port changes, and the operator cannot see anything you draw if the tab
isn't pointing at the current session's URL. Skipping the `open` shell
command is the single most common failure mode of this skill. Do not skip
it.

### 1a — Call `get_board_url`

No arguments. It returns `{ url, session_id, port, theme }` where `theme`
is `'light'` or `'dark'` — the operator's current canvas color scheme.
**Keep `theme`**, you'll use it in Step 4 to pick a contrasting D2 theme.

If the tool is unavailable, the visualize plugin is not active in this
session; tell the user and stop.

### 1b — Run `open "<url>"` in the shell

You MUST invoke the Bash tool with the returned URL. This is non-optional
and non-negotiable, regardless of:

- whether you "think" the board is already open from a previous session
- whether you just drew on it earlier in the conversation
- whether the user only asked you to draw and didn't say "open"
- whether the topic feels small enough to skip the ceremony

Run it. Every time. Before any `draw` call.

```bash
open "<url>"
```

`open` is idempotent — calling it when the tab already exists just focuses
it, costing nothing. On Linux substitute `xdg-open`, on Windows `start`.
If none of those work in the current environment, print the URL and ask
the user to open it manually — but try first.

## Step 2 — Decide what to draw

Three modes. Pick one based on the user's prompt and the canvas state:

### A — Just open the board
If the user invoked `/visualize` with no topic and no clear diagramming
intent (e.g., "/visualize" by itself or "where's the canvas?"), stop after
step 1. Don't draw anything.

### B — Refine an existing diagram
Call `get_active_selection`. It returns `{ selected, theme }`. If `selected`
is non-null AND the user's prompt sounds like a refinement of an existing
thing ("denser", "split out X", "add a step for Y", "use ELK", "make it TB",
"clearer labels"), refine the selected diagram in place. Note the returned
`theme` may differ from what you saw earlier — operator may have flipped
themes; re-pick `theme-id` in `vars.d2-config` accordingly.

Take the selected entry's `spec.source`, modify it, and call:
```
draw({ id: <selected.id>, title: <updated title>, spec: { kind: 'd2', source: <new source> } })
```
Position and size are preserved automatically — never pass them on update.

### C — Draw something new
Otherwise: compose new D2 source and call `draw` without an `id`. The
server auto-places it on a grid.

### D — Read a hand-drawn workflow (the reverse direction)
This mode is the INVERSE of drawing: the operator sketches a workflow on the
canvas using the workflow-primitive shapes (Agent, Gate, Branch, Terminal, and
the Phase/Parallel/Pipeline/Sub-workflow containers, wired with Control/Data/
Propagate connections), and you read it to author a `.workflow.js` for the
Claude Code Workflow tool.

Trigger: the operator says "I drew a workflow", "read my workflow", "turn this
into a workflow script", or similar.

1. **Tell the operator to SELECT the shapes** they want you to read — reading is
   selection-scoped. Select-all (Ctrl/Cmd-A) grabs the whole drawing; a partial
   selection reads just that subgraph. Nothing selected → empty.
2. Call **`get_workflow`** (or read the `visualize://workflow` MCP resource). It
   returns `{ workflow, theme }`. If `workflow` is null/empty, tell them you
   don't see a selected workflow and stop.
3. Map each node `kind` → Workflow primitive and honor `hints` — the
   `get_workflow` tool description is the authoritative mapping. The
   load-bearing rules:
   - At every `workflow()` boundary in each `hints.propagationPaths[].boundaryChain`,
     emit `const c = await workflow(...); if (c && c.status==='needs_input') return c`.
   - For `hints.loopBackEdges`, prefer the dispatcher-loop shape (return
     `{ status: 'rejected' }`) over an in-script `while`.
   - Surface `hints.danglingNodes` / `unknownContainerChildren` to the operator
     instead of silently dropping them; ask how they fit. Don't invent nodes.
4. Write the `.workflow.js` with the Write tool (this is the one place this flow
   leaves the canvas and touches the filesystem). Confirm the path with the
   operator if it isn't obvious from context.

## Step 3 — Pick the right D2 shape

D2 covers most diagram kinds. Pick the one that fits the topic:

- **Flow** (default) — `a -> b: label`. Plain D2. Use for data flow, call
  graphs, dependency graphs, pipelines.
- **Topology / C4** — nested containers via `name: { child1; child2 }`. Mix
  in `shape: person` for actors, `shape: hexagon` for external systems,
  `shape: cylinder` for databases. Connect across container boundaries with
  dotted paths: `outer.inner -> other.thing`.
- **Sequence diagram** — declare `shape: sequence_diagram` at the top, then
  lifelines and messages: `claude -> server: request`. Self-messages work
  (`x -> x: internal step`).
- **ER diagram** — one `shape: sql_table` per table with column rows
  (`+id int {constraint: primary_key}`). FK arrows go column-to-column:
  `posts.author_id -> users.id`.
- **UML class** — `shape: class` with `+field type` for attributes and
  `+method(args) return` for methods. `+` / `-` / `#` for visibility.

D2 does NOT do state diagrams cleanly yet — fork that conversation for
later, don't try to fake it.

## Step 4 — Configure the D2 program via `vars.d2-config`

The `draw` API has NO theme or layout params — everything goes inside the
D2 source via a `vars: { d2-config: {...} }` block at the top. Pick values
based on the `theme` you got from `get_board_url`.

### Required: `theme-id`

Pick a D2 theme that contrasts with the operator's canvas.

| Operator canvas | Good D2 theme IDs |
| --- | --- |
| `dark` | `200` (Dark Mauve), `201` (Dark Flagship Terrastruct) |
| `light` | `0` (Neutral Default), `1` (Neutral Grey), `3` (Flagship Terrastruct), `4` (Cool Classics), `5` (Mixed Berry Blue), `6` (Grape Soda), `7` (Aubergine), `8` (Colorblind Clear), `100`–`105` (Vanilla Nitro Cola, Orange Creamsicle, Shirley Temple, Earth Tones, Everglade Green, Buttered Toast), `300` (Terminal), `301` (Terminal Grayscale), `302` (Origami), `303` (C4) |

Notes:
- D2 also accepts a "light" theme as the only theme — useful if you want a
  bright pastel island on a dark canvas. Just be aware light themes default
  to dark text and look correct against light surroundings.
- Use `8` (Colorblind Clear) when accessibility matters.
- Use `300`/`301` (Terminal / Terminal Grayscale) for retro / monospace
  vibes — these apply caps-lock labels, square borders, and a mono font.

### Required when the structure needs it: `layout-engine`

- `dagre` (D2's default) — fast and clean for acyclic flows, LR pipelines,
  TB lifecycles.
- `elk` — graphs with cycles, feedback edges, back-references, dense
  cross-connections, or anywhere `dagre` would sprawl.
- `tala` — premium engine, only if installed.

Omit for `shape: sequence_diagram`, `shape: class`, `shape: sql_table` —
those pick their own internal layout.

### Optional: `theme-overrides` for fine-tuning

If the chosen theme is close but one color clashes, override individual
slots without writing a whole theme:

```d2
vars: {
  d2-config: {
    theme-id: 200
    theme-overrides: {
      B1: "#2E7D32"
      AB4: "#F44336"
    }
  }
}
```

See [d2lang.com/tour/themes](https://d2lang.com/tour/themes/#customizing-themes)
for the slot map.

### Example: dark canvas, topology diagram

```d2
vars: {
  d2-config: {
    theme-id: 200
    layout-engine: elk
  }
}

direction: right

client -> api: request
api -> db: query
db -> api: rows
api -> client: response
```

### Example: light canvas, sequence diagram

```d2
vars: {
  d2-config: {
    theme-id: 4
  }
}

shape: sequence_diagram
alice -> bob: hello
bob -> alice: hi
```

### Per-shape overrides

When you DO set `style.fill` on an individual shape, also set
`style.font-color` so the text contrasts with your custom fill — the theme
won't auto-pair for explicit colors.

## Step 5 — Call `draw`

**Mode B (refinement)** — same id as the selected entry:
```
draw({
  id: <selected.id>,
  title: <updated title>,
  spec: { kind: 'd2', source: <new D2 source> }
})
```

**Mode C (new)** — omit `id`, let the server assign one:
```
draw({
  title: <short kebab-case label>,
  spec: { kind: 'd2', source: <D2 source> }
})
```

Never pass `position` — auto-placement is the server's job, and the
operator drags to refine.

If `draw` returns `{ ok: false, error: { messages: [{ line, column, text }] } }`,
the D2 source has a syntax issue. Read the error, fix the source, call
again. Common fixes: quote labels containing `{` `}` `<` `>`, escape
parentheses in node names, ensure block braces are closed.

### Note on `kind: 'svg'`

For raw SVG (`spec.kind: 'svg'`) the same rule applies — pick stroke / fill
/ text colors that contrast with the operator's canvas theme from
`get_board_url`. There's no theme system to lean on; the SVG you author is
what renders.

## Step 6 — Focus

After a successful `draw`, call `focus({ id: <returned id> })`. This pans
and zooms the operator's viewport to the new (or updated) diagram so they
see it without scrolling, even if the canvas already had content elsewhere.

## After drawing

Briefly summarize what you drew or changed (2-3 lines max). Do not list
every node — the operator is looking at it. Invite them to:

- Drag the diagram to reposition (no need to ask permission)
- Add tldraw stickies, freehand notes, or arrows around it
- Select a diagram and ask you to refine — that triggers Mode B on the
  next `/visualize` call.
