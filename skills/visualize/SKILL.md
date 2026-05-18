---
name: visualize
description: >-
  Open the visualize board and draw the requested diagram on it. Use when
  the user types /visualize <topic>, asks to "draw this on the canvas",
  "visualize this system", "put X on the board", or wants a diagram rendered
  live alongside the conversation. With nothing selected and no topic it just
  opens the board; with a diagram already selected on the canvas, it refines
  that one in place instead of creating a new one.
disable-model-invocation: true
user-invocable: true
version: 0.1.0
---

# /visualize — paint a diagram on the canvas

The user wants you to draw or refine a diagram on the `visualize` board.
Follow these steps in order. The user may pass a `<topic>` argument; the
surrounding conversation is also part of the context.

## Step 1 — Ensure the board is open

Call `get_board_url` (no arguments). It returns `{ url, session_id, port }`.

If the tool is unavailable, the visualize plugin is not active in this
session; tell the user and stop.

Then run:

```bash
open "<url>"
```

`open` is idempotent — calling it when the tab already exists just focuses
it. On Linux substitute `xdg-open`, on Windows `start`. If none work, print
the URL and ask the user to open it manually.

## Step 2 — Decide what to draw

Three modes. Pick one based on the user's prompt and the canvas state:

### A — Just open the board
If the user invoked `/visualize` with no topic and no clear diagramming
intent (e.g., "/visualize" by itself or "where's the canvas?"), stop after
step 1. Don't draw anything.

### B — Refine an existing diagram
Call `get_active_selection`. If it returns `{ selected: { id, spec, … } }`
AND the user's prompt sounds like a refinement of an existing thing
("denser", "split out X", "add a step for Y", "use ELK", "make it TB",
"clearer labels"), refine the selected diagram in place.

Take the selected entry's `spec.source`, modify it, and call:
```
draw({ id: <selected.id>, title: <updated title>, spec: { kind: 'd2', source: <new source>, layout: <if needed> } })
```
Position and size are preserved automatically — never pass them on update.

### C — Draw something new
Otherwise: compose new D2 source and call `draw` without an `id`. The
server auto-places it on a grid.

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

## Step 4 — Pick the D2 layout

Pass `layout` on the spec when the structure benefits from a specific
engine:

- **`dagre`** (default) — fast and clean for acyclic flows, LR pipelines,
  TB lifecycles. Use when there are no back-edges.
- **`elk`** — graphs with cycles, feedback edges, back-references, or many
  cross-connections. Use this for any topology diagram with bidirectional
  arrows, request/response loops, or where dagre would sprawl.

Don't set `layout` for sequence/class/ER — those shapes pick their own
layout internally.

Set the diagram's `direction` (LR / TB / RL / BT) inline at the top of the
D2 source: `direction: right` for left-to-right flows, `direction: down`
for top-down lifecycles.

## Step 5 — Call `draw`

**Mode B (refinement)** — same id as the selected entry:
```
draw({
  id: <selected.id>,
  title: <updated title>,
  spec: { kind: 'd2', source: <new D2 source>, layout: <if needed> }
})
```

**Mode C (new)** — omit `id`, let the server assign one:
```
draw({
  title: <short kebab-case label>,
  spec: { kind: 'd2', source: <D2 source>, layout: <if needed> }
})
```

Never pass `position` — auto-placement is the server's job, and the
operator drags to refine.

If `draw` returns `{ ok: false, error: { messages: [{ line, column, text }] } }`,
the D2 source has a syntax issue. Read the error, fix the source, call
again. Common fixes: quote labels containing `{` `}` `<` `>`, escape
parentheses in node names, ensure block braces are closed.

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
